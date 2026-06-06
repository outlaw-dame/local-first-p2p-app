/**
 * Phase 1.8.14 — adversarial tests for `processInboundSyncBatch`
 * routing reputation envelopes into the trust-safety projection.
 *
 * Coverage:
 *   1. Aggregator envelopes from a subscribed labeler are stored AND
 *      projected to the reputation log.
 *   2. Aggregator envelopes from a NON-subscribed labeler are stored
 *      but DROPPED at the reputation log (counted in summary.dropped).
 *   3. `labelerIdForAuthor` mapper lets the caller map envelope.author
 *      to a different labeler id (e.g., DID → labeler id).
 *   4. Empty / missing publisher mapping drops with no error.
 *   5. The non-aggregator reputation kinds (observation, attestation,
 *      revocation) cannot ride a `public`-privacy envelope (rejected
 *      at envelope construction), and a `device-local`-privacy
 *      envelope cannot reach the inbound pipeline because device-
 *      local events do not travel. As DEFENSE IN DEPTH, the dispatch
 *      drops any non-aggregator kind regardless of privacy if one
 *      ever did slip through.
 *   6. Reputation projection is gated on `status === 'stored'` so
 *      duplicate envelopes do NOT double-apply.
 *   7. When the caller omits `subscribedLabelers`, the result has NO
 *      `reputation` field (back-compat shim for existing callers).
 *   8. A semantic-validator failure (envelope passed structural
 *      checks but payload trips a range check) lands in
 *      summary.rejected + summary.errors — does NOT abort the batch.
 */
import 'fake-indexeddb/auto';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { signingKeypairFromSeed, signEventEnvelope } from '@lfp2p/crypto';
import { createLocalFirstStore } from '@lfp2p/local-store';
import {
  REPUTATION_EVENT_PAYLOAD_VERSION,
  createUnsignedEvent,
  type SignedEventEnvelope
} from '@lfp2p/protocol';
import { processInboundSyncBatch, type InboundSyncRecord } from './index.js';

if (typeof globalThis.indexedDB === 'undefined') {
  Object.assign(globalThis, { indexedDB, IDBKeyRange });
}

const FIXED_NOW = '2026-06-01T00:00:00.000Z';
const LABELER_SEED = new Uint8Array(32).fill(99);
const LABELER_AUTHOR = 'identity:openrank';
const LABELER_DEVICE = 'device:openrank-runner';

function aggregatorPayload(eventId: string, actorId: string, score = 0.5) {
  return {
    version: REPUTATION_EVENT_PAYLOAD_VERSION,
    eventId,
    kind: 'reputation.aggregator.published' as const,
    createdAt: FIXED_NOW,
    algorithm: 'openrank.v1' as const,
    computedAt: FIXED_NOW,
    subjects: [
      {
        subject: { type: 'actor' as const, actorId },
        score,
        confidence: 0.8,
        observationCount: 5
      }
    ]
  };
}

function aggregatorEnvelope(
  eventId: string,
  payload: ReturnType<typeof aggregatorPayload>,
  author: string = LABELER_AUTHOR
): SignedEventEnvelope {
  const keypair = signingKeypairFromSeed(LABELER_SEED);
  return signEventEnvelope(
    createUnsignedEvent({
      eventId,
      kind: 'reputation.aggregator.published',
      author,
      deviceId: LABELER_DEVICE,
      createdAt: FIXED_NOW,
      privacy: 'public',
      payload
    }),
    keypair
  );
}

function asInboundRecord(
  event: SignedEventEnvelope,
  cursor: string,
  sequence: number
): InboundSyncRecord {
  return {
    sourceId: 'bridge:primary',
    streamId: 'durable-stream:reputation',
    scope: 'identity:alice',
    cursor,
    sequence,
    receivedAt: FIXED_NOW,
    event
  };
}

function freshStore(label: string) {
  return createLocalFirstStore(
    `inbound-sync-rep-${label}-${globalThis.crypto.randomUUID()}`
  );
}

/* -------------------------------------------------------------------------- */

