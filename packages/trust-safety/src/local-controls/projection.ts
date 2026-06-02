import type { DigestRef } from '@lfp2p/content-addressing';
import { tsError } from '../errors.js';
import {
  withFrozenAppliedEventId as withAppliedEventId,
  withFrozenRecordDelete as withRecordDelete,
  withFrozenRecordSet as withRecordSet
} from '../projection-helpers.js';
import type {
  AccountMuteScope,
  KeywordMatchKind,
  LabelPreferenceAction,
  LocalControlEvent,
  NotificationChannel,
  NotificationPreference,
  PolicyListKind,
  PolicyListTrustLevel
} from './events.js';
import { validateLocalControlEvent } from './events.js';

// --- Entry shapes --------------------------------------------------------

type ExpiringEntry = Readonly<{ expiresAt?: string }>;

export type BlockedActorEntry = Readonly<ExpiringEntry & {
  since: string;
  reasonCode?: string;
}>;

export type AllowlistedActorEntry = Readonly<ExpiringEntry & {
  since: string;
  reasonCode?: string;
}>;

export type MutedActorEntry = Readonly<ExpiringEntry & {
  since: string;
  muteScope: AccountMuteScope;
}>;

export type BlockedDomainEntry = Readonly<ExpiringEntry & {
  since: string;
  reasonCode?: string;
}>;

export type MutedKeywordEntry = Readonly<ExpiringEntry & {
  since: string;
  keyword: string;
  matchKind: KeywordMatchKind;
  embeddingRef?: DigestRef;
  embeddingModel?: string;
  similarityThreshold?: number;
}>;

export type MutedThreadEntry = Readonly<ExpiringEntry & { since: string }>;

export type HiddenPostEntry = Readonly<ExpiringEntry & { since: string }>;

export type LabelPreferenceEntry = Readonly<ExpiringEntry & {
  since: string;
  preference: LabelPreferenceAction;
}>;

export type PolicyListSubscriptionEntry = Readonly<ExpiringEntry & {
  since: string;
  issuerActorId: string;
  allowedKinds: ReadonlyArray<PolicyListKind>;
  trustLevel: PolicyListTrustLevel;
}>;

export type NotificationPreferenceEntry = Readonly<ExpiringEntry & {
  since: string;
  preference: NotificationPreference;
}>;

// --- State ---------------------------------------------------------------

/**
 * Snapshot of local-control state produced by replaying a sequence of
 * `LocalControlEvent`s. The shape is intentionally serializable so:
 *
 *  1. a downstream layer can persist it as-is in a local store and rebuild
 *     it deterministically from the event log on store reopen, and
 *  2. it can be wrapped in a `safety.preferences.snapshot` event for
 *     cross-app bootstrap on the user's other apps (the canonical
 *     answer to the "Nostr preferences scatter" problem).
 *
 * Expiry is read-only metadata; the projection does not prune expired
 * entries. The selector consults `now` when deciding whether to apply an
 * entry, so expiration is fully deterministic and pure.
 */
export type LocalControlState = Readonly<{
  blockedActors: Readonly<Record<string, BlockedActorEntry>>;
  allowlistedActors: Readonly<Record<string, AllowlistedActorEntry>>;
  mutedActors: Readonly<Record<string, MutedActorEntry>>;
  blockedDomains: Readonly<Record<string, BlockedDomainEntry>>;
  mutedKeywords: Readonly<Record<string, MutedKeywordEntry>>;
  mutedThreads: Readonly<Record<string, MutedThreadEntry>>;
  hiddenPosts: Readonly<Record<string, HiddenPostEntry>>;
  labelPreferences: Readonly<Record<string, LabelPreferenceEntry>>;
  policyListSubscriptions: Readonly<Record<string, PolicyListSubscriptionEntry>>;
  notificationPreferences: Readonly<
    Partial<Record<NotificationChannel, NotificationPreferenceEntry>>
  >;
  appliedEventIds: ReadonlySet<string>;
  snapshotAppliedAt?: string;
}>;

/** Build an empty, frozen state. */
export function createEmptyLocalControlState(): LocalControlState {
  return Object.freeze({
    blockedActors: Object.freeze({}),
    allowlistedActors: Object.freeze({}),
    mutedActors: Object.freeze({}),
    blockedDomains: Object.freeze({}),
    mutedKeywords: Object.freeze({}),
    mutedThreads: Object.freeze({}),
    hiddenPosts: Object.freeze({}),
    labelPreferences: Object.freeze({}),
    policyListSubscriptions: Object.freeze({}),
    notificationPreferences: Object.freeze({}),
    appliedEventIds: Object.freeze(new Set<string>())
  });
}

