/**
 * Phase 1.8.15 — adversarial tests for the default labeler registry.
 *
 * The single most important test in this file is the structural pin
 * that `DEFAULT_LABELER_REGISTRY.entries` is EMPTY. That is the
 * doctrine non-negotiable #1 made executable: no external party is
 * privileged out of the box. A future edit that smuggles a mandatory
 * external labeler into the shipped default fails CI here.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LABELER_REGISTRY,
  LABELER_REGISTRY_VERSION,
  LOCAL_REPUTATION_SOURCE,
  computeAggregatedReputation,
  computeReputation,
  resolveActiveLabelerSet,
  TrustSafetyError,
  type DefaultLabelerRegistry,
  type LocalReputationState,
  type UserLabelerSubscription
} from '../index.js';

const FIXED_NOW_ISO = '2026-06-01T12:00:00Z';

function localStateWithBob(): LocalReputationState {
  return computeReputation({
    observations: [
      {
        observer: 'actor:alice',
        subject: 'actor:bob',
        observationKind: 'outbox.useful',
        satCount: 5,
        unsatCount: 0,
        windowStart: '2026-05-25T00:00:00Z',
        windowEnd: '2026-06-01T00:00:00Z',
        createdAt: '2026-06-01T00:00:00Z'
      }
    ],
    attestations: [],
    revocations: [],
    seedContacts: [{ subject: 'actor:alice', strength: 1.0, attestedAt: '2026-06-01T00:00:00Z' }],
    nowIso: FIXED_NOW_ISO
  });
}

function userSub(
  labelerId: string,
  priority: number,
  algorithm: UserLabelerSubscription['algorithm'] = 'openrank.v1'
): UserLabelerSubscription {
  return { labelerId, priority, algorithm };
}

/* -------------------------------------------------------------------------- */
/*        THE doctrine pin: shipped default is LOCAL-ONLY (no externals)      */
/* -------------------------------------------------------------------------- */

describe('DEFAULT_LABELER_REGISTRY — local-only doctrine guarantee', () => {
  it('ships with ZERO external entries (no party privileged out of the box)', () => {
    expect(DEFAULT_LABELER_REGISTRY.entries).toEqual([]);
    expect(DEFAULT_LABELER_REGISTRY.entries.length).toBe(0);
  });

  it('carries the documented version sentinel and is deep-frozen', () => {
    expect(DEFAULT_LABELER_REGISTRY.version).toBe(LABELER_REGISTRY_VERSION);
    expect(DEFAULT_LABELER_REGISTRY.version).toBe('lfp2p.labeler-registry.v1');
    expect(Object.isFrozen(DEFAULT_LABELER_REGISTRY)).toBe(true);
    expect(Object.isFrozen(DEFAULT_LABELER_REGISTRY.entries)).toBe(true);
  });

  it('resolving with all defaults yields an empty active set (local stays structural)', () => {
    const result = resolveActiveLabelerSet();
    expect(result.active).toEqual([]);
    expect(result.subscriptions).toEqual([]);
    expect(result.version).toBe(LABELER_REGISTRY_VERSION);
  });
});

/* -------------------------------------------------------------------------- */
/*                  local source can never become a subscription              */
/* -------------------------------------------------------------------------- */

