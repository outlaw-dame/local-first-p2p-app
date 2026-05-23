import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { InMemoryBridgeService, handleBridgeDeliveryRequest } from '@lfp2p/bridge-service';
import { generateSigningKeypair, signEventEnvelope } from '@lfp2p/crypto';
import { createLocalFirstStore, type MutationOutboxEntry } from '@lfp2p/local-store';
import { createUnsignedEvent } from '@lfp2p/protocol';
import { createHttpBridgeTransport, processOutboxBatch } from './index.js';

describe('HTTP bridge outbox integration', () => {
  it('delivers a local outbox event through the bridge handler exactly once', async () => {
    const store = createLocalFirstStore(`outbox-http-bridge-${globalThis.crypto.randomUUID()}`);
    try {
      const bridge = new InMemoryBridgeService({ initialSequence: 0 });
      const entry = await seedOutboxEntry(store, 'evt_http_bridge_e2e');
      let requestCount = 0;
      const transport = createHttpBridgeTransport({
        endpoint: 'https://bridge.test/events',
        fetch: async (input, init) => {
          requestCount += 1;
          return handleBridgeDeliveryRequest(bridge, new Request(input, init), '2026-05-22T00:00:00.000Z');
        }
      });

      const first = await processOutboxBatch({
        store,
        transport,
        now: new Date('2026-05-22T00:00:00.000Z')
      });
      const second = await processOutboxBatch({
        store,
        transport,
        now: new Date('2026-05-22T00:00:01.000Z')
      });
      const snapshot = await bridge.snapshot('2026-05-22T00:00:01.000Z');

      expect(first).toEqual({ attempted: 1, confirmed: 1, conflicted: 0, retried: 0, failed: 0, skipped: 0 });
      expect(second).toEqual({ attempted: 0, confirmed: 0, conflicted: 0, retried: 0, failed: 0, skipped: 0 });
      expect(requestCount).toBe(1);
      expect((await store.getOutboxEntry(entry.idempotencyKey))?.status).toBe('confirmed');
      expect(snapshot).toMatchObject({
        storeKind: 'memory',
        acceptedCount: 1
      });
      expect(snapshot.latestSequence).toBeGreaterThanOrEqual(1);
    } finally {
      await store.delete();
    }
  });

  it('retries transient HTTP failures after backoff and then confirms delivery', async () => {
    const store = createLocalFirstStore(`outbox-http-bridge-retry-${globalThis.crypto.randomUUID()}`);
    try {
      const bridge = new InMemoryBridgeService({ initialSequence: 0 });
      const entry = await seedOutboxEntry(store, 'evt_http_bridge_retry');
      let requestCount = 0;
      const transport = createHttpBridgeTransport({
        endpoint: 'https://bridge.test/events',
        fetch: async (input, init) => {
          requestCount += 1;
          if (requestCount === 1) {
            return new Response('', { status: 503, statusText: 'Bridge unavailable' });
          }
          return handleBridgeDeliveryRequest(bridge, new Request(input, init), '2026-05-22T00:00:02.000Z');
        }
      });

      const first = await processOutboxBatch({
        store,
        transport,
        now: new Date('2026-05-22T00:00:00.000Z'),
        baseDelayMs: 1_000,
        random: () => 0.5
      });
      const afterFailure = await store.getOutboxEntry(entry.idempotencyKey);
      const beforeDue = await processOutboxBatch({
        store,
        transport,
        now: new Date('2026-05-22T00:00:01.000Z'),
        baseDelayMs: 1_000,
        random: () => 0.5
      });
      const afterRetry = await processOutboxBatch({
        store,
        transport,
        now: new Date('2026-05-22T00:00:02.000Z'),
        baseDelayMs: 1_000,
        random: () => 0.5
      });
      const confirmed = await store.getOutboxEntry(entry.idempotencyKey);
      const snapshot = await bridge.snapshot('2026-05-22T00:00:02.000Z');

      expect(first).toEqual({ attempted: 1, confirmed: 0, conflicted: 0, retried: 1, failed: 0, skipped: 0 });
      expect(afterFailure).toMatchObject({
        status: 'pending',
        retryCount: 1,
        nextRetryAt: '2026-05-22T00:00:02.000Z',
        lastError: 'Bridge unavailable'
      });
      expect(beforeDue).toEqual({ attempted: 0, confirmed: 0, conflicted: 0, retried: 0, failed: 0, skipped: 0 });
      expect(afterRetry).toEqual({ attempted: 1, confirmed: 1, conflicted: 0, retried: 0, failed: 0, skipped: 0 });
      expect(requestCount).toBe(2);
      expect(confirmed).toMatchObject({
        status: 'confirmed',
        retryCount: 1
      });
      expect(snapshot).toMatchObject({
        storeKind: 'memory',
        acceptedCount: 1
      });
    } finally {
      await store.delete();
    }
  });

  it('marks repeated transient HTTP failures failed after max attempts', async () => {
    const store = createLocalFirstStore(`outbox-http-bridge-max-attempts-${globalThis.crypto.randomUUID()}`);
    try {
      const bridge = new InMemoryBridgeService({ initialSequence: 0 });
      const entry = await seedOutboxEntry(store, 'evt_http_bridge_max_attempts');
      let requestCount = 0;
      const transport = createHttpBridgeTransport({
        endpoint: 'https://bridge.test/events',
        fetch: async () => {
          requestCount += 1;
          return new Response('', { status: 503, statusText: 'Bridge unavailable' });
        }
      });

      const first = await processOutboxBatch({
        store,
        transport,
        now: new Date('2026-05-22T00:00:00.000Z'),
        maxAttempts: 2,
        baseDelayMs: 1_000,
        random: () => 0.5
      });
      const afterFirst = await store.getOutboxEntry(entry.idempotencyKey);
      const second = await processOutboxBatch({
        store,
        transport,
        now: new Date('2026-05-22T00:00:02.000Z'),
        maxAttempts: 2,
        baseDelayMs: 1_000,
        random: () => 0.5
      });
      const afterSecond = await store.getOutboxEntry(entry.idempotencyKey);
      const third = await processOutboxBatch({
        store,
        transport,
        now: new Date('2026-05-22T00:00:04.000Z'),
        maxAttempts: 2,
        baseDelayMs: 1_000,
        random: () => 0.5
      });
      const snapshot = await bridge.snapshot('2026-05-22T00:00:04.000Z');

      expect(first).toEqual({ attempted: 1, confirmed: 0, conflicted: 0, retried: 1, failed: 0, skipped: 0 });
      expect(afterFirst).toMatchObject({
        status: 'pending',
        retryCount: 1,
        nextRetryAt: '2026-05-22T00:00:02.000Z',
        lastError: 'Bridge unavailable'
      });
      expect(second).toEqual({ attempted: 1, confirmed: 0, conflicted: 0, retried: 0, failed: 1, skipped: 0 });
      expect(afterSecond).toMatchObject({
        status: 'failed',
        retryCount: 1,
        lastError: 'Bridge unavailable'
      });
      expect(third).toEqual({ attempted: 0, confirmed: 0, conflicted: 0, retried: 0, failed: 0, skipped: 0 });
      expect(requestCount).toBe(2);
      expect(snapshot).toMatchObject({
        storeKind: 'memory',
        acceptedCount: 0
      });
    } finally {
      await store.delete();
    }
  });

  it('marks a local outbox event conflicted when the bridge owns the idempotency key for another event', async () => {
    const store = createLocalFirstStore(`outbox-http-bridge-conflict-${globalThis.crypto.randomUUID()}`);
    try {
      const bridge = new InMemoryBridgeService({ initialSequence: 0 });
      const idempotencyKey = 'idem_http_bridge_conflict';
      const existingEvent = makeSignedEvent('evt_http_bridge_conflict_existing');
      await bridge.acceptDelivery(
        { idempotencyKey, target: 'bridge:test', event: existingEvent },
        '2026-05-22T00:00:00.000Z'
      );
      const entry = await seedOutboxEntry(store, 'evt_http_bridge_conflict_local', idempotencyKey);
      let requestCount = 0;
      const transport = createHttpBridgeTransport({
        endpoint: 'https://bridge.test/events',
        fetch: async (input, init) => {
          requestCount += 1;
          return handleBridgeDeliveryRequest(bridge, new Request(input, init), '2026-05-22T00:00:01.000Z');
        }
      });

      const first = await processOutboxBatch({
        store,
        transport,
        now: new Date('2026-05-22T00:00:01.000Z')
      });
      const second = await processOutboxBatch({
        store,
        transport,
        now: new Date('2026-05-22T00:00:02.000Z')
      });
      const updated = await store.getOutboxEntry(entry.idempotencyKey);
      const snapshot = await bridge.snapshot('2026-05-22T00:00:02.000Z');

      expect(first).toEqual({ attempted: 1, confirmed: 0, conflicted: 1, retried: 0, failed: 0, skipped: 0 });
      expect(second).toEqual({ attempted: 0, confirmed: 0, conflicted: 0, retried: 0, failed: 0, skipped: 0 });
      expect(requestCount).toBe(1);
      expect(updated?.status).toBe('conflicted');
      expect(updated?.lastError).toBe('Idempotency key already belongs to a different event');
      expect(snapshot).toMatchObject({
        storeKind: 'memory',
        acceptedCount: 1
      });
    } finally {
      await store.delete();
    }
  });

  it('marks rejected bridge deliveries as terminal failed without retrying', async () => {
    const store = createLocalFirstStore(`outbox-http-bridge-rejected-${globalThis.crypto.randomUUID()}`);
    try {
      const bridge = new InMemoryBridgeService({ initialSequence: 0 });
      const entry = await seedOutboxEntry(store, 'evt_http_bridge_rejected');
      const event = await store.getSignedEvent(entry.eventId);
      if (!event) throw new Error('Expected seeded signed event');
      await store.putSignedEvent({ ...event, payload: { body: 'changed after signing' } });
      let requestCount = 0;
      const transport = createHttpBridgeTransport({
        endpoint: 'https://bridge.test/events',
        fetch: async (input, init) => {
          requestCount += 1;
          return handleBridgeDeliveryRequest(bridge, new Request(input, init), '2026-05-22T00:00:00.000Z');
        }
      });

      const first = await processOutboxBatch({
        store,
        transport,
        now: new Date('2026-05-22T00:00:00.000Z')
      });
      const second = await processOutboxBatch({
        store,
        transport,
        now: new Date('2026-05-22T00:00:01.000Z')
      });
      const updated = await store.getOutboxEntry(entry.idempotencyKey);
      const snapshot = await bridge.snapshot('2026-05-22T00:00:01.000Z');

      expect(first).toEqual({ attempted: 1, confirmed: 0, conflicted: 0, retried: 0, failed: 1, skipped: 0 });
      expect(second).toEqual({ attempted: 0, confirmed: 0, conflicted: 0, retried: 0, failed: 0, skipped: 0 });
      expect(requestCount).toBe(1);
      expect(updated?.status).toBe('failed');
      expect(updated?.retryCount).toBe(0);
      expect(updated?.lastError).toBe('Event signature verification failed');
      expect(snapshot).toMatchObject({
        storeKind: 'memory',
        acceptedCount: 0
      });
    } finally {
      await store.delete();
    }
  });
});

async function seedOutboxEntry(
  store: ReturnType<typeof createLocalFirstStore>,
  eventId: string,
  idempotencyKey = `idem_${eventId}`
): Promise<MutationOutboxEntry> {
  const event = makeSignedEvent(eventId);
  await store.putSignedEvent(event);
  const entry: MutationOutboxEntry = {
    idempotencyKey,
    eventId,
    target: 'bridge:test',
    status: 'pending',
    retryCount: 0,
    nextRetryAt: '2026-05-22T00:00:00.000Z',
    createdAt: '2026-05-22T00:00:00.000Z',
    updatedAt: '2026-05-22T00:00:00.000Z'
  };
  await store.enqueueOutbox(entry);
  return entry;
}

function makeSignedEvent(eventId: string) {
  const keypair = generateSigningKeypair();
  return signEventEnvelope(
    createUnsignedEvent({
      eventId,
      kind: 'outbox.test.created',
      author: `identity:${keypair.publicKey}`,
      deviceId: `device:${keypair.publicKey.slice(0, 16)}`,
      createdAt: '2026-05-22T00:00:00.000Z',
      privacy: 'dm',
      payload: { body: eventId }
    }),
    keypair
  );
}
