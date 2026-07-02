import { describe, expect, it } from 'vitest';
import {
  CONTENT_CATEGORIES,
  applyLabelerEvent,
  applyLocalControlEvent,
  createEmptyLabelersState,
  createEmptyLocalControlState
} from '@lfp2p/trust-safety';
import {
  KEYWORD_MATCH_KINDS_AVAILABLE_IN_UI,
  assessSubscribeIntent,
  buildAdultContentGateEvent,
  buildContentCategoryPreferenceEvent,
  buildContentCategoryRows,
  buildKeywordFilterEvent,
  buildKeywordFilterRevertEvent,
  buildKeywordFilterRows,
  buildLabelerSubscribeEvent,
  buildLabelerSubscriptionRows,
  buildLabelerUnsubscribeEvent,
  listExistingOverlaps,
  newEventId
} from './pwa-trust-safety-state.js';

describe('pwa-trust-safety-state — KEYWORD_MATCH_KINDS_AVAILABLE_IN_UI', () => {
  it('does not include semantic (deferred — no embedding pipeline yet)', () => {
    expect(KEYWORD_MATCH_KINDS_AVAILABLE_IN_UI as readonly string[]).not.toContain('semantic');
  });

  it('does not include regex (deliberate ReDoS guard)', () => {
    expect(KEYWORD_MATCH_KINDS_AVAILABLE_IN_UI as readonly string[]).not.toContain('regex');
  });

  it('includes substring, word, phrase, hashtag', () => {
    expect(KEYWORD_MATCH_KINDS_AVAILABLE_IN_UI).toEqual(['substring', 'word', 'phrase', 'hashtag']);
  });
});

describe('pwa-trust-safety-state — newEventId', () => {
  it('uses the given prefix and a stable evt_ prefix', () => {
    const id = newEventId('foo');
    expect(id.startsWith('evt_foo_')).toBe(true);
    expect(id.length).toBeLessThanOrEqual(64);
  });

  it('returns distinct ids per call', () => {
    expect(newEventId('a')).not.toEqual(newEventId('a'));
  });
});

describe('pwa-trust-safety-state — adult-content gate event', () => {
  it('emits a valid apply event with matching enabled flag', () => {
    const e = buildAdultContentGateEvent(true);
    expect(e.kind).toBe('safety.adult-content.gate.set');
    expect(e.action).toBe('apply');
    if (e.kind === 'safety.adult-content.gate.set') {
      expect(e.enabled).toBe(true);
      expect(typeof e.gatedAt).toBe('string');
    }
  });

  it('round-trips through the projection', () => {
    let s = createEmptyLocalControlState();
    s = applyLocalControlEvent(s, buildAdultContentGateEvent(true));
    expect(s.adultContentGate?.enabled).toBe(true);
  });
});

describe('pwa-trust-safety-state — content-category preference', () => {
  it('emits a valid label-preference event under the content-category namespace', () => {
    const e = buildContentCategoryPreferenceEvent('spam', 'hide');
    expect(e.kind).toBe('safety.label.preference.set');
    if (e.kind === 'safety.label.preference.set') {
      expect(e.namespace).toBe('lfp2p.content-category.v1');
      expect(e.labelKey).toBe('spam');
      expect(e.preference).toBe('hide');
    }
  });

  it('rejects an unknown category', () => {
    expect(() => buildContentCategoryPreferenceEvent('not.a.category', 'hide')).toThrow(
      /Unknown content category/
    );
  });
});

describe('pwa-trust-safety-state — keyword filter events', () => {
  it('round-trips a phrase filter through the projection', () => {
    let s = createEmptyLocalControlState();
    s = applyLocalControlEvent(
      s,
      buildKeywordFilterEvent({ keyword: 'election fraud', matchKind: 'phrase' })
    );
    expect(s.mutedKeywords['election fraud']).toBeDefined();
  });

  it('round-trips a hashtag filter through the projection (normalized)', () => {
    let s = createEmptyLocalControlState();
    s = applyLocalControlEvent(
      s,
      buildKeywordFilterEvent({ keyword: '#Spoilers', matchKind: 'hashtag' })
    );
    // Stored normalized: leading # stripped, lowercased.
    expect(s.mutedKeywords.spoilers).toBeDefined();
  });

  it('revert removes the entry installed by apply', () => {
    let s = createEmptyLocalControlState();
    const applyEvent = buildKeywordFilterEvent({
      keyword: 'spoilers',
      matchKind: 'hashtag'
    });
    s = applyLocalControlEvent(s, applyEvent);
    expect(s.mutedKeywords.spoilers).toBeDefined();
    s = applyLocalControlEvent(
      s,
      buildKeywordFilterRevertEvent({ keyword: 'spoilers', matchKind: 'hashtag' })
    );
    expect(s.mutedKeywords.spoilers).toBeUndefined();
  });
});

