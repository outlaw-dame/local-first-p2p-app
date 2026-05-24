import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { generateSigningKeypair, signEventEnvelope } from '@lfp2p/crypto';
import { createLocalFirstStore, type MutationOutboxEntry } from '@lfp2p/local-store';
import { createUnsignedEvent } from '@lfp2p/protocol';
import {
  computeBackoffDelayMs,
  createHttpBridgeTransport,
  NonRetryableOutboxError,
  processOutboxBatch,
  StaleResponseGuard,
  type OutboxTransport
} from './index.js';

describe('sync retry and staleness helpers', () => {
  it('computes bounded exponential backoff with deterministic jitter', () => {
    expect(
      computeBackoffDelayMs({ attempt: 3, baseDelayMs: 100, maxDelayMs: 1_000, jitterRatio: 0.25, random: () => 0.5 })
    ).toBe(800);
    expect(
      computeBackoffDelayMs({ attempt: 10, baseDelayMs: 100, maxDelayMs: 1_000, jitterRatio: 0, random: () => 0 })
    ).toBe(1_000);
  });

  it('rejects stale response sequences', () => {
    const guard = new StaleResponseGuard();
    expect(guard.accept('feed:home', 10)).toBe(true);
    expect(guard.accept('feed:home', 9)).toBe(false);
    expect(guard.accept('feed:home', 11)).toBe(true);
  });
});

describe('createHttpBridgeTransport', () => {
  it('posts signed events with an idempotency header and maps confirmations', async () => {
    const entry = makeOutboxEntry({ idempotencyKey: 'idem-http-confirm', eventId: 'evt_http_confirm' });
    const event = makeSignedEvent('evt_http_confirm');
    const requests: Request[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return new Response(JSON.stringify({ status: 'confirmed', sequence: 7 }), {
        status: 202,
        headers: { 'content-type': 'application/json' }
      });
    };

    const transport = createHttpBridgeTransport({ endpoint: 'https://bridge.test/events', fetch: fetchImpl, timeoutMs: 5_000 });
    const result = await transport.send({ entry, event });
    const body = JSON.parse(await requests[0]!.text()) as Record<string, unknown>;

    expect(result).toEqual({ status: 'confirmed', sequence: 7 });
    expect(requests[0]!.url).toBe('https://bridge.test/events');
    expect(requests[0]!.method).toBe('POST');
    expect(requests[0]!.headers.get('x-lfp2p-idempotency-key')).toBe('idem-http-confirm');
    expect(body.idempotencyKey).toBe('idem-http-confirm');
    expect(body.target).toBe('bridge:test');
  });

  it('maps bridge conflicts without retrying transport', async () => {
    const transport = createHttpBridgeTransport({
      endpoint: 'https://bridge.test/events',
      fetch: async () => new Response(JSON.stringify({ status: 'conflicted', reason: 'duplicate idempotency key' }), { status: 409 })
    });

    await expect(transport.send({ entry: makeOutboxEntry(), event: makeSignedEvent('evt_conflict_http') })).resolves.toEqual({
      status: 'conflicted',
      reason: 'duplicate idempotency key'
    });
  });

  it('treats bridge JSON rejections as non-retryable errors', async () => {
    const transport = createHttpBridgeTransport({
      endpoint: 'https://bridge.test/events',
      fetch: async () => new Response(JSON.stringify({ status: 'rejected', reason: 'local-only scope' }), { status: 422 })
    });

    await expect(transport.send({ entry: makeOutboxEntry(), event: makeSignedEvent('evt_rejected_http') })).rejects.toBeInstanceOf(
      NonRetryableOutboxError
    );
  });

  it('treats non-json permanent 4xx responses as non-retryable errors', async () => {
    const transport = createHttpBridgeTransport({
      endpoint: 'https://bridge.test/events',
      fetch: async () => new Response('<html>unprocessable</html>', { status: 422, statusText: 'Unprocessable Content' })
    });

    await expect(
      transport.send({ entry: makeOutboxEntry(), event: makeSignedEvent('evt_non_json_422') })
    ).rejects.toBeInstanceOf(NonRetryableOutboxError);
  });

  it('treats malformed successful bridge responses as retryable transport errors', async () => {
    const transport = createHttpBridgeTransport({
      endpoint: 'https://bridge.test/events',
      fetch: async () => new Response('{"status":', { status: 202, statusText: 'Accepted' })
    });

    await expect(
      transport.send({ entry: makeOutboxEntry(), event: makeSignedEvent('evt_malformed_success_response') })
    ).rejects.toThrow('Bridge returned malformed JSON response');
  });

  it('rejects invalid successful bridge response shapes without coercion', async () => {
    const invalidResponses: ReadonlyArray<Readonly<{ body: unknown; error: string; eventId: string }>> = [
      {
        body: { status: 'confirmed', sequence: '7' },
        error: 'Bridge response sequence must be a non-negative integer',
        eventId: 'evt_invalid_string_sequence'
      },
      {
        body: { status: 'conflicted', reason: 123 },
        error: 'Bridge response reason is required',
        eventId: 'evt_invalid_numeric_reason'
      },
      {
        body: { status: 'accepted' },
        error: 'Bridge returned unsupported status',
        eventId: 'evt_invalid_unsupported_status'
      }
    ];

    for (const invalid of invalidResponses) {
      const transport = createHttpBridgeTransport({
        endpoint: 'https://bridge.test/events',
        fetch: async () => new Response(JSON.stringify(invalid.body), { status: 202 })
      });

      await expect(transport.send({ entry: makeOutboxEntry(), event: makeSignedEvent(invalid.eventId) })).rejects.toThrow(
        invalid.error
      );
    }
  });

  it('rejects endpoints with embedded credentials', () => {
    expect(() => createHttpBridgeTransport({ endpoint: 'https://user:pass@bridge.test/events' })).toThrow(
      'Bridge endpoint must not include credentials'
    );
  });
});

