import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { signingKeypairFromSeed, signEventEnvelope } from '@lfp2p/crypto';
import { createLocalFirstStore } from '@lfp2p/local-store';
import { createUnsignedEvent, type SignedEventEnvelope } from '@lfp2p/protocol';
import { processInboundSyncBatch, type InboundSyncRecord } from './index.js';

describe('processInboundSyncBatch', () => {
  it('applies inbound signed events and advances checkpoints in order', async () => {
    const store = createLocalFirstStore(`inbound-sync-apply-${globalThis.crypto.randomUUID()}`);
    const first = makeRecord('evt_inbound_sync_001', 'cursor-1', 1);
    const second = makeRecord('evt_inbound_sync_002', 'cursor-2', 2);

    try {
      const result = await processInboundSyncBatch({
        store,
        records: [first, second],
        now: new Date('2026-05-24T00:00:00.000Z')
      });

      expect(result).toEqual({ received: 2, applied: 2, skipped: 0, rejected: 0, errors: [] });
      await expect(store.getSignedEvent('evt_inbound_sync_001')).resolves.toEqual(first.event);
      await expect(store.getSignedEvent('evt_inbound_sync_002')).resolves.toEqual(second.event);
      await expect(
        store.getSyncCheckpoint({
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice'
        })
      ).resolves.toMatchObject({ cursor: 'cursor-2', sequence: 2 });
    } finally {
      await store.delete();
    }
  });

  it('skips stale inbound records without replacing the latest checkpoint', async () => {
    const store = createLocalFirstStore(`inbound-sync-stale-${globalThis.crypto.randomUUID()}`);
    const current = makeRecord('evt_inbound_current', 'cursor-10', 10);
    const stale = makeRecord('evt_inbound_stale', 'cursor-9', 9);

    try {
      await expect(processInboundSyncBatch({ store, records: [current] })).resolves.toMatchObject({
        received: 1,
        applied: 1,
        skipped: 0,
        rejected: 0
      });

      const result = await processInboundSyncBatch({ store, records: [stale] });

      expect(result).toEqual({ received: 1, applied: 0, skipped: 1, rejected: 0, errors: [] });
      await expect(store.getSignedEvent('evt_inbound_stale')).resolves.toBeUndefined();
      await expect(
        store.getSyncCheckpoint({
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice'
        })
      ).resolves.toMatchObject({ cursor: 'cursor-10', sequence: 10 });
    } finally {
      await store.delete();
    }
  });

  it('stops on invalid event validation without advancing past it', async () => {
    const store = createLocalFirstStore(`inbound-sync-invalid-${globalThis.crypto.randomUUID()}`);
    const first = makeRecord('evt_inbound_valid_before_invalid', 'cursor-1', 1);
    const invalid = {
      ...makeRecord('evt_inbound_invalid_payload', 'cursor-2', 2),
      event: {
        ...makeSignedEvent('evt_inbound_invalid_payload'),
        payload: []
      } as unknown as SignedEventEnvelope
    };
    const afterInvalid = makeRecord('evt_inbound_after_invalid', 'cursor-3', 3);

    try {
      const result = await processInboundSyncBatch({
        store,
        records: [first, invalid, afterInvalid],
        now: new Date('2026-05-24T00:00:00.000Z')
      });

      expect(result.received).toBe(2);
      expect(result.applied).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.rejected).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        index: 1,
        eventId: 'evt_inbound_invalid_payload'
      });
      expect(result.errors[0]?.reason).toMatch(/payload must be a JSON object/);
      await expect(store.getSignedEvent('evt_inbound_valid_before_invalid')).resolves.toEqual(first.event);
      await expect(store.getSignedEvent('evt_inbound_invalid_payload')).resolves.toBeUndefined();
      await expect(store.getSignedEvent('evt_inbound_after_invalid')).resolves.toBeUndefined();
      await expect(
        store.getSyncCheckpoint({
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice'
        })
      ).resolves.toMatchObject({ cursor: 'cursor-1', sequence: 1 });
    } finally {
      await store.delete();
    }
  });

  it('does not crash while reporting an error for an inbound record without an event object', async () => {
    const store = createLocalFirstStore(`inbound-sync-missing-event-${globalThis.crypto.randomUUID()}`);
    const malformed = {
      sourceId: 'bridge:primary',
      streamId: 'durable-stream:inbox',
      scope: 'identity:alice',
      cursor: 'cursor-1',
      sequence: 1,
      receivedAt: '2026-05-24T00:00:00.000Z',
      event: undefined
    } as unknown as InboundSyncRecord;

    try {
      const result = await processInboundSyncBatch({ store, records: [malformed] });

      expect(result.received).toBe(1);
      expect(result.applied).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.rejected).toBe(1);
      expect(result.errors).toEqual([{ index: 0, reason: 'Invalid signed event' }]);
    } finally {
      await store.delete();
    }
  });

  it('uses an inbound-specific fallback for non-error failures', async () => {
    const store = createLocalFirstStore(`inbound-sync-unknown-failure-${globalThis.crypto.randomUUID()}`);
    const record = makeRecord('evt_inbound_unknown_failure', 'cursor-1', 1);
    const failingStore = {
      putSignedEventWithSyncCheckpoint: async () => {
        throw undefined;
      }
    } as unknown as typeof store;

    try {
      const result = await processInboundSyncBatch({ store: failingStore, records: [record] });
      expect(result).toEqual({
        received: 1,
        applied: 0,
        skipped: 0,
        rejected: 1,
        errors: [{ index: 0, eventId: 'evt_inbound_unknown_failure', reason: 'Unknown inbound sync failure' }]
      });
    } finally {
      await store.delete();
    }
  });

  it('treats same-sequence cursor conflicts as rejection and stops processing', async () => {
    const store = createLocalFirstStore(`inbound-sync-conflict-${globalThis.crypto.randomUUID()}`);
    const first = makeRecord('evt_inbound_conflict_first', 'cursor-10-a', 10);
    const conflict = makeRecord('evt_inbound_conflict_second', 'cursor-10-b', 10);
    const afterConflict = makeRecord('evt_inbound_after_conflict', 'cursor-11', 11);

    try {
      const result = await processInboundSyncBatch({
        store,
        records: [first, conflict, afterConflict]
      });

      expect(result.received).toBe(2);
      expect(result.applied).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.rejected).toBe(1);
      expect(result.errors[0]).toMatchObject({ index: 1, eventId: 'evt_inbound_conflict_second' });
      expect(result.errors[0]?.reason).toMatch(/cursor mismatch/);
      await expect(store.getSignedEvent('evt_inbound_conflict_first')).resolves.toEqual(first.event);
      await expect(store.getSignedEvent('evt_inbound_conflict_second')).resolves.toBeUndefined();
      await expect(store.getSignedEvent('evt_inbound_after_conflict')).resolves.toBeUndefined();
    } finally {
      await store.delete();
    }
  });

  it('supports explicit rewind for controlled resync flows', async () => {
    const store = createLocalFirstStore(`inbound-sync-rewind-${globalThis.crypto.randomUUID()}`);
    const current = makeRecord('evt_inbound_rewind_current', 'cursor-20', 20);
    const rewind = makeRecord('evt_inbound_rewind_target', 'cursor-15', 15);

    try {
      await expect(processInboundSyncBatch({ store, records: [current] })).resolves.toMatchObject({ applied: 1 });
      await expect(processInboundSyncBatch({ store, records: [rewind], allowRewind: true })).resolves.toEqual({
        received: 1,
        applied: 1,
        skipped: 0,
        rejected: 0,
        errors: []
      });
      await expect(store.getSignedEvent('evt_inbound_rewind_target')).resolves.toEqual(rewind.event);
      await expect(
        store.getSyncCheckpoint({
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice'
        })
      ).resolves.toMatchObject({ cursor: 'cursor-15', sequence: 15 });
    } finally {
      await store.delete();
    }
  });
});

function makeRecord(eventId: string, cursor: string, sequence: number): InboundSyncRecord {
  return {
    sourceId: 'bridge:primary',
    streamId: 'durable-stream:inbox',
    scope: 'identity:alice',
    cursor,
    sequence,
    receivedAt: '2026-05-24T00:00:00.000Z',
    event: makeSignedEvent(eventId)
  };
}

function makeSignedEvent(eventId: string): SignedEventEnvelope {
  const keypair = signingKeypairFromSeed(new Uint8Array(32).fill(12));
  return signEventEnvelope(
    createUnsignedEvent({
      eventId,
      kind: 'outbox.test.created',
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: '2026-05-24T00:00:00.000Z',
      privacy: 'dm',
      payload: { body: eventId }
    }),
    keypair
  );
}