describe('pwa-trust-safety-state — buildContentCategoryRows', () => {
  it('returns one row per registered content category', () => {
    const rows = buildContentCategoryRows(createEmptyLocalControlState());
    expect(rows.length).toBe(CONTENT_CATEGORIES.length);
  });

  it('reports lockedByGate=true for adult categories when the gate is off', () => {
    const rows = buildContentCategoryRows(createEmptyLocalControlState());
    const adultRow = rows.find((r) => r.category.key === 'adult.sexually-explicit');
    expect(adultRow?.lockedByGate).toBe(true);
    expect(adultRow?.effectiveAction).toBe('hide');
  });

  it('reports lockedByGate=false for adult categories when the gate is on', () => {
    let s = createEmptyLocalControlState();
    s = applyLocalControlEvent(s, buildAdultContentGateEvent(true));
    const rows = buildContentCategoryRows(s);
    const adultRow = rows.find((r) => r.category.key === 'adult.sexually-explicit');
    expect(adultRow?.lockedByGate).toBe(false);
  });

  it('surfaces the stored user preference', () => {
    let s = createEmptyLocalControlState();
    s = applyLocalControlEvent(s, buildContentCategoryPreferenceEvent('political', 'hide'));
    const rows = buildContentCategoryRows(s);
    const row = rows.find((r) => r.category.key === 'political');
    expect(row?.currentPreference).toBe('hide');
    expect(row?.effectiveAction).toBe('hide');
  });

  it('forces effectiveAction=hide for adult categories under the off gate regardless of preference', () => {
    let s = createEmptyLocalControlState();
    s = applyLocalControlEvent(
      s,
      buildContentCategoryPreferenceEvent('adult.sexually-explicit', 'allow')
    );
    const rows = buildContentCategoryRows(s);
    const row = rows.find((r) => r.category.key === 'adult.sexually-explicit');
    expect(row?.currentPreference).toBe('allow');
    expect(row?.effectiveAction).toBe('hide');
  });
});

describe('pwa-trust-safety-state — buildKeywordFilterRows', () => {
  it('lists every active filter in stable sort order', () => {
    let s = createEmptyLocalControlState();
    s = applyLocalControlEvent(s, buildKeywordFilterEvent({ keyword: 'zebra', matchKind: 'word' }));
    s = applyLocalControlEvent(
      s,
      buildKeywordFilterEvent({ keyword: 'apple', matchKind: 'substring' })
    );
    const rows = buildKeywordFilterRows(s);
    expect(rows.map((r) => r.keyword)).toEqual(['apple', 'zebra']);
    expect(rows.map((r) => r.matchKind)).toEqual(['substring', 'word']);
  });

  it('returns an empty array when there are no filters', () => {
    expect(buildKeywordFilterRows(createEmptyLocalControlState())).toEqual([]);
  });
});

