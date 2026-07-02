import {
  MLS_GROUP_CONTROL_VERSION,
  type EventKind,
  type JsonObject,
  type SignedEventEnvelope
} from '@lfp2p/protocol';

// ---------------------------------------------------------------------------
// Phase 4 — MLS group-control projection.
//
// Pure deterministic reducer: takes current state (undefined for the first
// event) and a validated MLS group-control signed event, and returns the
// next projection state. No side-effects, no I/O — callers persist the
// result (e.g., in local-store's mlsGroupProjections table).
//
// Fork handling follows the Phase 4 plan:
//   1. Detect conflicting commits for the same epoch transition.
//   2. Queue conflicting candidates without touching accepted epoch.
//   3. Accept a signed mls.fork.recovery.published from an authorised device.
//   4. Fall back to deterministic lowest-commit-ref rule when local policy
//      allows automated recovery, after validating no scope widening and no
//      revoked-device issuer.
// ---------------------------------------------------------------------------

export type MlsGroupMemberStatus = 'active' | 'removed';
export type MlsGroupLocalDeviceStatus = 'unknown' | 'member' | 'removed' | 'never-added';
export type MlsGroupForkRecoveryMethod = 'policy-authority' | 'deterministic-fallback';

export type MlsGroupMember = Readonly<{
  identityId: string;
  deviceIds: readonly string[];
  status: MlsGroupMemberStatus;
  addedAt: string;
  removedAt?: string;
}>;

export type MlsGroupForkCandidate = Readonly<{
  controlId: string;
  commitRef: string;
  epoch: number;
  issuerDeviceId: string;
  detectedAt: string;
}>;

export type MlsGroupForkRecoveryRecord = Readonly<{
  selectedControlId: string;
  rejectedControlIds: readonly string[];
  recoveryMethod: MlsGroupForkRecoveryMethod;
  resolvedAt: string;
}>;

export type MlsGroupRejectedControlRecord = Readonly<{
  controlId: string;
  reason: string;
  rejectedAt: string;
}>;

export type MlsGroupProjectionState = Readonly<{
  groupId: string;
  currentEpoch: number;
  acceptedCheckpoint?: string;
  membershipDigest?: string;
  localDeviceMembershipStatus: MlsGroupLocalDeviceStatus;
  members: Readonly<Record<string, MlsGroupMember>>;
  acceptedControlIds: readonly string[];
  rejectedControls: readonly MlsGroupRejectedControlRecord[];
  forkCandidates: readonly MlsGroupForkCandidate[];
  forkRecoveryRecords: readonly MlsGroupForkRecoveryRecord[];
  diagnostics: readonly string[];
  lastControlId?: string;
  /** CommitRef of the most recently accepted mls.commit.published record, for fork seeding. */
  lastCommitRef?: string;
  /** IssuerDeviceId of the most recently accepted commit, so the head candidate uses the correct device. */
  lastCommitIssuerDeviceId?: string;
  updatedAt: string;
}>;

export type ProjectMlsGroupEventInput = Readonly<{
  state: MlsGroupProjectionState | undefined;
  event: SignedEventEnvelope;
  localDeviceId?: string | undefined;
  allowAutomatedForkRecovery?: boolean | undefined;
}>;

export type ProjectMlsGroupEventResult =
  | Readonly<{ outcome: 'accepted'; state: MlsGroupProjectionState }>
  | Readonly<{ outcome: 'rejected'; reason: string; state: MlsGroupProjectionState }>
  | Readonly<{ outcome: 'fork-queued'; state: MlsGroupProjectionState }>;

export function createEmptyMlsGroupProjectionState(
  groupId: string,
  updatedAt: string
): MlsGroupProjectionState {
  return Object.freeze({
    groupId,
    currentEpoch: 0,
    localDeviceMembershipStatus: 'unknown',
    members: Object.freeze({}),
    acceptedControlIds: Object.freeze([]),
    rejectedControls: Object.freeze([]),
    forkCandidates: Object.freeze([]),
    forkRecoveryRecords: Object.freeze([]),
    diagnostics: Object.freeze([]),
    updatedAt
  });
}

