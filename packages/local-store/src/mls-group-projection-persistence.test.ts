import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { MLS_GROUP_CONTROL_VERSION, type SignedEventEnvelope } from '@lfp2p/protocol';
import {
  createLocalFirstStore,
  type AppendMlsGroupControlEventResult
} from './index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GROUP_ID = 'group:store-test-alpha';
const CREATOR_IDENTITY = 'identity:alice';
const CREATOR_DEVICE = 'device:alice-phone';
const BOB_IDENTITY = 'identity:bob';
const BOB_DEVICE = 'device:bob-laptop';

let _seq = 0;
function makeEvent(
  kind: string,
  payload: Record<string, unknown>,
  overrides: Partial<SignedEventEnvelope> = {}
): SignedEventEnvelope {
  _seq++;
  return {
    version: 'lfp2p.event.v1' as const,
    eventId: `evt-${kind}-${_seq}`,
    kind: kind as SignedEventEnvelope['kind'],
    author: CREATOR_IDENTITY,
    deviceId: CREATOR_DEVICE,
    createdAt: '2026-06-27T00:00:00.000Z',
    lamport: _seq,
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

function memberAddedEvent(overrides: Record<string, unknown> = {}): SignedEventEnvelope {
  return makeEvent('mls.member.added', {
    ...BASE_CONTROL,
    controlId: 'ctrl-001',
    previousControlId: 'ctrl-000',
    addedIdentityId: BOB_IDENTITY,
    addedDeviceId: BOB_DEVICE,
    ...overrides
  });
}

// ---------------------------------------------------------------------------
// Phase 4b — MLS group-control projection persistence
// ---------------------------------------------------------------------------

describe('getMlsGroupProjection', () => {
  it('returns undefined for a group that has never been seen', async () => {
    const store = createLocalFirstStore(`mls-test-${globalThis.crypto.randomUUID()}`);
    try {
      const result = await store.getMlsGroupProjection('group:never-seen');
      expect(result).toBeUndefined();
    } finally {
      await store.delete();
    }
  });
});

describe('appendMlsGroupControlEvent — mls.group.created', () => {
  it('persists the event and returns accepted projection', async () => {
    const store = createLocalFirstStore(`mls-test-${globalThis.crypto.randomUUID()}`);
    try {
      const event = groupCreatedEvent();
      const result = await store.appendMlsGroupControlEvent(event, {
        localDeviceId: CREATOR_DEVICE,
        updatedAt: '2026-06-27T00:00:00.000Z'
      });

      expect(result.status).toBe('stored');
      expect(result.outcome).toBe('accepted');
      expect(result.state.groupId).toBe(GROUP_ID);
      expect(result.state.currentEpoch).toBe(0);
      expect(result.state.acceptedControlIds).toContain('ctrl-000');
      expect(result.state.members[CREATOR_IDENTITY]?.status).toBe('active');
      expect(result.state.localDeviceMembershipStatus).toBe('member');

      // Signed event must also land in signedEvents table
      const stored = await store.getSignedEvent(event.eventId);
      expect(stored).toBeDefined();
    } finally {
      await store.delete();
    }
  });

  it('updates the cached projection readable via getMlsGroupProjection', async () => {
    const store = createLocalFirstStore(`mls-test-${globalThis.crypto.randomUUID()}`);
    try {
      const event = groupCreatedEvent();
      await store.appendMlsGroupControlEvent(event, { updatedAt: '2026-06-27T00:00:00.000Z' });

      const state = await store.getMlsGroupProjection(GROUP_ID);
      expect(state).toBeDefined();
      expect(state?.groupId).toBe(GROUP_ID);
      expect(state?.acceptedControlIds).toContain('ctrl-000');
    } finally {
      await store.delete();
    }
  });
});

describe('appendMlsGroupControlEvent — idempotency', () => {
  it('re-appending the same eventId is a silent no-op returning skipped', async () => {
    const store = createLocalFirstStore(`mls-test-${globalThis.crypto.randomUUID()}`);
    try {
      const event = groupCreatedEvent();
      const first = await store.appendMlsGroupControlEvent(event, {
        updatedAt: '2026-06-27T00:00:00.000Z'
      });
      const second = await store.appendMlsGroupControlEvent(event, {
        updatedAt: '2026-06-27T00:01:00.000Z'
      });

      expect(first.status).toBe('stored');
      expect(second.status).toBe('skipped');
      // Projection state is unchanged after the skipped re-append
      expect(second.state.acceptedControlIds).toEqual(first.state.acceptedControlIds);
    } finally {
      await store.delete();
    }
  });
});

describe('appendMlsGroupControlEvent — sequential events', () => {
  it('applies mls.member.added after mls.group.created and advances the projection', async () => {
    const store = createLocalFirstStore(`mls-test-${globalThis.crypto.randomUUID()}`);
    try {
      const createEvt = groupCreatedEvent();
      await store.appendMlsGroupControlEvent(createEvt, {
        localDeviceId: CREATOR_DEVICE,
        updatedAt: '2026-06-27T00:00:00.000Z'
      });

      const addEvt = memberAddedEvent();
      const result = await store.appendMlsGroupControlEvent(addEvt, {
        localDeviceId: CREATOR_DEVICE,
        updatedAt: '2026-06-27T00:01:00.000Z'
      });

      expect(result.status).toBe('stored');
      expect(result.outcome).toBe('accepted');
      expect(result.state.members[BOB_IDENTITY]?.status).toBe('active');
      expect(result.state.members[BOB_IDENTITY]?.deviceIds).toContain(BOB_DEVICE);
      expect(result.state.acceptedControlIds).toContain('ctrl-001');
    } finally {
      await store.delete();
    }
  });
});

describe('appendMlsGroupControlEvent — rejected events', () => {
  it('stores the event and records outcome rejected when the projection reducer rejects it', async () => {
    const store = createLocalFirstStore(`mls-test-${globalThis.crypto.randomUUID()}`);
    try {
      // A mls.member.added that references a previousControlId not in the
      // accepted chain passes protocol validation but is rejected by the
      // projection reducer (parent not accepted).
      const orphanEvent = makeEvent('mls.member.added', {
        version: MLS_GROUP_CONTROL_VERSION,
        groupId: GROUP_ID,
        epoch: 0,
        controlId: 'ctrl-orphan',
        createdAt: '2026-06-27T00:00:00.000Z',
        issuerDeviceId: CREATOR_DEVICE,
        previousControlId: 'ctrl-does-not-exist',
        addedIdentityId: BOB_IDENTITY,
        addedDeviceId: BOB_DEVICE
      });

      const result = await store.appendMlsGroupControlEvent(orphanEvent, {
        updatedAt: '2026-06-27T00:00:00.000Z'
      });

      expect(result.status).toBe('stored');
      expect(result.outcome).toBe('rejected');

      // Event still lands in signedEvents for audit trail
      const stored = await store.getSignedEvent(orphanEvent.eventId);
      expect(stored).toBeDefined();
    } finally {
      await store.delete();
    }
  });
});

describe('appendMlsGroupControlEvent — local device status', () => {
  it('marks localDeviceMembershipStatus as never-added when localDeviceId is not the creator', async () => {
    const store = createLocalFirstStore(`mls-test-${globalThis.crypto.randomUUID()}`);
    try {
      const event = groupCreatedEvent();
      const result = await store.appendMlsGroupControlEvent(event, {
        localDeviceId: 'device:observer',
        updatedAt: '2026-06-27T00:00:00.000Z'
      });

      expect(result.outcome).toBe('accepted');
      expect(result.state.localDeviceMembershipStatus).toBe('never-added');
    } finally {
      await store.delete();
    }
  });
});
