import { describe, expect, it } from 'vitest';
import { validateCurationExplanation, validateCurationRule } from '../index.js';

const OWNER = {
  version: 'lfp2p.safety-authority.v1' as const,
  authorityId: 'auth_curator_01',
  actorId: 'actor_curator',
  role: 'curator' as const,
  scope: 'index-local' as const,
  createdAt: '2026-01-01T00:00:00Z'
};

const RULE_BASE = {
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

describe('validateCurationRule', () => {
  it('accepts a minimal rule', () => {
    expect(() => validateCurationRule(RULE_BASE)).not.toThrow();
  });

  it('rejects moderation actions in curation context (masquerade)', () => {
    expect(() => validateCurationRule({ ...RULE_BASE, action: 'hide' })).toThrow(
      /TS_CURATION_MASQUERADE/
    );
    expect(() => validateCurationRule({ ...RULE_BASE, action: 'quarantine' })).toThrow(
      /TS_CURATION_MASQUERADE/
    );
    expect(() => validateCurationRule({ ...RULE_BASE, action: 'reject-transport' })).toThrow(
      /TS_CURATION_MASQUERADE/
    );
  });

  it('rejects unknown action', () => {
    expect(() => validateCurationRule({ ...RULE_BASE, action: 'pulverize' })).toThrow(
      /TS_INVALID_ENUM/
    );
  });

  it('rejects unknown surface', () => {
    expect(() => validateCurationRule({ ...RULE_BASE, surface: 'inbox' })).toThrow(
      /TS_INVALID_ENUM/
    );
  });

  it('rejects domain matcher containing a URL', () => {
    expect(() =>
      validateCurationRule({
        ...RULE_BASE,
        subjectMatcher: { kind: 'domain', domain: 'https://x.com' }
      })
    ).toThrow(/TS_INVALID_CURATION/);
  });
});

const EXPLANATION_BASE = {
  version: 'lfp2p.curation-explanation.v1' as const,
  explanationId: 'expl_1',
  surface: 'public-feed',
  subject: { type: 'event' as const, eventId: 'evt_1' },
  action: 'downrank' as const,
  reasonCodes: ['quality.low-effort'],
  policyVersion: 'feed.policy.v1',
  createdAt: '2026-05-31T00:00:00Z'
};

describe('validateCurationExplanation', () => {
  it('accepts a minimal explanation', () => {
    expect(() => validateCurationExplanation(EXPLANATION_BASE)).not.toThrow();
  });

  it('rejects moderation action in explanation (masquerade)', () => {
    expect(() => validateCurationExplanation({ ...EXPLANATION_BASE, action: 'hide' })).toThrow(
      /TS_CURATION_MASQUERADE/
    );
  });
});