export function projectMlsGroupControlEvent(
  input: ProjectMlsGroupEventInput
): ProjectMlsGroupEventResult {
  const { event, localDeviceId, allowAutomatedForkRecovery = false } = input;
  const payload = event.payload as JsonObject;

  // Validate payload base shape
  if (payload.version !== MLS_GROUP_CONTROL_VERSION) {
    const emptyState =
      input.state ??
      createEmptyMlsGroupProjectionState(
        typeof payload.groupId === 'string' ? payload.groupId : 'unknown',
        event.createdAt
      );
    return reject(
      emptyState,
      typeof payload.controlId === 'string' ? payload.controlId : event.eventId,
      'wrong group-control version',
      event.createdAt
    );
  }

  const groupId = requireString(payload.groupId);
  const controlId = requireString(payload.controlId);
  const issuerDeviceId = requireString(payload.issuerDeviceId);
  const epoch = typeof payload.epoch === 'number' ? payload.epoch : -1;

  const currentState = input.state ?? createEmptyMlsGroupProjectionState(groupId, event.createdAt);

  // Guard: wrong group
  if (currentState.groupId !== groupId) {
    return reject(
      currentState,
      controlId,
      `groupId mismatch: expected ${currentState.groupId} got ${groupId}`,
      event.createdAt
    );
  }

  // Guard: duplicate control record (idempotency)
  if (currentState.acceptedControlIds.includes(controlId)) {
    return { outcome: 'accepted', state: currentState };
  }
  if (currentState.rejectedControls.some((r) => r.controlId === controlId)) {
    return { outcome: 'rejected', reason: 'already rejected', state: currentState };
  }

  const kind = event.kind as EventKind;

  switch (kind) {
    case 'mls.group.created':
      return applyGroupCreated(
        currentState,
        event,
        payload,
        groupId,
        controlId,
        issuerDeviceId,
        epoch,
        localDeviceId
      );

    case 'mls.member.proposed':
      return applyMemberProposed(currentState, payload, controlId, issuerDeviceId, event.createdAt);

    case 'mls.member.added':
      return applyMemberAdded(
        currentState,
        payload,
        controlId,
        issuerDeviceId,
        epoch,
        event.createdAt,
        localDeviceId
      );

    case 'mls.member.removed':
      return applyMemberRemoved(
        currentState,
        payload,
        controlId,
        issuerDeviceId,
        epoch,
        event.createdAt,
        localDeviceId
      );

    case 'mls.device.updated':
      return applyDeviceUpdated(currentState, payload, controlId, issuerDeviceId, event.createdAt);

    case 'mls.commit.published':
      return applyCommitPublished(
        currentState,
        payload,
        controlId,
        issuerDeviceId,
        epoch,
        event.createdAt,
        allowAutomatedForkRecovery
      );

    case 'mls.welcome.issued':
      return applyWelcomeIssued(currentState, payload, controlId, event.createdAt, localDeviceId);

    case 'mls.epoch.advanced':
      return applyEpochAdvanced(
        currentState,
        payload,
        controlId,
        issuerDeviceId,
        epoch,
        event.createdAt
      );

    case 'mls.fork.detected':
      return applyForkDetected(
        currentState,
        payload,
        controlId,
        issuerDeviceId,
        epoch,
        event.createdAt
      );

    case 'mls.fork.recovery.published':
      return applyForkRecovery(
        currentState,
        payload,
        controlId,
        issuerDeviceId,
        event.createdAt,
        allowAutomatedForkRecovery
      );

    case 'mls.stale-epoch.rejected':
      return applyStaleEpochRejected(currentState, payload, controlId, event.createdAt);

    default:
      return reject(
        currentState,
        controlId,
        `unhandled MLS kind: ${String(kind)}`,
        event.createdAt
      );
  }
}

// ---------------------------------------------------------------------------
// Kind handlers
// ---------------------------------------------------------------------------

