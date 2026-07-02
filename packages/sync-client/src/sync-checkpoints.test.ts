import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createLocalFirstStore } from '@lfp2p/local-store';
import { acceptSyncCheckpoint } from './index.js';

describe('acceptSyncCheckpoint', () => {
  it('uses the store transaction as the single checkpoint authority', async () => {
    const store = createLocalFirstStore(`sync-checkpoint-atomic-${globalThis.crypto.randomUUID()}`);
    try {
      const results = await Promise.all([
        acceptSyncCheckpoint({
          store,
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice',
          cursor: 'cursor-10-a',
          sequence: 10,
          updatedAt: '2026-05-22T00:00:00.000Z'
        }),
        acceptSyncCheckpoint({
          store,
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice',
          cursor: 'cursor-10-b',
          sequence: 10,
          updatedAt: '2026-05-22T00:00:00.000Z'
        })
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
      await expect(
        store.getSyncCheckpoint({
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice'
        })
      ).resolves.toMatchObject({ sequence: 10 });
    } finally {
      await store.delete();
    }
  });

  it('returns false for checkpoint rejection but does not mask validation errors', async () => {
    const store = createLocalFirstStore(
      `sync-checkpoint-validation-${globalThis.crypto.randomUUID()}`
    );
    try {
      await expect(
        acceptSyncCheckpoint({
          store,
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice',
          cursor: 'cursor-10',
          sequence: 10,
          updatedAt: '2026-05-22T00:00:00.000Z'
        })
      ).resolves.toBe(true);

      await expect(
        acceptSyncCheckpoint({
          store,
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice',
          cursor: 'cursor-9',
          sequence: 9,
          updatedAt: '2026-05-22T00:01:00.000Z'
        })
      ).resolves.toBe(false);

      await expect(
        acceptSyncCheckpoint({
          store,
          sourceId: ' ',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice',
          cursor: 'cursor-11',
          sequence: 11,
          updatedAt: '2026-05-22T00:02:00.000Z'
        })
      ).rejects.toThrow(/sourceId is required/);
    } finally {
      await store.delete();
    }
  });
});
