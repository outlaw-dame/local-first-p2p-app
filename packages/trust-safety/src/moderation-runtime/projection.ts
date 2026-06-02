import { subjectKey } from '../curation-runtime/projection.js';
import type { SafetyAuthority } from '../authorities.js';
import { tsError } from '../errors.js';
import type { SafetyPolicy } from '../policies.js';
import type { SafetyPolicyDecision } from '../policy-decisions.js';
import {
  withFrozenAppliedEventId as withAppliedEventId,
  withFrozenBucketAppend,
  withFrozenRecordSet as withRecordSet
} from '../projection-helpers.js';
import type { SafetyReasonCode } from '../reason-codes.js';
import type { ModerationEvent, QueueResolution, QueueSourceKind } from './events.js';
import { validateModerationEvent } from './events.js';

// --- Record shapes -------------------------------------------------------

export type PolicyStatus = 'active' | 'deprecated';

export type PolicyVersionRecord = Readonly<{
  policy: SafetyPolicy;
  status: PolicyStatus;
  deprecatedBy?: SafetyAuthority;
  deprecatedAt?: string;
  deprecationReasonCode?: SafetyReasonCode;
  replacementPolicyId?: string;
}>;

export type QueueItemStatus = 'open' | 'assigned' | 'resolved';

export type QueueItemRecord = Readonly<{
  queueItemId: string;
  ownerAuthority: SafetyAuthority;
  sourceKind: QueueSourceKind;
  sourceId: string;
  reasonCode: SafetyReasonCode;
  summary?: string;
  status: QueueItemStatus;
  assignedTo?: SafetyAuthority;
  assignedAt?: string;
  resolvedBy?: SafetyAuthority;
  resolvedAt?: string;
  resolution?: QueueResolution;
  resolutionReasonCode?: SafetyReasonCode;
  resolutionDecisionId?: string;
  resolutionNotes?: string;
}>;

export type DecisionRecord = Readonly<{
  decision: SafetyPolicyDecision;
  recordedAt: string;
  sourceQueueItemId?: string;
}>;

// --- State ---------------------------------------------------------------

/**
 * Frozen moderation-runtime projection.
 *
 *  - `policiesByPolicyIdAndVersion`: keyed by `${policyId}::${versionNumber}`.
 *    Every version is preserved so an old decision's audit chain
 *    remains intact even after the policy is updated.
 *  - `activePolicyVersionByPolicyId`: points to the latest non-deprecated
 *    version. `undefined` after deprecation.
 *  - `decisionsById`: append-only by `decisionId`.
 *  - `decisionsBySubjectKey`: bucket of decisionIds per subject for
 *    "all moderation actions taken against this subject" queries.
 *  - `decisionsByPolicyId`: bucket of decisionIds per policyId for
 *    "all decisions made under this policy" queries.
 *  - `queueItemsById`: primary queue item records.
 *  - `queueIdsByStatus`: buckets per status.
 *  - `queueIdsByAssignee`: bucket of queue items keyed by assignee
 *    authorityId for a moderator inbox view.
 *  - `queueIdsBySourceId`: cross-reference index from
 *    `(sourceKind, sourceId)` back to the queue items that opened over
 *    them. Lets a downstream "show me the queue items for this report"
 *    lookup be O(1).
 *  - `appliedEventIds`: replay idempotency.
 */
export type ModerationState = Readonly<{
  policiesByPolicyIdAndVersion: Readonly<Record<string, PolicyVersionRecord>>;
  activePolicyVersionByPolicyId: Readonly<Record<string, number>>;
  decisionsById: Readonly<Record<string, DecisionRecord>>;
  decisionsBySubjectKey: Readonly<Record<string, ReadonlyArray<string>>>;
  decisionsByPolicyId: Readonly<Record<string, ReadonlyArray<string>>>;
  queueItemsById: Readonly<Record<string, QueueItemRecord>>;
  queueIdsByStatus: Readonly<Record<QueueItemStatus, ReadonlyArray<string>>>;
  queueIdsByAssignee: Readonly<Record<string, ReadonlyArray<string>>>;
  queueIdsBySourceId: Readonly<Record<string, ReadonlyArray<string>>>;
  appliedEventIds: ReadonlySet<string>;
}>;

