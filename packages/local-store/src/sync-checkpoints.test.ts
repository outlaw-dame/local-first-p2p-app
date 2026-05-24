import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createLocalFirstStore, SyncCheckpointRejectedError } from './index.js';

describe('sync checkpoint storage invariants', () => {
  it('rejects same-sequence cursor mismatches inside the checkpoint transaction', async () => {
    const store = createLocalFirstStore(`checkpoint-cursor-mismatch-${globalThis.crypto.randomUUID()}`);
    try {
      await store.advanceSyncCheckpoint({
        sourceId: 'bridge:primary',
        streamId: 'durable-stream:inbox',
        scope: 'identity:alice',
        cursor: 'cursor-10',
        sequence: 10,
        updatedAt: '2026-05-22T00:00:00.000Z'
      });

      await expect(
        store.advanceSyncCheckpoint({
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice',
          cursor: 'cursor-10-other',
          sequence: 10,
          updatedAt: '2026-05-22T00:01:00.000Z'
        })
      ).rejects.toBeInstanceOf(SyncCheckpointRejectedError);

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

  it('allows same-sequence cursor replacement only for explicit controlled rewinds', async () => {
    const store = createLocalFirstStore(`checkpoint-cursor-replace-${globalThis.crypto.randomUUID()}`);
    try {
      await store.advanceSyncCheckpoint({
        sourceId: 'bridge:primary',
        streamId: 'durable-stream:inbox',
        scope: 'identity:alice',
        cursor: 'cursor-10',
        sequence: 10,
        updatedAt: '2026-05-22T00:00:00.000Z'
      });

      await expect(
        store.advanceSyncCheckpoint({
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice',
          cursor: 'cursor-10-resync',
          sequence: 10,
          updatedAt: '2026-05-22T00:01:00.000Z',
          allowRewind: true
        })
      ).resolves.toMatchObject({ cursor: 'cursor-10-resync', sequence: 10 });
    } finally {
      await store.delete();
    }
  });
});
