/**
 * Phase 1.8.4 adversarial tests for `computeAggregatedReputation`.
 *
 * Pins the doctrine non-negotiable "LOCAL ALWAYS PRIORITY #0" and
 * the privacy-safe source-attribution invariant.
 */
import { describe, expect, it } from 'vitest';
import {
  AGGREGATED_REPUTATION_VIEW_VERSION,
  computeAggregatedReputation,
  computeReputation,
  LABELER_KINDS,
  LOCAL_REPUTATION_SOURCE,
  REPUTATION_EVENT_VERSION,
  STANDARD_LABELER_CAPABILITIES,
  TrustSafetyError,
  type AggregatorEventWithSource,
  type AggregatorSubscription,
  type LocalReputationState,
  type ReputationEvent
} from '../index.js';

const FIXED_NOW_ISO = '2026-06-01T12:00:00Z';

/** Build a real LocalReputationState via the computer for end-to-end tests. */
function realLocalState(subjects: Array<{ id: string; score: number }>): LocalReputationState {
  // Use the computer to manufacture an actual frozen state. We
  // cheat by seeding alice + observations that produce the requested
  // subjects with the requested scores (approximately).
  void subjects;
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
    seedContacts: [
      { subject: 'actor:alice', strength: 1.0, attestedAt: '2026-06-01T00:00:00Z' }
    ],
    nowIso: FIXED_NOW_ISO
  });
}

function aggregatorEvent(
  publisher: string,
  subjects: Array<{ actorId: string; score: number; confidence: number; observationCount?: number }>
): AggregatorEventWithSource {
  const event: Extract<ReputationEvent, { kind: 'reputation.aggregator.published' }> = {
    version: REPUTATION_EVENT_VERSION,
    eventId: `evt_agg_${publisher}`,
    createdAt: FIXED_NOW_ISO,
    kind: 'reputation.aggregator.published',
    algorithm: 'openrank.v1',
    computedAt: FIXED_NOW_ISO,
    subjects: Object.freeze(
      subjects.map((s) =>
        Object.freeze({
          subject: Object.freeze({ type: 'actor' as const, actorId: s.actorId }),
          score: s.score,
          confidence: s.confidence,
          observationCount: s.observationCount ?? 10
        })
      )
    )
  };
  return Object.freeze({ publisherLabelerId: publisher, event });
}

/* -------------------------------------------------------------------------- */
/*               doctrine non-negotiable: local is ALWAYS #0                  */
/* -------------------------------------------------------------------------- */

describe('computeAggregatedReputation — LOCAL ALWAYS WINS', () => {
  it('a subject scored by the local computer takes the local score regardless of aggregator opinion', () => {
    const local = realLocalState([]);
    // The local state should include actor:bob from the seed+observation.
    expect(local.scores.has('actor:bob')).toBe(true);
    const localBobScore = local.scores.get('actor:bob')!.score;

    // Aggregator publishes a wildly different score for bob.
    const view = computeAggregatedReputation({
      localState: local,
      subscriptions: [{ labelerId: 'openrank', priority: 1 }],
      aggregatorEvents: [aggregatorEvent('openrank', [{ actorId: 'bob', score: 0.001, confidence: 0.9 }])]
    });

    // Bob's entry MUST come from local, with the local score.
    const bobEntry = view.entries.get('actor:bob')!;
    expect(bobEntry.sourceLabelerId).toBe(LOCAL_REPUTATION_SOURCE);
    expect(bobEntry.priority).toBe(0);
    expect(bobEntry.score).toBe(localBobScore);
  });

  it('a subject ONLY in an aggregator (not in local) is filled by the aggregator', () => {
    const local = realLocalState([]);
    expect(local.scores.has('actor:carol')).toBe(false);

    const view = computeAggregatedReputation({
      localState: local,
      subscriptions: [{ labelerId: 'openrank', priority: 1 }],
      aggregatorEvents: [aggregatorEvent('openrank', [{ actorId: 'carol', score: 0.5, confidence: 0.7 }])]
    });
    const carolEntry = view.entries.get('actor:carol')!;
    expect(carolEntry.sourceLabelerId).toBe('openrank');
    expect(carolEntry.priority).toBe(1);
    expect(carolEntry.score).toBe(0.5);
  });

  it('LOCAL_REPUTATION_SOURCE is the sentinel string `__local__`', () => {
    expect(LOCAL_REPUTATION_SOURCE).toBe('__local__');
  });
});

