/**
 * Phase 1.8.14 — end-to-end test: a labeler signs a
 * `reputation.aggregator.published` envelope; the bridge admits the
 * delivery; the inbound HTTP transport pulls it; `processInboundSyncBatch`
 * routes it through automatic dispatch into the reputation log.
 *
 * This is the loop-close that Phase 1.8.12 deferred. The user explicitly
 * called out the gap ("just to be sure you didn't adopt OpenRank as is"
 * + "what is the method of dispatch") and asked for the wiring to be
 * completed. After this test, an aggregator labeler running anywhere
 * can publish reputation scores to a subscribed user's device with no
 * additional plumbing.
 *
 * Coverage:
 *   1. Bridge accepts a public-privacy aggregator envelope.
 *   2. Inbound HTTP pull surfaces it as an InboundSyncRecord.
 *   3. processInboundSyncBatch — with subscribedLabelers including the
 *      labeler's identity — projects it into the reputation log.
 *   4. Replay: a re-pulled envelope is a no-op (idempotent).
 *   5. Unsubscribed delivery: the envelope is stored but NOT projected
 *      (envelope.applied still increments; reputation.dropped == 1).
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  InMemoryBridgeService,
  handleBridgeDeliveryRequest,
  handleBridgeInboundReadRequest
} from '@lfp2p/bridge-service';
import { signingKeypairFromSeed, signEventEnvelope } from '@lfp2p/crypto';
import { createLocalFirstStore } from '@lfp2p/local-store';
import {
  REPUTATION_EVENT_PAYLOAD_VERSION,
  createUnsignedEvent,
  type SignedEventEnvelope
} from '@lfp2p/protocol';
import { createHttpBridgeInboundTransport } from './inbound-http.js';
import { createHttpBridgeTransport, processInboundSyncBatch, processOutboxBatch } from './index.js';

const FIXED_NOW = '2026-06-01T00:00:00.000Z';
const LABELER_SEED = new Uint8Array(32).fill(77);

function buildAggregatorEnvelope(eventId: string, actorId: string): {
  envelope: SignedEventEnvelope;
  labelerAuthor: string;
} {
  const keypair = signingKeypairFromSeed(LABELER_SEED);
  const labelerAuthor = `identity:${keypair.publicKey}`;
  const envelope = signEventEnvelope(
    createUnsignedEvent({
      eventId,
      kind: 'reputation.aggregator.published',
      author: labelerAuthor,
      deviceId: `device:${keypair.publicKey.slice(0, 16)}`,
      createdAt: FIXED_NOW,
      privacy: 'public',
      payload: {
        version: REPUTATION_EVENT_PAYLOAD_VERSION,
        eventId,
        kind: 'reputation.aggregator.published',
        createdAt: FIXED_NOW,
        algorithm: 'openrank.v1',
        computedAt: FIXED_NOW,
        subjects: [
          {
            subject: { type: 'actor', actorId },
            score: 0.75,
            confidence: 0.9,
            observationCount: 17
          }
        ]
      }
    }),
    keypair
  );
  return { envelope, labelerAuthor };
}

async function seedReputationOutbox(
  store: ReturnType<typeof createLocalFirstStore>,
  envelope: SignedEventEnvelope
): Promise<void> {
  await store.putSignedEvent(envelope);
  await store.enqueueOutbox({
    idempotencyKey: `idem_${envelope.eventId}`,
    eventId: envelope.eventId,
    target: 'bridge:test',
    status: 'pending',
    retryCount: 0,
    nextRetryAt: FIXED_NOW,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW
  });
}

/* -------------------------------------------------------------------------- */

