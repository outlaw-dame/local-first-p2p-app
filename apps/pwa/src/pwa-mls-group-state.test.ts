/**
 * Phase 4d — MLS group membership view-model helper tests.
 *
 * All tests are pure: no Dexie, no network, no DOM.
 * States are constructed directly from the projection type.
 */
import { describe, expect, it } from 'vitest';
import {
  createEmptyMlsGroupProjectionState,
  type MlsGroupForkCandidate,
  type MlsGroupForkRecoveryRecord,
  type MlsGroupMember,
  type MlsGroupProjectionState
} from '@lfp2p/mls-group-projection';
import {
  buildMlsGroupViewModel,
  formatMlsGroupForkStatus,
  formatMlsGroupLocalDeviceStatus,
  isMlsGroupLocallyMember
} from './pwa-mls-group-state.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GROUP_ID = 'group:view-model-test';
const T0 = '2026-06-28T00:00:00.000Z';
const T1 = '2026-06-28T01:00:00.000Z';
const T2 = '2026-06-28T02:00:00.000Z';

function makeState(overrides: Partial<MlsGroupProjectionState> = {}): MlsGroupProjectionState {
  return Object.freeze({ ...createEmptyMlsGroupProjectionState(GROUP_ID, T0), ...overrides });
}

function makeMember(
  identityId: string,
  deviceId: string,
  addedAt: string,
  status: 'active' | 'removed' = 'active',
  removedAt?: string
): MlsGroupMember {
  return Object.freeze({
    identityId,
    deviceIds: [deviceId],
    status,
    addedAt,
    ...(removedAt !== undefined ? { removedAt } : {})
  });
}

// ---------------------------------------------------------------------------
// buildMlsGroupViewModel
// ---------------------------------------------------------------------------

describe('buildMlsGroupViewModel — undefined state', () => {
  it('returns an empty shell without throwing', () => {
    const vm = buildMlsGroupViewModel(undefined);
    expect(vm.groupId).toBe('');
    expect(vm.currentEpoch).toBe(0);
    expect(vm.membershipDigest).toBeUndefined();
    expect(vm.localDeviceMembershipStatus).toBe('unknown');
    expect(vm.members).toHaveLength(0);
    expect(vm.activeMemberCount).toBe(0);
    expect(vm.forkStatus.kind).toBe('none');
    expect(vm.rejectedControlCount).toBe(0);
    expect(vm.diagnostics).toHaveLength(0);
    expect(vm.lastControlId).toBeUndefined();
    expect(vm.updatedAt).toBe('');
  });

  it('output is frozen', () => {
    const vm = buildMlsGroupViewModel(undefined);
    expect(Object.isFrozen(vm)).toBe(true);
    expect(Object.isFrozen(vm.members)).toBe(true);
    expect(Object.isFrozen(vm.diagnostics)).toBe(true);
  });
});

describe('buildMlsGroupViewModel — single active member', () => {
  const state = makeState({
    members: Object.freeze({
      'identity:alice': makeMember('identity:alice', 'device:alice', T0)
    }),
    localDeviceMembershipStatus: 'member',
    acceptedControlIds: ['ctrl-000'],
    lastControlId: 'ctrl-000',
    currentEpoch: 0,
    updatedAt: T0
  });

  it('maps the member into the members array', () => {
    const vm = buildMlsGroupViewModel(state);
    expect(vm.members).toHaveLength(1);
    expect(vm.members[0]!.identityId).toBe('identity:alice');
    expect(vm.members[0]!.deviceIds).toContain('device:alice');
    expect(vm.members[0]!.status).toBe('active');
    expect(vm.members[0]!.addedAt).toBe(T0);
    expect(vm.members[0]!.removedAt).toBeUndefined();
  });

  it('activeMemberCount is 1', () => {
    expect(buildMlsGroupViewModel(state).activeMemberCount).toBe(1);
  });

  it('localDeviceMembershipStatus is propagated', () => {
    expect(buildMlsGroupViewModel(state).localDeviceMembershipStatus).toBe('member');
  });

  it('lastControlId is propagated', () => {
    expect(buildMlsGroupViewModel(state).lastControlId).toBe('ctrl-000');
  });

  it('output and member rows are frozen', () => {
    const vm = buildMlsGroupViewModel(state);
    expect(Object.isFrozen(vm)).toBe(true);
    expect(Object.isFrozen(vm.members)).toBe(true);
    expect(Object.isFrozen(vm.members[0])).toBe(true);
    expect(Object.isFrozen(vm.members[0]!.deviceIds)).toBe(true);
  });
});