/* -------------------------------------------------------------------------- */
/*                  aggregator stacking + priority discipline                 */
/* -------------------------------------------------------------------------- */

describe('computeAggregatedReputation — priority stacking', () => {
  it('higher-priority labeler (lower number) wins among aggregators for non-local subjects', () => {
    const local = realLocalState([]);
    const view = computeAggregatedReputation({
      localState: local,
      subscriptions: [
        { labelerId: 'openrank', priority: 2 },
        { labelerId: 'community-curated', priority: 1 }
      ],
      aggregatorEvents: [
        aggregatorEvent('openrank', [{ actorId: 'dave', score: 0.2, confidence: 0.8 }]),
        aggregatorEvent('community-curated', [{ actorId: 'dave', score: 0.7, confidence: 0.9 }])
      ]
    });
    const dave = view.entries.get('actor:dave')!;
    expect(dave.sourceLabelerId).toBe('community-curated');
    expect(dave.score).toBe(0.7);
    expect(dave.priority).toBe(1);
  });

  it('tie in priority broken by ascending labeler id (replay-deterministic)', () => {
    const local = realLocalState([]);
    const view = computeAggregatedReputation({
      localState: local,
      subscriptions: [
        { labelerId: 'zebra', priority: 1 },
        { labelerId: 'apple', priority: 1 }
      ],
      aggregatorEvents: [
        aggregatorEvent('zebra', [{ actorId: 'eve', score: 0.4, confidence: 0.8 }]),
        aggregatorEvent('apple', [{ actorId: 'eve', score: 0.6, confidence: 0.9 }])
      ]
    });
    expect(view.entries.get('actor:eve')!.sourceLabelerId).toBe('apple');
  });
});

/* -------------------------------------------------------------------------- */
/*                  unsubscribed-labeler events are silently dropped          */
/* -------------------------------------------------------------------------- */

