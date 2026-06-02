import { describe, expect, it } from 'vitest';
import type { CurationEvent } from '../index.js';
import {
  applyCurationEvent,
  computeItemRanking,
  createEmptyCurationState,
  seedCurationState,
  subjectKey
} from '../index.js';

const OWNER = {
  version: 'lfp2p.safety-authority.v1' as const,
  authorityId: 'auth_curator_01',
  actorId: 'actor_curator',
  role: 'curator' as const,
  scope: 'index-local' as const,
  createdAt: '2026-01-01T00:00:00Z'
};

function makeRule(ruleId: string, action: 'boost' | 'downrank' | 'exclude' = 'downrank'): unknown {
  return {
    version: 'lfp2p.curation-rule.v1',
    ruleId,
    owner: OWNER,
    surface: 'public-feed',
    subjectMatcher: {
      kind: 'label',
      labelKey: 'quality.low-effort',
      namespace: 'lfp2p.safety'
    },
    action,
    reasonCode: 'quality.low-effort',
    createdAt: '2026-05-31T00:00:00Z'
  };
}

function created(ruleId: string, action: 'boost' | 'downrank' | 'exclude' = 'downrank'): CurationEvent {
  return {
    version: 'lfp2p.curation-event.v1',
    eventId: `evt_create_${ruleId}`,
    createdAt: '2026-05-31T00:00:00Z',
    kind: 'curation.rule.created',
    rule: makeRule(ruleId, action)
  } as unknown as CurationEvent;
}

function disabled(ruleId: string): CurationEvent {
  return {
    version: 'lfp2p.curation-event.v1',
    eventId: `evt_disable_${ruleId}`,
    createdAt: '2026-06-01T00:00:00Z',
    kind: 'curation.rule.disabled',
    ruleId,
    disabledBy: OWNER,
    disabledAt: '2026-06-01T00:00:00Z',
    reasonCode: 'policy.community-rule'
  } as unknown as CurationEvent;
}

function downrank(
  itemEventId: string,
  ruleId: string,
  delta = 5,
  evId?: string
): CurationEvent {
  return {
    version: 'lfp2p.curation-event.v1',
    eventId: evId ?? `evt_dr_${itemEventId}_${ruleId}`,
    createdAt: '2026-05-31T01:00:00Z',
    kind: 'curation.item.downranked',
    itemSubject: { type: 'event', eventId: itemEventId },
    surface: 'public-feed',
    sourceRuleId: ruleId,
    scoreDelta: delta,
    reasonCode: 'quality.low-effort'
  } as unknown as CurationEvent;
}

function boost(itemEventId: string, ruleId: string, delta = 3, evId?: string): CurationEvent {
  return {
    version: 'lfp2p.curation-event.v1',
    eventId: evId ?? `evt_bs_${itemEventId}_${ruleId}`,
    createdAt: '2026-05-31T01:00:00Z',
    kind: 'curation.item.boosted',
    itemSubject: { type: 'event', eventId: itemEventId },
    surface: 'public-feed',
    sourceRuleId: ruleId,
    scoreDelta: delta,
    reasonCode: 'policy.community-rule'
  } as unknown as CurationEvent;
}

function excluded(
  itemEventId: string,
  ruleId: string,
  excludeFrom: 'feed' | 'search' | 'recommendation',
  evId?: string
): CurationEvent {
  return {
    version: 'lfp2p.curation-event.v1',
    eventId: evId ?? `evt_ex_${itemEventId}_${ruleId}`,
    createdAt: '2026-05-31T01:00:00Z',
    kind: 'curation.item.excluded',
    itemSubject: { type: 'event', eventId: itemEventId },
    surface: 'public-feed',
    sourceRuleId: ruleId,
    reasonCode: 'quality.low-effort',
    excludeFrom
  } as unknown as CurationEvent;
}

describe('curation projection — rule lifecycle', () => {
  it('inserts an active rule on created', () => {
    const s = applyCurationEvent(createEmptyCurationState(), created('rule_1'));
    expect(s.rulesById['rule_1']?.status).toBe('active');
  });

  it('transitions active → disabled', () => {
    let s = applyCurationEvent(createEmptyCurationState(), created('rule_1'));
    s = applyCurationEvent(s, disabled('rule_1'));
    expect(s.rulesById['rule_1']?.status).toBe('disabled');
  });

  it('rejects disable of unknown rule', () => {
    expect(() =>
      applyCurationEvent(createEmptyCurationState(), disabled('rule_ghost'))
    ).toThrow(/TS_LIFECYCLE_TRANSITION/);
  });

  it('rejects double-disable', () => {
    let s = applyCurationEvent(createEmptyCurationState(), created('rule_1'));
    s = applyCurationEvent(s, disabled('rule_1'));
    expect(() =>
      applyCurationEvent(s, {
        ...disabled('rule_1'),
        eventId: 'evt_double_disable'
      } as CurationEvent)
    ).toThrow(/already disabled/);
  });

  it('rejects re-creation under an existing ruleId', () => {
    const s = applyCurationEvent(createEmptyCurationState(), created('rule_1'));
    expect(() =>
      applyCurationEvent(s, {
        ...created('rule_1'),
        eventId: 'evt_double_create'
      } as CurationEvent)
    ).toThrow(/already exists/);
  });
});