describe('buildMlsGroupViewModel — member row sorting', () => {
  it('places active members before removed members', () => {
    const state = makeState({
      members: Object.freeze({
        'identity:bob': makeMember('identity:bob', 'device:bob', T0, 'removed', T1),
        'identity:alice': makeMember('identity:alice', 'device:alice', T1)
      })
    });
    const vm = buildMlsGroupViewModel(state);
    expect(vm.members[0]!.status).toBe('active');
    expect(vm.members[0]!.identityId).toBe('identity:alice');
    expect(vm.members[1]!.status).toBe('removed');
    expect(vm.members[1]!.identityId).toBe('identity:bob');
  });

  it('sorts by addedAt within the same status group', () => {
    const state = makeState({
      members: Object.freeze({
        'identity:charlie': makeMember('identity:charlie', 'device:charlie', T2),
        'identity:alice': makeMember('identity:alice', 'device:alice', T0),
        'identity:bob': makeMember('identity:bob', 'device:bob', T1)
      })
    });
    const vm = buildMlsGroupViewModel(state);
    expect(vm.members.map((m) => m.identityId)).toEqual([
      'identity:alice',
      'identity:bob',
      'identity:charlie'
    ]);
  });
});

describe('buildMlsGroupViewModel — activeMemberCount', () => {
  it('counts only active members when some are removed', () => {
    const state = makeState({
      members: Object.freeze({
        'identity:alice': makeMember('identity:alice', 'device:alice', T0),
        'identity:bob': makeMember('identity:bob', 'device:bob', T0, 'removed', T1),
        'identity:charlie': makeMember('identity:charlie', 'device:charlie', T0)
      })
    });
    expect(buildMlsGroupViewModel(state).activeMemberCount).toBe(2);
  });
});

describe('buildMlsGroupViewModel — membershipDigest passthrough', () => {
  it('is undefined when not set on the state', () => {
    expect(buildMlsGroupViewModel(makeState()).membershipDigest).toBeUndefined();
  });

  it('is propagated when set', () => {
    const state = makeState({ membershipDigest: 'sha256-abc123' });
    expect(buildMlsGroupViewModel(state).membershipDigest).toBe('sha256-abc123');
  });
});

// ---------------------------------------------------------------------------
// fork status derivation
// ---------------------------------------------------------------------------

describe('buildMlsGroupViewModel — fork status: none', () => {
  it('returns kind "none" when no candidates and no recovery records', () => {
    const vm = buildMlsGroupViewModel(makeState());
    expect(vm.forkStatus.kind).toBe('none');
  });
});

describe('buildMlsGroupViewModel — fork status: pending', () => {
  const candidate1: MlsGroupForkCandidate = Object.freeze({
    controlId: 'ctrl-fork-a',
    commitRef: 'ref-a',
    epoch: 1,
    issuerDeviceId: 'device:alice',
    detectedAt: T1
  });
  const candidate2: MlsGroupForkCandidate = Object.freeze({
    controlId: 'ctrl-fork-b',
    commitRef: 'ref-b',
    epoch: 1,
    issuerDeviceId: 'device:bob',
    detectedAt: T0
  });

  it('returns kind "pending" when candidates are present', () => {
    const state = makeState({ forkCandidates: [candidate1] });
    const vm = buildMlsGroupViewModel(state);
    expect(vm.forkStatus.kind).toBe('pending');
  });

  it('candidateCount reflects the number of candidates', () => {
    const state = makeState({ forkCandidates: [candidate1, candidate2] });
    const vm = buildMlsGroupViewModel(state);
    if (vm.forkStatus.kind !== 'pending') throw new Error('expected pending');
    expect(vm.forkStatus.candidateCount).toBe(2);
  });

  it('earliestDetectedAt is the lexicographically smallest detectedAt', () => {
    const state = makeState({ forkCandidates: [candidate1, candidate2] });
    const vm = buildMlsGroupViewModel(state);
    if (vm.forkStatus.kind !== 'pending') throw new Error('expected pending');
    // T0 < T1, so T0 is earliest
    expect(vm.forkStatus.earliestDetectedAt).toBe(T0);
  });

  it('pending supersedes resolved when both candidates and recovery records are present', () => {
    const recovery: MlsGroupForkRecoveryRecord = Object.freeze({
      selectedControlId: 'ctrl-old',
      rejectedControlIds: [],
      recoveryMethod: 'deterministic-fallback',
      resolvedAt: T0
    });
    const state = makeState({ forkCandidates: [candidate1], forkRecoveryRecords: [recovery] });
    expect(buildMlsGroupViewModel(state).forkStatus.kind).toBe('pending');
  });
});