describe('HTTP bridge → inbound sync → reputation projection (Phase 1.8.14 E2E)', () => {
  it('routes a labeler-published aggregator envelope into the reputation log of a subscribed user', async () => {
    const labelerStore = createLocalFirstStore(
      `bridge-rep-e2e-labeler-${globalThis.crypto.randomUUID()}`
    );
    const userStore = createLocalFirstStore(
      `bridge-rep-e2e-user-${globalThis.crypto.randomUUID()}`
    );
    try {
      const bridge = new InMemoryBridgeService({ initialSequence: 0 });
      const { envelope, labelerAuthor } = buildAggregatorEnvelope(
        'evt_e2e_agg_published_001',
        'actor_subject_alice'
      );

      // Labeler-side: enqueue + outbox-process the envelope to the bridge.
      await seedReputationOutbox(labelerStore, envelope);
      const outboxTransport = createHttpBridgeTransport({
        endpoint: 'https://bridge.test/events',
        fetch: async (input, init) =>
          handleBridgeDeliveryRequest(bridge, new Request(input, init), FIXED_NOW)
      });
      await expect(
        processOutboxBatch({
          store: labelerStore,
          transport: outboxTransport,
          now: new Date(FIXED_NOW)
        })
      ).resolves.toEqual({
        attempted: 1,
        confirmed: 1,
        conflicted: 0,
        retried: 0,
        failed: 0,
        skipped: 0
      });

      // User-side: pull from the bridge and process with reputation
      // routing enabled. The labeler's signing identity is the
      // subscribed entry — using the default identity author→labeler
      // mapper means no caller-supplied function is needed.
      const inboundTransport = createHttpBridgeInboundTransport({
        endpoint: 'https://bridge.test/inbound',
        fetch: async (input, init) =>
          handleBridgeInboundReadRequest(bridge, new Request(input, init), FIXED_NOW)
      });
      const records = await inboundTransport.pull({
        sourceId: 'bridge:primary',
        streamId: 'bridge:test',
        scope: 'identity:alice',
        limit: 10
      });
      expect(records).toHaveLength(1);

      const result = await processInboundSyncBatch({
        store: userStore,
        records,
        subscribedLabelers: new Set([labelerAuthor]),
        now: new Date(FIXED_NOW)
      });
      expect(result.received).toBe(1);
      expect(result.applied).toBe(1);
      expect(result.reputation).toEqual({
        applied: 1,
        dropped: 0,
        rejected: 0,
        errors: []
      });

      // The envelope landed in signedEvents AND the reputation log.
      await expect(userStore.getSignedEvent('evt_e2e_agg_published_001')).resolves.toEqual(
        envelope
      );
      const reputationRows = await userStore.listTrustSafetyReputationEvents();
      expect(reputationRows).toHaveLength(1);
      expect(reputationRows[0]?.eventId).toBe('evt_e2e_agg_published_001');
      expect(reputationRows[0]?.kind).toBe('reputation.aggregator.published');
      // The reputation event the user can replay into Phase 1.8.2
      // computeReputation arrives shape-identical to what the labeler
      // signed — replay-deterministic boundary preserved.
      const replayable = await userStore.loadReputationEvents();
      expect(replayable).toHaveLength(1);
      expect(replayable[0]?.eventId).toBe('evt_e2e_agg_published_001');
    } finally {
      await labelerStore.delete();
      await userStore.delete();
    }
  });

  it('stores but does NOT project an aggregator envelope from a non-subscribed labeler', async () => {
    const labelerStore = createLocalFirstStore(
      `bridge-rep-e2e-unsubbed-labeler-${globalThis.crypto.randomUUID()}`
    );
    const userStore = createLocalFirstStore(
      `bridge-rep-e2e-unsubbed-user-${globalThis.crypto.randomUUID()}`
    );
    try {
      const bridge = new InMemoryBridgeService({ initialSequence: 0 });
      const { envelope } = buildAggregatorEnvelope(
        'evt_e2e_agg_unsubscribed_001',
        'actor_subject_bob'
      );
      await seedReputationOutbox(labelerStore, envelope);
      const outboxTransport = createHttpBridgeTransport({
        endpoint: 'https://bridge.test/events',
        fetch: async (input, init) =>
          handleBridgeDeliveryRequest(bridge, new Request(input, init), FIXED_NOW)
      });
      await processOutboxBatch({
        store: labelerStore,
        transport: outboxTransport,
        now: new Date(FIXED_NOW)
      });

      const inboundTransport = createHttpBridgeInboundTransport({
        endpoint: 'https://bridge.test/inbound',
        fetch: async (input, init) =>
          handleBridgeInboundReadRequest(bridge, new Request(input, init), FIXED_NOW)
      });
      const records = await inboundTransport.pull({
        sourceId: 'bridge:primary',
        streamId: 'bridge:test',
        scope: 'identity:alice',
        limit: 10
      });
      const result = await processInboundSyncBatch({
        store: userStore,
        records,
        subscribedLabelers: new Set(['identity:some-other-labeler-the-user-trusts']),
        now: new Date(FIXED_NOW)
      });

      // The envelope is admitted + stored (the bridge already did
      // admission; the user has the raw envelope for forensics) but
      // the reputation projection refuses to accept content from an
      // unsubscribed source. Doctrine non-negotiable #1 preserved.
      expect(result.applied).toBe(1); // envelope stored
      expect(result.reputation).toEqual({
        applied: 0,
        dropped: 1, // rejected at the reputation projection
        rejected: 0,
        errors: []
      });
      await expect(userStore.listTrustSafetyReputationEvents()).resolves.toHaveLength(0);
    } finally {
      await labelerStore.delete();
      await userStore.delete();
    }
  });

  it('replaying an already-projected envelope is a no-op (true idempotency end-to-end)', async () => {
    const labelerStore = createLocalFirstStore(
      `bridge-rep-e2e-replay-labeler-${globalThis.crypto.randomUUID()}`
    );
    const userStore = createLocalFirstStore(
      `bridge-rep-e2e-replay-user-${globalThis.crypto.randomUUID()}`
    );
    try {
      const bridge = new InMemoryBridgeService({ initialSequence: 0 });
      const { envelope, labelerAuthor } = buildAggregatorEnvelope(
        'evt_e2e_agg_replay_001',
        'actor_subject_carol'
      );
      await seedReputationOutbox(labelerStore, envelope);
      const outboxTransport = createHttpBridgeTransport({
        endpoint: 'https://bridge.test/events',
        fetch: async (input, init) =>
          handleBridgeDeliveryRequest(bridge, new Request(input, init), FIXED_NOW)
      });
      await processOutboxBatch({
        store: labelerStore,
        transport: outboxTransport,
        now: new Date(FIXED_NOW)
      });

      const inboundTransport = createHttpBridgeInboundTransport({
        endpoint: 'https://bridge.test/inbound',
        fetch: async (input, init) =>
          handleBridgeInboundReadRequest(bridge, new Request(input, init), FIXED_NOW)
      });
      const subscribedLabelers = new Set([labelerAuthor]);

      // First pass — fresh projection.
      const firstRecords = await inboundTransport.pull({
        sourceId: 'bridge:primary',
        streamId: 'bridge:test',
        scope: 'identity:alice',
        limit: 10
      });
      const firstPass = await processInboundSyncBatch({
        store: userStore,
        records: firstRecords,
        subscribedLabelers,
        now: new Date(FIXED_NOW)
      });
      expect(firstPass.reputation?.applied).toBe(1);

      // Second pass with the SAME records (simulating a re-delivery
      // after a transient network reorder). At the protocol /
      // checkpoint layer the duplicate is caught BEFORE the
      // reputation dispatch — `putSignedEventWithSyncCheckpoint`
      // returns `status: 'skipped'`, so the reputation projection is
      // never re-invoked. This is the FIRST line of idempotency
      // defense; the per-event-id idempotency at the reputation
      // log itself is the SECOND. Both lines hold here: the
      // reputation log still has exactly one row.
      const replayPass = await processInboundSyncBatch({
        store: userStore,
        records: firstRecords,
        subscribedLabelers,
        now: new Date(FIXED_NOW)
      });
      expect(replayPass.received).toBe(1);
      expect(replayPass.skipped).toBe(1);
      expect(replayPass.applied).toBe(0);
      expect(replayPass.reputation).toEqual({
        applied: 0,
        dropped: 0,
        rejected: 0,
        errors: []
      });
      await expect(userStore.listTrustSafetyReputationEvents()).resolves.toHaveLength(1);
    } finally {
      await labelerStore.delete();
      await userStore.delete();
    }
  });
});
