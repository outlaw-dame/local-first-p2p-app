/**
 * Phase 1.8.11 — adversarial tests for the OpenRank adapter.
 */
import { describe, expect, it } from 'vitest';
import {
  REPUTATION_EVENT_VERSION,
  REPUTATION_LIMITS,
  computeAggregatedReputation,
  computeReputation,
  type AggregatorEventWithSource
} from '@lfp2p/trust-safety';
import {
  createOpenRankAdapter,
  type OpenRankFetcher,
  type OpenRankResponse,
  type OpenRankRow
} from './index.js';

const FIXED_NOW = '2026-06-05T00:00:00Z';

function mockFetcher(response: OpenRankResponse | Promise<OpenRankResponse>): OpenRankFetcher {
  return async () => response;
}

/* -------------------------------------------------------------------------- */

describe('createOpenRankAdapter — constructor validation', () => {
  it('rejects empty labelerId', () => {
    expect(() =>
      createOpenRankAdapter({ labelerId: '', fetcher: mockFetcher({ rows: [] }) })
    ).toThrow();
  });

  it('rejects non-function fetcher', () => {
    expect(() =>
      createOpenRankAdapter({
        labelerId: 'openrank',
        // @ts-expect-error: testing runtime guard
        fetcher: 'not-a-function'
      })
    ).toThrow();
  });
});

describe('OpenRankAdapter — happy path mapping', () => {
  it('maps a normal OpenRank response into a single aggregator event', async () => {
    const adapter = createOpenRankAdapter({
      labelerId: 'openrank',
      fetcher: mockFetcher({
        algorithm: 'openrank.v1',
        computedAt: FIXED_NOW,
        rows: [
          { actorId: 'alice', score: 0.9, confidence: 0.95, observationCount: 100 },
          { actorId: 'bob', score: 0.2, confidence: 0.5, observationCount: 5 }
        ]
      }),
      now: () => FIXED_NOW
    });
    const events = await adapter.fetchAggregatorEvents();
    expect(events).toHaveLength(1);
    const event = events[0]!.event;
    expect(events[0]!.publisherLabelerId).toBe('openrank');
    expect(event.version).toBe(REPUTATION_EVENT_VERSION);
    expect(event.kind).toBe('reputation.aggregator.published');
    expect(event.algorithm).toBe('openrank.v1');
    expect(event.computedAt).toBe(FIXED_NOW);
    expect(event.subjects).toHaveLength(2);
    expect(event.subjects.map((s) => (s.subject as { actorId: string }).actorId)).toEqual([
      'alice',
      'bob'
    ]);
  });

  it('numeric fid is normalised to `actor:fid:<n>`', async () => {
    const adapter = createOpenRankAdapter({
      labelerId: 'openrank',
      fetcher: mockFetcher({
        rows: [{ fid: 42, score: 0.5, confidence: 0.7, observationCount: 10 }]
      }),
      now: () => FIXED_NOW
    });
    const events = await adapter.fetchAggregatorEvents();
    const sub = events[0]!.event.subjects[0]!;
    expect((sub.subject as { actorId: string }).actorId).toBe('fid:42');
  });

  it('output events are deep-frozen (Phase 3.2)', async () => {
    const adapter = createOpenRankAdapter({
      labelerId: 'openrank',
      fetcher: mockFetcher({
        rows: [{ actorId: 'a', score: 0.5, confidence: 0.5, observationCount: 1 }]
      }),
      now: () => FIXED_NOW
    });
    const events = await adapter.fetchAggregatorEvents();
    expect(Object.isFrozen(events)).toBe(true);
    expect(Object.isFrozen(events[0])).toBe(true);
    expect(Object.isFrozen(events[0]!.event)).toBe(true);
    expect(Object.isFrozen(events[0]!.event.subjects)).toBe(true);
    expect(Object.isFrozen(events[0]!.event.subjects[0])).toBe(true);
  });

  it('subjects sorted ascending by actor id (replay-deterministic)', async () => {
    const adapter = createOpenRankAdapter({
      labelerId: 'openrank',
      fetcher: mockFetcher({
        rows: [
          { actorId: 'zelda', score: 0.5, confidence: 0.5, observationCount: 1 },
          { actorId: 'alice', score: 0.5, confidence: 0.5, observationCount: 1 },
          { actorId: 'mallory', score: 0.5, confidence: 0.5, observationCount: 1 }
        ]
      }),
      now: () => FIXED_NOW
    });
    const events = await adapter.fetchAggregatorEvents();
    const ids = events[0]!.event.subjects.map((s) => (s.subject as { actorId: string }).actorId);
    expect(ids).toEqual(['alice', 'mallory', 'zelda']);
  });
});

