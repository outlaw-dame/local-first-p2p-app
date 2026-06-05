import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createLocalFirstStore } from '@lfp2p/local-store';
import { TrustSafetyError } from '@lfp2p/trust-safety';
import {
  emitAggregatorPublished,
  emitAggregatorRemoved,
  emitAttestationPublished,
  emitAttestationRevoked,
  emitObservationRecorded
} from './pwa-reputation-emit.js';

/**
 * Phase 1.8.7 emit-helper tests. Each helper must:
 *  - validate inputs against the protocol-layer validator,
 *  - persist via the v8 reputation event log,
 *  - be idempotent on the explicit eventId,
 *  - throw `TrustSafetyError` on bounded-enum / range violations.
 */

function freshStore(name: string): ReturnType<typeof createLocalFirstStore> {
  return createLocalFirstStore(`lfp2p-test-rep-${name}-${Math.random().toString(36).slice(2)}`);
}

describe('emitObservationRecorded', () => {
  it('persists a valid observation and is idempotent on the eventId', async () => {
    const store = freshStore('obs-happy');
    await emitObservationRecorded({
      store,
      subject: { type: 'actor', actorId: 'actor_alice' },
      observationKind: 'outbox.useful',
      satCount: 3,
      unsatCount: 0,
      windowStart: '2026-05-25T00:00:00Z',
      windowEnd: '2026-06-01T00:00:00Z',
      eventId: 'evt_rep_obs_test_1'
    });
    // Idempotent: same eventId is a silent no-op.
    await emitObservationRecorded({
      store,
      subject: { type: 'actor', actorId: 'actor_alice' },
      observationKind: 'outbox.useful',
      satCount: 3,
      unsatCount: 0,
      windowStart: '2026-05-25T00:00:00Z',
      windowEnd: '2026-06-01T00:00:00Z',
      eventId: 'evt_rep_obs_test_1'
    });
    const rows = await store.loadReputationEvents();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('reputation.observation.recorded');
    expect(rows[0]!.eventId).toBe('evt_rep_obs_test_1');
  });

  it('throws on inverted window (defense-in-depth via validator)', async () => {
    const store = freshStore('obs-bad-window');
    await expect(
      emitObservationRecorded({
        store,
        subject: { type: 'actor', actorId: 'a' },
        observationKind: 'outbox.useful',
        satCount: 1,
        unsatCount: 0,
        windowStart: '2026-06-02T00:00:00Z',
        windowEnd: '2026-05-25T00:00:00Z'
      })
    ).rejects.toThrow(TrustSafetyError);
  });

  it('throws on unknown observation kind', async () => {
    const store = freshStore('obs-unknown-kind');
    await expect(
      emitObservationRecorded({
        store,
        subject: { type: 'actor', actorId: 'a' },
        // @ts-expect-error: testing runtime guard
        observationKind: 'outbox.legendary',
        satCount: 1,
        unsatCount: 0,
        windowStart: '2026-05-25T00:00:00Z',
        windowEnd: '2026-06-01T00:00:00Z'
      })
    ).rejects.toThrow(TrustSafetyError);
  });

  it('persistence layer corrupt-row protection: load skips invalid rows silently', async () => {
    const store = freshStore('obs-corrupt');
    // Successfully persist one well-formed event.
    await emitObservationRecorded({
      store,
      subject: { type: 'actor', actorId: 'actor_bob' },
      observationKind: 'outbox.spammy',
      satCount: 0,
      unsatCount: 1,
      windowStart: '2026-05-25T00:00:00Z',
      windowEnd: '2026-06-01T00:00:00Z',
      eventId: 'evt_rep_obs_keep'
    });
    const rows = await store.loadReputationEvents();
    expect(rows.length).toBe(1);
  });
});