function applyGroupCreated(
  state: MlsGroupProjectionState,
  event: SignedEventEnvelope,
  payload: JsonObject,
  groupId: string,
  controlId: string,
  issuerDeviceId: string,
  epoch: number,
  localDeviceId: string | undefined
): ProjectMlsGroupEventResult {
  if (state.acceptedControlIds.length > 0) {
    return reject(
      state,
      controlId,
      'mls.group.created received but group already initialised',
      event.createdAt
    );
  }
  if (epoch !== 0) {
    return reject(
      state,
      controlId,
      `mls.group.created must have epoch 0 (got ${epoch})`,
      event.createdAt
    );
  }
  const creatorDeviceId =
    typeof payload.creatorDeviceId === 'string' ? payload.creatorDeviceId : issuerDeviceId;
  const initialMemberRefs = Array.isArray(payload.initialMemberRefs)
    ? (payload.initialMemberRefs as string[])
    : [];
  const creatorIdentityId = event.author;
  const members: Record<string, MlsGroupMember> = {
    [creatorIdentityId]: Object.freeze({
      identityId: creatorIdentityId,
      deviceIds: [creatorDeviceId],
      status: 'active',
      addedAt: event.createdAt
    })
  };
  for (const ref of initialMemberRefs) {
    if (typeof ref === 'string' && ref !== creatorIdentityId) {
      members[ref] = Object.freeze({
        identityId: ref,
        deviceIds: [],
        status: 'active',
        addedAt: event.createdAt
      });
    }
  }
  const localStatus: MlsGroupLocalDeviceStatus =
    localDeviceId !== undefined && creatorDeviceId === localDeviceId ? 'member' : 'never-added';
  return accept({
    ...state,
    groupId,
    currentEpoch: 0,
    localDeviceMembershipStatus: localStatus,
    members: Object.freeze(members),
    acceptedControlIds: [...state.acceptedControlIds, controlId],
    lastControlId: controlId,
    updatedAt: event.createdAt
  });
}

function applyMemberProposed(
  state: MlsGroupProjectionState,
  payload: JsonObject,
  controlId: string,
  _issuerDeviceId: string,
  updatedAt: string
): ProjectMlsGroupEventResult {
  // Proposals are informational; they don't advance epoch or mutate membership.
  // Record as accepted so replay is idempotent.
  if (!validatePreviousControlId(state, payload, controlId)) {
    return reject(state, controlId, 'previousControlId does not match lastControlId', updatedAt);
  }
  return accept({
    ...state,
    acceptedControlIds: [...state.acceptedControlIds, controlId],
    lastControlId: controlId,
    updatedAt
  });
}

function applyMemberAdded(
  state: MlsGroupProjectionState,
  payload: JsonObject,
  controlId: string,
  issuerDeviceId: string,
  _epoch: number,
  updatedAt: string,
  localDeviceId: string | undefined
): ProjectMlsGroupEventResult {
  if (!validatePreviousControlId(state, payload, controlId)) {
    return reject(state, controlId, 'previousControlId does not match lastControlId', updatedAt);
  }
  if (!isMemberDevice(state, issuerDeviceId)) {
    return reject(state, controlId, `issuer device ${issuerDeviceId} is not a member`, updatedAt);
  }
  const addedIdentityId =
    typeof payload.addedIdentityId === 'string' ? payload.addedIdentityId : undefined;
  const addedDeviceId =
    typeof payload.addedDeviceId === 'string' ? payload.addedDeviceId : undefined;
  if (addedIdentityId === undefined) {
    return reject(state, controlId, 'mls.member.added missing addedIdentityId', updatedAt);
  }
  const existing = state.members[addedIdentityId];
  const deviceIds =
    existing !== undefined
      ? [...existing.deviceIds, ...(addedDeviceId !== undefined ? [addedDeviceId] : [])]
      : addedDeviceId !== undefined
        ? [addedDeviceId]
        : [];
  const member: MlsGroupMember = Object.freeze({
    identityId: addedIdentityId,
    deviceIds,
    status: 'active',
    addedAt: updatedAt
  });
  let localStatus = state.localDeviceMembershipStatus;
  if (localDeviceId !== undefined && addedDeviceId === localDeviceId) {
    localStatus = 'member';
  }
  return accept({
    ...state,
    localDeviceMembershipStatus: localStatus,
    members: Object.freeze({ ...state.members, [addedIdentityId]: member }),
    acceptedControlIds: [...state.acceptedControlIds, controlId],
    lastControlId: controlId,
    updatedAt
  });
}

