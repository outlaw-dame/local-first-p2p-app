/**
 * Phase 1.8.12 — adversarial tests for `processInboundReputationBatch`.
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createLocalFirstStore } from '@lfp2p/local-store';
import {
  REPUTATION_EVENT_VERSION,
  type ReputationEvent
} from '@lfp2p/trust-safety';
import {
  REPUTATION_DROP_REASONS,
  processInboundReputationBatch,
  type InboundReputationRecord
} from './inbound-reputation.js';

function freshStore(name: string): ReturnType<typeof createLocalFirstStore> {
  return createLocalFirstStore(
    `lfp2p-test-rep-inbound-${name}-${Math.random().toString(36).slice(2)}`
  );
}

const FIXED_NOW = '2026-06-05T00:00:00Z';

function aggregatorEvent(
  eventId: string,
  actorId: string,
  score = 0.5
): Extract<ReputationEvent, { kind: 'reputation.aggregator.published' }> {
  return Object.freeze({
    version: REPUTATION_EVENT_VERSION,
    eventId,
    createdAt: FIXED_NOW,
    kind: 'reputation.aggregator.published' as const,
    algorithm: 'openrank.v1' as const,
    computedAt: FIXED_NOW,
    subjects: Object.freeze([
      Object.freeze({
        subject: Object.freeze({ type: 'actor' as const, actorId }),
        score,
        confidence: 0.8,
        observationCount: 10
      })
    ])
  });
}

function removedEvent(
  eventId: string,
  actorId: string
): Extract<ReputationEvent, { kind: 'reputation.aggregator.score.removed' }> {
  return Object.freeze({
    version: REPUTATION_EVENT_VERSION,
    eventId,
    createdAt: FIXED_NOW,
    kind: 'reputation.aggregator.score.removed' as const,
    subject: Object.freeze({ type: 'actor' as const, actorId }),
    reason: 'revoked' as const
  });
}

/* -------------------------------------------------------------------------- */

describe('processInboundReputationBatch — input validation', () => {
  it('throws when records is not an array', async () => {
    const store = freshStore('bad-records');
    await expect(
      processInboundReputationBatch({
        store,
        // @ts-expect-error: testing runtime guard
        records: 'not-an-array',
        subscribedLabelers: new Set()
      })
    ).rejects.toThrow(/records must be an array/);
  });

  it('throws when subscribedLabelers is not a Set', async () => {
    const store = freshStore('bad-subscribers');
    await expect(
      processInboundReputationBatch({
        store,
        records: [],
        // @ts-expect-error: testing runtime guard
        subscribedLabelers: ['not-a-set']
      })
    ).rejects.toThrow(/subscribedLabelers must be a Set/);
  });
});

describe('processInboundReputationBatch — aggregator publish flow', () => {
  it('persists a subscribed-labeler aggregator event', async () => {
    const store = freshStore('sub-publish');
    const record: InboundReputationRecord = {
      publisherLabelerId: 'openrank',
      event: aggregatorEvent('evt_agg_1', 'actor_alice')
    };
    const result = await processInboundReputationBatch({
      store,
      records: [record],
      subscribedLabelers: new Set(['openrank'])
    });
    expect(result.received).toBe(1);
    expect(result.applied).toBe(1);
    expect(result.dropped).toBe(0);
    expect(result.rejected).toBe(0);

    const rows = await store.loadReputationEvents();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.eventId).toBe('evt_agg_1');
  });

  it('drops aggregator events from non-subscribed labelers', async () => {
    const store = freshStore('not-sub');
    const result = await processInboundReputationBatch({
      store,
      records: [
        { publisherLabelerId: 'hostile', event: aggregatorEvent('evt_x', 'mallory') }
      ],
      subscribedLabelers: new Set(['openrank'])
    });
    expect(result.dropped).toBe(1);
    expect(result.applied).toBe(0);
    const rows = await store.loadReputationEvents();
    expect(rows).toHaveLength(0);
  });

  it('drops aggregator events with empty publisherLabelerId', async () => {
    const store = freshStore('empty-pub');
    const result = await processInboundReputationBatch({
      store,
      records: [{ publisherLabelerId: '', event: aggregatorEvent('evt_y', 'a') }],
      subscribedLabelers: new Set(['openrank'])
    });
    expect(result.dropped).toBe(1);
    expect(result.applied).toBe(0);
  });

  it('idempotent on eventId: duplicate inbound is a silent no-op at the store layer (counted as dropped, not applied)', async () => {
    const store = freshStore('idem');
    const evt = aggregatorEvent('evt_dup', 'actor_x');
    const result1 = await processInboundReputationBatch({
      store,
      records: [{ publisherLabelerId: 'openrank', event: evt }],
      subscribedLabelers: new Set(['openrank'])
    });
    expect(result1.applied).toBe(1);
    expect(result1.dropped).toBe(0);
    // Phase 1.8.14 — idempotency-aware counting. The duplicate event
    // is persisted as a no-op at the store layer, and we now count
    // that as `dropped` rather than `applied` so the result faithfully
    // reflects "no NEW state landed". The reputation log still has
    // exactly one row.
    const result2 = await processInboundReputationBatch({
      store,
      records: [{ publisherLabelerId: 'openrank', event: evt }],
      subscribedLabelers: new Set(['openrank'])
    });
    expect(result2.applied).toBe(0);
    expect(result2.dropped).toBe(1);
    const rows = await store.loadReputationEvents();
    expect(rows).toHaveLength(1);
  });
});