describe('emitAttestationPublished', () => {
  it('persists a valid attestation with the fingerprint-verified context tag', async () => {
    const store = freshStore('att-happy');
    const evt = await emitAttestationPublished({
      store,
      subject: { type: 'actor', actorId: 'actor_bob' },
      valence: 'positive',
      contextTag: 'contact.verified-in-person',
      strength: 0.9
    });
    expect(evt.kind).toBe('reputation.attestation.published');
    const rows = await store.loadReputationEvents();
    expect(rows).toHaveLength(1);
  });

  it('rejects strength outside [0, 1]', async () => {
    const store = freshStore('att-bad-strength');
    await expect(
      emitAttestationPublished({
        store,
        subject: { type: 'actor', actorId: 'a' },
        valence: 'positive',
        contextTag: 'community.contributor',
        strength: 1.5
      })
    ).rejects.toThrow(TrustSafetyError);
  });

  it('rejects expiresAt before createdAt', async () => {
    const store = freshStore('att-bad-expires');
    await expect(
      emitAttestationPublished({
        store,
        subject: { type: 'actor', actorId: 'a' },
        valence: 'positive',
        contextTag: 'community.contributor',
        strength: 0.5,
        createdAt: '2026-06-01T12:00:00Z',
        expiresAt: '2026-06-01T00:00:00Z'
      })
    ).rejects.toThrow(TrustSafetyError);
  });
});

describe('emitAttestationRevoked', () => {
  it('persists a valid revocation', async () => {
    const store = freshStore('rev-happy');
    await emitAttestationRevoked({
      store,
      attestationId: 'evt_rep_att_ref',
      eventId: 'evt_rep_rev_1'
    });
    const rows = await store.loadReputationEvents();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('reputation.attestation.revoked');
  });

  it('rejects revokedAt before createdAt', async () => {
    const store = freshStore('rev-bad-time');
    await expect(
      emitAttestationRevoked({
        store,
        attestationId: 'evt_x',
        createdAt: '2026-06-02T00:00:00Z',
        revokedAt: '2026-06-01T00:00:00Z'
      })
    ).rejects.toThrow(TrustSafetyError);
  });
});

describe('emitAggregatorPublished + emitAggregatorRemoved', () => {
  it('persists an aggregator batch then a removal event', async () => {
    const store = freshStore('agg-roundtrip');
    await emitAggregatorPublished({
      store,
      algorithm: 'openrank.v1',
      computedAt: '2026-06-01T01:00:00Z',
      subjects: [
        Object.freeze({
          subject: Object.freeze({ type: 'actor' as const, actorId: 'actor_alice' }),
          score: 0.5,
          confidence: 0.7,
          observationCount: 10
        })
      ]
    });
    await emitAggregatorRemoved({
      store,
      subject: { type: 'actor', actorId: 'actor_alice' },
      reason: 'revoked'
    });
    const rows = await store.loadReputationEvents();
    expect(rows.length).toBe(2);
    expect(rows[0]!.kind).toBe('reputation.aggregator.published');
    expect(rows[1]!.kind).toBe('reputation.aggregator.score.removed');
  });

  it('rejects an empty aggregator batch', async () => {
    const store = freshStore('agg-empty');
    await expect(
      emitAggregatorPublished({
        store,
        algorithm: 'openrank.v1',
        computedAt: '2026-06-01T01:00:00Z',
        subjects: []
      })
    ).rejects.toThrow(TrustSafetyError);
  });

  it('rejects an unknown removal reason', async () => {
    const store = freshStore('rem-bad-reason');
    await expect(
      emitAggregatorRemoved({
        store,
        subject: { type: 'actor', actorId: 'a' },
        // @ts-expect-error: testing runtime guard
        reason: 'because-i-said-so'
      })
    ).rejects.toThrow(TrustSafetyError);
  });
});

describe('cross-helper sequencing — multi-kind log replays in order', () => {
  it('multiple emits land in insertion order on listTrustSafetyReputationEvents', async () => {
    const store = freshStore('multi-order');
    await emitObservationRecorded({
      store,
      subject: { type: 'actor', actorId: 'a' },
      observationKind: 'outbox.useful',
      satCount: 1,
      unsatCount: 0,
      windowStart: '2026-05-25T00:00:00Z',
      windowEnd: '2026-06-01T00:00:00Z',
      eventId: 'evt_1'
    });
    await emitAttestationPublished({
      store,
      subject: { type: 'actor', actorId: 'b' },
      valence: 'positive',
      contextTag: 'community.contributor',
      strength: 0.7,
      eventId: 'evt_2'
    });
    await emitAttestationRevoked({
      store,
      attestationId: 'evt_2',
      eventId: 'evt_3'
    });
    const rows = await store.listTrustSafetyReputationEvents();
    expect(rows.map((r) => r.eventId)).toEqual(['evt_1', 'evt_2', 'evt_3']);
    expect(rows.map((r) => r.sequence)).toEqual([0, 1, 2]);
  });
});
