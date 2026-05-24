import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { InMemoryBridgeService, handleBridgeDeliveryRequest, handleBridgeInboundReadRequest } from '@lfp2p/bridge-service';
import { generateSigningKeypair, signEventEnvelope } from '@lfp2p/crypto';
import { createLocalFirstStore, type MutationOutboxEntry } from '@lfp2p/local-store';
import { createUnsignedEvent } from '@lfp2p/protocol';
import { createHttpBridgeInboundTransport } from './inbound-http.js';
import { createHttpBridgeTransport, processInboundSyncBatch, processOutboxBatch } from './index.js';

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

  it('pulls accepted bridge records through the inbound reader and applies them locally', async () => {
    const outboundStore = createLocalFirstStore(`bridge-e2e-outbound-${globalThis.crypto.randomUUID()}`);
    const inboundStore = createLocalFirstStore(`bridge-e2e-inbound-${globalThis.crypto.randomUUID()}`);
    try {
      const bridge = new InMemoryBridgeService({ initialSequence: 0 });
      const entry = await seedOutboxEntry(outboundStore, 'evt_http_bridge_inbound_read');
      const outboxTransport = createHttpBridgeTransport({
        endpoint: 'https://bridge.test/events',
        fetch: async (input, init) => handleBridgeDeliveryRequest(bridge, new Request(input, init), '2026-05-22T00:00:00.000Z')
      });
      const inboundTransport = createHttpBridgeInboundTransport({
        endpoint: 'https://bridge.test/inbound',
        fetch: async (input, init) => handleBridgeInboundReadRequest(bridge, new Request(input, init), '2026-05-22T00:00:01.000Z')
      });

      await expect(
        processOutboxBatch({ outboundStore, store: outboundStore, transport: outboxTransport, now: new Date('2026-05-22T00:00:00.000Z') })
      ).resolves.toEqual({ attempted: 1, confirmed: 1, conflicted: 0, retried: 0, failed: 0, skipped: 0 });
      const records = await inboundTransport.pull({
        sourceId: 'bridge:primary',
        streamId: 'bridge:test',
        scope: 'identity:alice',
        limit: 10
      });
      const applied = await processInboundSyncBatch({
        store: inboundStore,
        records,
        now: new Date('2026-05-22T00:00:01.000Z')
      });

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ sourceId: 'bridge:primary', streamId: 'bridge:test', scope: 'identity:alice', cursor: '1', sequence: 1 });
      expect(applied).toEqual({ received: 1, applied: 1, skipped: 0, rejected: 0, errors: [] });
      await expect(inboundStore.getSignedEvent(entry.eventId)).resolves.toEqual(records[0]?.event);
      await expect(
        inboundStore.getSyncCheckpoint({ sourceId: 'bridge:primary', streamId: 'bridge:test', scope: 'identity:alice' })
      ).resolves.toMatchObject({ cursor: '1', sequence: 1 });
    } finally {
      await outboundStore.delete();
      await inboundStore.delete();
    }
  });

  it('recovers an interrupted local confirmation and confirms idempotently on retry', async () => {
    const store = createLocalFirstStore(`outbox-http-bridge-recovery-${globalThis.crypto.randomUUID()}`);
    const originalMarkConfirmed = store.markOutboxConfirmed.bind(store);
    let markAttempts = 0;
    store.markOutboxConfirmed = async (...args) => {
      markAttempts += 1;
      if (markAttempts === 1) throw new Error('simulated local confirmation write failure');
      return originalMarkConfirmed(...args);
    };

    try {
      const bridge = new InMemoryBridgeService({ initialSequence: 0 });
      const entry = await seedOutboxEntry(store, 'evt_http_bridge_recovery');
      let requestCount = 0;
      const transport = createHttpBridgeTransport({
        endpoint: 'https://bridge.test/events',
        fetch: async (input, init) => {
          requestCount += 1;
          return handleBridgeDeliveryRequest(bridge, new Request(input, init), '2026-05-22T00:00:00.000Z');
        }
      });

      await expect(
        processOutboxBatch({
          store,
          transport,
          now: new Date('2026-05-22T00:00:00.000Z'),
          claimTimeoutMs: 30_000
        })
      ).rejects.toThrow('simulated local confirmation write failure');
      const interrupted = await store.getOutboxEntry(entry.idempotencyKey);
      const beforeRecovery = await processOutboxBatch({
        store,
        transport,
        now: new Date('2026-05-22T00:00:29.000Z'),
        claimTimeoutMs: 30_000
      });
      const afterRecovery = await processOutboxBatch({
        store,
        transport,
        now: new Date('2026-05-22T00:00:30.000Z'),
        claimTimeoutMs: 30_000
      });
      const confirmed = await store.getOutboxEntry(entry.idempotencyKey);
      const snapshot = await bridge.snapshot('2026-05-22T00:00:30.000Z');

      expect(interrupted).toMatchObject({
        status: 'syncing',
        retryCount: 0,
        updatedAt: '2026-05-22T00:00:00.000Z'
      });
      expect(beforeRecovery).toEqual({ attempted: 0, confirmed: 0, conflicted: 0, retried: 0, failed: 0, skipped: 0 });
      expect(afterRecovery).toEqual({ attempted: 1, confirmed: 1, conflicted: 0, retried: 0, failed: 0, skipped: 0 });
      expect(requestCount).toBe(2);
      expect(markAttempts).toBe(2);
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

  it('fails recovered entries at the retry limit before resending', async () => {
    const store = createLocalFirstStore(`outbox-http-bridge-recovered-limit-${globalThis.crypto.randomUUID()}`);
    try {
      const bridge = new InMemoryBridgeService({ initialSequence: 0 });
      const entry = await seedOutboxEntry(store, 'evt_http_bridge_recovered_limit');
      await store.updateOutboxStatus(entry.idempotencyKey, 'syncing', {
        updatedAt: '2026-05-22T00:00:00.000Z',
        lastError: 'interrupted before completion'
      });
      await store.scheduleOutboxRetry({
        idempotencyKey: entry.idempotencyKey,
        retryCount: 1,
        nextRetryAt: '2026-05-22T00:00:00.000Z',
        lastError: 'previous retry',
        updatedAt: '2026-05-22T00:00:00.000Z'
      });
      await store.updateOutboxStatus(entry.idempotencyKey, 'syncing', {
        updatedAt: '2026-05-22T00:00:00.000Z',
        lastError: 'interrupted before completion'
      });
      let requestCount = 0;
      const transport = createHttpBridgeTransport({
        endpoint: 'https://bridge.test/events',
        fetch: async (input, init) => {
          requestCount += 1;
          return handleBridgeDeliveryRequest(bridge, new Request(input, init), '2026-05-22T00:00:30.000Z');
        }
      });

      const result = await processOutboxBatch({
        store,
        transport,
        now: new Date('2026-05-22T00:00:30.000Z'),
        claimTimeoutMs: 30_000,
        maxAttempts: 2
      });
      const updated = await store.getOutboxEntry(entry.idempotencyKey);
      const snapshot = await bridge.snapshot('2026-05-22T00:00:30.000Z');

      expect(result).toEqual({ attempted: 0, confirmed: 0, conflicted: 0, retried: 0, failed: 1, skipped: 0 });
      expect(requestCount).toBe(0);
      expect(updated).toMatchObject({
        status: 'failed',
        retryCount: 2,
        lastError: 'Outbox retry budget exhausted'
      });
      expect(snapshot).toMatchObject({
        storeKind: 'memory',
        acceptedCount: 0
      });
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

  it('retries thrown fetch failures after backoff and then confirms delivery', async () => {
    const store = createLocalFirstStore(`outbox-http-bridge-fetch-${globalThis.crypto.randomUUID()}`);
    try {
      const bridge = new InMemoryBridgeService({ initialSequence: 0 });
      const entry = await seedOutboxEntry(store, 'evt_http_bridge_fetch_retry');
      let requestCount = 0;
      const transport = createHttpBridgeTransport({
        endpoint: 'https://bridge.test/events',
        fetch: async (input, init) => {
          requestCount += 1;
          if (requestCount === 1) {
            throw new Error('Temporary bridge outage');
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
        lastError: 'Temporary bridge outage'
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

  it('retries timed out bridge requests after backoff and then confirms delivery', async () => {
    const store = createLocalFirstStore(`outbox-http-bridge-timeout-${globalThis.crypto.randomUUID()}`);
    try {
      const bridge = new InMemoryBridgeService({ initialSequence: 0 });
      const entry = await seedOutboxEntry(store, 'evt_http_bridge_timeout_retry');
      let requestCount = 0;
      const transport = createHttpBridgeTransport({
        endpoint: 'https://bridge.test/events',
        timeoutMs: 1,
        fetch: async (input, init) => {
          requestCount += 1;
          if (requestCount === 1) {
            await waitForAbort(init?.signal);
            throw makeAbortError();
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
        lastError: 'Bridge request timed out after 1ms'
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

async function waitForAbort(signal: AbortSignal | null | undefined): Promise<void> {
  if (!signal) throw new Error('Expected bridge request abort signal');
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

function makeAbortError(): Error {
  const error = new Error('Request aborted');
  error.name = 'AbortError';
  return error;
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