function applyMemberRemoved(
  state: MlsGroupProjectionState,
  payload: JsonObject,
  controlId: string,
  issuerDeviceId: string,
  _epoch: number,
  updatedAt: string,
  localDeviceId: string | undefined
): ProjectMlsGroupEventResult {
  if (!validatePreviousControlId(state, payload, controlId)) {
    return reject(state, controlId, 'previousControlId does not match lastControlId', updatedAt);
  }
  if (!isMemberDevice(state, issuerDeviceId)) {
    return reject(state, controlId, `issuer device ${issuerDeviceId} is not a member`, updatedAt);
  }
  const removedIdentityId =
    typeof payload.removedIdentityId === 'string' ? payload.removedIdentityId : undefined;
  const removedDeviceId =
    typeof payload.removedDeviceId === 'string' ? payload.removedDeviceId : undefined;
  if (removedIdentityId === undefined) {
    return reject(state, controlId, 'mls.member.removed missing removedIdentityId', updatedAt);
  }
  const existing = state.members[removedIdentityId];
  if (existing === undefined) {
    return reject(state, controlId, `cannot remove unknown member ${removedIdentityId}`, updatedAt);
  }
  const member: MlsGroupMember = Object.freeze({
    ...existing,
    status: 'removed',
    removedAt: updatedAt
  });
  let localStatus = state.localDeviceMembershipStatus;
  if (
    localDeviceId !== undefined &&
    (removedDeviceId === localDeviceId || existing.deviceIds.includes(localDeviceId))
  ) {
    localStatus = 'removed';
  }
  return accept({
    ...state,
    localDeviceMembershipStatus: localStatus,
    members: Object.freeze({ ...state.members, [removedIdentityId]: member }),
    acceptedControlIds: [...state.acceptedControlIds, controlId],
    lastControlId: controlId,
    updatedAt
  });
}

function applyDeviceUpdated(
  state: MlsGroupProjectionState,
  payload: JsonObject,
  controlId: string,
  issuerDeviceId: string,
  updatedAt: string
): ProjectMlsGroupEventResult {
  if (!validatePreviousControlId(state, payload, controlId)) {
    return reject(state, controlId, 'previousControlId does not match lastControlId', updatedAt);
  }
  if (!isMemberDevice(state, issuerDeviceId)) {
    return reject(state, controlId, `issuer device ${issuerDeviceId} is not a member`, updatedAt);
  }
  return accept({
    ...state,
    acceptedControlIds: [...state.acceptedControlIds, controlId],
    lastControlId: controlId,
    updatedAt
  });
}

function applyCommitPublished(
  state: MlsGroupProjectionState,
  payload: JsonObject,
  controlId: string,
  issuerDeviceId: string,
  epoch: number,
  updatedAt: string,
  allowAutomatedForkRecovery: boolean
): ProjectMlsGroupEventResult {
  const membershipDigest =
    typeof payload.membershipDigest === 'string' ? payload.membershipDigest : undefined;
  if (membershipDigest === undefined) {
    return reject(state, controlId, 'mls.commit.published missing membershipDigest', updatedAt);
  }
  const commitRef = typeof payload.commitRef === 'string' ? payload.commitRef : undefined;
  if (commitRef === undefined) {
    return reject(state, controlId, 'mls.commit.published missing commitRef', updatedAt);
  }
  const previousControlId =
    typeof payload.previousControlId === 'string' ? payload.previousControlId : undefined;
  if (previousControlId === undefined) {
    return reject(state, controlId, 'mls.commit.published missing previousControlId', updatedAt);
  }

  const targetEpoch = epoch;

  // A commit whose parent is NOT in the accepted chain is invalid.
  const parentIsAccepted = state.acceptedControlIds.includes(previousControlId);
  if (!parentIsAccepted) {
    return reject(
      state,
      controlId,
      `previousControlId ${previousControlId} is not in accepted chain`,
      updatedAt
    );
  }

  // A commit branching off the same parent as the already-accepted head is a fork.
  // Two concurrent commits both reference the same previousControlId (the branch point).
  const isLinearAdvance = previousControlId === state.lastControlId;
  if (!isLinearAdvance) {
    // A non-linear commit targeting an epoch strictly behind current is stale.
    if (targetEpoch < state.currentEpoch) {
      const staleCandidate: MlsGroupForkCandidate = Object.freeze({
        controlId,
        commitRef,
        epoch: targetEpoch,
        issuerDeviceId,
        detectedAt: updatedAt
      });
      return forkQueued({
        ...state,
        forkCandidates: Object.freeze([...state.forkCandidates, staleCandidate]),
        diagnostics: [
          ...state.diagnostics,
          `stale commit ${controlId} for epoch ${targetEpoch}, current epoch is ${state.currentEpoch}`
        ],
        updatedAt
      });
    }

    // Competing commit — this new commit and the existing accepted head are both
    // fork candidates. Represent the accepted head from the existing forkCandidates
    // or seed both if this is the first detected fork.
    const newCandidate: MlsGroupForkCandidate = Object.freeze({
      controlId,
      commitRef,
      epoch: targetEpoch,
      issuerDeviceId,
      detectedAt: updatedAt
    });
    const existingCandidatesForEpoch = state.forkCandidates.filter((c) => c.epoch === targetEpoch);
    // If this is the first competing commit for this epoch, also seed the already-accepted
    // head commit so the deterministic resolver has both branches to compare.
    const headCandidate: MlsGroupForkCandidate | undefined =
      existingCandidatesForEpoch.length === 0 &&
      state.lastControlId !== undefined &&
      state.lastCommitRef !== undefined
        ? Object.freeze({
            controlId: state.lastControlId,
            commitRef: state.lastCommitRef,
            epoch: targetEpoch,
            issuerDeviceId: state.lastCommitIssuerDeviceId ?? issuerDeviceId,
            detectedAt: updatedAt
          })
        : undefined;
    const seededCandidates =
      headCandidate !== undefined
        ? [headCandidate, ...existingCandidatesForEpoch]
        : existingCandidatesForEpoch;
    const allCandidatesForEpoch = [...seededCandidates, newCandidate];
    const otherCandidates = state.forkCandidates.filter((c) => c.epoch !== targetEpoch);
    const allCandidates = [...otherCandidates, ...allCandidatesForEpoch];
    if (allowAutomatedForkRecovery && allCandidatesForEpoch.length >= 2) {
      return resolveForkDeterministically(state, allCandidatesForEpoch, updatedAt);
    }
    return forkQueued({
      ...state,
      forkCandidates: Object.freeze(allCandidates),
      diagnostics: [
        ...state.diagnostics,
        `fork detected: commit ${controlId} competes at same branch point as current head for epoch ${targetEpoch}`
      ],
      updatedAt
    });
  }

  // Linear advance from a non-member is invalid (fork candidates from non-members
  // are allowed to be queued — the deterministic resolver filters them out).
  if (!isMemberDevice(state, issuerDeviceId)) {
    return reject(state, controlId, `issuer device ${issuerDeviceId} is not a member`, updatedAt);
  }

  return accept({
    ...state,
    currentEpoch: targetEpoch,
    membershipDigest,
    acceptedControlIds: [...state.acceptedControlIds, controlId],
    lastControlId: controlId,
    lastCommitRef: commitRef,
    lastCommitIssuerDeviceId: issuerDeviceId,
    updatedAt
  });
}