export function labelPreferenceKey(namespace: string, labelKey: string): string {
  return `${namespace}::${labelKey}`;
}

function attachSinceAndExpiry<E extends ExpiringEntry & { since: string }>(
  base: Omit<E, 'since' | 'expiresAt'>,
  since: string,
  expiresAt: string | undefined
): E {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>), since };
  if (expiresAt !== undefined) out.expiresAt = expiresAt;
  return Object.freeze(out) as E;
}

// --- Apply ---------------------------------------------------------------

/**
 * Apply a single event to a state snapshot, returning a new frozen state.
 *
 * Determinism rules:
 *  - Applying the same event twice produces the same state as applying it
 *    once (`appliedEventIds` guards against double-application on replay).
 *  - `apply` events install entries; `revert` events remove them.
 *  - Reverting a missing entry is a no-op except for recording the eventId.
 *  - Apply is pure: no IO, no clock reads, no random sources.
 *  - The input is validated before any state mutation. Malformed payloads
 *    throw without changing `state`.
 *  - `safety.preferences.snapshot` events are rejected here on purpose —
 *    snapshot import is an explicit operation via
 *    `./snapshot.ts#importPreferencesSnapshot`, so a stray snapshot event
 *    in an event log cannot silently overwrite user state.
 */
export function applyLocalControlEvent(
  state: LocalControlState,
  event: LocalControlEvent | unknown,
  label = 'applyLocalControlEvent'
): LocalControlState {
  if (
    event === null ||
    typeof event !== 'object' ||
    Array.isArray(event)
  ) {
    throw tsError('TS_INVALID_INPUT', `${label}: event must be a plain object`);
  }
  const e = validateLocalControlEvent(event, label);

  if (state.appliedEventIds.has(e.eventId)) {
    return state;
  }

  const nextAppliedEventIds = withAppliedEventId(state.appliedEventIds, e.eventId);

  switch (e.kind) {
    case 'safety.account.blocked': {
      const entry = attachSinceAndExpiry<BlockedActorEntry>(
        e.reasonCode !== undefined ? { reasonCode: e.reasonCode } : {},
        e.createdAt,
        e.expiresAt
      );
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
      const entry = attachSinceAndExpiry<MutedActorEntry>(
        { muteScope: e.muteScope },
        e.createdAt,
        e.expiresAt
      );
      return Object.freeze({
        ...state,
        mutedActors:
          e.action === 'apply'
            ? withRecordSet(state.mutedActors, e.targetActorId, entry)
            : withRecordDelete(state.mutedActors, e.targetActorId),
        appliedEventIds: nextAppliedEventIds
      });
    }
    case 'safety.account.allowlisted': {
      const entry = attachSinceAndExpiry<AllowlistedActorEntry>(
        e.reasonCode !== undefined ? { reasonCode: e.reasonCode } : {},
        e.createdAt,
        e.expiresAt
      );
      return Object.freeze({
        ...state,
        allowlistedActors:
          e.action === 'apply'
            ? withRecordSet(state.allowlistedActors, e.targetActorId, entry)
            : withRecordDelete(state.allowlistedActors, e.targetActorId),
        appliedEventIds: nextAppliedEventIds
      });
    }
    case 'safety.domain.blocked': {
      const entry = attachSinceAndExpiry<BlockedDomainEntry>(
        e.reasonCode !== undefined ? { reasonCode: e.reasonCode } : {},
        e.createdAt,
        e.expiresAt
      );
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
      const base: Omit<MutedKeywordEntry, 'since' | 'expiresAt'> = {
        keyword: e.keyword,
        matchKind: e.matchKind,
        ...(e.embeddingRef !== undefined ? { embeddingRef: e.embeddingRef } : {}),
        ...(e.embeddingModel !== undefined ? { embeddingModel: e.embeddingModel } : {}),
        ...(e.similarityThreshold !== undefined
          ? { similarityThreshold: e.similarityThreshold }
          : {})
      };
      const entry = attachSinceAndExpiry<MutedKeywordEntry>(base, e.createdAt, e.expiresAt);
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
      const entry = attachSinceAndExpiry<MutedThreadEntry>({}, e.createdAt, e.expiresAt);
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
      const entry = attachSinceAndExpiry<HiddenPostEntry>({}, e.createdAt, e.expiresAt);
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
      const entry = attachSinceAndExpiry<LabelPreferenceEntry>(
        { preference: e.preference },
        e.createdAt,
        e.expiresAt
      );
      return Object.freeze({
        ...state,
        labelPreferences:
          e.action === 'apply'
            ? withRecordSet(state.labelPreferences, key, entry)
            : withRecordDelete(state.labelPreferences, key),
        appliedEventIds: nextAppliedEventIds
      });
    }
    case 'safety.policy-list.subscribed': {
      const entry = attachSinceAndExpiry<PolicyListSubscriptionEntry>(
        {
          issuerActorId: e.issuerActorId,
          allowedKinds: e.allowedKinds,
          trustLevel: e.trustLevel
        },
        e.createdAt,
        e.expiresAt
      );
      return Object.freeze({
        ...state,
        policyListSubscriptions:
          e.action === 'apply'
            ? withRecordSet(state.policyListSubscriptions, e.policyListId, entry)
            : withRecordDelete(state.policyListSubscriptions, e.policyListId),
        appliedEventIds: nextAppliedEventIds
      });
    }
    case 'safety.policy-list.unsubscribed': {
      // Unsubscription always removes regardless of `action`; the user
      // action is explicit and a sync-ordering revert cannot bring it back.
      return Object.freeze({
        ...state,
        policyListSubscriptions: withRecordDelete(
          state.policyListSubscriptions,
          e.policyListId
        ),
        appliedEventIds: nextAppliedEventIds
      });
    }
    case 'safety.notification-preference.set': {
      const entry = attachSinceAndExpiry<NotificationPreferenceEntry>(
        { preference: e.preference },
        e.createdAt,
        e.expiresAt
      );
      const current = state.notificationPreferences as Readonly<
        Record<string, NotificationPreferenceEntry>
      >;
      const next = e.action === 'apply'
        ? withRecordSet(current, e.channel, entry)
        : withRecordDelete(current, e.channel);
      return Object.freeze({
        ...state,
        notificationPreferences: next as Readonly<
          Partial<Record<NotificationChannel, NotificationPreferenceEntry>>
        >,
        appliedEventIds: nextAppliedEventIds
      });
    }
    case 'safety.preferences.snapshot': {
      throw tsError(
        'TS_INVALID_INPUT',
        `${label}: safety.preferences.snapshot must be applied via importPreferencesSnapshot, not applyLocalControlEvent`
      );
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

/** Returns true if an entry has expired at the given `now` (epoch ms). */
export function isExpired(entry: ExpiringEntry, now: number): boolean {
  return entry.expiresAt !== undefined && Date.parse(entry.expiresAt) < now;
}

/**
 * Compact the state by removing entries whose `expiresAt` is strictly
 * before `now`. Pure; the original state is unchanged. This is an
 * *optional* optimization for callers that want to keep state small.
 * The selector already ignores expired entries, so correctness does not
 * depend on calling this function.
 */
export function pruneExpiredLocalControlState(
  state: LocalControlState,
  now: number = Date.now()
): LocalControlState {
  function pruneRecord<T extends ExpiringEntry>(
    record: Readonly<Record<string, T>>
  ): Readonly<Record<string, T>> {
    let changed = false;
    const next: Record<string, T> = {};
    for (const key of Object.keys(record)) {
      const entry = record[key];
      if (entry === undefined) continue;
      if (isExpired(entry, now)) {
        changed = true;
        continue;
      }
      next[key] = entry;
    }
    return changed ? Object.freeze(next) : record;
  }

  const prunedNotif = pruneRecord(
    state.notificationPreferences as Readonly<Record<string, NotificationPreferenceEntry>>
  ) as Readonly<Partial<Record<NotificationChannel, NotificationPreferenceEntry>>>;

  return Object.freeze({
    ...state,
    blockedActors: pruneRecord(state.blockedActors),
    allowlistedActors: pruneRecord(state.allowlistedActors),
    mutedActors: pruneRecord(state.mutedActors),
    blockedDomains: pruneRecord(state.blockedDomains),
    mutedKeywords: pruneRecord(state.mutedKeywords),
    mutedThreads: pruneRecord(state.mutedThreads),
    hiddenPosts: pruneRecord(state.hiddenPosts),
    labelPreferences: pruneRecord(state.labelPreferences),
    policyListSubscriptions: pruneRecord(state.policyListSubscriptions),
    notificationPreferences: prunedNotif
  });
}
