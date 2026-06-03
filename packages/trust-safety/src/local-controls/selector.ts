import type {
  LabelPreferenceAction,
  NotificationChannel,
  NotificationPreference
} from './events.js';
import type {
  LocalControlState,
  MutedKeywordEntry,
  NotificationPreferenceEntry
} from './projection.js';
import { isExpired, labelPreferenceKey } from './projection.js';

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
  /**
   * Whether this label is a hard-safety label per its `SafetyLabelDefinition`.
   * Hard-safety labels are NOT suppressed by the user's allowlist. If the
   * host does not know the label's hardSafety status, omit the field — the
   * default is false so allowlist will suppress it.
   */
  hardSafety?: boolean;
}>;

/**
 * Host-supplied semantic matcher. Called once per `safety.keyword.muted`
 * entry with `matchKind: 'semantic'` and a candidate text. The host is
 * responsible for running the actual embedding comparison; this package
 * never compiles a regex and never loads an ML model.
 *
 * Returning `true` indicates the candidate is similar enough to the
 * stored embedding to count as a match.
 */
export type SemanticKeywordMatcher = (
  entry: MutedKeywordEntry,
  candidateText: string
) => boolean;

export type SelectorContext = Readonly<{
  actorId?: string;
  domain?: string;
  threadId?: string;
  postEventId?: string;
  text?: string;
  labels?: ReadonlyArray<SelectorLabelHit>;
  /**
   * Notification channel context. When present, the selector also
   * consults `notificationPreferences`; `mute` collapses, `allow` shows.
   */
  notificationChannel?: NotificationChannel;
}>;

export type SelectorOptions = Readonly<{
  /** Reference time used for TTL evaluation. Defaults to Date.now(). */
  now?: number;
  /** Host-supplied semantic matcher. */
  semanticMatch?: SemanticKeywordMatcher;
}>;

function isAsciiWordChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95
  );
}

/**
 * Constant Unicode pattern for "is this code point a hashtag-body
 * character (letter, number, underscore)". Compiled once at module
 * load — never compiled against user input.
 */
const UNICODE_WORD_PATTERN = /[\p{L}\p{N}_]/u;

function isUnicodeWordChar(ch: string): boolean {
  if (ch.length === 0) return false;
  // Single-code-point fast path for ASCII.
  if (ch.charCodeAt(0) < 128) return isAsciiWordChar(ch.charCodeAt(0));
  return UNICODE_WORD_PATTERN.test(ch);
}

/**
 * Collapse runs of whitespace to a single space and trim. Pure;
 * uses a constant pre-compiled pattern so it is linear-time and
 * cannot be made adversarial by the caller's text.
 */