describe('buildMlsGroupViewModel — fork status: resolved', () => {
  it('returns kind "resolved" when no candidates but recovery records exist', () => {
    const recovery: MlsGroupForkRecoveryRecord = Object.freeze({
      selectedControlId: 'ctrl-winner',
      rejectedControlIds: ['ctrl-loser'],
      recoveryMethod: 'policy-authority',
      resolvedAt: T1
    });
    const state = makeState({ forkRecoveryRecords: [recovery] });
    const vm = buildMlsGroupViewModel(state);
    expect(vm.forkStatus.kind).toBe('resolved');
    if (vm.forkStatus.kind !== 'resolved') throw new Error('expected resolved');
    expect(vm.forkStatus.recoveryMethod).toBe('policy-authority');
    expect(vm.forkStatus.resolvedAt).toBe(T1);
  });

  it('uses the most recent recovery record when multiple are present', () => {
    const first: MlsGroupForkRecoveryRecord = Object.freeze({
      selectedControlId: 'ctrl-a',
      rejectedControlIds: [],
      recoveryMethod: 'deterministic-fallback',
      resolvedAt: T0
    });
    const second: MlsGroupForkRecoveryRecord = Object.freeze({
      selectedControlId: 'ctrl-b',
      rejectedControlIds: [],
      recoveryMethod: 'policy-authority',
      resolvedAt: T1
    });
    const state = makeState({ forkRecoveryRecords: [first, second] });
    const vm = buildMlsGroupViewModel(state);
    if (vm.forkStatus.kind !== 'resolved') throw new Error('expected resolved');
    expect(vm.forkStatus.recoveryMethod).toBe('policy-authority');
    expect(vm.forkStatus.resolvedAt).toBe(T1);
  });
});

// ---------------------------------------------------------------------------
// rejectedControlCount
// ---------------------------------------------------------------------------

describe('buildMlsGroupViewModel — rejectedControlCount', () => {
  it('is 0 when no rejected controls', () => {
    expect(buildMlsGroupViewModel(makeState()).rejectedControlCount).toBe(0);
  });

  it('reflects the number of rejected control records', () => {
    const state = makeState({
      rejectedControls: [
        Object.freeze({ controlId: 'ctrl-bad-1', reason: 'orphan', rejectedAt: T0 }),
        Object.freeze({ controlId: 'ctrl-bad-2', reason: 'wrong epoch', rejectedAt: T1 })
      ]
    });
    expect(buildMlsGroupViewModel(state).rejectedControlCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// formatMlsGroupLocalDeviceStatus
// ---------------------------------------------------------------------------

describe('formatMlsGroupLocalDeviceStatus', () => {
  it.each([
    ['member', 'Member'],
    ['removed', 'Removed'],
    ['never-added', 'Not a member'],
    ['unknown', 'Unknown']
  ] as const)('status %s → label %s', (status, label) => {
    expect(formatMlsGroupLocalDeviceStatus(status)).toBe(label);
  });
});

// ---------------------------------------------------------------------------
// formatMlsGroupForkStatus
// ---------------------------------------------------------------------------

describe('formatMlsGroupForkStatus', () => {
  it('renders "No fork" for kind none', () => {
    expect(formatMlsGroupForkStatus({ kind: 'none' })).toBe('No fork');
  });

  it('renders singular "candidate" for count 1', () => {
    const view = Object.freeze({
      kind: 'pending' as const,
      candidateCount: 1,
      earliestDetectedAt: T0
    });
    expect(formatMlsGroupForkStatus(view)).toBe('Fork pending (1 candidate)');
  });

  it('renders plural "candidates" for count > 1', () => {
    const view = Object.freeze({
      kind: 'pending' as const,
      candidateCount: 3,
      earliestDetectedAt: T0
    });
    expect(formatMlsGroupForkStatus(view)).toBe('Fork pending (3 candidates)');
  });

  it('renders automatic label for deterministic-fallback recovery', () => {
    const view = Object.freeze({
      kind: 'resolved' as const,
      recoveryMethod: 'deterministic-fallback' as const,
      resolvedAt: T1
    });
    expect(formatMlsGroupForkStatus(view)).toBe('Fork resolved (automatic)');
  });

  it('renders authority label for policy-authority recovery', () => {
    const view = Object.freeze({
      kind: 'resolved' as const,
      recoveryMethod: 'policy-authority' as const,
      resolvedAt: T1
    });
    expect(formatMlsGroupForkStatus(view)).toBe('Fork resolved (authority)');
  });
});

// ---------------------------------------------------------------------------
// isMlsGroupLocallyMember
// ---------------------------------------------------------------------------

describe('isMlsGroupLocallyMember', () => {
  it('returns false for undefined state', () => {
    expect(isMlsGroupLocallyMember(undefined)).toBe(false);
  });

  it('returns true when localDeviceMembershipStatus is "member"', () => {
    expect(isMlsGroupLocallyMember(makeState({ localDeviceMembershipStatus: 'member' }))).toBe(
      true
    );
  });

  it.each(['removed', 'never-added', 'unknown'] as const)(
    'returns false for status %s',
    (status) => {
      expect(isMlsGroupLocallyMember(makeState({ localDeviceMembershipStatus: status }))).toBe(
        false
      );
    }
  );
});