describe('curation projection — distinctions (doctrine)', () => {
  it('downrank does NOT exclude the item from any surface', () => {
    let s = applyCurationEvent(createEmptyCurationState(), created('rule_1'));
    s = applyCurationEvent(s, downrank('evt_target', 'rule_1', 10));
    const view = computeItemRanking(s, { type: 'event', eventId: 'evt_target' });
    expect(view.effectiveNetScoreDelta).toBe(-10);
    expect(view.isExcludedFromFeed).toBe(false);
    expect(view.isExcludedFromSearch).toBe(false);
    expect(view.isExcludedFromRecommendation).toBe(false);
  });

  it('search exclusion does NOT delete from feed or recommendation', () => {
    let s = applyCurationEvent(createEmptyCurationState(), created('rule_1', 'exclude'));
    s = applyCurationEvent(s, excluded('evt_target', 'rule_1', 'search'));
    const view = computeItemRanking(s, { type: 'event', eventId: 'evt_target' });
    expect(view.isExcludedFromSearch).toBe(true);
    expect(view.isExcludedFromFeed).toBe(false);
    expect(view.isExcludedFromRecommendation).toBe(false);
  });

  it('recommendation exclusion does NOT affect feed or search', () => {
    let s = applyCurationEvent(createEmptyCurationState(), created('rule_1', 'exclude'));
    s = applyCurationEvent(s, excluded('evt_target', 'rule_1', 'recommendation'));
    const view = computeItemRanking(s, { type: 'event', eventId: 'evt_target' });
    expect(view.isExcludedFromRecommendation).toBe(true);
    expect(view.isExcludedFromFeed).toBe(false);
    expect(view.isExcludedFromSearch).toBe(false);
  });
});

describe('curation projection — accumulating actions', () => {
  it('boost + downrank from different rules combine in net score', () => {
    let s = createEmptyCurationState();
    s = applyCurationEvent(s, created('rule_boost', 'boost'));
    s = applyCurationEvent(s, created('rule_dr', 'downrank'));
    s = applyCurationEvent(s, boost('evt_target', 'rule_boost', 8));
    s = applyCurationEvent(s, downrank('evt_target', 'rule_dr', 3));
    const view = computeItemRanking(s, { type: 'event', eventId: 'evt_target' });
    expect(view.effectiveNetScoreDelta).toBe(5);
  });

  it('disabling a source rule retracts its effect from net score', () => {
    let s = createEmptyCurationState();
    s = applyCurationEvent(s, created('rule_dr', 'downrank'));
    s = applyCurationEvent(s, downrank('evt_target', 'rule_dr', 10));
    expect(computeItemRanking(s, { type: 'event', eventId: 'evt_target' }).effectiveNetScoreDelta).toBe(-10);
    s = applyCurationEvent(s, disabled('rule_dr'));
    // After disabling the source rule the downrank no longer counts.
    expect(computeItemRanking(s, { type: 'event', eventId: 'evt_target' }).effectiveNetScoreDelta).toBe(0);
  });

  it('disabling a source rule also lifts its exclusions', () => {
    let s = createEmptyCurationState();
    s = applyCurationEvent(s, created('rule_excl', 'exclude'));
    s = applyCurationEvent(s, excluded('evt_target', 'rule_excl', 'search'));
    expect(computeItemRanking(s, { type: 'event', eventId: 'evt_target' }).isExcludedFromSearch).toBe(true);
    s = applyCurationEvent(s, disabled('rule_excl'));
    expect(computeItemRanking(s, { type: 'event', eventId: 'evt_target' }).isExcludedFromSearch).toBe(false);
  });
});

describe('curation projection — idempotency and replay', () => {
  it('same eventId twice returns identical reference', () => {
    const e = created('rule_1');
    const s1 = applyCurationEvent(createEmptyCurationState(), e);
    const s2 = applyCurationEvent(s1, e);
    expect(s2).toBe(s1);
  });

  it('seedCurationState replay equals step-by-step', () => {
    const events: CurationEvent[] = [
      created('rule_1'),
      created('rule_2', 'boost'),
      downrank('evt_a', 'rule_1', 5),
      boost('evt_a', 'rule_2', 3),
      excluded('evt_b', 'rule_1', 'search'),
      disabled('rule_1')
    ];
    const seeded = seedCurationState(events);
    let stepped = createEmptyCurationState();
    for (const e of events) stepped = applyCurationEvent(stepped, e);
    expect(seeded).toEqual(stepped);
  });

  it('duplicate explanationId is silent no-op', () => {
    const explainEvent: CurationEvent = {
      version: 'lfp2p.curation-event.v1',
      eventId: 'evt_exp_a',
      createdAt: '2026-05-31T03:00:00Z',
      kind: 'curation.explanation.recorded',
      explanation: {
        version: 'lfp2p.curation-explanation.v1',
        explanationId: 'expl_1',
        surface: 'public-feed',
        subject: { type: 'event', eventId: 'evt_x' },
        action: 'downrank',
        reasonCodes: ['quality.low-effort'],
        policyVersion: 'feed.policy.v1',
        createdAt: '2026-05-31T03:00:00Z'
      }
    } as unknown as CurationEvent;
    let s = applyCurationEvent(createEmptyCurationState(), explainEvent);
    expect(s.explanationsById['expl_1']).toBeDefined();
    const dup: CurationEvent = { ...explainEvent, eventId: 'evt_exp_b' };
    s = applyCurationEvent(s, dup);
    // explanationId already recorded; entry preserved, no overwrite.
    expect(Object.keys(s.explanationsById).length).toBe(1);
  });
});

describe('subjectKey', () => {
  it('encodes distinct subjects to distinct keys', () => {
    const a = subjectKey({ type: 'event', eventId: 'evt_1' });
    const b = subjectKey({ type: 'actor', actorId: 'evt_1' });
    expect(a).not.toBe(b);
  });
});