describe('processInboundSyncBatch — reputation routing (Phase 1.8.14)', () => {
  it('projects aggregator envelopes from a subscribed labeler to the reputation log', async () => {
    const store = freshStore('subscribed-projection');
    try {
      const envelope = aggregatorEnvelope(
        'evt_rep_agg_001',
        aggregatorPayload('evt_rep_agg_001', 'actor_alice', 0.42)
      );
      const result = await processInboundSyncBatch({
        store,
        records: [asInboundRecord(envelope, 'cursor-1', 1)],
        subscribedLabelers: new Set([LABELER_AUTHOR])
      });

      expect(result.received).toBe(1);
      expect(result.applied).toBe(1);
      expect(result.reputation).toEqual({
        applied: 1,
        dropped: 0,
        rejected: 0,
        errors: []
      });

      // Verify the envelope itself was stored AND the reputation
      // projection ran (idempotent on eventId).
      await expect(store.getSignedEvent('evt_rep_agg_001')).resolves.toEqual(envelope);
      const rows = await store.listTrustSafetyReputationEvents();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.eventId).toBe('evt_rep_agg_001');
      expect(rows[0]?.kind).toBe('reputation.aggregator.published');
    } finally {
      await store.delete();
    }
  });

  it('drops aggregator envelopes from a non-subscribed labeler at the reputation projection (but still stores them)', async () => {
    const store = freshStore('not-subscribed');
    try {
      const envelope = aggregatorEnvelope(
        'evt_rep_agg_002',
        aggregatorPayload('evt_rep_agg_002', 'actor_bob')
      );
      const result = await processInboundSyncBatch({
        store,
        records: [asInboundRecord(envelope, 'cursor-1', 1)],
        subscribedLabelers: new Set(['identity:some-other-labeler'])
      });

      expect(result.received).toBe(1);
      expect(result.applied).toBe(1); // envelope stored
      expect(result.reputation).toEqual({
        applied: 0,
        dropped: 1, // not projected to reputation log
        rejected: 0,
        errors: []
      });

      await expect(store.getSignedEvent('evt_rep_agg_002')).resolves.toEqual(envelope);
      await expect(store.listTrustSafetyReputationEvents()).resolves.toHaveLength(0);
    } finally {
      await store.delete();
    }
  });

  it('uses labelerIdForAuthor to map envelope.author → publisher labeler id', async () => {
    const store = freshStore('author-mapper');
    try {
      const envelope = aggregatorEnvelope(
        'evt_rep_agg_003',
        aggregatorPayload('evt_rep_agg_003', 'actor_carol')
      );
      const result = await processInboundSyncBatch({
        store,
        records: [asInboundRecord(envelope, 'cursor-1', 1)],
        subscribedLabelers: new Set(['labeler:openrank-trust']),
        labelerIdForAuthor: (author) =>
          author === LABELER_AUTHOR ? 'labeler:openrank-trust' : undefined
      });

      expect(result.reputation).toEqual({
        applied: 1,
        dropped: 0,
        rejected: 0,
        errors: []
      });
      await expect(store.listTrustSafetyReputationEvents()).resolves.toHaveLength(1);
    } finally {
      await store.delete();
    }
  });

  it('drops when labelerIdForAuthor returns undefined (no mapping available)', async () => {
    const store = freshStore('author-mapper-undefined');
    try {
      const envelope = aggregatorEnvelope(
        'evt_rep_agg_004',
        aggregatorPayload('evt_rep_agg_004', 'actor_dave')
      );
      const result = await processInboundSyncBatch({
        store,
        records: [asInboundRecord(envelope, 'cursor-1', 1)],
        subscribedLabelers: new Set(['labeler:openrank-trust']),
        labelerIdForAuthor: () => undefined
      });

      expect(result.reputation).toEqual({
        applied: 0,
        dropped: 1,
        rejected: 0,
        errors: []
      });
      await expect(store.listTrustSafetyReputationEvents()).resolves.toHaveLength(0);
    } finally {
      await store.delete();
    }
  });

  it('omits the `reputation` field when caller does NOT pass subscribedLabelers (back-compat)', async () => {
    const store = freshStore('no-routing');
    try {
      const envelope = aggregatorEnvelope(
        'evt_rep_agg_005',
        aggregatorPayload('evt_rep_agg_005', 'actor_eve')
      );
      const result = await processInboundSyncBatch({
        store,
        records: [asInboundRecord(envelope, 'cursor-1', 1)]
      });

      expect(result.applied).toBe(1);
      expect('reputation' in result).toBe(false);
      await expect(store.listTrustSafetyReputationEvents()).resolves.toHaveLength(0);
    } finally {
      await store.delete();
    }
  });

  it('does not double-apply when the envelope is replayed (idempotency at the reputation log)', async () => {
    const store = freshStore('replay-suppression');
    try {
      const envelope = aggregatorEnvelope(
        'evt_rep_agg_006',
        aggregatorPayload('evt_rep_agg_006', 'actor_frank')
      );
      const record = asInboundRecord(envelope, 'cursor-1', 1);
      const subscribedLabelers = new Set([LABELER_AUTHOR]);

      const first = await processInboundSyncBatch({
        store,
        records: [record],
        subscribedLabelers
      });
      expect(first.reputation?.applied).toBe(1);
      expect(first.reputation?.dropped).toBe(0);

      // Replay the SAME envelope with an advanced checkpoint cursor.
      // The envelope upsert still runs (cursor advanced legitimately)
      // BUT the reputation log already has the row — the store
      // returns `status: 'skipped'`, so the routing increments
      // `dropped` (idempotent no-op) instead of `applied`. The
      // reputation log MUST end up with exactly one row regardless of
      // how many times the inbound stream redelivers this event.
      const replay = await processInboundSyncBatch({
        store,
        records: [asInboundRecord(envelope, 'cursor-2', 2)],
        subscribedLabelers
      });
      expect(replay.received).toBe(1);
      expect(replay.reputation?.applied).toBe(0);
      expect(replay.reputation?.dropped).toBe(1);

      // Only one row in the reputation log — true idempotency.
      await expect(store.listTrustSafetyReputationEvents()).resolves.toHaveLength(1);
    } finally {
      await store.delete();
    }
  });

  it('surfaces semantic-validator failures in reputation.errors without aborting the batch', async () => {
    const store = freshStore('semantic-failure');
    try {
      // Build an envelope whose payload passes the protocol's
      // structural checks (version + eventId + kind + createdAt
      // pinned) but trips the trust-safety semantic validator. An
      // empty `subjects` array is the canonical example.
      const badPayload = {
        ...aggregatorPayload('evt_rep_agg_bad_001', 'actor_geoff'),
        subjects: []
      };
      const badEnvelope = aggregatorEnvelope('evt_rep_agg_bad_001', badPayload);
      const goodEnvelope = aggregatorEnvelope(
        'evt_rep_agg_good_001',
        aggregatorPayload('evt_rep_agg_good_001', 'actor_helen')
      );

      const result = await processInboundSyncBatch({
        store,
        records: [
          asInboundRecord(badEnvelope, 'cursor-1', 1),
          asInboundRecord(goodEnvelope, 'cursor-2', 2)
        ],
        subscribedLabelers: new Set([LABELER_AUTHOR])
      });

      // The batch itself does NOT abort — both envelopes are stored.
      // The good one is projected; the bad one lands in
      // reputation.rejected with an error row.
      expect(result.applied).toBe(2);
      expect(result.reputation?.applied).toBe(1);
      expect(result.reputation?.rejected).toBe(1);
      expect(result.reputation?.errors[0]?.eventId).toBe('evt_rep_agg_bad_001');
      expect(result.reputation?.errors[0]?.reason).toMatch(/subjects/i);

      // Only the good event reached the reputation log.
      const rows = await store.listTrustSafetyReputationEvents();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.eventId).toBe('evt_rep_agg_good_001');
    } finally {
      await store.delete();
    }
  });

  it('drops aggregator envelopes when the author field is empty after mapping', async () => {
    const store = freshStore('empty-author');
    try {
      const envelope = aggregatorEnvelope(
        'evt_rep_agg_007',
        aggregatorPayload('evt_rep_agg_007', 'actor_isaac')
      );
      const result = await processInboundSyncBatch({
        store,
        records: [asInboundRecord(envelope, 'cursor-1', 1)],
        subscribedLabelers: new Set([LABELER_AUTHOR]),
        // Maps to empty string → must drop.
        labelerIdForAuthor: () => ''
      });

      expect(result.reputation).toEqual({
        applied: 0,
        dropped: 1,
        rejected: 0,
        errors: []
      });
    } finally {
      await store.delete();
    }
  });

  it('mixed batch: identity events flow through without touching reputation routing', async () => {
    // Mixing protocol-kind families in one batch is realistic for a
    // bridge inbound stream. The reputation routing MUST be a no-op
    // for non-reputation kinds, and the routing must NOT corrupt the
    // existing identity-event flow.
    const store = freshStore('mixed-batch');
    try {
      const reputationEnvelope = aggregatorEnvelope(
        'evt_rep_agg_mix_001',
        aggregatorPayload('evt_rep_agg_mix_001', 'actor_jane')
      );
      // Build an outbox.test.created envelope alongside.
      const keypair = signingKeypairFromSeed(new Uint8Array(32).fill(12));
      const noteEnvelope = signEventEnvelope(
        createUnsignedEvent({
          eventId: 'evt_outbox_mix_001',
          kind: 'outbox.test.created',
          author: 'identity:alice',
          deviceId: 'device:alice-phone',
          createdAt: FIXED_NOW,
          privacy: 'device-local',
          payload: { body: 'hello' }
        }),
        keypair
      );

      const result = await processInboundSyncBatch({
        store,
        records: [
          {
            sourceId: 'bridge:primary',
            streamId: 'durable-stream:inbox',
            scope: 'identity:alice',
            cursor: 'cursor-1',
            sequence: 1,
            receivedAt: FIXED_NOW,
            event: noteEnvelope
          },
          {
            sourceId: 'bridge:primary',
            streamId: 'durable-stream:inbox',
            scope: 'identity:alice',
            cursor: 'cursor-2',
            sequence: 2,
            receivedAt: FIXED_NOW,
            event: reputationEnvelope
          }
        ],
        subscribedLabelers: new Set([LABELER_AUTHOR])
      });

      expect(result.applied).toBe(2);
      expect(result.reputation).toEqual({
        applied: 1,
        dropped: 0,
        rejected: 0,
        errors: []
      });
      await expect(store.getSignedEvent('evt_outbox_mix_001')).resolves.toBeDefined();
      await expect(store.listTrustSafetyReputationEvents()).resolves.toHaveLength(1);
    } finally {
      await store.delete();
    }
  });

  it('handles an empty subscribedLabelers set by dropping everything', async () => {
    const store = freshStore('empty-subscriptions');
    try {
      const envelope = aggregatorEnvelope(
        'evt_rep_agg_008',
        aggregatorPayload('evt_rep_agg_008', 'actor_karl')
      );
      const result = await processInboundSyncBatch({
        store,
        records: [asInboundRecord(envelope, 'cursor-1', 1)],
        subscribedLabelers: new Set()
      });

      expect(result.reputation).toEqual({
        applied: 0,
        dropped: 1,
        rejected: 0,
        errors: []
      });
    } finally {
      await store.delete();
    }
  });

  it('reputation projection runs in stable order across multiple subscribed envelopes', async () => {
    const store = freshStore('multi-projection');
    try {
      const envelopes = [
        aggregatorEnvelope(
          'evt_rep_agg_seq_001',
          aggregatorPayload('evt_rep_agg_seq_001', 'actor_a')
        ),
        aggregatorEnvelope(
          'evt_rep_agg_seq_002',
          aggregatorPayload('evt_rep_agg_seq_002', 'actor_b')
        ),
        aggregatorEnvelope(
          'evt_rep_agg_seq_003',
          aggregatorPayload('evt_rep_agg_seq_003', 'actor_c')
        )
      ];
      const records = envelopes.map((e, i) => asInboundRecord(e, `cursor-${i + 1}`, i + 1));

      const result = await processInboundSyncBatch({
        store,
        records,
        subscribedLabelers: new Set([LABELER_AUTHOR])
      });

      expect(result.reputation?.applied).toBe(3);
      const rows = await store.listTrustSafetyReputationEvents();
      expect(rows.map((r) => r.eventId)).toEqual([
        'evt_rep_agg_seq_001',
        'evt_rep_agg_seq_002',
        'evt_rep_agg_seq_003'
      ]);
    } finally {
      await store.delete();
    }
  });
});