describe('processInboundReputationBatch — aggregator score.removed flow', () => {
  it('persists a subscribed-labeler removal event', async () => {
    const store = freshStore('rm-sub');
    const result = await processInboundReputationBatch({
      store,
      records: [
        { publisherLabelerId: 'openrank', event: removedEvent('evt_rm_1', 'actor_alice') }
      ],
      subscribedLabelers: new Set(['openrank'])
    });
    expect(result.applied).toBe(1);
    const rows = await store.loadReputationEvents();
    expect(rows[0]!.kind).toBe('reputation.aggregator.score.removed');
  });
});

describe('processInboundReputationBatch — non-aggregator kinds dropped', () => {
  it('observation events are dropped (policy-not-subscribable)', async () => {
    const store = freshStore('obs-drop');
    const obs: Extract<ReputationEvent, { kind: 'reputation.observation.recorded' }> = {
      version: REPUTATION_EVENT_VERSION,
      eventId: 'evt_obs',
      createdAt: FIXED_NOW,
      kind: 'reputation.observation.recorded',
      subject: { type: 'actor', actorId: 'bob' },
      observationKind: 'outbox.useful',
      satCount: 1,
      unsatCount: 0,
      windowStart: '2026-05-25T00:00:00Z',
      windowEnd: '2026-06-01T00:00:00Z'
    };
    const result = await processInboundReputationBatch({
      store,
      records: [{ publisherLabelerId: 'openrank', event: obs }],
      subscribedLabelers: new Set(['openrank'])
    });
    expect(result.dropped).toBe(1);
    expect(result.applied).toBe(0);
    const rows = await store.loadReputationEvents();
    expect(rows).toHaveLength(0);
  });

  it('attestation events are dropped', async () => {
    const store = freshStore('att-drop');
    const att: Extract<ReputationEvent, { kind: 'reputation.attestation.published' }> = {
      version: REPUTATION_EVENT_VERSION,
      eventId: 'evt_att',
      createdAt: FIXED_NOW,
      kind: 'reputation.attestation.published',
      subject: { type: 'actor', actorId: 'bob' },
      valence: 'positive',
      contextTag: 'community.contributor',
      strength: 0.5
    };
    const result = await processInboundReputationBatch({
      store,
      records: [{ publisherLabelerId: 'openrank', event: att }],
      subscribedLabelers: new Set(['openrank'])
    });
    expect(result.dropped).toBe(1);
  });

  it('revocation events are dropped', async () => {
    const store = freshStore('rev-drop');
    const rev: Extract<ReputationEvent, { kind: 'reputation.attestation.revoked' }> = {
      version: REPUTATION_EVENT_VERSION,
      eventId: 'evt_rev',
      createdAt: FIXED_NOW,
      kind: 'reputation.attestation.revoked',
      attestationId: 'evt_att',
      revokedAt: FIXED_NOW
    };
    const result = await processInboundReputationBatch({
      store,
      records: [{ publisherLabelerId: 'openrank', event: rev }],
      subscribedLabelers: new Set(['openrank'])
    });
    expect(result.dropped).toBe(1);
  });
});

describe('processInboundReputationBatch — invalid events fail validation', () => {
  it('rejects an event with an out-of-range score', async () => {
    const store = freshStore('bad-event');
    // Build an invalid event that bypasses TypeScript with `as any`.
    const bad = {
      version: REPUTATION_EVENT_VERSION,
      eventId: 'evt_bad',
      createdAt: FIXED_NOW,
      kind: 'reputation.aggregator.published',
      algorithm: 'openrank.v1',
      computedAt: FIXED_NOW,
      subjects: [
        {
          subject: { type: 'actor', actorId: 'a' },
          score: 5, // out of range
          confidence: 0.5,
          observationCount: 1
        }
      ]
    } as unknown as ReputationEvent;
    const result = await processInboundReputationBatch({
      store,
      records: [{ publisherLabelerId: 'openrank', event: bad }],
      subscribedLabelers: new Set(['openrank'])
    });
    expect(result.rejected).toBe(1);
    expect(result.applied).toBe(0);
    expect(result.errors[0]!.eventId).toBe('evt_bad');
  });
});

describe('REPUTATION_DROP_REASONS — frozen + documented', () => {
  it('is frozen at module load', () => {
    expect(Object.isFrozen(REPUTATION_DROP_REASONS)).toBe(true);
  });
  it('includes the documented codes', () => {
    expect(REPUTATION_DROP_REASONS).toContain('not-subscribed');
    expect(REPUTATION_DROP_REASONS).toContain('policy-not-subscribable');
  });
});