describe('computeAggregatedReputation — opt-in discipline', () => {
  it('aggregator events from non-subscribed labelers are silently dropped', () => {
    const local = realLocalState([]);
    // User has NO aggregator subscriptions.
    const view = computeAggregatedReputation({
      localState: local,
      subscriptions: [],
      aggregatorEvents: [
        aggregatorEvent('openrank', [{ actorId: 'noisy_stranger', score: 0.99, confidence: 0.99 }])
      ]
    });
    expect(view.entries.has('actor:noisy_stranger')).toBe(false);
  });

  it('subscriptions with priority 0 are silently dropped (local owns that slot)', () => {
    const local = realLocalState([]);
    const view = computeAggregatedReputation({
      localState: local,
      subscriptions: [{ labelerId: 'pretender', priority: 0 }],
      aggregatorEvents: [
        aggregatorEvent('pretender', [{ actorId: 'mallory', score: 0.99, confidence: 0.99 }])
      ]
    });
    expect(view.entries.has('actor:mallory')).toBe(false);
  });

  it('non-integer / negative priority subscriptions are silently dropped', () => {
    const local = realLocalState([]);
    const view = computeAggregatedReputation({
      localState: local,
      subscriptions: [
        { labelerId: 'fractional', priority: 1.5 },
        { labelerId: 'negative', priority: -1 }
      ],
      aggregatorEvents: [
        aggregatorEvent('fractional', [{ actorId: 'frank', score: 0.5, confidence: 0.5 }]),
        aggregatorEvent('negative', [{ actorId: 'grace', score: 0.5, confidence: 0.5 }])
      ]
    });
    expect(view.entries.has('actor:frank')).toBe(false);
    expect(view.entries.has('actor:grace')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/*                  input validation                                          */
/* -------------------------------------------------------------------------- */

describe('computeAggregatedReputation — input validation', () => {
  it('non-object input throws TS_INVALID_INPUT', () => {
    // @ts-expect-error: testing runtime guard
    expect(() => computeAggregatedReputation(null)).toThrow(TrustSafetyError);
  });

  it('missing arrays throw TS_INVALID_INPUT', () => {
    const local = realLocalState([]);
    expect(() =>
      computeAggregatedReputation({
        localState: local,
        // @ts-expect-error: testing runtime guard
        subscriptions: 'not-an-array',
        aggregatorEvents: []
      })
    ).toThrowError(/subscriptions must be an array/);
    expect(() =>
      computeAggregatedReputation({
        localState: local,
        subscriptions: [],
        // @ts-expect-error: testing runtime guard
        aggregatorEvents: 'not-an-array'
      })
    ).toThrowError(/aggregatorEvents must be an array/);
  });
});

/* -------------------------------------------------------------------------- */
/*                  output integrity                                          */
/* -------------------------------------------------------------------------- */

describe('computeAggregatedReputation — output integrity (Phase 3.2)', () => {
  it('view is deep-frozen at every level', () => {
    const local = realLocalState([]);
    const view = computeAggregatedReputation({
      localState: local,
      subscriptions: [{ labelerId: 'openrank', priority: 1 }],
      aggregatorEvents: [
        aggregatorEvent('openrank', [{ actorId: 'carol', score: 0.5, confidence: 0.7 }])
      ]
    });
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.contributingLabelers)).toBe(true);
    for (const entry of view.entries.values()) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });

  it('view has the documented version sentinel', () => {
    const local = realLocalState([]);
    const view = computeAggregatedReputation({
      localState: local,
      subscriptions: [],
      aggregatorEvents: []
    });
    expect(view.version).toBe(AGGREGATED_REPUTATION_VIEW_VERSION);
    expect(view.version).toBe('lfp2p.reputation-aggregated-view.v1');
  });

  it('contributingLabelers includes local AND every aggregator with a winning entry', () => {
    const local = realLocalState([]);
    const view = computeAggregatedReputation({
      localState: local,
      subscriptions: [{ labelerId: 'openrank', priority: 1 }],
      aggregatorEvents: [
        aggregatorEvent('openrank', [{ actorId: 'carol', score: 0.5, confidence: 0.7 }])
      ]
    });
    expect(view.contributingLabelers).toContain(LOCAL_REPUTATION_SOURCE);
    expect(view.contributingLabelers).toContain('openrank');
  });

  it('an aggregator with NO winning subjects is NOT in contributingLabelers', () => {
    const local = realLocalState([]);
    const view = computeAggregatedReputation({
      localState: local,
      subscriptions: [{ labelerId: 'noisy-no-data', priority: 1 }],
      aggregatorEvents: []
    });
    expect(view.contributingLabelers).not.toContain('noisy-no-data');
  });
});

/* -------------------------------------------------------------------------- */
/*                  replay equivalence                                        */
/* -------------------------------------------------------------------------- */

describe('computeAggregatedReputation — replay equivalence', () => {
  it('same input thrice produces byte-identical view (Phase 3.2)', () => {
    const local = realLocalState([]);
    const input = {
      localState: local,
      subscriptions: [
        { labelerId: 'openrank', priority: 1 },
        { labelerId: 'community-curated', priority: 2 }
      ] as ReadonlyArray<AggregatorSubscription>,
      aggregatorEvents: [
        aggregatorEvent('openrank', [
          { actorId: 'carol', score: 0.5, confidence: 0.7 },
          { actorId: 'dave', score: 0.3, confidence: 0.6 }
        ]),
        aggregatorEvent('community-curated', [{ actorId: 'eve', score: 0.4, confidence: 0.5 }])
      ]
    };
    const serialize = (v: ReturnType<typeof computeAggregatedReputation>) =>
      JSON.stringify({
        v: v.version,
        e: [...v.entries.entries()],
        c: v.contributingLabelers
      });
    const a = serialize(computeAggregatedReputation(input));
    const b = serialize(computeAggregatedReputation(input));
    const c = serialize(computeAggregatedReputation(input));
    expect(a).toBe(b);
    expect(a).toBe(c);
  });
});

/* -------------------------------------------------------------------------- */
/*                  clamping + privacy-safety                                 */
/* -------------------------------------------------------------------------- */

describe('computeAggregatedReputation — clamping + privacy-safety', () => {
  it('aggregator-published score outside [0, 1] is clamped (defense-in-depth)', () => {
    // Validator should reject these at the protocol layer, but if a
    // bad event slips through (or a third-party aggregator misbehaves),
    // the runtime clamps rather than propagating an invalid score.
    const local = realLocalState([]);
    const evt: AggregatorEventWithSource = {
      publisherLabelerId: 'hostile',
      event: {
        version: REPUTATION_EVENT_VERSION,
        eventId: 'evt_h',
        createdAt: FIXED_NOW_ISO,
        kind: 'reputation.aggregator.published',
        algorithm: 'openrank.v1',
        computedAt: FIXED_NOW_ISO,
        subjects: Object.freeze([
          Object.freeze({
            subject: Object.freeze({ type: 'actor' as const, actorId: 'sneaky' }),
            // Both fields out-of-range — should be clamped.
            score: 99,
            confidence: -5,
            observationCount: 1
          })
        ])
      }
    };
    const view = computeAggregatedReputation({
      localState: local,
      subscriptions: [{ labelerId: 'hostile', priority: 1 }],
      aggregatorEvents: [evt]
    });
    const sneaky = view.entries.get('actor:sneaky')!;
    expect(sneaky.score).toBe(1);
    expect(sneaky.confidence).toBe(0);
  });

  it('entries never expose raw aggregator-event references (immutable composition)', () => {
    const local = realLocalState([]);
    const view = computeAggregatedReputation({
      localState: local,
      subscriptions: [{ labelerId: 'openrank', priority: 1 }],
      aggregatorEvents: [
        aggregatorEvent('openrank', [{ actorId: 'carol', score: 0.5, confidence: 0.7 }])
      ]
    });
    const entry = view.entries.get('actor:carol')!;
    // The aggregator-source attribution is a stable string id only.
    // The runtime MUST NOT expose the raw event or any payload from it.
    const keys = Object.keys(entry);
    expect(keys.sort()).toEqual(['confidence', 'priority', 'score', 'sourceLabelerId', 'subject']);
  });
});

/* -------------------------------------------------------------------------- */
/*                  labeler taxonomy extension                                */
/* -------------------------------------------------------------------------- */

describe('LABELER_KINDS includes the Phase 1.8.4 reputation-aggregator kind', () => {
  it('reputation-aggregator is a documented labeler kind', () => {
    expect(LABELER_KINDS).toContain('reputation-aggregator');
  });

  it('aggregate.reputation-scoring is a documented standard capability', () => {
    expect(STANDARD_LABELER_CAPABILITIES).toContain('aggregate.reputation-scoring');
  });
});

/* -------------------------------------------------------------------------- */
/*       Phase 1.8.8 — aggregator score.removed consumption                   */
/* -------------------------------------------------------------------------- */

function removalEvent(
  publisher: string,
  actorId: string,
  reason: 'revoked' | 'expired' | 'superseded' | 'algorithm-changed' = 'revoked'
): {
  publisherLabelerId: string;
  event: Extract<ReputationEvent, { kind: 'reputation.aggregator.score.removed' }>;
} {
  return Object.freeze({
    publisherLabelerId: publisher,
    event: Object.freeze({
      version: REPUTATION_EVENT_VERSION,
      eventId: `evt_rep_rem_${publisher}_${actorId}`,
      createdAt: FIXED_NOW_ISO,
      kind: 'reputation.aggregator.score.removed' as const,
      subject: Object.freeze({ type: 'actor' as const, actorId }),
      reason
    })
  });
}

describe('computeAggregatedReputation — Phase 1.8.8 score.removed consumption', () => {
  it('a subscribed removal evicts the matching subject/labeler pair from the view', () => {
    const local = realLocalState([]);
    const view = computeAggregatedReputation({
      localState: local,
      subscriptions: [{ labelerId: 'openrank', priority: 1 }],
      aggregatorEvents: [
        aggregatorEvent('openrank', [{ actorId: 'carol', score: 0.5, confidence: 0.7 }])
      ],
      removalEvents: [removalEvent('openrank', 'carol', 'revoked')]
    });
    expect(view.entries.has('actor:carol')).toBe(false);
    // contributingLabelers should not list the labeler since none of its scores won.
    expect(view.contributingLabelers).not.toContain('openrank');
  });

  it('a removal for one labeler does NOT affect a different labeler scoring the same subject', () => {
    const local = realLocalState([]);
    const view = computeAggregatedReputation({
      localState: local,
      subscriptions: [
        { labelerId: 'openrank', priority: 2 },
        { labelerId: 'community-curated', priority: 1 }
      ],
      aggregatorEvents: [
        aggregatorEvent('openrank', [{ actorId: 'dave', score: 0.2, confidence: 0.8 }]),
        aggregatorEvent('community-curated', [{ actorId: 'dave', score: 0.7, confidence: 0.9 }])
      ],
      removalEvents: [removalEvent('community-curated', 'dave', 'revoked')]
    });
    // community-curated's score is evicted; openrank's score survives.
    const dave = view.entries.get('actor:dave')!;
    expect(dave.sourceLabelerId).toBe('openrank');
    expect(dave.score).toBe(0.2);
  });

  it('removals from non-subscribed labelers are silently ignored (opt-in discipline)', () => {
    const local = realLocalState([]);
    const view = computeAggregatedReputation({
      localState: local,
      subscriptions: [{ labelerId: 'openrank', priority: 1 }],
      aggregatorEvents: [
        aggregatorEvent('openrank', [{ actorId: 'eve', score: 0.5, confidence: 0.5 }])
      ],
      // 'attacker' is NOT subscribed. Its removal should not affect anything.
      removalEvents: [removalEvent('attacker', 'eve', 'revoked')]
    });
    expect(view.entries.has('actor:eve')).toBe(true);
    expect(view.entries.get('actor:eve')!.sourceLabelerId).toBe('openrank');
  });

  it('a removal arriving BEFORE its publish is a stale no-op (fail open)', () => {
    const local = realLocalState([]);
    const view = computeAggregatedReputation({
      localState: local,
      subscriptions: [{ labelerId: 'openrank', priority: 1 }],
      // The candidate set is empty when removal is applied because the
      // publish event isn't in the input. The runtime fails open
      // rather than throwing.
      aggregatorEvents: [],
      removalEvents: [removalEvent('openrank', 'ghost', 'revoked')]
    });
    expect(view.entries.has('actor:ghost')).toBe(false);
    expect(view.contributingLabelers).toEqual([LOCAL_REPUTATION_SOURCE]);
  });

  it('LOCAL ALWAYS WINS: an aggregator removal does NOT evict a locally-scored subject', () => {
    const local = realLocalState([]);
    // Bob is scored by the local computer.
    expect(local.scores.has('actor:bob')).toBe(true);
    const view = computeAggregatedReputation({
      localState: local,
      subscriptions: [{ labelerId: 'openrank', priority: 1 }],
      aggregatorEvents: [
        aggregatorEvent('openrank', [{ actorId: 'bob', score: 0.001, confidence: 0.9 }])
      ],
      removalEvents: [removalEvent('openrank', 'bob', 'revoked')]
    });
    // Bob keeps the local score regardless of the removal.
    const bob = view.entries.get('actor:bob')!;
    expect(bob.sourceLabelerId).toBe(LOCAL_REPUTATION_SOURCE);
    expect(bob.priority).toBe(0);
  });

  it('every reason code is accepted by the runtime (no preference among reasons)', () => {
    const reasons = ['revoked', 'expired', 'superseded', 'algorithm-changed'] as const;
    for (const r of reasons) {
      const local = realLocalState([]);
      const view = computeAggregatedReputation({
        localState: local,
        subscriptions: [{ labelerId: 'openrank', priority: 1 }],
        aggregatorEvents: [
          aggregatorEvent('openrank', [{ actorId: 'frank', score: 0.5, confidence: 0.5 }])
        ],
        removalEvents: [removalEvent('openrank', 'frank', r)]
      });
      expect(view.entries.has('actor:frank')).toBe(false);
    }
  });

  it('removalEvents not an array (non-undefined) throws TS_INVALID_INPUT', () => {
    const local = realLocalState([]);
    expect(() =>
      computeAggregatedReputation({
        localState: local,
        subscriptions: [],
        aggregatorEvents: [],
        // @ts-expect-error: testing runtime guard
        removalEvents: 'not-an-array'
      })
    ).toThrowError(/removalEvents must be an array when supplied/);
  });

  it('omitting removalEvents keeps existing behavior byte-identical (backward compat)', () => {
    const local = realLocalState([]);
    const withoutKey = computeAggregatedReputation({
      localState: local,
      subscriptions: [{ labelerId: 'openrank', priority: 1 }],
      aggregatorEvents: [
        aggregatorEvent('openrank', [{ actorId: 'gwen', score: 0.5, confidence: 0.5 }])
      ]
    });
    const withEmpty = computeAggregatedReputation({
      localState: local,
      subscriptions: [{ labelerId: 'openrank', priority: 1 }],
      aggregatorEvents: [
        aggregatorEvent('openrank', [{ actorId: 'gwen', score: 0.5, confidence: 0.5 }])
      ],
      removalEvents: []
    });
    expect(JSON.stringify([...withoutKey.entries.entries()])).toBe(
      JSON.stringify([...withEmpty.entries.entries()])
    );
  });
});