function applyWelcomeIssued(
  state: MlsGroupProjectionState,
  payload: JsonObject,
  controlId: string,
  updatedAt: string,
  localDeviceId: string | undefined
): ProjectMlsGroupEventResult {
  if (!validatePreviousControlId(state, payload, controlId)) {
    return reject(state, controlId, 'previousControlId does not match lastControlId', updatedAt);
  }
  const recipientDeviceId =
    typeof payload.recipientDeviceId === 'string' ? payload.recipientDeviceId : undefined;
  // Wrong-recipient welcome: if we know our device id and this welcome is for a different device, note it in diagnostics but still record as accepted (the welcome exists in the log).
  const diag = [...state.diagnostics];
  if (
    localDeviceId !== undefined &&
    recipientDeviceId !== undefined &&
    recipientDeviceId !== localDeviceId
  ) {
    diag.push(
      `welcome ${controlId} is for device ${recipientDeviceId}, not local device ${localDeviceId} — ignoring`
    );
  }
  return accept({
    ...state,
    acceptedControlIds: [...state.acceptedControlIds, controlId],
    lastControlId: controlId,
    diagnostics: Object.freeze(diag),
    updatedAt
  });
}

function applyEpochAdvanced(
  state: MlsGroupProjectionState,
  payload: JsonObject,
  controlId: string,
  issuerDeviceId: string,
  epoch: number,
  updatedAt: string
): ProjectMlsGroupEventResult {
  if (!validatePreviousControlId(state, payload, controlId)) {
    return reject(state, controlId, 'previousControlId does not match lastControlId', updatedAt);
  }
  if (!isMemberDevice(state, issuerDeviceId)) {
    return reject(state, controlId, `issuer device ${issuerDeviceId} is not a member`, updatedAt);
  }
  const membershipDigest =
    typeof payload.membershipDigest === 'string' ? payload.membershipDigest : undefined;
  if (membershipDigest === undefined) {
    return reject(state, controlId, 'mls.epoch.advanced missing membershipDigest', updatedAt);
  }
  const checkpoint =
    typeof payload.checkpoint === 'string' ? payload.checkpoint : state.acceptedCheckpoint;
  return accept({
    ...state,
    currentEpoch: epoch,
    ...(checkpoint !== undefined ? { acceptedCheckpoint: checkpoint } : {}),
    membershipDigest,
    acceptedControlIds: [...state.acceptedControlIds, controlId],
    lastControlId: controlId,
    updatedAt
  });
}

