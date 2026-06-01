import type { LabelPreferenceAction } from './events.js';
import type { LocalControlState } from './projection.js';
import { labelPreferenceKey } from './projection.js';

/**
 * Visibility decision returned by the selector. Ordered from most
 * permissive (`show`) to most restrictive (`hide`).
 */
export const VISIBILITY_DECISIONS = [
  'show',
  'downrank',
  'warn',
  'blur-media',
  'collapse',
  'hide'
] as const;
export type VisibilityDecision = (typeof VISIBILITY_DECISIONS)[number];

const DECISION_RANK: Readonly<Record<VisibilityDecision, number>> = {
  show: 0,
  downrank: 1,
  warn: 2,
  'blur-media': 3,
  collapse: 4,
  hide: 5
};

function mostRestrictive(a: VisibilityDecision, b: VisibilityDecision): VisibilityDecision {
  return DECISION_RANK[a] >= DECISION_RANK[b] ? a : b;
}

function labelPreferenceToDecision(
  preference: LabelPreferenceAction
): VisibilityDecision {
  switch (preference) {
    case 'allow':
      return 'show';
    case 'warn':
      return 'warn';
    case 'collapse':
      return 'collapse';
    case 'blur-media':
      return 'blur-media';
    case 'hide':
      return 'hide';
    case 'downrank':
      return 'downrank';
  }
}

export type SelectorLabelHit = Readonly<{
  labelKey: string;
  namespace: string;
}>;

/**
 * Context for a visibility decision. Each field is optional — provide only
 * what the caller has. Empty context returns `show`.
 *
 *  - `actorId`: the producer of the content (block / mute)
 *  - `domain`: a normalized bare domain associated with the content
 *  - `threadId`: thread parent
 *  - `postEventId`: the event id of the post itself
 *  - `text`: visible text fragments to scan for muted keywords
 *  - `labels`: labels that have already been attached to the content by
 *    issuers the user trusts
 */
export type SelectorContext = Readonly<{
  actorId?: string;
  domain?: string;
  threadId?: string;
  postEventId?: string;
  text?: string;
  labels?: ReadonlyArray<SelectorLabelHit>;
}>;

/**
 * Lower-case ASCII word-boundary characters: anything that is NOT a letter
 * (a-z / A-Z), digit (0-9), or underscore. Matches the typical Unicode
 * letter+digit-tolerant word boundary closely enough for safety filtering
 * without bringing in a full Unicode property table.
 */
function isWordChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95
  );
}

function matchesKeyword(
  text: string,
  keyword: string,
  matchKind: 'substring' | 'word'
): boolean {
  if (text.length === 0 || keyword.length === 0) return false;
  const haystack = text.toLowerCase();
  const needle = keyword.toLowerCase();

  if (matchKind === 'substring') {
    return haystack.includes(needle);
  }

  // word: search every occurrence and verify both ends are at word boundaries.
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return false;
    const before = idx === 0 ? -1 : haystack.charCodeAt(idx - 1);
    const after =
      idx + needle.length >= haystack.length
        ? -1
        : haystack.charCodeAt(idx + needle.length);
    const leftBoundary = before === -1 || !isWordChar(before);
    const rightBoundary = after === -1 || !isWordChar(after);
    if (leftBoundary && rightBoundary) return true;
    from = idx + 1;
  }
  return false;
}

/**
 * Resolve the visibility decision for `context` given the local-control
 * `state`. The decision is the most restrictive across every signal that
 * matches:
 *
 *   blocked actor       -> hide
 *   blocked domain      -> hide
 *   hidden post id      -> hide
 *   muted thread        -> collapse
 *   muted actor (all)   -> collapse
 *   muted actor (feed)  -> downrank
 *   muted actor (replies/notifications) -> downrank (caller may further filter)
 *   muted keyword hit   -> collapse
 *   label preference    -> the preference's mapped decision
 *
 * Decisions are combined with `max(rank)` so a single `hide` signal
 * dominates lower-severity signals.
 */
export function decideVisibility(
  state: LocalControlState,
  context: SelectorContext
): VisibilityDecision {
  let decision: VisibilityDecision = 'show';

  if (
    context.actorId !== undefined &&
    Object.prototype.hasOwnProperty.call(state.blockedActors, context.actorId)
  ) {
    decision = mostRestrictive(decision, 'hide');
  }
  if (
    context.domain !== undefined &&
    Object.prototype.hasOwnProperty.call(
      state.blockedDomains,
      context.domain.toLowerCase()
    )
  ) {
    decision = mostRestrictive(decision, 'hide');
  }
  if (
    context.postEventId !== undefined &&
    Object.prototype.hasOwnProperty.call(state.hiddenPosts, context.postEventId)
  ) {
    decision = mostRestrictive(decision, 'hide');
  }
  if (
    context.threadId !== undefined &&
    Object.prototype.hasOwnProperty.call(state.mutedThreads, context.threadId)
  ) {
    decision = mostRestrictive(decision, 'collapse');
  }
  if (context.actorId !== undefined) {
    const mute = state.mutedActors[context.actorId];
    if (mute !== undefined) {
      const muteDecision: VisibilityDecision =
        mute.muteScope === 'all' ? 'collapse' : 'downrank';
      decision = mostRestrictive(decision, muteDecision);
    }
  }
  if (context.text !== undefined && context.text.length > 0) {
    for (const key of Object.keys(state.mutedKeywords)) {
      const entry = state.mutedKeywords[key];
      if (entry === undefined) continue;
      if (matchesKeyword(context.text, entry.keyword, entry.matchKind)) {
        decision = mostRestrictive(decision, 'collapse');
        break;
      }
    }
  }
  if (context.labels !== undefined && context.labels.length > 0) {
    for (const hit of context.labels) {
      const key = labelPreferenceKey(hit.namespace, hit.labelKey);
      const pref = state.labelPreferences[key];
      if (pref === undefined) continue;
      decision = mostRestrictive(decision, labelPreferenceToDecision(pref.preference));
    }
  }
  return decision;
}
