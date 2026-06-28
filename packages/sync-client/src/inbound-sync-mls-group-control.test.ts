/**
 * Phase 4c — MLS group-control inbound sync dispatch.
 *
 * Covers:
 *  - MLS group-control events dispatched to `updateMlsGroupProjection`
 *    after storage when `mlsGroupControlOptions` is supplied
 *  - `mlsGroupControl` summary counts (applied / rejected)
 *  - Projection readable via `getMlsGroupProjection` after sync
 *  - Non-MLS events are not dispatched (no `mlsGroupControl` summary
 *    when option is omitted; MLS events skipped when not mls.* kind)
 *  - Reducer-rejected events (orphaned previousControlId) count as
 *    `rejected` in the summary and the event is still stored
 *  - Stale checkpoint replay (skipped status) does not re-dispatch
 */
import 'fake-indexeddb/auto';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { signingKeypairFromSeed, signEventEnvelope } from '@lfp2p/crypto';
import { createLocalFirstStore } from '@lfp2p/local-store';
import {
  MLS_GROUP_CONTROL_VERSION,
  createUnsignedEvent,
  type SignedEventEnvelope
} from '@lfp2p/protocol';
import { processInboundSyncBatch, type InboundSyncRecord } from './index.js';

if (typeof globalThis.indexedDB === 'undefined') {
  Object.assign(globalThis, { indexedDB, IDBKeyRange });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GROUP_ID = 'group:sync-test-alpha';
const CREATOR_IDENTITY = 'identity:alice';
const CREATOR_DEVICE = 'device:alice-phone';
const BOB_IDENTITY = 'identity:bob';
const BOB_DEVICE = 'device:bob-laptop';

const KEYPAIR = signingKeypairFromSeed(new Uint8Array(32).fill(77));

let _seq = 0;

function makeMlsSignedEvent(
  kind: string,
  payload: Record<string, unknown>,
  overrides: Partial<Parameters<typeof createUnsignedEvent>[0]> = {}
): SignedEventEnvelope {
  _seq++;
  return signEventEnvelope(
    createUnsignedEvent({
      eventId: `evt-mls-${kind}-${_seq}`,
      kind: kind as SignedEventEnvelope['kind'],
      author: CREATOR_IDENTITY,
      deviceId: CREATOR_DEVICE,
      createdAt: '2026-06-28T00:00:00.000Z',
      privacy: 'public',
      payload,
      ...overrides
    }),
    KEYPAIR
  );
}

const BASE_CTRL = {
  version: MLS_GROUP_CONTROL_VERSION,
  groupId: GROUP_ID,
  epoch: 0,
  controlId: 'ctrl-000',
  createdAt: '2026-06-28T00:00:00.000Z',
  issuerDeviceId: CREATOR_DEVICE
};

function groupCreatedEvent(overrides: Record<string, unknown> = {}): SignedEventEnvelope {
  return makeMlsSignedEvent('mls.group.created', {
    ...BASE_CTRL,
    creatorDeviceId: CREATOR_DEVICE,
    ...overrides
  });
}

function memberAddedEvent(controlId: string, previousControlId: string): SignedEventEnvelope {
  return makeMlsSignedEvent('mls.member.added', {
    ...BASE_CTRL,
    controlId,
    previousControlId,
    addedIdentityId: BOB_IDENTITY,
    addedDeviceId: BOB_DEVICE
  });
}

function makeRecord(event: SignedEventEnvelope, cursor: string, sequence: number): InboundSyncRecord {
  return {
    sourceId: 'bridge:primary',
    streamId: 'durable-stream:inbox',
    scope: 'identity:alice',
    cursor,
    sequence,
    receivedAt: '2026-06-28T00:00:00.000Z',
    event
  };
}

// ---------------------------------------------------------------------------
// Phase 4c tests
// ---------------------------------------------------------------------------

describe('processInboundSyncBatch — MLS group-control dispatch (mlsGroupControlOptions)', () => {
  it('populates the mlsGroupProjections table after syncing mls.group.created', async () => {
    const store = createLocalFirstStore(`mls-sync-test-${globalThis.crypto.randomUUID()}`);
    try {
      const createEvt = groupCreatedEvent();
      const result = await processInboundSyncBatch({
        store,
        records: [makeRecord(createEvt, 'cursor-1', 1)],
        mlsGroupControlOptions: { localDeviceId: CREATOR_DEVICE }
      });

      expect(result.applied).toBe(1);
      expect(result.mlsGroupControl).toBeDefined();
      expect(result.mlsGroupControl?.applied).toBe(1);
      expect(result.mlsGroupControl?.rejected).toBe(0);

      const projection = await store.getMlsGroupProjection(GROUP_ID);
      expect(projection).toBeDefined();
      expect(projection?.groupId).toBe(GROUP_ID);
      expect(projection?.acceptedControlIds).toContain('ctrl-000');
      expect(projection?.localDeviceMembershipStatus).toBe('member');
    } finally {
      await store.delete();
    }
  });

  it('advances the projection across sequential mls events in a single batch', async () => {
    const store = createLocalFirstStore(`mls-sync-seq-${globalThis.crypto.randomUUID()}`);
    try {
      const createEvt = groupCreatedEvent();
      const addEvt = memberAddedEvent('ctrl-001', 'ctrl-000');

      const result = await processInboundSyncBatch({
        store,
        records: [
          makeRecord(createEvt, 'cursor-1', 1),
          makeRecord(addEvt, 'cursor-2', 2)
        ],
        mlsGroupControlOptions: { localDeviceId: CREATOR_DEVICE }
      });

      expect(result.applied).toBe(2);
      expect(result.mlsGroupControl?.applied).toBe(2);

      const projection = await store.getMlsGroupProjection(GROUP_ID);
      expect(projection?.members[BOB_IDENTITY]?.status).toBe('active');
      expect(projection?.acceptedControlIds).toContain('ctrl-001');
    } finally {
      await store.delete();
    }
  });

  it('counts reducer-rejected events in the rejected summary without stopping the batch', async () => {
    const store = createLocalFirstStore(`mls-sync-reject-${globalThis.crypto.randomUUID()}`);
    try {
      // Orphaned member-added: previousControlId not in any accepted chain
      const orphanEvt = makeMlsSignedEvent('mls.member.added', {
        ...BASE_CTRL,
        controlId: 'ctrl-orphan',
        previousControlId: 'ctrl-does-not-exist',
        addedIdentityId: BOB_IDENTITY,
        addedDeviceId: BOB_DEVICE
      });
      const createEvt = groupCreatedEvent({ controlId: 'ctrl-after-orphan' });

      const result = await processInboundSyncBatch({
        store,
        records: [
          makeRecord(orphanEvt, 'cursor-1', 1),
          makeRecord(createEvt, 'cursor-2', 2)
        ],
        mlsGroupControlOptions: { localDeviceId: CREATOR_DEVICE }
      });

      // Both events stored (batch continues past projection-rejected events)
      expect(result.applied).toBe(2);
      expect(result.rejected).toBe(0);

      // MLS summary reflects the rejected projection outcome
      expect(result.mlsGroupControl?.rejected).toBe(1);
      expect(result.mlsGroupControl?.applied).toBe(1);
      expect(result.mlsGroupControl?.errors).toHaveLength(1);

      // The orphaned event is still persisted
      expect(await store.getSignedEvent(orphanEvt.eventId)).toBeDefined();
    } finally {
      await store.delete();
    }
  });

  it('does not include mlsGroupControl in result when option is omitted', async () => {
    const store = createLocalFirstStore(`mls-sync-opt-out-${globalThis.crypto.randomUUID()}`);
    try {
      const createEvt = groupCreatedEvent();
      const result = await processInboundSyncBatch({
        store,
        records: [makeRecord(createEvt, 'cursor-1', 1)]
        // mlsGroupControlOptions deliberately omitted
      });

      expect(result.mlsGroupControl).toBeUndefined();
      // Projection is NOT updated (no dispatch)
      expect(await store.getMlsGroupProjection(GROUP_ID)).toBeUndefined();
    } finally {
      await store.delete();
    }
  });

  it('does not dispatch on stale-skipped records (checkpoint already ahead)', async () => {
    const store = createLocalFirstStore(`mls-sync-stale-${globalThis.crypto.randomUUID()}`);
    try {
      const createEvt = groupCreatedEvent();
      // Apply at sequence 10
      await processInboundSyncBatch({
        store,
        records: [makeRecord(createEvt, 'cursor-10', 10)],
        mlsGroupControlOptions: { localDeviceId: CREATOR_DEVICE }
      });

      // Replay same event at stale sequence 9 — should be skipped
      const staleResult = await processInboundSyncBatch({
        store,
        records: [makeRecord(createEvt, 'cursor-9', 9)],
        mlsGroupControlOptions: { localDeviceId: CREATOR_DEVICE }
      });

      expect(staleResult.skipped).toBe(1);
      expect(staleResult.mlsGroupControl?.applied).toBe(0);
      expect(staleResult.mlsGroupControl?.rejected).toBe(0);
    } finally {
      await store.delete();
    }
  });

  it('does not re-apply projection when the same event is re-delivered at a higher sequence', async () => {
    // P2: bridge re-delivery can deliver the same event at sequence+1.
    // putSignedEventWithSyncCheckpoint returns 'stored' (checkpoint advances),
    // but updateMlsGroupProjection must detect the controlId is already known
    // and skip re-applying to avoid duplicate fork candidates.
    const store = createLocalFirstStore(`mls-sync-redelivery-${globalThis.crypto.randomUUID()}`);
    try {
      const createEvt = groupCreatedEvent();
      const first = await processInboundSyncBatch({
        store,
        records: [makeRecord(createEvt, 'cursor-1', 1)],
        mlsGroupControlOptions: { localDeviceId: CREATOR_DEVICE }
      });
      expect(first.mlsGroupControl?.applied).toBe(1);

      // Same event, higher sequence (bridge re-delivery)
      const second = await processInboundSyncBatch({
        store,
        records: [makeRecord(createEvt, 'cursor-2', 2)],
        mlsGroupControlOptions: { localDeviceId: CREATOR_DEVICE },
        allowRewind: false
      });

      // Checkpoint advanced (applied at batch level), but projection is NOT re-applied
      expect(second.applied).toBe(1);
      expect(second.mlsGroupControl?.applied).toBe(0);
      expect(second.mlsGroupControl?.rejected).toBe(0);

      // Projection state unchanged — no duplicate acceptedControlIds
      const state = await store.getMlsGroupProjection(GROUP_ID);
      const timesCtrl000Appears = state?.acceptedControlIds.filter((id) => id === 'ctrl-000').length;
      expect(timesCtrl000Appears).toBe(1);
    } finally {
      await store.delete();
    }
  });

  it('throws when event payload has missing or empty groupId (groupId validation)', async () => {
    const store = createLocalFirstStore(`mls-sync-no-groupid-${globalThis.crypto.randomUUID()}`);
    try {
      // Manually create an event with empty groupId — bypasses protocol validator
      // to test the store-level guard directly.
      const noGroupIdEvt = signEventEnvelope(
        createUnsignedEvent({
          eventId: `evt-no-groupid-${globalThis.crypto.randomUUID()}`,
          kind: 'mls.group.created' as SignedEventEnvelope['kind'],
          author: CREATOR_IDENTITY,
          deviceId: CREATOR_DEVICE,
          createdAt: '2026-06-28T00:00:00.000Z',
          privacy: 'public',
          payload: {
            version: MLS_GROUP_CONTROL_VERSION,
            groupId: GROUP_ID, // valid for protocol; we test store method directly
            epoch: 0,
            controlId: 'ctrl-no-gid',
            createdAt: '2026-06-28T00:00:00.000Z',
            issuerDeviceId: CREATOR_DEVICE,
            creatorDeviceId: CREATOR_DEVICE
          }
        }),
        KEYPAIR
      );

      // Test updateMlsGroupProjection directly with a payload missing groupId
      await expect(
        store.updateMlsGroupProjection({
          ...noGroupIdEvt,
          payload: { ...noGroupIdEvt.payload, groupId: '' } as unknown as SignedEventEnvelope['payload']
        })
      ).rejects.toThrow(/groupId/);
    } finally {
      await store.delete();
    }
  });
});
