/**
 * Phase 4d — MLS group membership view-model helpers.
 *
 * Pure logic for the PWA group-membership surface. No DOM, no React, no IO.
 * The component layer renders these shapes and dispatches documented intents.
 */
import type {
  MlsGroupForkRecoveryMethod,
  MlsGroupLocalDeviceStatus,
  MlsGroupMemberStatus
} from '@lfp2p/mls-group-projection';
import type { StoredMlsGroupProjection } from '@lfp2p/local-store';

export type MlsGroupMemberRow = Readonly<{
  identityId: string;
  deviceIds: ReadonlyArray<string>;
  status: MlsGroupMemberStatus;
  addedAt: string;
  removedAt: string | undefined;
}>;

export type MlsGroupForkStatusView =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'pending'; candidateCount: number; earliestDetectedAt: string }>
  | Readonly<{ kind: 'resolved'; recoveryMethod: MlsGroupForkRecoveryMethod; resolvedAt: string }>;

export type MlsGroupViewModel = Readonly<{
  groupId: string;
  currentEpoch: number;
  membershipDigest: string | undefined;
  localDeviceMembershipStatus: MlsGroupLocalDeviceStatus;
  members: ReadonlyArray<MlsGroupMemberRow>;
  activeMemberCount: number;
  forkStatus: MlsGroupForkStatusView;
  rejectedControlCount: number;
  diagnostics: ReadonlyArray<string>;
  lastControlId: string | undefined;
  updatedAt: string;
}>;

const EMPTY_FORK_STATUS: MlsGroupForkStatusView = Object.freeze({ kind: 'none' as const });

/**
 * Build the view model from a frozen `StoredMlsGroupProjection`.
 *
 * Total function: `state === undefined` returns an empty shell so the UI
 * can render gracefully during bootstrap or when the group is not yet known.
 */
export function buildMlsGroupViewModel(
  state: StoredMlsGroupProjection | undefined
): MlsGroupViewModel {
  if (state === undefined) {
    return Object.freeze({
      groupId: '',
      currentEpoch: 0,
      membershipDigest: undefined,
      localDeviceMembershipStatus: 'unknown' as MlsGroupLocalDeviceStatus,
      members: Object.freeze([] as MlsGroupMemberRow[]),
      activeMemberCount: 0,
      forkStatus: EMPTY_FORK_STATUS,
      rejectedControlCount: 0,
      diagnostics: Object.freeze([] as string[]),
      lastControlId: undefined,
      updatedAt: ''
    });
  }

  const members: MlsGroupMemberRow[] = Object.values(state.members).map((m) =>
    Object.freeze({
      identityId: m.identityId,
      deviceIds: Object.freeze([...m.deviceIds]),
      status: m.status,
      addedAt: m.addedAt,
      removedAt: m.removedAt
    })
  );
  // Active first; within each status group, sort by addedAt ascending.
  members.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return a.addedAt.localeCompare(b.addedAt);
  });

  const activeMemberCount = members.filter((m) => m.status === 'active').length;

  return Object.freeze({
    groupId: state.groupId,
    currentEpoch: state.currentEpoch,
    membershipDigest: state.membershipDigest,
    localDeviceMembershipStatus: state.localDeviceMembershipStatus,
    members: Object.freeze(members),
    activeMemberCount,
    forkStatus: deriveForkStatusView(state),
    rejectedControlCount: state.rejectedControls.length,
    diagnostics: Object.freeze([...state.diagnostics]),
    lastControlId: state.lastControlId,
    updatedAt: state.updatedAt
  });
}

function deriveForkStatusView(state: StoredMlsGroupProjection): MlsGroupForkStatusView {
  if (state.forkCandidates.length > 0) {
    const earliest = state.forkCandidates.reduce(
      (min, c) => (c.detectedAt < min ? c.detectedAt : min),
      state.forkCandidates[0]!.detectedAt
    );
    return Object.freeze({
      kind: 'pending' as const,
      candidateCount: state.forkCandidates.length,
      earliestDetectedAt: earliest
    });
  }
  if (state.forkRecoveryRecords.length > 0) {
    const latest = state.forkRecoveryRecords[state.forkRecoveryRecords.length - 1]!;
    return Object.freeze({
      kind: 'resolved' as const,
      recoveryMethod: latest.recoveryMethod,
      resolvedAt: latest.resolvedAt
    });
  }
  return EMPTY_FORK_STATUS;
}

export function formatMlsGroupLocalDeviceStatus(status: MlsGroupLocalDeviceStatus): string {
  switch (status) {
    case 'member':
      return 'Member';
    case 'removed':
      return 'Removed';
    case 'never-added':
      return 'Not a member';
    case 'unknown':
      return 'Unknown';
  }
}

export function formatMlsGroupForkStatus(view: MlsGroupForkStatusView): string {
  switch (view.kind) {
    case 'none':
      return 'No fork';
    case 'pending':
      return `Fork pending (${view.candidateCount} candidate${view.candidateCount === 1 ? '' : 's'})`;
    case 'resolved':
      return view.recoveryMethod === 'deterministic-fallback'
        ? 'Fork resolved (automatic)'
        : 'Fork resolved (authority)';
  }
}

/**
 * True when the local device is a confirmed current member of the group.
 * False for `undefined` state and all non-`'member'` statuses.
 */
export function isMlsGroupLocallyMember(state: StoredMlsGroupProjection | undefined): boolean {
  return state?.localDeviceMembershipStatus === 'member';
}
