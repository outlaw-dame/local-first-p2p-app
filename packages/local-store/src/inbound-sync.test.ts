import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { signEventEnvelope, signingKeypairFromSeed } from '@lfp2p/crypto';
import { createUnsignedEvent, type SignedEventEnvelope } from '@lfp2p/protocol';
import { createLocalFirstStore, SyncCheckpointRejectedError } from './index.js';

describe('atomic inbound sync storage', () => {
  it('stores a signed event and advances its checkpoint atomically', async () => {
    const store = createLocalFirstStore(`inbound-atomic-store-${globalThis.crypto.randomUUID()}`);
    const event = makeSignedEvent('evt_inbound_001');

    try {
      const result = await store.putSignedEventWithSyncCheckpoint({
        event,
        checkpoint: {
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice',
          cursor: 'cursor-1',
          sequence: 1,
          updatedAt: '2026-05-24T00:00:00.000Z'
        }
      });

      expect(result.status).toBe('stored');
      await expect(store.getSignedEvent('evt_inbound_001')).resolves.toEqual(event);
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

  it('skips exact checkpoint replays without replacing the stored event', async () => {
    const store = createLocalFirstStore(`inbound-replay-${globalThis.crypto.randomUUID()}`);
    const firstEvent = makeSignedEvent('evt_inbound_replay_original');
    const replayEvent = makeSignedEvent('evt_inbound_replay_duplicate');

    try {
      await store.putSignedEventWithSyncCheckpoint({
        event: firstEvent,
        checkpoint: {
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice',
          cursor: 'cursor-1',
          sequence: 1,
          updatedAt: '2026-05-24T00:00:00.000Z'
        }
      });

      const replay = await store.putSignedEventWithSyncCheckpoint({
        event: replayEvent,
        checkpoint: {
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice',
          cursor: 'cursor-1',
          sequence: 1,
          updatedAt: '2026-05-24T00:01:00.000Z'
        }
      });

      expect(replay.status).toBe('skipped');
      await expect(store.getSignedEvent('evt_inbound_replay_original')).resolves.toEqual(firstEvent);
      await expect(store.getSignedEvent('evt_inbound_replay_duplicate')).resolves.toBeUndefined();
    } finally {
      await store.delete();
    }
  });

  it('rejects stale checkpoints without storing the stale event', async () => {
    const store = createLocalFirstStore(`inbound-stale-${globalThis.crypto.randomUUID()}`);
    const currentEvent = makeSignedEvent('evt_inbound_current');
    const staleEvent = makeSignedEvent('evt_inbound_stale');

    try {
      await store.putSignedEventWithSyncCheckpoint({
        event: currentEvent,
        checkpoint: {
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice',
          cursor: 'cursor-10',
          sequence: 10,
          updatedAt: '2026-05-24T00:00:00.000Z'
        }
      });

      await expect(
        store.putSignedEventWithSyncCheckpoint({
          event: staleEvent,
          checkpoint: {
            sourceId: 'bridge:primary',
            streamId: 'durable-stream:inbox',
            scope: 'identity:alice',
            cursor: 'cursor-9',
            sequence: 9,
            updatedAt: '2026-05-24T00:01:00.000Z'
          }
        })
      ).rejects.toBeInstanceOf(SyncCheckpointRejectedError);

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

  it('rejects stale checkpoints before validating malformed stale events', async () => {
    const store = createLocalFirstStore(`inbound-stale-malformed-${globalThis.crypto.randomUUID()}`);
    const currentEvent = makeSignedEvent('evt_inbound_current_before_malformed');
    const malformedStaleEvent = {
      ...makeSignedEvent('evt_inbound_malformed_stale'),
      payload: []
    } as unknown as SignedEventEnvelope;

    try {
      await store.putSignedEventWithSyncCheckpoint({
        event: currentEvent,
        checkpoint: {
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice',
          cursor: 'cursor-100',
          sequence: 100,
          updatedAt: '2026-05-24T00:00:00.000Z'
        }
      });

      await expect(
        store.putSignedEventWithSyncCheckpoint({
          event: malformedStaleEvent,
          checkpoint: {
            sourceId: 'bridge:primary',
            streamId: 'durable-stream:inbox',
            scope: 'identity:alice',
            cursor: 'cursor-90',
            sequence: 90,
            updatedAt: '2026-05-24T00:01:00.000Z'
          }
        })
      ).rejects.toMatchObject({ code: 'stale-sequence' });

      await expect(store.getSignedEvent('evt_inbound_malformed_stale')).resolves.toBeUndefined();
      await expect(
        store.getSyncCheckpoint({
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice'
        })
      ).resolves.toMatchObject({ cursor: 'cursor-100', sequence: 100 });
    } finally {
      await store.delete();
    }
  });

  it('does not advance a checkpoint when event validation fails', async () => {
    const store = createLocalFirstStore(`inbound-invalid-event-${globalThis.crypto.randomUUID()}`);
    const invalidEvent = {
      ...makeSignedEvent('evt_inbound_invalid'),
      payload: []
    } as unknown as SignedEventEnvelope;

    try {
      await expect(
        store.putSignedEventWithSyncCheckpoint({
          event: invalidEvent,
          checkpoint: {
            sourceId: 'bridge:primary',
            streamId: 'durable-stream:inbox',
            scope: 'identity:alice',
            cursor: 'cursor-1',
            sequence: 1,
            updatedAt: '2026-05-24T00:00:00.000Z'
          }
        })
      ).rejects.toThrow(/payload must be a JSON object/);

      await expect(store.getSignedEvent('evt_inbound_invalid')).resolves.toBeUndefined();
      await expect(
        store.getSyncCheckpoint({
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice'
        })
      ).resolves.toBeUndefined();
    } finally {
      await store.delete();
    }
  });
});

function makeSignedEvent(eventId: string): SignedEventEnvelope {
  const keypair = signingKeypairFromSeed(new Uint8Array(32).fill(11));
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
