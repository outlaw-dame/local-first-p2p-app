import { describe, expect, it } from 'vitest';
import type { LabelerEvent, LocalControlEvent } from '../index.js';
import {
  ADULT_CONTENT_CATEGORY_KEYS,
  CONTENT_CATEGORIES,
  CONTENT_CATEGORY_NAMESPACE,
  STANDARD_LABELER_CAPABILITIES,
  applyLabelerEvent,
  applyLocalControlEvent,
  createEmptyLabelersState,
  createEmptyLocalControlState,
  decideContentCategoryAction,
  detectRedundantSubscription,
  findOverlappingSubscriptions,
  getContentCategory,
  isContentCategoryKey,
  isStandardCapability,
  validateSafetyLabelerProfile
} from '../index.js';

// =============================================================================
// Capability declaration
// =============================================================================

const BASE_PROFILE_FIELDS = {
  version: 'lfp2p.safety-labeler-profile.v1' as const,
  actorId: 'actor_labeler',
  displayName: 'A Labeler',
  supportedNamespaces: ['lfp2p.safety'],
  supportedLabels: ['security.spam', 'quality.duplicate'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-05-30T00:00:00Z'
};

describe('Phase 1.69 — labeler capabilities', () => {
  it('accepts a profile with valid capabilities entries', () => {
    const profile = validateSafetyLabelerProfile({
      ...BASE_PROFILE_FIELDS,
      labelerId: 'labeler_spam_detector',
      capabilities: [
        {
          capabilityId: 'classify.spam',
          description: 'ML-driven spam classifier',
          producesLabels: ['security.spam'],
          mediaTypes: ['text/plain']
        },
        {
          capabilityId: 'detect.duplicate',
          description: 'Near-duplicate detection',
          producesLabels: ['quality.duplicate']
        }
      ]
    });
    expect(profile.capabilities?.length).toBe(2);
  });

  it('rejects capability whose producesLabels are not in profile.supportedLabels', () => {
    expect(() =>
      validateSafetyLabelerProfile({
        ...BASE_PROFILE_FIELDS,
        labelerId: 'labeler_X',
        capabilities: [
          {
            capabilityId: 'classify.spam',
            description: 'Spam classifier',
            producesLabels: ['ghost.label.not.declared']
          }
        ]
      })
    ).toThrow(/not in the profile's supportedLabels/);
  });

  it('rejects capabilityId outside the (detect|classify|scan|attest|aggregate|x) namespace pattern', () => {
    expect(() =>
      validateSafetyLabelerProfile({
        ...BASE_PROFILE_FIELDS,
        labelerId: 'labeler_X',
        capabilities: [
          {
            capabilityId: 'invented.namespace.foo',
            description: '...',
            producesLabels: ['security.spam']
          }
        ]
      })
    ).toThrow(/must match/);
  });

  it('accepts the x.* custom-namespace pattern', () => {
    const profile = validateSafetyLabelerProfile({
      ...BASE_PROFILE_FIELDS,
      labelerId: 'labeler_X',
      capabilities: [
        {
          capabilityId: 'x.community-lab.alpha',
          description: 'Custom community capability',
          producesLabels: ['security.spam']
        }
      ]
    });
    expect(profile.capabilities?.[0]?.capabilityId).toBe('x.community-lab.alpha');
  });

  it('rejects empty producesLabels', () => {
    expect(() =>
      validateSafetyLabelerProfile({
        ...BASE_PROFILE_FIELDS,
        labelerId: 'labeler_X',
        capabilities: [
          {
            capabilityId: 'classify.spam',
            description: '...',
            producesLabels: []
          }
        ]
      })
    ).toThrow(/at least one labelKey/);
  });

  it('rejects malformed mediaType', () => {
    expect(() =>
      validateSafetyLabelerProfile({
        ...BASE_PROFILE_FIELDS,
        labelerId: 'labeler_X',
        capabilities: [
          {
            capabilityId: 'detect.twitter-screenshot',
            description: '...',
            producesLabels: ['security.spam'],
            mediaTypes: ['not-a-media-type']
          }
        ]
      })
    ).toThrow(/RFC 6838/);
  });

  it('exposes the standard capability registry and isStandardCapability', () => {
    expect(STANDARD_LABELER_CAPABILITIES).toContain('detect.twitter-screenshot');
    expect(STANDARD_LABELER_CAPABILITIES).toContain('classify.spam');
    expect(STANDARD_LABELER_CAPABILITIES).toContain('scan.media-csam');
    expect(isStandardCapability('classify.spam')).toBe(true);
    expect(isStandardCapability('x.custom.thing')).toBe(false);
  });
});

// =============================================================================
// Content categories
// =============================================================================

describe('Phase 1.69 — content category registry', () => {
  it('has the canonical namespace pinned', () => {
    expect(CONTENT_CATEGORY_NAMESPACE).toBe('lfp2p.content-category.v1');
  });

  it('every adult category is in the ADULT_CONTENT_CATEGORY_KEYS set', () => {
    for (const c of CONTENT_CATEGORIES) {
      expect(ADULT_CONTENT_CATEGORY_KEYS.has(c.key)).toBe(c.isAdult);
    }
  });

  it('getContentCategory + isContentCategoryKey work', () => {
    expect(getContentCategory('spam')?.defaultAction).toBe('hide');
    expect(isContentCategoryKey('spam')).toBe(true);
    expect(isContentCategoryKey('not.a.category')).toBe(false);
  });
});

describe('Phase 1.69 — decideContentCategoryAction', () => {
  const adultCategory = getContentCategory('adult.sexually-explicit')!;
  const nonAdultCategory = getContentCategory('spam')!;

  it('forces hide on adult categories when the master gate is off', () => {
    expect(decideContentCategoryAction(adultCategory, 'allow', false)).toBe('hide');
    expect(decideContentCategoryAction(adultCategory, 'warn', false)).toBe('hide');
    expect(decideContentCategoryAction(adultCategory, undefined, false)).toBe('hide');
    expect(decideContentCategoryAction(adultCategory, undefined, undefined)).toBe('hide');
  });

  it('honors user preference on adult categories when the master gate is on', () => {
    expect(decideContentCategoryAction(adultCategory, 'allow', true)).toBe('allow');
    expect(decideContentCategoryAction(adultCategory, 'warn', true)).toBe('warn');
    // No preference set -> defaultAction (which for porn is 'hide').
    expect(decideContentCategoryAction(adultCategory, undefined, true)).toBe('hide');
  });

  it('non-adult categories are unaffected by the master gate', () => {
    expect(decideContentCategoryAction(nonAdultCategory, 'allow', false)).toBe('allow');
    expect(decideContentCategoryAction(nonAdultCategory, 'allow', true)).toBe('allow');
    expect(decideContentCategoryAction(nonAdultCategory, undefined, false)).toBe('hide'); // default
  });

  it('matches the Bluesky-style conservative defaults', () => {
    function defaultFor(key: string): string | undefined {
      return CONTENT_CATEGORIES.find((c) => c.key === key)?.defaultAction;
    }
    expect(defaultFor('adult.sexually-explicit')).toBe('hide');
    expect(defaultFor('adult.sexually-suggestive')).toBe('warn');
    expect(defaultFor('violence.gore')).toBe('warn');
    expect(defaultFor('violence.threat')).toBe('hide');
    expect(defaultFor('hate.iconography')).toBe('hide');
    expect(defaultFor('spam')).toBe('hide');
    expect(defaultFor('impersonation')).toBe('hide');
    expect(defaultFor('political')).toBe('allow');
    expect(defaultFor('screenshot.crossplatform')).toBe('allow');
  });
});

// =============================================================================
// Adult content master gate (local-controls event)
// =============================================================================

describe('Phase 1.69 — safety.adult-content.gate.set', () => {
  function gateEvent(enabled: boolean, action: 'apply' | 'revert' = 'apply'): LocalControlEvent {
    return {
      version: 'lfp2p.local-control-event.v1',
      eventId: `evt_gate_${enabled}_${action}`,
      createdAt: '2026-05-31T00:00:00Z',
      action,
      kind: 'safety.adult-content.gate.set',
      enabled,
      gatedAt: '2026-05-31T00:00:00Z'
    } as unknown as LocalControlEvent;
  }

  it('apply records the gate', () => {
    const s = applyLocalControlEvent(createEmptyLocalControlState(), gateEvent(true));
    expect(s.adultContentGate?.enabled).toBe(true);
  });

  it('revert clears the gate', () => {
    let s = applyLocalControlEvent(createEmptyLocalControlState(), gateEvent(true));
    expect(s.adultContentGate).toBeDefined();
    s = applyLocalControlEvent(s, gateEvent(false, 'revert'));
    expect(s.adultContentGate).toBeUndefined();
  });

  it('rejects non-boolean enabled', () => {
    expect(() =>
      applyLocalControlEvent(createEmptyLocalControlState(), {
        version: 'lfp2p.local-control-event.v1',
        eventId: 'e',
        createdAt: '2026-05-31T00:00:00Z',
        action: 'apply',
        kind: 'safety.adult-content.gate.set',
        enabled: 'yes',
        gatedAt: '2026-05-31T00:00:00Z'
      })
    ).toThrow(/must be a boolean/);
  });
});

// =============================================================================
// Subscription overlap detection
// =============================================================================

const SUBSCRIBER = 'actor_subscriber';

function profile(
  labelerId: string,
  supportedLabels: string[],
  capabilities?: { capabilityId: string; producesLabels: string[] }[]
): LabelerEvent {
  const profileBody: Record<string, unknown> = {
    version: 'lfp2p.safety-labeler-profile.v1',
    labelerId,
    actorId: `actor_${labelerId}`,
    displayName: labelerId,
    supportedNamespaces: ['lfp2p.safety'],
    supportedLabels,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-05-30T00:00:00Z'
  };
  if (capabilities !== undefined) {
    profileBody.capabilities = capabilities.map((c) => ({
      capabilityId: c.capabilityId,
      description: c.capabilityId,
      producesLabels: c.producesLabels
    }));
  }
  return {
    version: 'lfp2p.labeler-event.v1',
    eventId: `evt_prof_${labelerId}`,
    createdAt: '2026-05-31T00:00:00Z',
    kind: 'safety.labeler.profile.published',
    profile: profileBody
  } as unknown as LabelerEvent;
}

function subscribe(subscriptionId: string, labelerId: string): LabelerEvent {
  return {
    version: 'lfp2p.labeler-event.v1',
    eventId: `evt_sub_${subscriptionId}`,
    createdAt: '2026-05-31T00:00:00Z',
    kind: 'safety.labeler.subscribed',
    subscription: {
      version: 'lfp2p.safety-labeler-subscription.v1',
      subscriptionId,
      subscriberActorId: SUBSCRIBER,
      labelerId,
      trustedNamespaces: ['lfp2p.safety'],
      scope: 'account-local',
      createdAt: '2026-05-31T00:00:00Z'
    }
  } as unknown as LabelerEvent;
}

describe('Phase 1.69 — findOverlappingSubscriptions', () => {
  it('returns no overlap when capabilities and label sets are disjoint', () => {
    let s = createEmptyLabelersState();
    s = applyLabelerEvent(
      s,
      profile('labeler_screenshot', ['screenshot.x-twitter'], [
        { capabilityId: 'detect.twitter-screenshot', producesLabels: ['screenshot.x-twitter'] }
      ])
    );
    s = applyLabelerEvent(
      s,
      profile('labeler_profanity', ['quality.profanity-en'], [
        { capabilityId: 'detect.profanity-en', producesLabels: ['quality.profanity-en'] }
      ])
    );
    s = applyLabelerEvent(s, subscribe('sub_1', 'labeler_screenshot'));
    s = applyLabelerEvent(s, subscribe('sub_2', 'labeler_profanity'));
    expect(findOverlappingSubscriptions(s, SUBSCRIBER)).toEqual([]);
  });

  it('flags two spam labelers as fully overlapping', () => {
    let s = createEmptyLabelersState();
    s = applyLabelerEvent(
      s,
      profile('labeler_spam_A', ['security.spam'], [
        { capabilityId: 'classify.spam', producesLabels: ['security.spam'] }
      ])
    );
    s = applyLabelerEvent(
      s,
      profile('labeler_spam_B', ['security.spam'], [
        { capabilityId: 'classify.spam', producesLabels: ['security.spam'] }
      ])
    );
    s = applyLabelerEvent(s, subscribe('sub_A', 'labeler_spam_A'));
    s = applyLabelerEvent(s, subscribe('sub_B', 'labeler_spam_B'));
    const pairs = findOverlappingSubscriptions(s, SUBSCRIBER);
    expect(pairs.length).toBe(1);
    expect(pairs[0]?.level).toBe('full');
    expect(pairs[0]?.overlappingCapabilityIds).toEqual(['classify.spam']);
    expect(pairs[0]?.overlappingLabelKeys).toEqual(['security.spam']);
  });

  it('flags label-only overlap when neither has declared capabilities', () => {
    let s = createEmptyLabelersState();
    s = applyLabelerEvent(s, profile('labeler_A', ['security.spam']));
    s = applyLabelerEvent(s, profile('labeler_B', ['security.spam']));
    s = applyLabelerEvent(s, subscribe('sub_A', 'labeler_A'));
    s = applyLabelerEvent(s, subscribe('sub_B', 'labeler_B'));
    const pairs = findOverlappingSubscriptions(s, SUBSCRIBER);
    expect(pairs.length).toBe(1);
    expect(pairs[0]?.level).toBe('label-only');
  });

  it('flags partial overlap when capabilities and labels both partially overlap', () => {
    let s = createEmptyLabelersState();
    s = applyLabelerEvent(
      s,
      profile('labeler_A', ['security.spam', 'quality.duplicate'], [
        { capabilityId: 'classify.spam', producesLabels: ['security.spam'] },
        { capabilityId: 'detect.duplicate', producesLabels: ['quality.duplicate'] }
      ])
    );
    s = applyLabelerEvent(
      s,
      profile('labeler_B', ['security.spam', 'quality.low-effort'], [
        { capabilityId: 'classify.spam', producesLabels: ['security.spam'] },
        { capabilityId: 'classify.toxicity', producesLabels: ['quality.low-effort'] }
      ])
    );
    s = applyLabelerEvent(s, subscribe('sub_A', 'labeler_A'));
    s = applyLabelerEvent(s, subscribe('sub_B', 'labeler_B'));
    const pairs = findOverlappingSubscriptions(s, SUBSCRIBER);
    expect(pairs.length).toBe(1);
    expect(pairs[0]?.level).toBe('partial');
    expect(pairs[0]?.overlappingCapabilityIds).toEqual(['classify.spam']);
  });

  it('omits pairs where one subscription is unsubscribed', () => {
    let s = createEmptyLabelersState();
    s = applyLabelerEvent(
      s,
      profile('labeler_A', ['security.spam'], [
        { capabilityId: 'classify.spam', producesLabels: ['security.spam'] }
      ])
    );
    s = applyLabelerEvent(
      s,
      profile('labeler_B', ['security.spam'], [
        { capabilityId: 'classify.spam', producesLabels: ['security.spam'] }
      ])
    );
    s = applyLabelerEvent(s, subscribe('sub_A', 'labeler_A'));
    s = applyLabelerEvent(s, subscribe('sub_B', 'labeler_B'));
    s = applyLabelerEvent(s, {
      version: 'lfp2p.labeler-event.v1',
      eventId: 'evt_unsub_B',
      createdAt: '2026-06-01T00:00:00Z',
      kind: 'safety.labeler.unsubscribed',
      subscriptionId: 'sub_B',
      unsubscribedAt: '2026-06-01T00:00:00Z'
    } as unknown as LabelerEvent);
    expect(findOverlappingSubscriptions(s, SUBSCRIBER)).toEqual([]);
  });
});

describe('Phase 1.69 — detectRedundantSubscription', () => {
  it('flags a candidate that does exactly what an existing subscription does', () => {
    let s = createEmptyLabelersState();
    s = applyLabelerEvent(
      s,
      profile('labeler_existing', ['security.spam'], [
        { capabilityId: 'classify.spam', producesLabels: ['security.spam'] }
      ])
    );
    s = applyLabelerEvent(
      s,
      profile('labeler_candidate', ['security.spam'], [
        { capabilityId: 'classify.spam', producesLabels: ['security.spam'] }
      ])
    );
    s = applyLabelerEvent(s, subscribe('sub_existing', 'labeler_existing'));
    const r = detectRedundantSubscription(s, SUBSCRIBER, 'labeler_candidate');
    expect(r.isRedundant).toBe(true);
    expect(r.overlappingWithLabelerId).toBe('labeler_existing');
  });

  it('does not flag a candidate with a disjoint job', () => {
    let s = createEmptyLabelersState();
    s = applyLabelerEvent(
      s,
      profile('labeler_screenshot', ['screenshot.x'], [
        { capabilityId: 'detect.twitter-screenshot', producesLabels: ['screenshot.x'] }
      ])
    );
    s = applyLabelerEvent(
      s,
      profile('labeler_profanity', ['quality.profanity'], [
        { capabilityId: 'detect.profanity-en', producesLabels: ['quality.profanity'] }
      ])
    );
    s = applyLabelerEvent(s, subscribe('sub_screenshot', 'labeler_screenshot'));
    const r = detectRedundantSubscription(s, SUBSCRIBER, 'labeler_profanity');
    expect(r.isRedundant).toBe(false);
    expect(r.overlappingCapabilityIds.length).toBe(0);
    expect(r.overlappingLabelKeys.length).toBe(0);
  });

  it('returns a non-redundant overlap when capabilities overlap partially', () => {
    let s = createEmptyLabelersState();
    s = applyLabelerEvent(
      s,
      profile('labeler_existing', ['security.spam', 'quality.duplicate'], [
        { capabilityId: 'classify.spam', producesLabels: ['security.spam'] },
        { capabilityId: 'detect.duplicate', producesLabels: ['quality.duplicate'] }
      ])
    );
    s = applyLabelerEvent(
      s,
      profile('labeler_candidate', ['security.spam', 'quality.low-effort'], [
        { capabilityId: 'classify.spam', producesLabels: ['security.spam'] },
        { capabilityId: 'classify.toxicity', producesLabels: ['quality.low-effort'] }
      ])
    );
    s = applyLabelerEvent(s, subscribe('sub_existing', 'labeler_existing'));
    const r = detectRedundantSubscription(s, SUBSCRIBER, 'labeler_candidate');
    // Capabilities partially overlap; neither is a subset of the other.
    expect(r.isRedundant).toBe(false);
    expect(r.overlappingCapabilityIds).toEqual(['classify.spam']);
  });
});

// =============================================================================
// Bluesky-style scenarios from the user's prompt
// =============================================================================

describe('Phase 1.69 — Bluesky-style scenarios', () => {
  it('subscribing to a Twitter-screenshot labeler + a profanity labeler does NOT warn', () => {
    let s = createEmptyLabelersState();
    s = applyLabelerEvent(
      s,
      profile('labeler_x_screenshots', ['screenshot.x'], [
        { capabilityId: 'detect.twitter-screenshot', producesLabels: ['screenshot.x'] }
      ])
    );
    s = applyLabelerEvent(
      s,
      profile('labeler_profanity_en', ['quality.profanity-en'], [
        { capabilityId: 'detect.profanity-en', producesLabels: ['quality.profanity-en'] }
      ])
    );
    s = applyLabelerEvent(s, subscribe('sub_screenshots', 'labeler_x_screenshots'));
    const r = detectRedundantSubscription(s, SUBSCRIBER, 'labeler_profanity_en');
    expect(r.isRedundant).toBe(false);
  });

  it('subscribing to a second spam labeler DOES warn', () => {
    let s = createEmptyLabelersState();
    s = applyLabelerEvent(
      s,
      profile('labeler_spam_1', ['security.spam'], [
        { capabilityId: 'classify.spam', producesLabels: ['security.spam'] }
      ])
    );
    s = applyLabelerEvent(
      s,
      profile('labeler_spam_2', ['security.spam'], [
        { capabilityId: 'classify.spam', producesLabels: ['security.spam'] }
      ])
    );
    s = applyLabelerEvent(s, subscribe('sub_1', 'labeler_spam_1'));
    const r = detectRedundantSubscription(s, SUBSCRIBER, 'labeler_spam_2');
    expect(r.isRedundant).toBe(true);
    expect(r.overlappingCapabilityIds).toEqual(['classify.spam']);
  });
});