export function createEmptyModerationState(): ModerationState {
  return Object.freeze({
    policiesByPolicyIdAndVersion: Object.freeze({}),
    activePolicyVersionByPolicyId: Object.freeze({}),
    decisionsById: Object.freeze({}),
    decisionsBySubjectKey: Object.freeze({}),
    decisionsByPolicyId: Object.freeze({}),
    queueItemsById: Object.freeze({}),
    queueIdsByStatus: Object.freeze({
      open: Object.freeze([]),
      assigned: Object.freeze([]),
      resolved: Object.freeze([])
    }),
    queueIdsByAssignee: Object.freeze({}),
    queueIdsBySourceId: Object.freeze({}),
    appliedEventIds: Object.freeze(new Set<string>())
  });
}

function policyVersionKey(policyId: string, versionNumber: number): string {
  return `${policyId}::${versionNumber}`;
}

function sourceKey(sourceKind: QueueSourceKind, sourceId: string): string {
  return `${sourceKind}::${sourceId}`;
}

function removeFromBucket(
  map: Readonly<Record<string, ReadonlyArray<string>>>,
  key: string,
  value: string
): Readonly<Record<string, ReadonlyArray<string>>> {
  const existing = map[key];
  if (existing === undefined) return map;
  if (!existing.includes(value)) return map;
  const filtered = existing.filter((v) => v !== value);
  return withRecordSet(map, key, Object.freeze(filtered));
}

// --- Apply ---------------------------------------------------------------

/**
 * Apply a single moderation-runtime event.
 *
 * Determinism rules:
 *  - Idempotent on `eventId`.
 *  - Validation runs before mutation.
 *  - Policy state machine: a policyId starts at version N=1 via
 *    `safety.policy.created`. Subsequent `safety.policy.updated` events
 *    must carry strictly increasing `policyVersionNumber` and a
 *    `supersedesPolicyVersionNumber` that matches the prior active
 *    version. After deprecation, no further updates accepted; a new
 *    `safety.policy.created` under a fresh `policyId` is the way to
 *    replace.
 *  - Queue state machine: `open → assigned → resolved` with
 *    `open → resolved` skip-assignment permitted. `resolved` is
 *    terminal — re-resolve, re-assign-after-resolve, and assign-without-
 *    prior-create all throw `TS_LIFECYCLE_TRANSITION`.
 *  - Decisions append idempotently on `decisionId`; if the decision's
 *    `policyVersion` field references a policy/version pair not in
 *    the projection, the decision is still accepted (the decision may
 *    have been made under a policy issued by a different community
 *    outside this projection's scope), but it is recorded with no
 *    cross-link.
 */