describe('resolveActiveLabelerSet — local source is structural, never a subscription', () => {
  it('rejects a registry entry claiming the __local__ sentinel', () => {
    const registry: DefaultLabelerRegistry = {
      version: LABELER_REGISTRY_VERSION,
      entries: [{ labelerId: LOCAL_REPUTATION_SOURCE, priority: 1, algorithm: 'openrank.v1' }]
    };
    const result = resolveActiveLabelerSet({ registry });
    expect(result.active).toEqual([]);
    expect(result.warnings.some((w) => w.includes(LOCAL_REPUTATION_SOURCE))).toBe(true);
  });

  it('rejects a user subscription claiming the __local__ sentinel', () => {
    const result = resolveActiveLabelerSet({
      userSubscriptions: [userSub(LOCAL_REPUTATION_SOURCE, 1)]
    });
    expect(result.active).toEqual([]);
    expect(result.warnings.some((w) => w.includes(LOCAL_REPUTATION_SOURCE))).toBe(true);
  });

  it('local is NEVER present in the produced subscriptions list', () => {
    const result = resolveActiveLabelerSet({
      userSubscriptions: [userSub('labeler:a', 1), userSub('labeler:b', 2)]
    });
    expect(result.subscriptions.some((s) => s.labelerId === LOCAL_REPUTATION_SOURCE)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/*                       priority 0 reserved for local                        */
/* -------------------------------------------------------------------------- */

describe('resolveActiveLabelerSet — priority 0 is reserved', () => {
  it('rejects an entry claiming priority 0 (does NOT silently bump it into a live slot)', () => {
    const result = resolveActiveLabelerSet({ userSubscriptions: [userSub('labeler:greedy', 0)] });
    expect(result.active).toEqual([]);
    expect(result.warnings.some((w) => w.includes('priority must be an integer ≥ 1'))).toBe(true);
  });

  it('rejects negative and non-integer priorities', () => {
    const result = resolveActiveLabelerSet({
      userSubscriptions: [userSub('labeler:neg', -3), userSub('labeler:frac', 1.5)]
    });
    expect(result.active).toEqual([]);
    expect(result.warnings.length).toBe(2);
  });

  it('accepts priority ≥ 1', () => {
    const result = resolveActiveLabelerSet({ userSubscriptions: [userSub('labeler:ok', 1)] });
    expect(result.active.map((e) => e.labelerId)).toEqual(['labeler:ok']);
    expect(result.subscriptions).toEqual([{ labelerId: 'labeler:ok', priority: 1 }]);
  });
});

/* -------------------------------------------------------------------------- */
/*                              opt-out wins                                   */
/* -------------------------------------------------------------------------- */

describe('resolveActiveLabelerSet — mute (opt-out) wins', () => {
  it('a muted labelerId is excluded even if a registry default lists it', () => {
    const registry: DefaultLabelerRegistry = {
      version: LABELER_REGISTRY_VERSION,
      entries: [{ labelerId: 'labeler:distributor-default', priority: 1, algorithm: 'openrank.v1' }]
    };
    const result = resolveActiveLabelerSet({
      registry,
      mutedLabelerIds: new Set(['labeler:distributor-default'])
    });
    expect(result.active).toEqual([]);
    expect(result.warnings.some((w) => w.includes('Excluded muted labeler'))).toBe(true);
  });

  it('a muted labelerId is excluded even if the user subscribed to it', () => {
    const result = resolveActiveLabelerSet({
      userSubscriptions: [userSub('labeler:x', 1)],
      mutedLabelerIds: new Set(['labeler:x'])
    });
    expect(result.active).toEqual([]);
  });

  it('throws when mutedLabelerIds is not a Set', () => {
    expect(() =>
      // @ts-expect-error: testing runtime guard
      resolveActiveLabelerSet({ mutedLabelerIds: ['labeler:x'] })
    ).toThrow(TrustSafetyError);
  });
});

/* -------------------------------------------------------------------------- */
/*                  user intent overrides distributor default                 */
/* -------------------------------------------------------------------------- */

describe('resolveActiveLabelerSet — user overrides distributor default', () => {
  it('a user entry for the same id wins over the registry default (priority + origin)', () => {
    const registry: DefaultLabelerRegistry = {
      version: LABELER_REGISTRY_VERSION,
      entries: [{ labelerId: 'labeler:shared', priority: 5, algorithm: 'openrank.v1' }]
    };
    const result = resolveActiveLabelerSet({
      registry,
      userSubscriptions: [userSub('labeler:shared', 2, 'community-curated.v1')]
    });
    expect(result.active).toHaveLength(1);
    expect(result.active[0]).toEqual({
      labelerId: 'labeler:shared',
      priority: 2,
      algorithm: 'community-curated.v1',
      origin: 'user'
    });
  });

  it('tags provenance: distributor entries vs user entries', () => {
    const registry: DefaultLabelerRegistry = {
      version: LABELER_REGISTRY_VERSION,
      entries: [{ labelerId: 'labeler:dist', priority: 3, algorithm: 'openrank.v1' }]
    };
    const result = resolveActiveLabelerSet({
      registry,
      userSubscriptions: [userSub('labeler:user', 1)]
    });
    const byId = new Map(result.active.map((e) => [e.labelerId, e.origin]));
    expect(byId.get('labeler:dist')).toBe('distributor');
    expect(byId.get('labeler:user')).toBe('user');
  });
});

/* -------------------------------------------------------------------------- */
/*                       determinism + frozen output                          */
/* -------------------------------------------------------------------------- */

describe('resolveActiveLabelerSet — determinism + integrity', () => {
  it('sorts ascending by priority, ties broken by ascending labelerId', () => {
    const result = resolveActiveLabelerSet({
      userSubscriptions: [
        userSub('labeler:z', 2),
        userSub('labeler:a', 2),
        userSub('labeler:m', 1)
      ]
    });
    expect(result.active.map((e) => e.labelerId)).toEqual(['labeler:m', 'labeler:a', 'labeler:z']);
    expect(result.subscriptions.map((s) => s.priority)).toEqual([1, 2, 2]);
  });

  it('input array reordering produces identical output (replay-deterministic)', () => {
    const a = resolveActiveLabelerSet({
      userSubscriptions: [userSub('labeler:a', 1), userSub('labeler:b', 2)]
    });
    const b = resolveActiveLabelerSet({
      userSubscriptions: [userSub('labeler:b', 2), userSub('labeler:a', 1)]
    });
    expect(a.active).toEqual(b.active);
    expect(a.subscriptions).toEqual(b.subscriptions);
  });

  it('output is deep-frozen', () => {
    const result = resolveActiveLabelerSet({ userSubscriptions: [userSub('labeler:a', 1)] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.active)).toBe(true);
    expect(Object.isFrozen(result.active[0])).toBe(true);
    expect(Object.isFrozen(result.subscriptions)).toBe(true);
    expect(Object.isFrozen(result.warnings)).toBe(true);
  });

  it('drops malformed entries without throwing', () => {
    const result = resolveActiveLabelerSet({
      // @ts-expect-error: testing runtime guard against malformed rows
      userSubscriptions: [{ labelerId: 'labeler:ok', priority: 1, algorithm: 'openrank.v1' }, null, 42, { nope: true }]
    });
    expect(result.active.map((e) => e.labelerId)).toEqual(['labeler:ok']);
    expect(result.warnings.some((w) => w.includes('malformed'))).toBe(true);
  });

  it('drops entries with empty id or unknown algorithm', () => {
    const result = resolveActiveLabelerSet({
      userSubscriptions: [
        userSub('', 1),
        // @ts-expect-error: testing unknown algorithm
        userSub('labeler:bad-algo', 1, 'nonsense.v9')
      ]
    });
    expect(result.active).toEqual([]);
    expect(result.warnings.length).toBe(2);
  });

  it('throws on structurally invalid input (non-array userSubscriptions, bad registry, null values)', () => {
    // @ts-expect-error: testing runtime guard
    expect(() => resolveActiveLabelerSet({ userSubscriptions: 'nope' })).toThrow(TrustSafetyError);
    // @ts-expect-error: testing runtime guard
    expect(() => resolveActiveLabelerSet({ registry: { version: 'x' } })).toThrow(TrustSafetyError);
    // @ts-expect-error: testing runtime guard
    expect(() => resolveActiveLabelerSet({ registry: null })).toThrow(TrustSafetyError);
    // @ts-expect-error: testing runtime guard
    expect(() => resolveActiveLabelerSet({ userSubscriptions: null })).toThrow(TrustSafetyError);
    // @ts-expect-error: testing runtime guard
    expect(() => resolveActiveLabelerSet({ mutedLabelerIds: null })).toThrow(TrustSafetyError);
  });
});

/* -------------------------------------------------------------------------- */
/*       end-to-end: registry → subscriptions → computeAggregatedReputation   */
/* -------------------------------------------------------------------------- */

describe('resolveActiveLabelerSet — end-to-end with computeAggregatedReputation', () => {
  it('local-only default: local always #0 holds, no external labeler contributes', () => {
    const local = localStateWithBob();
    const { subscriptions } = resolveActiveLabelerSet(); // local-only default
    const view = computeAggregatedReputation({
      localState: local,
      subscriptions,
      aggregatorEvents: []
    });
    // Bob is scored by local; it stays the local source.
    const bob = view.entries.get('actor:bob');
    expect(bob?.sourceLabelerId).toBe(LOCAL_REPUTATION_SOURCE);
    expect(view.contributingLabelers).toEqual([LOCAL_REPUTATION_SOURCE]);
  });

  it('distributor-populated registry: produced subscriptions feed the runtime, local STILL wins for local-scored subjects', () => {
    const local = localStateWithBob();
    const localBobScore = local.scores.get('actor:bob')!.score;
    const registry: DefaultLabelerRegistry = {
      version: LABELER_REGISTRY_VERSION,
      entries: [{ labelerId: 'labeler:openrank', priority: 1, algorithm: 'openrank.v1' }]
    };
    const { subscriptions } = resolveActiveLabelerSet({ registry });
    expect(subscriptions).toEqual([{ labelerId: 'labeler:openrank', priority: 1 }]);

    const view = computeAggregatedReputation({
      localState: local,
      subscriptions,
      aggregatorEvents: [
        {
          publisherLabelerId: 'labeler:openrank',
          event: {
            version: 'lfp2p.reputation-event.v1',
            eventId: 'evt_agg_or',
            createdAt: FIXED_NOW_ISO,
            kind: 'reputation.aggregator.published',
            algorithm: 'openrank.v1',
            computedAt: FIXED_NOW_ISO,
            subjects: [
              {
                // Bare actorId — `subjectRefToKey` adds the `actor:`
                // prefix, producing key `actor:bob` so it collides
                // with the local-scored subject (proving local wins).
                subject: { type: 'actor', actorId: 'bob' },
                score: 0.01, // wildly different from local
                confidence: 0.9,
                observationCount: 99
              },
              {
                subject: { type: 'actor', actorId: 'stranger' },
                score: 0.7,
                confidence: 0.8,
                observationCount: 12
              }
            ]
          }
        }
      ]
    });
    // Local wins for bob (doctrine non-negotiable), even with a
    // distributor labeler in the active set.
    expect(view.entries.get('actor:bob')?.sourceLabelerId).toBe(LOCAL_REPUTATION_SOURCE);
    expect(view.entries.get('actor:bob')?.score).toBe(localBobScore);
    // The external labeler only fills in subjects local hasn't scored.
    expect(view.entries.get('actor:stranger')?.sourceLabelerId).toBe('labeler:openrank');
  });
});