describe('pwa-trust-safety-state — labeler subscriptions', () => {
  const SUBSCRIBER = 'actor_user';

  function profile(labelerId: string, labels: string[], caps?: { capabilityId: string }[]) {
    return applyLabelerEvent(createEmptyLabelersState(), {
      version: 'lfp2p.labeler-event.v1',
      eventId: `evt_p_${labelerId}`,
      createdAt: '2026-06-02T00:00:00Z',
      kind: 'safety.labeler.profile.published',
      profile: {
        version: 'lfp2p.safety-labeler-profile.v1',
        labelerId,
        actorId: `actor_${labelerId}`,
        displayName: labelerId,
        supportedNamespaces: ['lfp2p.safety'],
        supportedLabels: labels,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-06-02T00:00:00Z',
        ...(caps !== undefined
          ? {
              capabilities: caps.map((c) => ({
                capabilityId: c.capabilityId,
                description: c.capabilityId,
                producesLabels: labels
              }))
            }
          : {})
      }
    } as Parameters<typeof applyLabelerEvent>[1]);
  }

  it('subscribe + unsubscribe events project correctly', () => {
    let s = profile('labeler_spam', ['security.spam'], [{ capabilityId: 'classify.spam' }]);
    s = applyLabelerEvent(
      s,
      buildLabelerSubscribeEvent({
        subscriptionId: 'sub_1',
        subscriberActorId: SUBSCRIBER,
        labelerId: 'labeler_spam',
        trustedNamespaces: ['lfp2p.safety']
      })
    );
    const rows = buildLabelerSubscriptionRows(s, SUBSCRIBER);
    expect(rows.length).toBe(1);
    expect(rows[0]?.labelerId).toBe('labeler_spam');
    expect(rows[0]?.capabilitySummary).toEqual(['classify.spam']);

    s = applyLabelerEvent(s, buildLabelerUnsubscribeEvent('sub_1'));
    expect(buildLabelerSubscriptionRows(s, SUBSCRIBER).length).toBe(0);
  });

  it('assessSubscribeIntent flags a redundant subscription', () => {
    let s = profile('labeler_existing', ['security.spam'], [{ capabilityId: 'classify.spam' }]);
    s = applyLabelerEvent(s, {
      version: 'lfp2p.labeler-event.v1',
      eventId: 'evt_p_candidate',
      createdAt: '2026-06-02T00:00:00Z',
      kind: 'safety.labeler.profile.published',
      profile: {
        version: 'lfp2p.safety-labeler-profile.v1',
        labelerId: 'labeler_candidate',
        actorId: 'actor_candidate',
        displayName: 'labeler_candidate',
        supportedNamespaces: ['lfp2p.safety'],
        supportedLabels: ['security.spam'],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-06-02T00:00:00Z',
        capabilities: [
          {
            capabilityId: 'classify.spam',
            description: 'spam classifier',
            producesLabels: ['security.spam']
          }
        ]
      }
    } as Parameters<typeof applyLabelerEvent>[1]);
    s = applyLabelerEvent(
      s,
      buildLabelerSubscribeEvent({
        subscriptionId: 'sub_existing',
        subscriberActorId: SUBSCRIBER,
        labelerId: 'labeler_existing',
        trustedNamespaces: ['lfp2p.safety']
      })
    );
    const a = assessSubscribeIntent(s, SUBSCRIBER, 'labeler_candidate');
    expect(a.ok).toBe(false);
    expect(a.redundantWithLabelerId).toBe('labeler_existing');
    expect(a.overlappingCapabilityIds).toContain('classify.spam');
  });

  it('assessSubscribeIntent passes when the candidate does a different job', () => {
    let s = profile(
      'labeler_screenshot',
      ['screenshot.x'],
      [{ capabilityId: 'detect.twitter-screenshot' }]
    );
    s = applyLabelerEvent(s, {
      version: 'lfp2p.labeler-event.v1',
      eventId: 'evt_p_profanity',
      createdAt: '2026-06-02T00:00:00Z',
      kind: 'safety.labeler.profile.published',
      profile: {
        version: 'lfp2p.safety-labeler-profile.v1',
        labelerId: 'labeler_profanity',
        actorId: 'actor_profanity',
        displayName: 'labeler_profanity',
        supportedNamespaces: ['lfp2p.safety'],
        supportedLabels: ['quality.profanity'],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-06-02T00:00:00Z',
        capabilities: [
          {
            capabilityId: 'detect.profanity-en',
            description: 'profanity detector',
            producesLabels: ['quality.profanity']
          }
        ]
      }
    } as Parameters<typeof applyLabelerEvent>[1]);
    s = applyLabelerEvent(
      s,
      buildLabelerSubscribeEvent({
        subscriptionId: 'sub_screenshot',
        subscriberActorId: SUBSCRIBER,
        labelerId: 'labeler_screenshot',
        trustedNamespaces: ['lfp2p.safety']
      })
    );
    const a = assessSubscribeIntent(s, SUBSCRIBER, 'labeler_profanity');
    expect(a.ok).toBe(true);
    expect(a.redundantWithLabelerId).toBeUndefined();
  });

  it('listExistingOverlaps surfaces an existing overlap pair', () => {
    let s = profile('labeler_a', ['security.spam'], [{ capabilityId: 'classify.spam' }]);
    s = applyLabelerEvent(s, {
      version: 'lfp2p.labeler-event.v1',
      eventId: 'evt_p_b',
      createdAt: '2026-06-02T00:00:00Z',
      kind: 'safety.labeler.profile.published',
      profile: {
        version: 'lfp2p.safety-labeler-profile.v1',
        labelerId: 'labeler_b',
        actorId: 'actor_b',
        displayName: 'labeler_b',
        supportedNamespaces: ['lfp2p.safety'],
        supportedLabels: ['security.spam'],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-06-02T00:00:00Z',
        capabilities: [
          {
            capabilityId: 'classify.spam',
            description: 'spam classifier b',
            producesLabels: ['security.spam']
          }
        ]
      }
    } as Parameters<typeof applyLabelerEvent>[1]);
    for (const subscriptionId of ['sub_a', 'sub_b'] as const) {
      const labelerId = subscriptionId === 'sub_a' ? 'labeler_a' : 'labeler_b';
      s = applyLabelerEvent(
        s,
        buildLabelerSubscribeEvent({
          subscriptionId,
          subscriberActorId: SUBSCRIBER,
          labelerId,
          trustedNamespaces: ['lfp2p.safety']
        })
      );
    }
    const overlaps = listExistingOverlaps(s, SUBSCRIBER);
    expect(overlaps.length).toBe(1);
    expect(overlaps[0]?.level).toBe('full');
  });
});