function normalizeWhitespace(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

function matchesKeyword(
  text: string,
  entry: MutedKeywordEntry,
  semanticMatch: SemanticKeywordMatcher | undefined
): boolean {
  if (text.length === 0 || entry.keyword.length === 0) return false;

  if (entry.matchKind === 'semantic') {
    if (semanticMatch === undefined) return false;
    try {
      return semanticMatch(entry, text);
    } catch {
      // Host matcher errors must not disrupt selection; treat as no-match.
      return false;
    }
  }

  const haystackLower = text.toLowerCase();
  const needleLower = entry.keyword.toLowerCase();

  if (entry.matchKind === 'substring') {
    return haystackLower.includes(needleLower);
  }

  if (entry.matchKind === 'phrase') {
    // Phrase: whitespace-insensitive (collapse runs to a single
    // space), case-insensitive substring match. The needle was
    // already normalized at validation time; we still re-normalize
    // for safety against an unverified projection.
    const haystack = normalizeWhitespace(haystackLower);
    const needle = normalizeWhitespace(needleLower);
    if (needle.length === 0) return false;
    return haystack.includes(needle);
  }

  if (entry.matchKind === 'hashtag') {
    // Hashtag: walk the text looking for `#`, then compare the body
    // up to the next non-Unicode-word-character against the needle.
    // The needle (stored lowercased without `#`) is compared
    // case-insensitively. Pure char-by-char scan; no regex against
    // attacker text.
    const haystack = haystackLower;
    let i = 0;
    while (true) {
      const hashIdx = haystack.indexOf('#', i);
      if (hashIdx === -1) return false;
      // Walk forward collecting the body.
      let end = hashIdx + 1;
      while (end < haystack.length) {
        const ch = haystack[end];
        if (ch === undefined || !isUnicodeWordChar(ch)) break;
        end += 1;
      }
      if (end > hashIdx + 1) {
        const body = haystack.slice(hashIdx + 1, end);
        if (body === needleLower) return true;
      }
      i = hashIdx + 1;
    }
  }

  // word: boundary-checked literal scan; no regex compilation.
  let from = 0;
  while (from <= haystackLower.length - needleLower.length) {
    const idx = haystackLower.indexOf(needleLower, from);
    if (idx === -1) return false;
    const before = idx === 0 ? -1 : haystackLower.charCodeAt(idx - 1);
    const after =
      idx + needleLower.length >= haystackLower.length
        ? -1
        : haystackLower.charCodeAt(idx + needleLower.length);
    const leftBoundary = before === -1 || !isAsciiWordChar(before);
    const rightBoundary = after === -1 || !isAsciiWordChar(after);
    if (leftBoundary && rightBoundary) return true;
    from = idx + 1;
  }
  return false;
}

function notificationPreferenceToDecision(
  preference: NotificationPreference
): VisibilityDecision {
  switch (preference) {
    case 'allow':
      return 'show';
    case 'mute':
      return 'collapse';
    case 'collapse':
      return 'collapse';
  }
}

/**
 * Resolve the visibility decision for `context` given the local-control
 * `state`. The decision is the most restrictive across every applicable
 * signal. Expired entries (entries with `expiresAt < now`) are skipped.
 *
 * Allowlist semantics:
 *  - An allowlisted actor's content is NOT suppressed by non-hard-safety
 *    label preferences. The allowlist is the user saying "I trust this
 *    actor regardless of third-party labels."
 *  - Hard-safety labels (`label.hardSafety === true`) are still applied
 *    against allowlisted actors. Allowlist cannot downgrade safety.
 *  - User-set blocks, mutes, hidden posts, keyword filters, and muted
 *    threads still apply against an allowlisted actor — the user
 *    actively chose those, and they remain authoritative.
 */
export function decideVisibility(
  state: LocalControlState,
  context: SelectorContext,
  options?: SelectorOptions
): VisibilityDecision {
  const now = options?.now ?? Date.now();
  let decision: VisibilityDecision = 'show';

  // Hard blocks.
  if (context.actorId !== undefined) {
    const e = state.blockedActors[context.actorId];
    if (e !== undefined && !isExpired(e, now)) {
      decision = mostRestrictive(decision, 'hide');
    }
  }
  if (context.domain !== undefined) {
    const e = state.blockedDomains[context.domain.toLowerCase()];
    if (e !== undefined && !isExpired(e, now)) {
      decision = mostRestrictive(decision, 'hide');
    }
  }
  if (context.postEventId !== undefined) {
    const e = state.hiddenPosts[context.postEventId];
    if (e !== undefined && !isExpired(e, now)) {
      decision = mostRestrictive(decision, 'hide');
    }
  }

  // Mutes.
  if (context.threadId !== undefined) {
    const e = state.mutedThreads[context.threadId];
    if (e !== undefined && !isExpired(e, now)) {
      decision = mostRestrictive(decision, 'collapse');
    }
  }
  if (context.actorId !== undefined) {
    const mute = state.mutedActors[context.actorId];
    if (mute !== undefined && !isExpired(mute, now)) {
      const muteDecision: VisibilityDecision =
        mute.muteScope === 'all' ? 'collapse' : 'downrank';
      decision = mostRestrictive(decision, muteDecision);
    }
  }

  // Keyword filter.
  if (context.text !== undefined && context.text.length > 0) {
    for (const key of Object.keys(state.mutedKeywords)) {
      const entry = state.mutedKeywords[key];
      if (entry === undefined) continue;
      if (isExpired(entry, now)) continue;
      if (matchesKeyword(context.text, entry, options?.semanticMatch)) {
        decision = mostRestrictive(decision, 'collapse');
        break;
      }
    }
  }

  // Labels — suppressed for allowlisted actors UNLESS hardSafety.
  if (context.labels !== undefined && context.labels.length > 0) {
    const allowlistEntry =
      context.actorId !== undefined
        ? state.allowlistedActors[context.actorId]
        : undefined;
    const actorAllowlisted =
      allowlistEntry !== undefined && !isExpired(allowlistEntry, now);

    for (const hit of context.labels) {
      if (actorAllowlisted && hit.hardSafety !== true) continue;
      const key = labelPreferenceKey(hit.namespace, hit.labelKey);
      const pref = state.labelPreferences[key];
      if (pref === undefined) continue;
      if (isExpired(pref, now)) continue;
      decision = mostRestrictive(decision, labelPreferenceToDecision(pref.preference));
    }
  }

  // Notification channel preference.
  if (context.notificationChannel !== undefined) {
    const map = state.notificationPreferences as Readonly<
      Partial<Record<NotificationChannel, NotificationPreferenceEntry>>
    >;
    const npref = map[context.notificationChannel];
    if (npref !== undefined && !isExpired(npref, now)) {
      decision = mostRestrictive(
        decision,
        notificationPreferenceToDecision(npref.preference)
      );
    }
  }

  return decision;
}
