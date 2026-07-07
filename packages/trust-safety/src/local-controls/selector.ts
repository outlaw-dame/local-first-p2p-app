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

function labelPreferenceToDecision(preference: LabelPreferenceAction): VisibilityDecision {
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
export type SemanticKeywordMatcher = (entry: MutedKeywordEntry, candidateText: string) => boolean;

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

// Phase 1.71.A — Unicode normalization on the keyword match path.
//
// The goal is to make `sp0iler`, `sp<U+200B>oiler`, `ѕpoiler` (Cyrillic),
// `ＳＰＯＩＬＥＲ` (full-width), `ⓢⓟⓞⓘⓛⓔⓡ` (circled letters), and
// `spoîler` (combining diacritic obfuscation) all match a user's
// `spoiler` filter. Without this hardening, every one of those
// evades the literal matcher.
//
// Pipeline (applied to BOTH haystack and needle before match):
//   1. `String.prototype.normalize('NFKD')` — compatibility
//      decomposition. Full-width / circled / mathematical letters
//      collapse to base ASCII letters; precomposed diacritics
//      decompose into base letter + combining marks so the marks
//      can be stripped at step 3.
//   2. lowercase (`toLowerCase()`, not locale-aware — JS default
//      `toLowerCase()` is deliberately not locale-sensitive; we want
//      stable cross-device behavior).
//   3. strip a fixed set of zero-width / format code points AND
//      every Unicode combining mark via constant precompiled
//      patterns.
//   4. map a fixed table of common visual confusables (Cyrillic /
//      Greek homoglyphs + common leet-speak digit/symbol-to-letter
//      substitutions) onto their ASCII counterparts.
//
// Safety:
//   - All patterns are compiled once at module load against literal
//     source. We never compile a regex against attacker text.
//   - The confusables table is a `Map`, not a plain object — safe
//     against prototype-pollution lookups.
//   - The pipeline is linear-time in the input length.
//   - The output is at most ~1.1× the input length (NFKD can grow
//     a few graphemes but is bounded; the confusables map is 1:1).
//   - Combining-mark stripping is intentionally aggressive. The
//     normalized form is used ONLY for matching; the user's stored
//     keyword and the rendered post text are untouched. For non-Latin
//     scripts where combining marks are semantically essential
//     (Arabic, Devanagari, Hebrew, etc.) this collapses some
//     distinctions, but the user opted into a content filter and
//     this only affects whether a filter matches — never the
//     displayed text.

// U+200B zero-width space, U+200C zero-width non-joiner,
// U+200D zero-width joiner, U+2060 word joiner,
// U+FEFF zero-width no-break space (BOM).
const ZERO_WIDTH_PATTERN = /[\u200B-\u200D\u2060\uFEFF]/gu;

// Every Unicode combining mark. Compiled once against literal source.
const COMBINING_MARK_PATTERN = /\p{M}/gu;

/**
 * Common visual confusables → ASCII equivalents. Keyed by
 * lowercase forms (we lowercase before applying). Entries are
 * conservative — only homoglyphs that look indistinguishable to
 * a human reader plus common leet-speak digit/symbol swaps that
 * users actually use to evade filters. The cost of a false match
 * here (e.g. matching "k1ll" against a mute on "kill") is the
 * intended behavior: the user opted into a content filter, and
 * the alternative is rampant evasion.
 */
const KEYWORD_CONFUSABLES: ReadonlyMap<string, string> = new Map([
  // Cyrillic small letters that look like Latin letters
  ['а', 'a'],
  ['е', 'e'],
  ['і', 'i'],
  ['ј', 'j'],
  ['о', 'o'],
  ['р', 'p'],
  ['с', 'c'],
  ['у', 'y'],
  ['х', 'x'],
  ['ѕ', 's'],
  ['ԁ', 'd'],
  ['һ', 'h'],
  ['ӏ', 'l'],
  // Greek small letters that look like Latin letters
  ['α', 'a'],
  ['ε', 'e'],
  ['ι', 'i'],
  ['ν', 'v'],
  ['ο', 'o'],
  ['ρ', 'p'],
  ['τ', 't'],
  ['μ', 'u'],
  // Common leet-speak intentional evasions
  ['0', 'o'],
  ['1', 'l'],
  ['3', 'e'],
  ['4', 'a'],
  ['5', 's'],
  ['7', 't'],
  ['8', 'b'],
  ['@', 'a'],
  ['$', 's']
]);

/**
 * The full normalization applied before matching. Pure function;
 * exported only via the package boundary (no test imports it
 * directly — its behavior is observed via the selector outputs in
 * `phase-1.71.test.ts`).
 */
function normalizeForKeywordMatch(input: string): string {
  if (input.length === 0) return '';
  // Step 1: NFKD — compatibility decomposition.
  const nfkd = input.normalize('NFKD');
  // Step 2: lowercase. Default `toLowerCase()` is intentionally not
  // locale-aware (`toLocaleLowerCase()` would be), which gives us
  // deterministic behavior across devices regardless of system locale.
  const lower = nfkd.toLowerCase();
  // Step 3: strip zero-width / format code points + every combining
  // mark in one pass each. Both patterns are constants.
  const stripped = lower.replace(ZERO_WIDTH_PATTERN, '').replace(COMBINING_MARK_PATTERN, '');
  // Step 4: confusables mapping. Iterate by code-point chunk so a
  // surrogate pair lookup does not split mid-character.
  let out = '';
  for (const ch of stripped) {
    const mapped = KEYWORD_CONFUSABLES.get(ch);
    out += mapped === undefined ? ch : mapped;
  }
  return out;
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

  // Phase 1.71.A: every non-semantic match kind runs through the
  // Unicode normalization pipeline before comparison. The needle is
  // normalized fresh each call rather than precomputed on the entry
  // — we expect filter counts to be small (tens, not thousands), so
  // the extra ~2µs per filter is irrelevant and the simpler code is
  // worth more than the micro-optimization.
  const haystackN = normalizeForKeywordMatch(text);
  const needleN = normalizeForKeywordMatch(entry.keyword);
  if (needleN.length === 0) return false;

  if (entry.matchKind === 'substring') {
    return haystackN.includes(needleN);
  }

  if (entry.matchKind === 'phrase') {
    // Phrase: whitespace-insensitive (collapse runs to a single space)
    // on top of the normalized strings.
    const haystack = normalizeWhitespace(haystackN);
    const needle = normalizeWhitespace(needleN);
    if (needle.length === 0) return false;
    return haystack.includes(needle);
  }

  if (entry.matchKind === 'hashtag') {
    // Hashtag: walk the normalized haystack for `#`, then compare the
    // body up to the next non-Unicode-word-character against the
    // normalized needle. Pure char-by-char scan; no regex against
    // attacker text.
    let i = 0;
    while (true) {
      const hashIdx = haystackN.indexOf('#', i);
      if (hashIdx === -1) return false;
      let end = hashIdx + 1;
      while (end < haystackN.length) {
        const ch = haystackN[end];
        if (ch === undefined || !isUnicodeWordChar(ch)) break;
        end += 1;
      }
      if (end > hashIdx + 1) {
        const body = haystackN.slice(hashIdx + 1, end);
        if (body === needleN) return true;
      }
      i = hashIdx + 1;
    }
  }

  // word: boundary-checked literal scan against the normalized strings.
  let from = 0;
  while (from <= haystackN.length - needleN.length) {
    const idx = haystackN.indexOf(needleN, from);
    if (idx === -1) return false;
    const before = idx === 0 ? -1 : haystackN.charCodeAt(idx - 1);
    const after =
      idx + needleN.length >= haystackN.length ? -1 : haystackN.charCodeAt(idx + needleN.length);
    const leftBoundary = before === -1 || !isAsciiWordChar(before);
    const rightBoundary = after === -1 || !isAsciiWordChar(after);
    if (leftBoundary && rightBoundary) return true;
    from = idx + 1;
  }
  return false;
}

function notificationPreferenceToDecision(preference: NotificationPreference): VisibilityDecision {
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
      const muteDecision: VisibilityDecision = mute.muteScope === 'all' ? 'collapse' : 'downrank';
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
      context.actorId !== undefined ? state.allowlistedActors[context.actorId] : undefined;
    const actorAllowlisted = allowlistEntry !== undefined && !isExpired(allowlistEntry, now);

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
      decision = mostRestrictive(decision, notificationPreferenceToDecision(npref.preference));
    }
  }

  return decision;
}
