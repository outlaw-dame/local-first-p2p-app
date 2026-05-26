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
    const store = createLocalFirstStore(`sync-checkpoint-validation-${globalThis.crypto.randomUUID()}`);
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

  it('isolates checkpoints by source stream and scope tuples', async () => {
    const store = createLocalFirstStore(`sync-checkpoint-isolation-${globalThis.crypto.randomUUID()}`);
    try {
      await expect(
        acceptSyncCheckpoint({
          store,
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice',
          cursor: 'alice-primary-inbox-10',
          sequence: 10,
          updatedAt: '2026-05-22T00:00:00.000Z'
        })
      ).resolves.toBe(true);
      await expect(
        acceptSyncCheckpoint({
          store,
          sourceId: 'bridge:secondary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice',
          cursor: 'alice-secondary-inbox-2',
          sequence: 2,
          updatedAt: '2026-05-22T00:00:00.000Z'
        })
      ).resolves.toBe(true);
      await expect(
        acceptSyncCheckpoint({
          store,
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:public',
          scope: 'identity:alice',
          cursor: 'alice-primary-public-5',
          sequence: 5,
          updatedAt: '2026-05-22T00:00:00.000Z'
        })
      ).resolves.toBe(true);
      await expect(
        acceptSyncCheckpoint({
          store,
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:bob',
          cursor: 'bob-primary-inbox-1',
          sequence: 1,
          updatedAt: '2026-05-22T00:00:00.000Z'
        })
      ).resolves.toBe(true);

      await expect(
        store.getSyncCheckpoint({
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice'
        })
      ).resolves.toMatchObject({ cursor: 'alice-primary-inbox-10', sequence: 10 });
      await expect(
        store.getSyncCheckpoint({
          sourceId: 'bridge:secondary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice'
        })
      ).resolves.toMatchObject({ cursor: 'alice-secondary-inbox-2', sequence: 2 });
      await expect(
        store.getSyncCheckpoint({
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:public',
          scope: 'identity:alice'
        })
      ).resolves.toMatchObject({ cursor: 'alice-primary-public-5', sequence: 5 });
      await expect(
        store.getSyncCheckpoint({
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:bob'
        })
      ).resolves.toMatchObject({ cursor: 'bob-primary-inbox-1', sequence: 1 });
    } finally {
      await store.delete();
    }
  });

  it('persists accepted checkpoints across store reopen', async () => {
    const dbName = `sync-checkpoint-persist-${globalThis.crypto.randomUUID()}`;
    const first = createLocalFirstStore(dbName);
    await expect(
      acceptSyncCheckpoint({
        store: first,
        sourceId: 'bridge:primary',
        streamId: 'durable-stream:inbox',
        scope: 'identity:alice',
        cursor: 'cursor-42',
        sequence: 42,
        updatedAt: '2026-05-22T00:00:00.000Z'
      })
    ).resolves.toBe(true);
    await first.close();

    const reopened = createLocalFirstStore(dbName);
    try {
      await expect(
        reopened.getSyncCheckpoint({
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice'
        })
      ).resolves.toMatchObject({ cursor: 'cursor-42', sequence: 42 });
    } finally {
      await reopened.delete();
    }
  });
});
