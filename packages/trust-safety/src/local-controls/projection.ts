import { tsError } from '../errors.js';
import type {
  AccountMuteScope,
  KeywordMatchKind,
  LabelPreferenceAction,
  LocalControlEvent
} from './events.js';
import { validateLocalControlEvent } from './events.js';

// --- Entry shapes --------------------------------------------------------

export type BlockedActorEntry = Readonly<{
  since: string;
  reasonCode?: string;
}>;

export type MutedActorEntry = Readonly<{
  since: string;
  muteScope: AccountMuteScope;
}>;

export type BlockedDomainEntry = Readonly<{
  since: string;
  reasonCode?: string;
}>;

export type MutedKeywordEntry = Readonly<{
  since: string;
  keyword: string;
  matchKind: KeywordMatchKind;
}>;

export type MutedThreadEntry = Readonly<{
  since: string;
}>;

export type HiddenPostEntry = Readonly<{
  since: string;
}>;

export type LabelPreferenceEntry = Readonly<{
  since: string;
  preference: LabelPreferenceAction;
}>;

// --- State ---------------------------------------------------------------

/**
 * Snapshot of local-control state produced by replaying a sequence of
 * `LocalControlEvent`s. The shape is intentionally serializable so a
 * downstream layer can persist it as-is in a local store and rebuild it
 * deterministically from the event log on store reopen.
 *
 * Map keys:
 *  - `blockedActors`, `mutedActors`: actor identifier
 *  - `blockedDomains`: lower-cased bare domain
 *  - `mutedThreads`: thread identifier
 *  - `hiddenPosts`: post event identifier
 *  - `labelPreferences`: `${namespace}::${labelKey}`
 *  - `mutedKeywords`: stored as an array keyed by lower-cased keyword to
 *    preserve match-kind metadata
 *
 * `appliedEventIds` exists so the projection is idempotent on replay —
 * applying the same event twice never doubles a state entry.
 */
export type LocalControlState = Readonly<{
  blockedActors: Readonly<Record<string, BlockedActorEntry>>;
  mutedActors: Readonly<Record<string, MutedActorEntry>>;
  blockedDomains: Readonly<Record<string, BlockedDomainEntry>>;
  mutedKeywords: Readonly<Record<string, MutedKeywordEntry>>;
  mutedThreads: Readonly<Record<string, MutedThreadEntry>>;
  hiddenPosts: Readonly<Record<string, HiddenPostEntry>>;
  labelPreferences: Readonly<Record<string, LabelPreferenceEntry>>;
  appliedEventIds: ReadonlySet<string>;
}>;

/** Build an empty, frozen state. */
export function createEmptyLocalControlState(): LocalControlState {
  return Object.freeze({
    blockedActors: Object.freeze({}),
    mutedActors: Object.freeze({}),
    blockedDomains: Object.freeze({}),
    mutedKeywords: Object.freeze({}),
    mutedThreads: Object.freeze({}),
    hiddenPosts: Object.freeze({}),
    labelPreferences: Object.freeze({}),
    appliedEventIds: Object.freeze(new Set<string>())
  });
}

export function labelPreferenceKey(namespace: string, labelKey: string): string {
  return `${namespace}::${labelKey}`;
}

function withRecordSet<T>(
  map: Readonly<Record<string, T>>,
  key: string,
  value: T
): Readonly<Record<string, T>> {
  // Spread first so adversarial-looking keys like `__proto__` land on a
  // fresh, plain object without altering the prototype chain.
  const next: Record<string, T> = { ...map };
  next[key] = value;
  return Object.freeze(next);
}

function withRecordDelete<T>(
  map: Readonly<Record<string, T>>,
  key: string
): Readonly<Record<string, T>> {
  if (!Object.prototype.hasOwnProperty.call(map, key)) return map;
  const next: Record<string, T> = { ...map };
  delete next[key];
  return Object.freeze(next);
}

function withAppliedEventId(
  ids: ReadonlySet<string>,
  eventId: string
): ReadonlySet<string> {
  if (ids.has(eventId)) return ids;
  const next = new Set(ids);
  next.add(eventId);
  return next;
}

// --- Apply ---------------------------------------------------------------

/**
 * Apply a single event to a state snapshot, returning a new frozen state.
 *
 * Determinism rules:
 *  - The same event applied twice produces the same state as applying it
 *    once (`appliedEventIds` guards against double-application on replay).
 *  - Applying an `apply` event installs an entry; applying a `revert` event
 *    removes the entry. Reverting a missing entry is a no-op except for
 *    recording the eventId.
 *  - Apply is pure: no IO, no clock reads, no random sources.
 *
 * The input is validated before any state mutation. Malformed payloads
 * throw without changing `state`.
 */
