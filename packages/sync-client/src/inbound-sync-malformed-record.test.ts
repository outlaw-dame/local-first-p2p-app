import 'fake-indexeddb/auto';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createLocalFirstStore } from '@lfp2p/local-store';
import { processInboundSyncBatch, type InboundSyncRecord } from './index.js';

if (typeof globalThis.indexedDB === 'undefined') {
  Object.assign(globalThis, { indexedDB, IDBKeyRange });
}

describe('processInboundSyncBatch malformed records', () => {
  it('reports a missing event without exposing a fabricated event id', async () => {
    const store = createLocalFirstStore(`inbound-missing-event-${globalThis.crypto.randomUUID()}`);
    const record = {
      sourceId: 'bridge:primary',
      streamId: 'durable-stream:inbox',
      scope: 'identity:alice',
      cursor: 'cursor-1',
      sequence: 1,
      receivedAt: '2026-05-24T00:00:00.000Z',
      event: undefined
    } as unknown as InboundSyncRecord;

    try {
      const result = await processInboundSyncBatch({ store, records: [record] });
      expect(result.received).toBe(1);
      expect(result.applied).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.rejected).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.index).toBe(0);
      expect(result.errors[0]).not.toHaveProperty('eventId');
      expect(result.errors[0]?.reason).toMatch(/event|signed|version/i);
    } finally {
      await store.delete();
    }
  });
});
