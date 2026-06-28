import { describe, expect, it } from 'vitest';
import { MLS_GROUP_CONTROL_VERSION, type SignedEventEnvelope } from '@lfp2p/protocol';
import {
  createEmptyMlsGroupProjectionState,
  projectMlsGroupControlEvent,
  type MlsGroupProjectionState,
  type ProjectMlsGroupEventInput
} from './index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GROUP_ID = 'group:test-alpha';
const CREATOR_DEVICE = 'device:alice-phone';
const CREATOR_IDENTITY = 'identity:alice';
const BOB_IDENTITY = 'identity:bob';
const BOB_DEVICE = 'device:bob-laptop';
const CHARLIE_IDENTITY = 'identity:charlie';
const CHARLIE_DEVICE = 'device:charlie-pc';

function makeEvent(
  kind: string,
  payload: Record<string, unknown>,
  overrides: Partial<SignedEventEnvelope> = {}
): SignedEventEnvelope {
  return {
    version: 'lfp2p.event.v1' as const,
    eventId: `evt-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind: kind as SignedEventEnvelope['kind'],
    author: CREATOR_IDENTITY,
    deviceId: CREATOR_DEVICE,
    createdAt: '2026-06-27T00:00:00.000Z',
    lamport: 0,
    schemaVersion: 1,
    privacy: 'public' as const,
    payload: payload as unknown as SignedEventEnvelope['payload'],
    signature: { algorithm: 'ed25519' as const, publicKey: 'key-stub', value: 'sig-stub' },
    refs: [],
    ...overrides
  };
}

const BASE_CONTROL = {
  version: MLS_GROUP_CONTROL_VERSION,
  groupId: GROUP_ID,
  epoch: 0,
  controlId: 'ctrl-000',
  createdAt: '2026-06-27T00:00:00.000Z',
  issuerDeviceId: CREATOR_DEVICE
};

function groupCreatedEvent(overrides: Record<string, unknown> = {}): SignedEventEnvelope {
  return makeEvent('mls.group.created', {
    ...BASE_CONTROL,
    creatorDeviceId: CREATOR_DEVICE,
    ...overrides
  });
}

function applyCreation(localDeviceId?: string): MlsGroupProjectionState {
  const result = projectMlsGroupControlEvent({
    state: undefined,
    event: groupCreatedEvent(),
    localDeviceId
  });
  if (result.outcome !== 'accepted') throw new Error(`expected accepted, got ${result.outcome}`);
  return result.state;
}

// ---------------------------------------------------------------------------
// Group creation
// ---------------------------------------------------------------------------

describe('mls.group.created', () => {
  it('initialises projection from first control record', () => {
    const result = projectMlsGroupControlEvent({
      state: undefined,
      event: groupCreatedEvent(),
      localDeviceId: CREATOR_DEVICE
    });
    expect(result.outcome).toBe('accepted');
    if (result.outcome !== 'accepted') return;
    const s = result.state;
    expect(s.groupId).toBe(GROUP_ID);
    expect(s.currentEpoch).toBe(0);
    expect(s.acceptedControlIds).toContain('ctrl-000');
    expect(s.members[CREATOR_IDENTITY]?.status).toBe('active');
    expect(s.localDeviceMembershipStatus).toBe('member');
  });

  it('sets localDeviceMembershipStatus to never-added when local device is absent', () => {
    const result = projectMlsGroupControlEvent({
      state: undefined,
      event: groupCreatedEvent(),
      localDeviceId: 'device:other'
    });
    expect(result.outcome).toBe('accepted');
    if (result.outcome !== 'accepted') return;
    expect(result.state.localDeviceMembershipStatus).toBe('never-added');
  });

  it('rejects a second mls.group.created for an already-initialised group', () => {
    const state = applyCreation();
    const result = projectMlsGroupControlEvent({
      state,
      event: groupCreatedEvent({ controlId: 'ctrl-dup' }),
      localDeviceId: CREATOR_DEVICE
    });
    expect(result.outcome).toBe('rejected');
  });

  it('rejects mls.group.created with non-zero epoch', () => {
    const result = projectMlsGroupControlEvent({
      state: undefined,
      event: groupCreatedEvent({ epoch: 1 }),
      localDeviceId: CREATOR_DEVICE
    });
    expect(result.outcome).toBe('rejected');
  });

  it('rejects wrong group-control version', () => {
    const result = projectMlsGroupControlEvent({
      state: undefined,
      event: groupCreatedEvent({ version: 'lfp2p.mls-group-control.v2' }),
      localDeviceId: CREATOR_DEVICE
    });
    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.reason).toMatch(/version/);
  });
});

// ---------------------------------------------------------------------------
// Member add
// ---------------------------------------------------------------------------

describe('mls.member.added', () => {
  it('adds a new member and their device', () => {
    const state = applyCreation(CREATOR_DEVICE);
    const result = projectMlsGroupControlEvent({
      state,
      event: makeEvent('mls.member.added', {
        ...BASE_CONTROL,
        controlId: 'ctrl-001',
        previousControlId: 'ctrl-000',
        addedIdentityId: BOB_IDENTITY,
        addedDeviceId: BOB_DEVICE,
        welcomeRef: 'ref:welcome-1'
      }),
      localDeviceId: CREATOR_DEVICE
    });
    expect(result.outcome).toBe('accepted');
    if (result.outcome !== 'accepted') return;
    const s = result.state;
    expect(s.members[BOB_IDENTITY]?.status).toBe('active');
    expect(s.members[BOB_IDENTITY]?.deviceIds).toContain(BOB_DEVICE);
  });

  it('sets localDeviceMembershipStatus to member when local device is added', () => {
    const state = applyCreation(BOB_DEVICE);
    const result = projectMlsGroupControlEvent({
      state,
      event: makeEvent('mls.member.added', {
        ...BASE_CONTROL,
        controlId: 'ctrl-001',
        previousControlId: 'ctrl-000',
        addedIdentityId: BOB_IDENTITY,
        addedDeviceId: BOB_DEVICE,
        welcomeRef: 'ref:welcome-1'
      }),
      localDeviceId: BOB_DEVICE
    });
    expect(result.outcome).toBe('accepted');
    if (result.outcome !== 'accepted') return;
    expect(result.state.localDeviceMembershipStatus).toBe('member');
  });

  it('rejects member add from a non-member device', () => {
    const state = applyCreation(CREATOR_DEVICE);
    const result = projectMlsGroupControlEvent({
      state,
      event: makeEvent('mls.member.added', {
        ...BASE_CONTROL,
        controlId: 'ctrl-001',
        previousControlId: 'ctrl-000',
        issuerDeviceId: 'device:outsider',
        addedIdentityId: BOB_IDENTITY,
        addedDeviceId: BOB_DEVICE,
        welcomeRef: 'ref:welcome-1'
      }),
      localDeviceId: CREATOR_DEVICE
    });
    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.reason).toMatch(/not a member/);
  });

  it('rejects member add with wrong previousControlId', () => {
    const state = applyCreation(CREATOR_DEVICE);
    const result = projectMlsGroupControlEvent({
      state,
      event: makeEvent('mls.member.added', {
        ...BASE_CONTROL,
        controlId: 'ctrl-001',
        previousControlId: 'ctrl-WRONG',
        addedIdentityId: BOB_IDENTITY,
        addedDeviceId: BOB_DEVICE,
        welcomeRef: 'ref:welcome-1'
      }),
      localDeviceId: CREATOR_DEVICE
    });
    expect(result.outcome).toBe('rejected');
  });
});

// ---------------------------------------------------------------------------
// Member remove
// ---------------------------------------------------------------------------

describe('mls.member.removed', () => {
  function stateWithBob(): MlsGroupProjectionState {
    const s0 = applyCreation(CREATOR_DEVICE);
    const r = projectMlsGroupControlEvent({
      state: s0,
      event: makeEvent('mls.member.added', {
        ...BASE_CONTROL,
        controlId: 'ctrl-001',
        previousControlId: 'ctrl-000',
        addedIdentityId: BOB_IDENTITY,
        addedDeviceId: BOB_DEVICE,
        welcomeRef: 'ref:welcome-1'
      }),
      localDeviceId: CREATOR_DEVICE
    });
    if (r.outcome !== 'accepted') throw new Error('setup failed');
    return r.state;
  }

  it('removes a member and marks them as removed', () => {
    const state = stateWithBob();
    const result = projectMlsGroupControlEvent({
      state,
      event: makeEvent('mls.member.removed', {
        ...BASE_CONTROL,
        controlId: 'ctrl-002',
        previousControlId: 'ctrl-001',
        removedIdentityId: BOB_IDENTITY,
        removedDeviceId: BOB_DEVICE,
        removalReasonCode: 'left'
      }),
      localDeviceId: CREATOR_DEVICE
    });
    expect(result.outcome).toBe('accepted');
    if (result.outcome !== 'accepted') return;
    expect(result.state.members[BOB_IDENTITY]?.status).toBe('removed');
  });

  it('rejects removing an unknown member', () => {
    const state = applyCreation(CREATOR_DEVICE);
    const result = projectMlsGroupControlEvent({
      state,
      event: makeEvent('mls.member.removed', {
        ...BASE_CONTROL,
        controlId: 'ctrl-001',
        previousControlId: 'ctrl-000',
        removedIdentityId: 'identity:nobody',
        removalReasonCode: 'kicked'
      }),
      localDeviceId: CREATOR_DEVICE
    });
    expect(result.outcome).toBe('rejected');
  });

  it('rejects removal from a non-member device', () => {
    const state = stateWithBob();
    const result = projectMlsGroupControlEvent({
      state,
      event: makeEvent('mls.member.removed', {
        ...BASE_CONTROL,
        controlId: 'ctrl-002',
        previousControlId: 'ctrl-001',
        issuerDeviceId: 'device:outsider',
        removedIdentityId: BOB_IDENTITY,
        removalReasonCode: 'kicked'
      }),
      localDeviceId: CREATOR_DEVICE
    });
    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.reason).toMatch(/not a member/);
  });
});

// ---------------------------------------------------------------------------
// Stale epoch rejection
// ---------------------------------------------------------------------------

describe('mls.stale-epoch.rejected', () => {
  it('records a stale epoch notification without mutating accepted epoch', () => {
    const state = applyCreation(CREATOR_DEVICE);
    const result = projectMlsGroupControlEvent({
      state,
      event: makeEvent('mls.stale-epoch.rejected', {
        ...BASE_CONTROL,
        controlId: 'ctrl-001',
        previousControlId: 'ctrl-000',
        rejectedEpoch: 0,
        rejectedRef: 'ref:stale-msg-1'
      }),
      localDeviceId: CREATOR_DEVICE
    });
    expect(result.outcome).toBe('accepted');
    if (result.outcome !== 'accepted') return;
    expect(result.state.currentEpoch).toBe(0);
    expect(result.state.rejectedControls.some((r) => r.reason === 'stale epoch')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Idempotency / replay
// ---------------------------------------------------------------------------

describe('idempotency', () => {
  it('replaying an already-accepted control id returns accepted without mutating state', () => {
    const state = applyCreation(CREATOR_DEVICE);
    const result = projectMlsGroupControlEvent({
      state,
      event: groupCreatedEvent(),
      localDeviceId: CREATOR_DEVICE
    });
    // ctrl-000 was already accepted; projecting the same event again should be a no-op
    expect(result.outcome).toBe('accepted');
    if (result.outcome !== 'accepted') return;
    expect(result.state.acceptedControlIds).toEqual(state.acceptedControlIds);
  });

  it('replaying a rejected control id returns rejected without adding a second entry', () => {
    const state = applyCreation(CREATOR_DEVICE);
    // Try to add a non-existent member (will be rejected because issuerDevice is not a member via wrong device)
    const badEvent = makeEvent('mls.member.added', {
      ...BASE_CONTROL,
      controlId: 'ctrl-bad',
      previousControlId: 'ctrl-000',
      issuerDeviceId: 'device:outsider',
      addedIdentityId: BOB_IDENTITY,
      addedDeviceId: BOB_DEVICE,
      welcomeRef: 'ref:w'
    });
    const r1 = projectMlsGroupControlEvent({ state, event: badEvent });
    expect(r1.outcome).toBe('rejected');
    if (r1.outcome !== 'rejected') return;
    const r2 = projectMlsGroupControlEvent({ state: r1.state, event: badEvent });
    expect(r2.outcome).toBe('rejected');
    // Should not accumulate a second rejection entry
    const rejCount = r2.state.rejectedControls.filter((r) => r.controlId === 'ctrl-bad').length;
    expect(rejCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Fork detection
// ---------------------------------------------------------------------------

describe('fork detection', () => {
  it('queues a competing commit for the same epoch as a fork candidate', () => {
    const state = applyCreation(CREATOR_DEVICE);
    // First commit advancing epoch 0→1
    const commit1 = makeEvent('mls.commit.published', {
      ...BASE_CONTROL,
      controlId: 'ctrl-commit-A',
      previousControlId: 'ctrl-000',
      epoch: 1,
      commitRef: 'commit:aaa',
      membershipDigest: 'digest:A'
    });
    const r1 = projectMlsGroupControlEvent({ state, event: commit1, allowAutomatedForkRecovery: false });
    expect(r1.outcome).toBe('accepted');
    if (r1.outcome !== 'accepted') return;

    // Competing commit advancing same epoch 0→1
    const commit2 = makeEvent('mls.commit.published', {
      ...BASE_CONTROL,
      controlId: 'ctrl-commit-B',
      previousControlId: 'ctrl-000',
      epoch: 1,
      commitRef: 'commit:bbb',
      membershipDigest: 'digest:B'
    });
    const r2 = projectMlsGroupControlEvent({ state: r1.state, event: commit2, allowAutomatedForkRecovery: false });
    expect(r2.outcome).toBe('fork-queued');
    if (r2.outcome !== 'fork-queued') return;
    expect(r2.state.forkCandidates.length).toBeGreaterThan(0);
    expect(r2.state.currentEpoch).toBe(1); // accepted epoch unchanged
  });

  it('queues a stale commit for an already-advanced epoch', () => {
    const state = applyCreation(CREATOR_DEVICE);
    const commit1 = makeEvent('mls.commit.published', {
      ...BASE_CONTROL,
      controlId: 'ctrl-commit-A',
      previousControlId: 'ctrl-000',
      epoch: 1,
      commitRef: 'commit:aaa',
      membershipDigest: 'digest:A'
    });
    const r1 = projectMlsGroupControlEvent({ state, event: commit1 });
    if (r1.outcome !== 'accepted') return;
    // Now a late commit also claiming epoch 0→1
    const lateCommit = makeEvent('mls.commit.published', {
      ...BASE_CONTROL,
      controlId: 'ctrl-commit-late',
      previousControlId: 'ctrl-000',
      epoch: 0,
      commitRef: 'commit:late',
      membershipDigest: 'digest:late'
    });
    const r2 = projectMlsGroupControlEvent({ state: r1.state, event: lateCommit });
    expect(r2.outcome).toBe('fork-queued');
  });
});

// ---------------------------------------------------------------------------
// Deterministic fork recovery
// ---------------------------------------------------------------------------

describe('deterministic fork recovery', () => {
  it('selects the lexicographically lowest commitRef when allowAutomatedForkRecovery is true', () => {
    const state = applyCreation(CREATOR_DEVICE);
    const commit1 = makeEvent('mls.commit.published', {
      ...BASE_CONTROL,
      controlId: 'ctrl-commit-A',
      previousControlId: 'ctrl-000',
      epoch: 1,
      commitRef: 'commit:bbb',
      membershipDigest: 'digest:A'
    });
    const r1 = projectMlsGroupControlEvent({ state, event: commit1 });
    if (r1.outcome !== 'accepted') throw new Error('setup failed');

    const commit2 = makeEvent('mls.commit.published', {
      ...BASE_CONTROL,
      controlId: 'ctrl-commit-B',
      previousControlId: 'ctrl-000',
      epoch: 1,
      commitRef: 'commit:aaa',
      membershipDigest: 'digest:B'
    });
    const r2 = projectMlsGroupControlEvent({
      state: r1.state,
      event: commit2,
      allowAutomatedForkRecovery: true
    });
    // Should resolve deterministically to the lowest commitRef ('commit:aaa' < 'commit:bbb')
    expect(r2.outcome).toBe('accepted');
    if (r2.outcome !== 'accepted') return;
    expect(r2.state.forkRecoveryRecords.length).toBe(1);
    expect(r2.state.forkRecoveryRecords[0]?.recoveryMethod).toBe('deterministic-fallback');
    expect(r2.state.diagnostics.some((d) => d.includes('deterministically'))).toBe(true);
  });

  it('keeps fork queued when all candidates are from revoked/non-member devices', () => {
    // Create a state where the fork candidates have an outsider device
    const state = applyCreation(CREATOR_DEVICE);
    const commit1 = makeEvent('mls.commit.published', {
      ...BASE_CONTROL,
      controlId: 'ctrl-commit-A',
      previousControlId: 'ctrl-000',
      epoch: 1,
      commitRef: 'commit:aaa',
      membershipDigest: 'digest:A'
    });
    const r1 = projectMlsGroupControlEvent({ state, event: commit1 });
    if (r1.outcome !== 'accepted') throw new Error('setup failed');

    // Competing commit from a non-member (outsider) device
    const commit2 = makeEvent('mls.commit.published', {
      ...BASE_CONTROL,
      controlId: 'ctrl-commit-B',
      previousControlId: 'ctrl-000',
      issuerDeviceId: 'device:outsider',
      epoch: 1,
      commitRef: 'commit:bbb',
      membershipDigest: 'digest:B'
    });
    const r2 = projectMlsGroupControlEvent({
      state: r1.state,
      event: commit2,
      allowAutomatedForkRecovery: true
    });
    // Should queue (not panic) and note it awaits policy authority
    expect(r2.outcome).toBe('fork-queued');
    if (r2.outcome !== 'fork-queued') return;
    expect(r2.state.diagnostics.some((d) => d.includes('policy authority'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Policy-authority fork recovery (mls.fork.recovery.published)
// ---------------------------------------------------------------------------

describe('mls.fork.recovery.published', () => {
  it('resolves a fork via signed recovery record and clears candidates', () => {
    const state = applyCreation(CREATOR_DEVICE);
    const commit1 = makeEvent('mls.commit.published', {
      ...BASE_CONTROL,
      controlId: 'ctrl-commit-A',
      previousControlId: 'ctrl-000',
      epoch: 1,
      commitRef: 'commit:aaa',
      membershipDigest: 'digest:A'
    });
    const r1 = projectMlsGroupControlEvent({ state, event: commit1 });
    if (r1.outcome !== 'accepted') throw new Error('setup failed');

    const commit2 = makeEvent('mls.commit.published', {
      ...BASE_CONTROL,
      controlId: 'ctrl-commit-B',
      previousControlId: 'ctrl-000',
      epoch: 1,
      commitRef: 'commit:bbb',
      membershipDigest: 'digest:B'
    });
    const r2 = projectMlsGroupControlEvent({ state: r1.state, event: commit2 });
    if (r2.outcome !== 'fork-queued') throw new Error('expected fork-queued');

    const recovery = makeEvent('mls.fork.recovery.published', {
      ...BASE_CONTROL,
      controlId: 'ctrl-recovery-1',
      previousControlId: 'ctrl-commit-A',
      selectedCommitRef: 'ctrl-commit-A',
      rejectedCandidates: ['ctrl-commit-B'],
      policyAuthorityId: CREATOR_IDENTITY
    });
    const r3 = projectMlsGroupControlEvent({ state: r2.state, event: recovery });
    expect(r3.outcome).toBe('accepted');
    if (r3.outcome !== 'accepted') return;
    expect(r3.state.forkRecoveryRecords.length).toBe(1);
    expect(r3.state.forkCandidates.filter((c) => c.controlId === 'ctrl-commit-B').length).toBe(0);
  });

  it('rejects recovery from a non-member device', () => {
    const state = applyCreation(CREATOR_DEVICE);
    const recovery = makeEvent('mls.fork.recovery.published', {
      ...BASE_CONTROL,
      controlId: 'ctrl-recovery-bad',
      previousControlId: 'ctrl-000',
      issuerDeviceId: 'device:outsider',
      selectedCommitRef: 'ctrl-commit-A',
      rejectedCandidates: []
    });
    const result = projectMlsGroupControlEvent({ state, event: recovery });
    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.reason).toMatch(/not a member/);
  });
});

// ---------------------------------------------------------------------------
// Wrong-recipient welcome routing
// ---------------------------------------------------------------------------

describe('mls.welcome.issued', () => {
  it('accepts a welcome addressed to the local device', () => {
    const state = applyCreation(CREATOR_DEVICE);
    const result = projectMlsGroupControlEvent({
      state,
      event: makeEvent('mls.welcome.issued', {
        ...BASE_CONTROL,
        controlId: 'ctrl-welcome-1',
        previousControlId: 'ctrl-000',
        recipientIdentityId: BOB_IDENTITY,
        recipientDeviceId: BOB_DEVICE,
        welcomeRef: 'ref:welcome-1'
      }),
      localDeviceId: BOB_DEVICE
    });
    expect(result.outcome).toBe('accepted');
    if (result.outcome !== 'accepted') return;
    expect(result.state.diagnostics.some((d) => d.includes('ignoring'))).toBe(false);
  });

  it('records a diagnostic when welcome is for a different device but still accepts the control', () => {
    const state = applyCreation(CREATOR_DEVICE);
    const result = projectMlsGroupControlEvent({
      state,
      event: makeEvent('mls.welcome.issued', {
        ...BASE_CONTROL,
        controlId: 'ctrl-welcome-wrong',
        previousControlId: 'ctrl-000',
        recipientIdentityId: BOB_IDENTITY,
        recipientDeviceId: BOB_DEVICE,
        welcomeRef: 'ref:welcome-wrong'
      }),
      localDeviceId: CHARLIE_DEVICE
    });
    expect(result.outcome).toBe('accepted');
    if (result.outcome !== 'accepted') return;
    expect(result.state.diagnostics.some((d) => d.includes('ignoring'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Epoch advancement
// ---------------------------------------------------------------------------

describe('mls.epoch.advanced', () => {
  it('advances the epoch and stores checkpoint and membershipDigest', () => {
    const state = applyCreation(CREATOR_DEVICE);
    const result = projectMlsGroupControlEvent({
      state,
      event: makeEvent('mls.epoch.advanced', {
        ...BASE_CONTROL,
        controlId: 'ctrl-epoch-adv',
        previousControlId: 'ctrl-000',
        epoch: 1,
        priorEpoch: 0,
        nextEpoch: 1,
        checkpoint: 'ckpt-1',
        membershipDigest: 'sha256:abc123'
      }),
      localDeviceId: CREATOR_DEVICE
    });
    expect(result.outcome).toBe('accepted');
    if (result.outcome !== 'accepted') return;
    expect(result.state.currentEpoch).toBe(1);
    expect(result.state.acceptedCheckpoint).toBe('ckpt-1');
    expect(result.state.membershipDigest).toBe('sha256:abc123');
  });

  it('rejects epoch.advanced from a non-member device', () => {
    const state = applyCreation(CREATOR_DEVICE);
    const result = projectMlsGroupControlEvent({
      state,
      event: makeEvent('mls.epoch.advanced', {
        ...BASE_CONTROL,
        controlId: 'ctrl-epoch-bad',
        previousControlId: 'ctrl-000',
        issuerDeviceId: 'device:outsider',
        epoch: 1,
        membershipDigest: 'sha256:abc'
      })
    });
    expect(result.outcome).toBe('rejected');
  });
});

// ---------------------------------------------------------------------------
// Multi-device offline catch-up
// ---------------------------------------------------------------------------

describe('offline catch-up', () => {
  it('accepts a chain of control records applied out of storage order after all are present', () => {
    // Simulate receiving events in order (storage order = correct causal order)
    let state: MlsGroupProjectionState | undefined;

    const events = [
      makeEvent('mls.group.created', { ...BASE_CONTROL, controlId: 'ctrl-000', creatorDeviceId: CREATOR_DEVICE }),
      makeEvent('mls.member.added', {
        ...BASE_CONTROL, controlId: 'ctrl-001', previousControlId: 'ctrl-000',
        addedIdentityId: BOB_IDENTITY, addedDeviceId: BOB_DEVICE, welcomeRef: 'ref:w1'
      }),
      makeEvent('mls.member.added', {
        ...BASE_CONTROL, controlId: 'ctrl-002', previousControlId: 'ctrl-001',
        addedIdentityId: CHARLIE_IDENTITY, addedDeviceId: CHARLIE_DEVICE, welcomeRef: 'ref:w2'
      }),
      makeEvent('mls.epoch.advanced', {
        ...BASE_CONTROL, controlId: 'ctrl-003', previousControlId: 'ctrl-002',
        epoch: 1, priorEpoch: 0, nextEpoch: 1, checkpoint: 'ckpt-1',
        membershipDigest: 'sha256:catch-up'
      })
    ];

    for (const event of events) {
      const result = projectMlsGroupControlEvent({ state, event, localDeviceId: CREATOR_DEVICE });
      expect(result.outcome).toBe('accepted');
      if (result.outcome !== 'accepted') return;
      state = result.state;
    }

    expect(state?.currentEpoch).toBe(1);
    expect(state?.members[BOB_IDENTITY]?.status).toBe('active');
    expect(state?.members[CHARLIE_IDENTITY]?.status).toBe('active');
    expect(state?.acceptedCheckpoint).toBe('ckpt-1');
  });
});

// ---------------------------------------------------------------------------
// createEmptyMlsGroupProjectionState
// ---------------------------------------------------------------------------

describe('createEmptyMlsGroupProjectionState', () => {
  it('returns a frozen initial state', () => {
    const s = createEmptyMlsGroupProjectionState(GROUP_ID, '2026-06-27T00:00:00.000Z');
    expect(s.groupId).toBe(GROUP_ID);
    expect(s.currentEpoch).toBe(0);
    expect(s.acceptedControlIds).toHaveLength(0);
    expect(s.localDeviceMembershipStatus).toBe('unknown');
    expect(Object.isFrozen(s)).toBe(true);
  });
});