export function applyLocalControlEvent(
  state: LocalControlState,
  event: LocalControlEvent | unknown,
  label = 'applyLocalControlEvent'
): LocalControlState {
  const e = event instanceof Object && !(event instanceof Array)
    ? (validateLocalControlEvent(event, label) as LocalControlEvent)
    : (() => {
        throw tsError('TS_INVALID_INPUT', `${label}: event must be a plain object`);
      })();

  if (state.appliedEventIds.has(e.eventId)) {
    return state;
  }

  const nextAppliedEventIds = withAppliedEventId(state.appliedEventIds, e.eventId);

  switch (e.kind) {
    case 'safety.account.blocked': {
      const entry: BlockedActorEntry =
        e.reasonCode !== undefined
          ? Object.freeze({ since: e.createdAt, reasonCode: e.reasonCode })
          : Object.freeze({ since: e.createdAt });
      return Object.freeze({
        ...state,
        blockedActors:
          e.action === 'apply'
            ? withRecordSet(state.blockedActors, e.targetActorId, entry)
            : withRecordDelete(state.blockedActors, e.targetActorId),
        appliedEventIds: nextAppliedEventIds
      });
    }
    case 'safety.account.muted': {
      const entry: MutedActorEntry = Object.freeze({
        since: e.createdAt,
        muteScope: e.muteScope
      });
      return Object.freeze({
        ...state,
        mutedActors:
          e.action === 'apply'
            ? withRecordSet(state.mutedActors, e.targetActorId, entry)
            : withRecordDelete(state.mutedActors, e.targetActorId),
        appliedEventIds: nextAppliedEventIds
      });
    }
    case 'safety.domain.blocked': {
      const entry: BlockedDomainEntry =
        e.reasonCode !== undefined
          ? Object.freeze({ since: e.createdAt, reasonCode: e.reasonCode })
          : Object.freeze({ since: e.createdAt });
      return Object.freeze({
        ...state,
        blockedDomains:
          e.action === 'apply'
            ? withRecordSet(state.blockedDomains, e.domain, entry)
            : withRecordDelete(state.blockedDomains, e.domain),
        appliedEventIds: nextAppliedEventIds
      });
    }
    case 'safety.keyword.muted': {
      const key = e.keyword.toLowerCase();
      const entry: MutedKeywordEntry = Object.freeze({
        since: e.createdAt,
        keyword: e.keyword,
        matchKind: e.matchKind
      });
      return Object.freeze({
        ...state,
        mutedKeywords:
          e.action === 'apply'
            ? withRecordSet(state.mutedKeywords, key, entry)
            : withRecordDelete(state.mutedKeywords, key),
        appliedEventIds: nextAppliedEventIds
      });
    }
    case 'safety.thread.muted': {
      const entry: MutedThreadEntry = Object.freeze({ since: e.createdAt });
      return Object.freeze({
        ...state,
        mutedThreads:
          e.action === 'apply'
            ? withRecordSet(state.mutedThreads, e.threadId, entry)
            : withRecordDelete(state.mutedThreads, e.threadId),
        appliedEventIds: nextAppliedEventIds
      });
    }
    case 'safety.post.hidden': {
      const entry: HiddenPostEntry = Object.freeze({ since: e.createdAt });
      return Object.freeze({
        ...state,
        hiddenPosts:
          e.action === 'apply'
            ? withRecordSet(state.hiddenPosts, e.postEventId, entry)
            : withRecordDelete(state.hiddenPosts, e.postEventId),
        appliedEventIds: nextAppliedEventIds
      });
    }
    case 'safety.label.preference.set': {
      const key = labelPreferenceKey(e.namespace, e.labelKey);
      const entry: LabelPreferenceEntry = Object.freeze({
        since: e.createdAt,
        preference: e.preference
      });
      return Object.freeze({
        ...state,
        labelPreferences:
          e.action === 'apply'
            ? withRecordSet(state.labelPreferences, key, entry)
            : withRecordDelete(state.labelPreferences, key),
        appliedEventIds: nextAppliedEventIds
      });
    }
  }
}

/**
 * Replay a full event sequence from empty state. Equivalent to a left fold
 * of `applyLocalControlEvent`. Provided as a convenience because store
 * rebuild after reopen is the canonical use case.
 */
export function seedLocalControlState(
  events: Iterable<LocalControlEvent | unknown>,
  label = 'seedLocalControlState'
): LocalControlState {
  let state = createEmptyLocalControlState();
  let i = 0;
  for (const event of events) {
    state = applyLocalControlEvent(state, event, `${label}[${i}]`);
    i += 1;
  }
  return state;
}