describe('processOutboxBatch', () => {
  it('confirms successfully delivered signed events', async () => {
    const store = createLocalFirstStore(`outbox-success-${globalThis.crypto.randomUUID()}`);
    const entry = await seedOutboxEntry(store, 'evt_success');
    const sent: string[] = [];
    const transport: OutboxTransport = {
      async send(input) {
        sent.push(input.entry.idempotencyKey);
        expect(input.event.eventId).toBe('evt_success');
        return { status: 'confirmed', sequence: 1 };
      }
    };

    const result = await processOutboxBatch({
      store,
      transport,
      now: new Date('2026-05-22T00:00:00.000Z')
    });

    expect(result).toEqual({ attempted: 1, confirmed: 1, conflicted: 0, retried: 0, failed: 0, skipped: 0 });
    expect(sent).toEqual([entry.idempotencyKey]);
    expect((await store.getOutboxEntry(entry.idempotencyKey))?.status).toBe('confirmed');
    await store.delete();
  });

  it('does not retry an event when local confirmation persistence fails after transport success', async () => {
    const store = createLocalFirstStore(`outbox-local-confirm-fail-${globalThis.crypto.randomUUID()}`);
    await seedOutboxEntry(store, 'evt_confirm_local_failure');
    let sent = 0;
    const transport: OutboxTransport = {
      async send() {
        sent += 1;
        await store.close();
        return { status: 'confirmed', sequence: 1 };
      }
    };

    await expect(
      processOutboxBatch({
        store,
        transport,
        now: new Date('2026-05-22T00:00:00.000Z')
      })
    ).rejects.toThrow();

    expect(sent).toBe(1);
  });

  it('schedules retryable transport failures with exponential backoff', async () => {
    const store = createLocalFirstStore(`outbox-retry-${globalThis.crypto.randomUUID()}`);
    const entry = await seedOutboxEntry(store, 'evt_retry');
    const transport: OutboxTransport = {
      async send() {
        throw new Error('temporary relay unavailable');
      }
    };

    const result = await processOutboxBatch({
      store,
      transport,
      now: new Date('2026-05-22T00:00:00.000Z'),
      baseDelayMs: 1_000,
      maxDelayMs: 60_000,
      random: () => 0.5
    });

    const updated = await store.getOutboxEntry(entry.idempotencyKey);
    expect(result).toEqual({ attempted: 1, confirmed: 0, conflicted: 0, retried: 1, failed: 0, skipped: 0 });
    expect(updated?.status).toBe('pending');
    expect(updated?.retryCount).toBe(1);
    expect(updated?.nextRetryAt).toBe('2026-05-22T00:00:02.000Z');
    expect(updated?.lastError).toBe('temporary relay unavailable');
    await store.delete();
  });

  it('schedules retry for malformed successful HTTP bridge responses without confirming locally', async () => {
    const store = createLocalFirstStore(`outbox-malformed-bridge-response-${globalThis.crypto.randomUUID()}`);
    try {
      const entry = await seedOutboxEntry(store, 'evt_malformed_bridge_response');
      let requestCount = 0;
      const transport = createHttpBridgeTransport({
        endpoint: 'https://bridge.test/events',
        fetch: async () => {
          requestCount += 1;
          if (requestCount === 1) return new Response('{"status":', { status: 202, statusText: 'Accepted' });
          return new Response(JSON.stringify({ status: 'confirmed', sequence: 4 }), { status: 202 });
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

      expect(first).toEqual({ attempted: 1, confirmed: 0, conflicted: 0, retried: 1, failed: 0, skipped: 0 });
      expect(afterFailure).toMatchObject({
        status: 'pending',
        retryCount: 1,
        nextRetryAt: '2026-05-22T00:00:02.000Z',
        lastError: 'Bridge returned malformed JSON response'
      });
      expect(beforeDue).toEqual({ attempted: 0, confirmed: 0, conflicted: 0, retried: 0, failed: 0, skipped: 0 });
      expect(afterRetry).toEqual({ attempted: 1, confirmed: 1, conflicted: 0, retried: 0, failed: 0, skipped: 0 });
      expect(requestCount).toBe(2);
      expect(confirmed).toMatchObject({
        status: 'confirmed',
        retryCount: 1
      });
    } finally {
      await store.delete();
    }
  });

  it('marks non-retryable failures as terminal failed', async () => {
    const store = createLocalFirstStore(`outbox-terminal-${globalThis.crypto.randomUUID()}`);
    const entry = await seedOutboxEntry(store, 'evt_terminal');
    const transport: OutboxTransport = {
      async send() {
        throw new NonRetryableOutboxError('rejected by bridge policy');
      }
    };

    const result = await processOutboxBatch({
      store,
      transport,
      now: new Date('2026-05-22T00:00:00.000Z')
    });

    const updated = await store.getOutboxEntry(entry.idempotencyKey);
    expect(result).toEqual({ attempted: 1, confirmed: 0, conflicted: 0, retried: 0, failed: 1, skipped: 0 });
    expect(updated?.status).toBe('failed');
    expect(updated?.lastError).toBe('rejected by bridge policy');
    await store.delete();
  });

  it('marks transport conflicts separately from failures', async () => {
    const store = createLocalFirstStore(`outbox-conflict-${globalThis.crypto.randomUUID()}`);
    const entry = await seedOutboxEntry(store, 'evt_conflict');
    const transport: OutboxTransport = {
      async send() {
        return { status: 'conflicted', reason: 'duplicate idempotency key' };
      }
    };

    const result = await processOutboxBatch({
      store,
      transport,
      now: new Date('2026-05-22T00:00:00.000Z')
    });

    const updated = await store.getOutboxEntry(entry.idempotencyKey);
    expect(result).toEqual({ attempted: 1, confirmed: 0, conflicted: 1, retried: 0, failed: 0, skipped: 0 });
    expect(updated?.status).toBe('conflicted');
    expect(updated?.lastError).toBe('duplicate idempotency key');
    await store.delete();
  });

  it('fails closed when an outbox entry references a missing signed event', async () => {
    const store = createLocalFirstStore(`outbox-missing-${globalThis.crypto.randomUUID()}`);
    const now = '2026-05-22T00:00:00.000Z';
    const entry: MutationOutboxEntry = {
      idempotencyKey: 'idem_missing',
      eventId: 'evt_missing',
      target: 'bridge:test',
      status: 'pending',
      retryCount: 0,
      nextRetryAt: now,
      createdAt: now,
      updatedAt: now
    };
    await store.enqueueOutbox(entry);

    const result = await processOutboxBatch({
      store,
      transport: { async send() { return { status: 'confirmed' }; } },
      now: new Date(now)
    });

    const updated = await store.getOutboxEntry(entry.idempotencyKey);
    expect(result).toEqual({ attempted: 1, confirmed: 0, conflicted: 0, retried: 0, failed: 1, skipped: 0 });
    expect(updated?.status).toBe('failed');
    expect(updated?.lastError).toContain('Missing signed event');
    await store.delete();
  });
});

async function seedOutboxEntry(store: ReturnType<typeof createLocalFirstStore>, eventId: string): Promise<MutationOutboxEntry> {
  const event = makeSignedEvent(eventId);
  await store.putSignedEvent(event);
  const entry = makeOutboxEntry({
    idempotencyKey: `idem_${eventId}`,
    eventId
  });
  await store.enqueueOutbox(entry);
  return entry;
}

function makeOutboxEntry(overrides: Partial<MutationOutboxEntry> = {}): MutationOutboxEntry {
  const now = '2026-05-22T00:00:00.000Z';
  return {
    idempotencyKey: 'idem-default',
    eventId: 'evt-default',
    target: 'bridge:test',
    status: 'pending',
    retryCount: 0,
    nextRetryAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
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
