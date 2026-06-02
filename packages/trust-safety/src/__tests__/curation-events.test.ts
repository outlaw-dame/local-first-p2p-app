import { describe, expect, it } from 'vitest';
import type { CurationEvent } from '../index.js';
import { CURATION_EVENT_KINDS, MAX_SCORE_DELTA, validateCurationEvent } from '../index.js';

const OWNER = {
  version: 'lfp2p.safety-authority.v1' as const,
  authorityId: 'auth_curator_01',
  actorId: 'actor_curator',
  role: 'curator' as const,
  scope: 'index-local' as const,
  createdAt: '2026-01-01T00:00:00Z'
};

const RULE = {
  version: 'lfp2p.curation-rule.v1' as const,
  ruleId: 'rule_1',
  owner: OWNER,
  surface: 'public-feed' as const,
  subjectMatcher: {
    kind: 'label' as const,
    labelKey: 'quality.low-effort',
    namespace: 'lfp2p.safety'
  },
  action: 'downrank' as const,
  reasonCode: 'quality.low-effort',
  createdAt: '2026-05-31T00:00:00Z'
};

function base(kind: CurationEvent['kind']): Record<string, unknown> {
  return {
    version: 'lfp2p.curation-event.v1',
    eventId: 'evt_' + Math.random().toString(36).slice(2, 10),
    createdAt: '2026-05-31T00:00:00Z',
    kind
  };
}

describe('validateCurationEvent — kinds', () => {
  it('accepts curation.rule.created', () => {
    expect(() => validateCurationEvent({ ...base('curation.rule.created'), rule: RULE })).not.toThrow();
  });

  it('accepts curation.rule.disabled', () => {
    expect(() =>
      validateCurationEvent({
        ...base('curation.rule.disabled'),
        ruleId: 'rule_1',
        disabledBy: OWNER,
        disabledAt: '2026-06-01T00:00:00Z',
        reasonCode: 'policy.community-rule'
      })
    ).not.toThrow();
  });

  it.each(['curation.item.boosted', 'curation.item.downranked'] as const)(
    'accepts %s with positive scoreDelta',
    (kind) => {
      expect(() =>
        validateCurationEvent({
          ...base(kind),
          itemSubject: { type: 'event', eventId: 'evt_x' },
          surface: 'public-feed',
          sourceRuleId: 'rule_1',
          scoreDelta: 10,
          reasonCode: 'policy.community-rule'
        })
      ).not.toThrow();
    }
  );

  it('rejects negative scoreDelta on boosted (range guard)', () => {
    expect(() =>
      validateCurationEvent({
        ...base('curation.item.boosted'),
        itemSubject: { type: 'event', eventId: 'evt_x' },
        surface: 'public-feed',
        sourceRuleId: 'rule_1',
        scoreDelta: -5,
        reasonCode: 'policy.community-rule'
      })
    ).toThrow();
  });

  it(`rejects scoreDelta above MAX_SCORE_DELTA (${MAX_SCORE_DELTA})`, () => {
    expect(() =>
      validateCurationEvent({
        ...base('curation.item.downranked'),
        itemSubject: { type: 'event', eventId: 'evt_x' },
        surface: 'public-feed',
        sourceRuleId: 'rule_1',
        scoreDelta: MAX_SCORE_DELTA + 1,
        reasonCode: 'policy.community-rule'
      })
    ).toThrow();
  });

  it('rejects unknown excludeFrom', () => {
    expect(() =>
      validateCurationEvent({
        ...base('curation.item.excluded'),
        itemSubject: { type: 'event', eventId: 'evt_x' },
        surface: 'search',
        sourceRuleId: 'rule_1',
        reasonCode: 'policy.community-rule',
        excludeFrom: 'everywhere'
      })
    ).toThrow(/TS_INVALID_ENUM/);
  });

  it('exposes all 6 kinds', () => {
    expect(CURATION_EVENT_KINDS.length).toBe(6);
  });

  it('rejects unknown version', () => {
    expect(() =>
      validateCurationEvent({
        ...base('curation.rule.created'),
        version: 'lfp2p.curation-event.v2',
        rule: RULE
      })
    ).toThrow(/TS_UNKNOWN_VERSION/);
  });
});
