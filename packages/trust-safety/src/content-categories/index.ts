/**
 * Standard content-category registry.
 *
 * The canonical set of content categories that any labeler may produce
 * labels under, and that subscribers have a built-in preference UI for.
 * Emulates Bluesky's content-filter system: a fixed list of categories
 * (Adult Content, Violence, Hate, Spam, etc.) with per-user
 * Show/Warn/Hide preferences plus an adult-content master gate.
 *
 * All standard categories live in the namespace
 * `lfp2p.content-category.v1`. Labelers MAY produce labels in this
 * namespace; the subscriber's content-category preference applies.
 * Labelers MAY ALSO produce labels in their own community-specific
 * namespaces — those bypass the standard preference UI and use the
 * generic `safety.label.preference.set` path.
 */

import type { LabelPreferenceAction } from '../local-controls/events.js';

/** The namespace under which all standard content categories are registered. */
export const CONTENT_CATEGORY_NAMESPACE = 'lfp2p.content-category.v1';

/**
 * Built-in content categories. Each category has:
 *  - `key`: the `labelKey` under `CONTENT_CATEGORY_NAMESPACE`.
 *  - `isAdult`: whether the adult-content master gate applies (when
 *    disabled, the category forces `hide` regardless of user pref).
 *  - `defaultAction`: the default subscriber preference when none has
 *    been set explicitly. Matches Bluesky's conservative defaults.
 *  - `description`: short human-readable description.
 */
export const CONTENT_CATEGORIES = [
  // Adult (gated)
  {
    key: 'adult.sexually-explicit',
    isAdult: true,
    defaultAction: 'hide' as const,
    description: 'Pornographic or sexually explicit content.'
  },
  {
    key: 'adult.sexually-suggestive',
    isAdult: true,
    defaultAction: 'warn' as const,
    description: 'Sexually suggestive content that is not explicit.'
  },
  {
    key: 'adult.nudity-artistic',
    isAdult: true,
    defaultAction: 'warn' as const,
    description: 'Artistic or non-sexual nudity.'
  },
  // Violence
  {
    key: 'violence.gore',
    isAdult: false,
    defaultAction: 'warn' as const,
    description: 'Graphic depictions of injury or death.'
  },
  {
    key: 'violence.graphic',
    isAdult: false,
    defaultAction: 'warn' as const,
    description: 'Other graphically violent content.'
  },
  {
    key: 'violence.threat',
    isAdult: false,
    defaultAction: 'hide' as const,
    description: 'Credible threats of violence.'
  },
  // Self-harm and sensitive
  {
    key: 'self-harm',
    isAdult: false,
    defaultAction: 'warn' as const,
    description: 'Self-harm imagery or discussion.'
  },
  {
    key: 'eating-disorder',
    isAdult: false,
    defaultAction: 'warn' as const,
    description: 'Content that may promote eating disorders.'
  },
  // Hate / identity-targeted
  {
    key: 'hate.iconography',
    isAdult: false,
    defaultAction: 'hide' as const,
    description: 'Hate group iconography or symbols.'
  },
  {
    key: 'hate.slur',
    isAdult: false,
    defaultAction: 'hide' as const,
    description: 'Slurs targeting protected groups.'
  },
  {
    key: 'intolerance.targeted',
    isAdult: false,
    defaultAction: 'warn' as const,
    description: 'Targeted intolerance toward a person or group.'
  },
  // Authenticity / quality
  {
    key: 'spam',
    isAdult: false,
    defaultAction: 'hide' as const,
    description: 'Bulk unsolicited content.'
  },
  {
    key: 'impersonation',
    isAdult: false,
    defaultAction: 'hide' as const,
    description: 'Impersonating another person or organization.'
  },
  {
    key: 'misleading-claim',
    isAdult: false,
    defaultAction: 'warn' as const,
    description: 'Factually misleading claim.'
  },
  {
    key: 'misleading-context',
    isAdult: false,
    defaultAction: 'warn' as const,
    description: 'Manipulated or out-of-context media.'
  },
  {
    key: 'bot-account',
    isAdult: false,
    defaultAction: 'warn' as const,
    description: 'Automated / non-human account.'
  },
  // Topic-specific
  {
    key: 'political',
    isAdult: false,
    defaultAction: 'allow' as const,
    description: 'Political content.'
  },
  {
    key: 'religion',
    isAdult: false,
    defaultAction: 'allow' as const,
    description: 'Religious content.'
  },
  {
    key: 'gambling',
    isAdult: false,
    defaultAction: 'warn' as const,
    description: 'Gambling-related content.'
  },
  // Cross-platform / provenance
  {
    key: 'screenshot.crossplatform',
    isAdult: false,
    defaultAction: 'allow' as const,
    description: 'A screenshot of content from another platform.'
  }
] as const;

export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];
export type ContentCategoryKey = ContentCategory['key'];

const BY_KEY: ReadonlyMap<ContentCategoryKey, ContentCategory> = new Map(
  CONTENT_CATEGORIES.map((c) => [c.key, c])
);

export function getContentCategory(key: string): ContentCategory | undefined {
  return BY_KEY.get(key as ContentCategoryKey);
}

export function isContentCategoryKey(key: string): key is ContentCategoryKey {
  return BY_KEY.has(key as ContentCategoryKey);
}

/** The set of adult-gated category keys. */
export const ADULT_CONTENT_CATEGORY_KEYS: ReadonlySet<ContentCategoryKey> = new Set(
  CONTENT_CATEGORIES.filter((c) => c.isAdult).map((c) => c.key)
);

/**
 * Resolve the effective action for a content-category label. Used by a
 * downstream selector to combine the user's per-category preference with
 * the adult-content master gate.
 *
 * Inputs:
 *  - `category`: the content category being resolved
 *  - `userPreference`: the user's per-category preference, if any
 *    (from `safety.label.preference.set`)
 *  - `adultContentGateEnabled`: whether the master gate is on
 *
 * Rule:
 *  - If the category is adult AND the gate is off (or undefined):
 *    return `hide` regardless of `userPreference`. This is the
 *    non-overridable child-safety / fresh-account default.
 *  - Otherwise: return `userPreference` if set, else
 *    `category.defaultAction`.
 */
export function decideContentCategoryAction(
  category: ContentCategory,
  userPreference: LabelPreferenceAction | undefined,
  adultContentGateEnabled: boolean | undefined
): LabelPreferenceAction {
  if (category.isAdult && !adultContentGateEnabled) {
    return 'hide';
  }
  if (userPreference !== undefined) return userPreference;
  return category.defaultAction;
}
