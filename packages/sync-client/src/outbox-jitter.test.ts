import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { generateSigningKeypair, signEventEnvelope } from '@lfp2p/crypto';
import { createLocalFirstStore } from '@lfp2p/local-store';
import { createUnsignedEvent, placeholderPrivatePayloadEnvelope } from '@lfp2p/protocol';
import { processOutboxBatch, type OutboxTransport } from './index.js';

describe('processOutboxBatch retry jitter configuration', () => {
  it('passes jitterRatio through to retry delay computation', async () => {
    const store = createLocalFirstStore(`outbox-jitter-${globalThis.crypto.randomUUID()}`);
    try {
      const now = '2026-05-22T00:00:00.000Z';
      const eventId = 'evt_custom_jitter';
      const keypair = generateSigningKeypair();
      const event = signEventEnvelope(
        createUnsignedEvent({
          eventId,
          kind: 'outbox.test.created',
          author: `identity:${keypair.publicKey}`,
          deviceId: `device:${keypair.publicKey.slice(0, 16)}`,
          createdAt: now,
          privacy: 'dm',
          // Phase 5.0E follow-up: `dm` privacy requires a PrivatePayloadEnvelopeV1.
          payload: placeholderPrivatePayloadEnvelope({ keyId: `placeholder-${eventId}` })
        }),
        keypair
      );
      await store.putSignedEvent(event);
      await store.enqueueOutbox({
        idempotencyKey: 'idem_custom_jitter',
        eventId,
        target: 'bridge:test',
        status: 'pending',
        retryCount: 0,
        nextRetryAt: now,
        createdAt: now,
        updatedAt: now
      });
      const transport: OutboxTransport = {
        async send() {
          throw new Error('temporary relay unavailable');
        }
      };

      const result = await processOutboxBatch({
        store,
        transport,
        now: new Date(now),
        baseDelayMs: 1_000,
        jitterRatio: 0.5,
        random: () => 1
      });

      const updated = await store.getOutboxEntry('idem_custom_jitter');
      expect(result).toEqual({
        attempted: 1,
        confirmed: 0,
        conflicted: 0,
        retried: 1,
        failed: 0,
        skipped: 0
      });
      expect(updated?.nextRetryAt).toBe('2026-05-22T00:00:03.000Z');
      expect(updated?.lastError).toBe('temporary relay unavailable');
    } finally {
      await store.delete();
    }
  });
});