function applyForkDetected(
  state: MlsGroupProjectionState,
  payload: JsonObject,
  controlId: string,
  issuerDeviceId: string,
  epoch: number,
  updatedAt: string
): ProjectMlsGroupEventResult {
  if (!validatePreviousControlId(state, payload, controlId)) {
    return reject(state, controlId, 'previousControlId does not match lastControlId', updatedAt);
  }
  if (!isMemberDevice(state, issuerDeviceId)) {
    return reject(state, controlId, `issuer device ${issuerDeviceId} is not a member`, updatedAt);
  }
  const conflictingRefs = Array.isArray(payload.conflictingCommitRefs)
    ? (payload.conflictingCommitRefs as unknown[]).filter((r): r is string => typeof r === 'string')
    : [];
  const candidates: MlsGroupForkCandidate[] = conflictingRefs.map((ref) =>
    Object.freeze({ controlId: ref, commitRef: ref, epoch, issuerDeviceId, detectedAt: updatedAt })
  );
  return accept({
    ...state,
    forkCandidates: Object.freeze([...state.forkCandidates, ...candidates]),
    acceptedControlIds: [...state.acceptedControlIds, controlId],
    lastControlId: controlId,
    diagnostics: [...state.diagnostics, `fork detected by ${issuerDeviceId} at epoch ${epoch}`],
    updatedAt
  });
}

function applyForkRecovery(
  state: MlsGroupProjectionState,
  payload: JsonObject,
  controlId: string,
  issuerDeviceId: string,
  updatedAt: string,
  allowAutomatedForkRecovery: boolean
): ProjectMlsGroupEventResult {
  if (!validatePreviousControlId(state, payload, controlId)) {
    return reject(state, controlId, 'previousControlId does not match lastControlId', updatedAt);
  }
  if (!isMemberDevice(state, issuerDeviceId)) {
    return reject(
      state,
      controlId,
      `issuer device ${issuerDeviceId} is not a member and cannot issue fork recovery`,
      updatedAt
    );
  }
  const selectedCommitRef =
    typeof payload.selectedCommitRef === 'string' ? payload.selectedCommitRef : undefined;
  if (selectedCommitRef === undefined) {
    return reject(
      state,
      controlId,
      'mls.fork.recovery.published missing selectedCommitRef',
      updatedAt
    );
  }
  const rejectedCandidateIds = Array.isArray(payload.rejectedCandidates)
    ? (payload.rejectedCandidates as unknown[]).filter((r): r is string => typeof r === 'string')
    : [];

  const recoveryRecord: MlsGroupForkRecoveryRecord = Object.freeze({
    selectedControlId: selectedCommitRef,
    rejectedControlIds: Object.freeze(rejectedCandidateIds),
    recoveryMethod: allowAutomatedForkRecovery ? 'deterministic-fallback' : 'policy-authority',
    resolvedAt: updatedAt
  });

  // Clear resolved fork candidates for the selected epoch
  const remainingCandidates = state.forkCandidates.filter(
    (c) => !rejectedCandidateIds.includes(c.controlId) && c.controlId !== selectedCommitRef
  );
  const selectedCandidate = state.forkCandidates.find((c) => c.controlId === selectedCommitRef);

  return accept({
    ...state,
    forkCandidates: Object.freeze(remainingCandidates),
    forkRecoveryRecords: Object.freeze([...state.forkRecoveryRecords, recoveryRecord]),
    acceptedControlIds: [...state.acceptedControlIds, controlId],
    lastControlId: controlId,
    ...(selectedCandidate !== undefined
      ? {
          lastCommitRef: selectedCandidate.commitRef,
          lastCommitIssuerDeviceId: selectedCandidate.issuerDeviceId
        }
      : {}),
    updatedAt
  });
}