export function applyModerationEvent(
  state: ModerationState,
  event: ModerationEvent | unknown,
  label = 'applyModerationEvent'
): ModerationState {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    throw tsError('TS_INVALID_INPUT', `${label}: event must be a plain object`);
  }
  const e = validateModerationEvent(event, label);
  if (state.appliedEventIds.has(e.eventId)) return state;
  const appliedEventIds = withAppliedEventId(state.appliedEventIds, e.eventId);

  switch (e.kind) {
    case 'safety.policy.created': {
      const { policy } = e;
      const versionKey = policyVersionKey(policy.policyId, policy.policyVersionNumber);
      if (state.policiesByPolicyIdAndVersion[versionKey] !== undefined) {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: policy version "${versionKey}" already exists`
        );
      }
      if (state.activePolicyVersionByPolicyId[policy.policyId] !== undefined) {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: policy "${policy.policyId}" already exists; use safety.policy.updated`
        );
      }
      if (policy.policyVersionNumber !== 1) {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: safety.policy.created requires policyVersionNumber === 1 (got ${policy.policyVersionNumber})`
        );
      }
      const record: PolicyVersionRecord = Object.freeze({ policy, status: 'active' });
      return Object.freeze({
        ...state,
        policiesByPolicyIdAndVersion: withRecordSet(
          state.policiesByPolicyIdAndVersion,
          versionKey,
          record
        ),
        activePolicyVersionByPolicyId: withRecordSet(
          state.activePolicyVersionByPolicyId,
          policy.policyId,
          1
        ),
        appliedEventIds
      });
    }
    case 'safety.policy.updated': {
      const { policy } = e;
      const activeVersion = state.activePolicyVersionByPolicyId[policy.policyId];
      if (activeVersion === undefined) {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: cannot update unknown or deprecated policy "${policy.policyId}"`
        );
      }
      if (policy.policyVersionNumber !== activeVersion + 1) {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: policy update version must be ${activeVersion + 1} (got ${policy.policyVersionNumber})`
        );
      }
      if (
        policy.supersedesPolicyVersionNumber === undefined ||
        policy.supersedesPolicyVersionNumber !== activeVersion
      ) {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: supersedesPolicyVersionNumber must equal current active version (${activeVersion})`
        );
      }
      const versionKey = policyVersionKey(policy.policyId, policy.policyVersionNumber);
      const record: PolicyVersionRecord = Object.freeze({ policy, status: 'active' });
      return Object.freeze({
        ...state,
        policiesByPolicyIdAndVersion: withRecordSet(
          state.policiesByPolicyIdAndVersion,
          versionKey,
          record
        ),
        activePolicyVersionByPolicyId: withRecordSet(
          state.activePolicyVersionByPolicyId,
          policy.policyId,
          policy.policyVersionNumber
        ),
        appliedEventIds
      });
    }
    case 'safety.policy.deprecated': {
      const activeVersion = state.activePolicyVersionByPolicyId[e.policyId];
      if (activeVersion === undefined) {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: cannot deprecate unknown or already-deprecated policy "${e.policyId}"`
        );
      }
      const versionKey = policyVersionKey(e.policyId, activeVersion);
      const current = state.policiesByPolicyIdAndVersion[versionKey];
      if (current === undefined) {
        throw tsError(
          'TS_INVALID_INPUT',
          `${label}: internal inconsistency — active version record missing for "${versionKey}"`
        );
      }
      const updated: PolicyVersionRecord = Object.freeze({
        policy: current.policy,
        status: 'deprecated',
        deprecatedBy: e.deprecatedBy,
        deprecatedAt: e.deprecatedAt,
        deprecationReasonCode: e.reasonCode,
        ...(e.replacementPolicyId !== undefined
          ? { replacementPolicyId: e.replacementPolicyId }
          : {})
      });
      // Remove the active-version pointer; older versions remain in
      // the policy ledger for audit lookups.
      const nextActive: Record<string, number> = { ...state.activePolicyVersionByPolicyId };
      delete nextActive[e.policyId];
      return Object.freeze({
        ...state,
        policiesByPolicyIdAndVersion: withRecordSet(
          state.policiesByPolicyIdAndVersion,
          versionKey,
          updated
        ),
        activePolicyVersionByPolicyId: Object.freeze(nextActive),
        appliedEventIds
      });
    }
    case 'safety.policy.decision.recorded': {
      const { decision } = e;
      if (state.decisionsById[decision.decisionId] !== undefined) {
        // Append-only: silently no-op on duplicate decisionId.
        return Object.freeze({ ...state, appliedEventIds });
      }
      const record: DecisionRecord = Object.freeze({
        decision,
        recordedAt: e.createdAt,
        ...(e.sourceQueueItemId !== undefined ? { sourceQueueItemId: e.sourceQueueItemId } : {})
      });
      const sKey = subjectKey(decision.subject);
      return Object.freeze({
        ...state,
        decisionsById: withRecordSet(state.decisionsById, decision.decisionId, record),
        decisionsBySubjectKey: withFrozenBucketAppend(
          state.decisionsBySubjectKey,
          sKey,
          decision.decisionId
        ),
        // policyVersion is a string like 'community.policy.v1' — index
        // by it directly so a downstream query can find every decision
        // emitted under that exact policy version string.
        decisionsByPolicyId: withFrozenBucketAppend(
          state.decisionsByPolicyId,
          decision.policyVersion,
          decision.decisionId
        ),
        appliedEventIds
      });
    }
    case 'moderation.queue.item.created': {
      if (state.queueItemsById[e.queueItemId] !== undefined) {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: queue item "${e.queueItemId}" already exists`
        );
      }
      const record: QueueItemRecord = Object.freeze({
        queueItemId: e.queueItemId,
        ownerAuthority: e.ownerAuthority,
        sourceKind: e.sourceKind,
        sourceId: e.sourceId,
        reasonCode: e.reasonCode,
        ...(e.summary !== undefined ? { summary: e.summary } : {}),
        status: 'open' as const
      });
      return Object.freeze({
        ...state,
        queueItemsById: withRecordSet(state.queueItemsById, e.queueItemId, record),
        queueIdsByStatus: withRecordSet(
          state.queueIdsByStatus,
          'open',
          Object.freeze([...state.queueIdsByStatus.open, e.queueItemId])
        ) as ModerationState['queueIdsByStatus'],
        queueIdsBySourceId: withFrozenBucketAppend(
          state.queueIdsBySourceId,
          sourceKey(e.sourceKind, e.sourceId),
          e.queueItemId
        ),
        appliedEventIds
      });
    }
    case 'moderation.queue.item.assigned': {
      const existing = state.queueItemsById[e.queueItemId];
      if (existing === undefined) {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: cannot assign unknown queue item "${e.queueItemId}"`
        );
      }
      if (existing.status === 'resolved') {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: queue item "${e.queueItemId}" is already resolved`
        );
      }
      if (existing.status === 'assigned') {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: queue item "${e.queueItemId}" is already assigned`
        );
      }
      const next: QueueItemRecord = Object.freeze({
        ...existing,
        status: 'assigned' as const,
        assignedTo: e.assignedTo,
        assignedAt: e.assignedAt
      });
      const queueIdsByStatus = Object.freeze({
        open: Object.freeze(state.queueIdsByStatus.open.filter((id) => id !== e.queueItemId)),
        assigned: Object.freeze([...state.queueIdsByStatus.assigned, e.queueItemId]),
        resolved: state.queueIdsByStatus.resolved
      });
      return Object.freeze({
        ...state,
        queueItemsById: withRecordSet(state.queueItemsById, e.queueItemId, next),
        queueIdsByStatus,
        queueIdsByAssignee: withFrozenBucketAppend(
          state.queueIdsByAssignee,
          e.assignedTo.authorityId,
          e.queueItemId
        ),
        appliedEventIds
      });
    }
    case 'moderation.queue.item.resolved': {
      const existing = state.queueItemsById[e.queueItemId];
      if (existing === undefined) {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: cannot resolve unknown queue item "${e.queueItemId}"`
        );
      }
      if (existing.status === 'resolved') {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: queue item "${e.queueItemId}" is already resolved`
        );
      }
      const next: QueueItemRecord = Object.freeze({
        ...existing,
        status: 'resolved' as const,
        resolvedBy: e.resolvedBy,
        resolvedAt: e.resolvedAt,
        resolution: e.resolution,
        resolutionReasonCode: e.resolutionReasonCode,
        ...(e.resolutionDecisionId !== undefined
          ? { resolutionDecisionId: e.resolutionDecisionId }
          : {}),
        ...(e.resolutionNotes !== undefined ? { resolutionNotes: e.resolutionNotes } : {})
      });
      const prevStatus = existing.status;
      const queueIdsByStatus = Object.freeze({
        open:
          prevStatus === 'open'
            ? Object.freeze(state.queueIdsByStatus.open.filter((id) => id !== e.queueItemId))
            : state.queueIdsByStatus.open,
        assigned:
          prevStatus === 'assigned'
            ? Object.freeze(state.queueIdsByStatus.assigned.filter((id) => id !== e.queueItemId))
            : state.queueIdsByStatus.assigned,
        resolved: Object.freeze([...state.queueIdsByStatus.resolved, e.queueItemId])
      });
      const queueIdsByAssignee =
        existing.assignedTo === undefined
          ? state.queueIdsByAssignee
          : removeFromBucket(
              state.queueIdsByAssignee,
              existing.assignedTo.authorityId,
              e.queueItemId
            );
      return Object.freeze({
        ...state,
        queueItemsById: withRecordSet(state.queueItemsById, e.queueItemId, next),
        queueIdsByStatus,
        queueIdsByAssignee,
        appliedEventIds
      });
    }
  }
}

export function seedModerationState(
  events: Iterable<ModerationEvent | unknown>,
  label = 'seedModerationState'
): ModerationState {
  let state = createEmptyModerationState();
  let i = 0;
  for (const event of events) {
    state = applyModerationEvent(state, event, `${label}[${i}]`);
    i += 1;
  }
  return state;
}

// --- Query helpers -------------------------------------------------------

/**
 * Return queue items that opened against a specific source. Used by the
 * Phase 1.63 cross-reference: "show me all queue items spawned from
 * this `reportId`."
 */
export function queueItemsForSource(
  state: ModerationState,
  sourceKind: QueueSourceKind,
  sourceId: string
): ReadonlyArray<string> {
  return state.queueIdsBySourceId[sourceKey(sourceKind, sourceId)] ?? Object.freeze([]);
}