describe('OpenRankAdapter — hardening (per-row + per-batch)', () => {
  it('clamps out-of-range scores into [0, 1]', async () => {
    const adapter = createOpenRankAdapter({
      labelerId: 'openrank',
      fetcher: mockFetcher({
        rows: [
          { actorId: 'high', score: 99, confidence: -5, observationCount: -1 },
          {
            actorId: 'nan',
            score: Number.NaN,
            confidence: Number.POSITIVE_INFINITY,
            observationCount: 5
          }
        ]
      }),
      now: () => FIXED_NOW
    });
    const events = await adapter.fetchAggregatorEvents();
    const subjects = events[0]!.event.subjects;
    const high = subjects.find((s) => (s.subject as { actorId: string }).actorId === 'high')!;
    const nan = subjects.find((s) => (s.subject as { actorId: string }).actorId === 'nan')!;
    expect(high.score).toBe(1);
    expect(high.confidence).toBe(0);
    expect(high.observationCount).toBe(0);
    expect(nan.score).toBe(0);
    expect(nan.confidence).toBe(0);
  });

  it('drops individual malformed rows without breaking the batch', async () => {
    const adapter = createOpenRankAdapter({
      labelerId: 'openrank',
      fetcher: mockFetcher({
        rows: [
          { actorId: 'good', score: 0.5, confidence: 0.5, observationCount: 1 },
          // @ts-expect-error: testing runtime guard
          'not-an-object',
          { score: 0.5 }, // missing both actorId and fid
          { actorId: '', score: 0.5 }, // empty actorId
          { actorId: 'good2', score: 0.5, confidence: 0.5, observationCount: 1 }
        ]
      }),
      now: () => FIXED_NOW
    });
    const events = await adapter.fetchAggregatorEvents();
    expect(events[0]!.event.subjects.length).toBe(2);
  });

  it('splits over-cap batches into multiple aggregator events deterministically', async () => {
    // Build a synthetic response right at the cap boundary.
    const cap = REPUTATION_LIMITS.maxSubjectsPerAggregatorBatch;
    const rows: OpenRankRow[] = [];
    for (let i = 0; i < cap + 5; i++) {
      rows.push({
        actorId: `actor_${String(i).padStart(6, '0')}`,
        score: 0.5,
        confidence: 0.5,
        observationCount: 1
      });
    }
    const adapter = createOpenRankAdapter({
      labelerId: 'openrank',
      fetcher: mockFetcher({ rows }),
      now: () => FIXED_NOW
    });
    const events = await adapter.fetchAggregatorEvents();
    expect(events.length).toBe(2);
    expect(events[0]!.event.subjects.length).toBe(cap);
    expect(events[1]!.event.subjects.length).toBe(5);
  });
});

describe('OpenRankAdapter — fail-closed on structural issues', () => {
  it('throws on non-object response', async () => {
    const adapter = createOpenRankAdapter({
      labelerId: 'openrank',
      // @ts-expect-error: testing runtime guard
      fetcher: async () => null,
      now: () => FIXED_NOW
    });
    await expect(adapter.fetchAggregatorEvents()).rejects.toThrow(/must be an object/);
  });

  it('throws on missing rows array', async () => {
    const adapter = createOpenRankAdapter({
      labelerId: 'openrank',
      // @ts-expect-error: testing runtime guard
      fetcher: async () => ({ rows: 'not-an-array' }),
      now: () => FIXED_NOW
    });
    await expect(adapter.fetchAggregatorEvents()).rejects.toThrow(/rows must be an array/);
  });
});

describe('OpenRankAdapter — end-to-end with the Phase 1.8.4 runtime', () => {
  it('adapter output is directly consumable by computeAggregatedReputation', async () => {
    // Build a minimal local state.
    const local = computeReputation({
      observations: [],
      attestations: [],
      revocations: [],
      seedContacts: [{ subject: 'actor:alice', strength: 1.0, attestedAt: FIXED_NOW }],
      nowIso: FIXED_NOW
    });
    const adapter = createOpenRankAdapter({
      labelerId: 'openrank',
      fetcher: mockFetcher({
        rows: [{ actorId: 'bob', score: 0.7, confidence: 0.8, observationCount: 12 }]
      }),
      now: () => FIXED_NOW
    });
    const events: ReadonlyArray<AggregatorEventWithSource> = await adapter.fetchAggregatorEvents();
    const view = computeAggregatedReputation({
      localState: local,
      subscriptions: [{ labelerId: 'openrank', priority: 1 }],
      aggregatorEvents: events
    });
    // Alice (locally scored) AND bob (from openrank) appear in the
    // composed view.
    expect(view.entries.has('actor:alice')).toBe(true);
    expect(view.entries.has('actor:bob')).toBe(true);
    expect(view.entries.get('actor:bob')!.sourceLabelerId).toBe('openrank');
  });
});