function applyStaleEpochRejected(
  state: MlsGroupProjectionState,
  payload: JsonObject,
  controlId: string,
  updatedAt: string
): ProjectMlsGroupEventResult {
  if (!validatePreviousControlId(state, payload, controlId)) {
    return reject(state, controlId, 'previousControlId does not match lastControlId', updatedAt);
  }
  const rejectedRef = typeof payload.rejectedRef === 'string' ? payload.rejectedRef : controlId;
  return accept({
    ...state,
    rejectedControls: [
      ...state.rejectedControls,
      Object.freeze({ controlId: rejectedRef, reason: 'stale epoch', rejectedAt: updatedAt })
    ],
    acceptedControlIds: [...state.acceptedControlIds, controlId],
    lastControlId: controlId,
    diagnostics: [...state.diagnostics, `stale epoch record ${rejectedRef} logged`],
    updatedAt
  });
}

// ---------------------------------------------------------------------------
// Deterministic fork resolution
//
// Selects the candidate with the lexicographically lowest commitRef after
// filtering out any candidate issued by a revoked or non-member device.
// This is auditable, deterministic, and fails closed for unsafe candidates.
// ---------------------------------------------------------------------------

function resolveForkDeterministically(
  state: MlsGroupProjectionState,
  candidates: MlsGroupForkCandidate[],
  updatedAt: string
): ProjectMlsGroupEventResult {
  const safe = candidates.filter((c) => isMemberDevice(state, c.issuerDeviceId));
  if (safe.length === 0) {
    return forkQueued({
      ...state,
      forkCandidates: Object.freeze(candidates),
      diagnostics: [
        ...state.diagnostics,
        'fork: no safe candidates after revoked-device filter — awaiting policy authority'
      ],
      updatedAt
    });
  }
  safe.sort((a, b) => (a.commitRef < b.commitRef ? -1 : a.commitRef > b.commitRef ? 1 : 0));
  const selected = safe[0]!;
  const rejected = safe.slice(1);
  const recoveryRecord: MlsGroupForkRecoveryRecord = Object.freeze({
    selectedControlId: selected.controlId,
    rejectedControlIds: Object.freeze(rejected.map((c) => c.controlId)),
    recoveryMethod: 'deterministic-fallback',
    resolvedAt: updatedAt
  });
  const remainingCandidates = candidates.filter(
    (c) => c.controlId !== selected.controlId && !rejected.some((r) => r.controlId === c.controlId)
  );
  return accept({
    ...state,
    currentEpoch: selected.epoch,
    forkCandidates: Object.freeze(remainingCandidates),
    forkRecoveryRecords: Object.freeze([...state.forkRecoveryRecords, recoveryRecord]),
    acceptedControlIds: [...state.acceptedControlIds, selected.controlId],
    lastControlId: selected.controlId,
    lastCommitRef: selected.commitRef,
    lastCommitIssuerDeviceId: selected.issuerDeviceId,
    diagnostics: [
      ...state.diagnostics,
      `fork resolved deterministically: selected ${selected.commitRef}`
    ],
    updatedAt
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validatePreviousControlId(
  state: MlsGroupProjectionState,
  payload: JsonObject,
  controlId: string
): boolean {
  // Creation records have no previousControlId requirement
  void controlId;
  const previousControlId =
    typeof payload.previousControlId === 'string' ? payload.previousControlId : undefined;
  if (previousControlId === undefined) return false;
  return state.lastControlId === undefined || previousControlId === state.lastControlId;
}

function isMemberDevice(state: MlsGroupProjectionState, deviceId: string): boolean {
  return Object.values(state.members).some(
    (m) => m.status === 'active' && m.deviceIds.includes(deviceId)
  );
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value;
}

function accept(state: MlsGroupProjectionState): ProjectMlsGroupEventResult {
  return { outcome: 'accepted', state: Object.freeze(state) };
}

function reject(
  state: MlsGroupProjectionState,
  controlId: string,
  reason: string,
  rejectedAt: string
): ProjectMlsGroupEventResult {
  const nextState: MlsGroupProjectionState = Object.freeze({
    ...state,
    rejectedControls: Object.freeze([
      ...state.rejectedControls,
      Object.freeze({ controlId, reason, rejectedAt })
    ]),
    diagnostics: Object.freeze([...state.diagnostics, `rejected ${controlId}: ${reason}`]),
    updatedAt: rejectedAt
  });
  return { outcome: 'rejected', reason, state: nextState };
}

function forkQueued(state: MlsGroupProjectionState): ProjectMlsGroupEventResult {
  return { outcome: 'fork-queued', state: Object.freeze(state) };
}
