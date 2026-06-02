/**
 * Bounded TTL cache of idempotency keys for replay detection. Pure
 * data structure; the caller drives `now`.
 *
 * Threat model:
 *  - An attacker SHOULD NOT be able to flood the cache to OOM the
 *    bridge. Eviction is oldest-first with a hard capacity cap.
 *  - An attacker SHOULD NOT bypass replay detection by waiting just
 *    under the TTL — the TTL is a minimum lifetime, not a maximum.
 *    Entries are eligible for pruning *after* the TTL, not before.
 *  - The cache never reveals an idempotency key it has not seen — the
 *    `seen` result is purely "first-seen" vs "duplicate" with no
 *    information about other peers' traffic.
 */

import { tsError } from '../errors.js';
import { assertFiniteNumberInRange } from '../validation.js';

export type ReplayCacheConfig = Readonly<{
  /** Minimum lifetime of an entry in ms. */
  ttlMs: number;
  /** Maximum number of entries stored. Oldest-first eviction. */
  maxEntries: number;
}>;

export const DEFAULT_REPLAY_CACHE: ReplayCacheConfig = Object.freeze({
  ttlMs: 24 * 60 * 60 * 1_000, // 24 hours
  maxEntries: 100_000
});

export type ReplayCache = Readonly<{
  /** key -> insertion epoch ms. */
  entries: Readonly<Record<string, number>>;
  /** Ordered list of keys by insertion time, oldest first. */
  insertionOrder: ReadonlyArray<string>;
}>;

export function validateReplayCacheConfig(
  config: ReplayCacheConfig,
  label = 'ReplayCacheConfig'
): ReplayCacheConfig {
  assertFiniteNumberInRange(config.ttlMs, `${label}.ttlMs`, 1_000, 7 * 24 * 60 * 60 * 1_000);
  assertFiniteNumberInRange(config.maxEntries, `${label}.maxEntries`, 16, 100_000_000);
  if (!Number.isSafeInteger(config.maxEntries)) {
    throw tsError('TS_INVALID_NUMBER', `${label}.maxEntries must be a safe integer`);
  }
  return config;
}

export function createReplayCache(): ReplayCache {
  return Object.freeze({
    entries: Object.freeze({}),
    insertionOrder: Object.freeze([])
  });
}

export type ReplayResult = Readonly<{
  outcome: 'first-seen' | 'duplicate';
  cache: ReplayCache;
}>;

/**
 * Look up an idempotency key. If unseen (or expired), record it and
 * return `first-seen`. If already in the cache and not expired, return
 * `duplicate` without mutating the cache.
 *
 * Eviction:
 *  - Entries older than `ttlMs` are eligible for pruning. We prune
 *    lazily here: before insertion, drop any prefix of `insertionOrder`
 *    whose entries are older than now - ttlMs.
 *  - If the cache is at capacity after pruning, drop the oldest entry
 *    regardless of TTL.
 */
export function recordSeen(
  cache: ReplayCache,
  key: string,
  now: number,
  config: ReplayCacheConfig = DEFAULT_REPLAY_CACHE
): ReplayResult {
  const expiresAtBoundary = now - config.ttlMs;

  // Duplicate check first: an entry exists and is not expired -> duplicate.
  const existingTs = cache.entries[key];
  if (existingTs !== undefined && existingTs > expiresAtBoundary) {
    return Object.freeze({ outcome: 'duplicate', cache });
  }

  // Prune expired entries from the head of insertionOrder.
  let prunedOrder = cache.insertionOrder;
  let prunedEntries = cache.entries;
  let cutoff = 0;
  while (cutoff < prunedOrder.length) {
    const k = prunedOrder[cutoff]!;
    const ts = prunedEntries[k];
    if (ts !== undefined && ts <= expiresAtBoundary) {
      cutoff += 1;
      continue;
    }
    break;
  }
  if (cutoff > 0) {
    const tail = prunedOrder.slice(cutoff);
    const nextEntries: Record<string, number> = {};
    for (const k of tail) {
      const ts = prunedEntries[k];
      if (ts !== undefined) nextEntries[k] = ts;
    }
    prunedEntries = Object.freeze(nextEntries);
    prunedOrder = Object.freeze(tail);
  }

  // If still at or over capacity after TTL pruning, drop the oldest
  // entry regardless. This protects against attacker flooding within
  // the TTL window.
  if (prunedOrder.length >= config.maxEntries) {
    const overflow = prunedOrder.length - config.maxEntries + 1;
    const dropped = prunedOrder.slice(0, overflow);
    const kept = prunedOrder.slice(overflow);
    const nextEntries: Record<string, number> = { ...prunedEntries };
    for (const k of dropped) {
      delete nextEntries[k];
    }
    prunedEntries = Object.freeze(nextEntries);
    prunedOrder = Object.freeze(kept);
  }

  // Insert the new key (or refresh an expired one).
  const refreshedEntries: Record<string, number> = { ...prunedEntries };
  refreshedEntries[key] = now;
  // If the key was already in insertionOrder (expired entry), remove it first.
  const nextOrder = prunedOrder.includes(key)
    ? [...prunedOrder.filter((k) => k !== key), key]
    : [...prunedOrder, key];

  return Object.freeze({
    outcome: 'first-seen',
    cache: Object.freeze({
      entries: Object.freeze(refreshedEntries),
      insertionOrder: Object.freeze(nextOrder)
    })
  });
}

/**
 * Explicit prune step. Returns a cache with all expired entries removed.
 * Optional — `recordSeen` prunes lazily on each insert.
 */
export function pruneReplayCache(
  cache: ReplayCache,
  now: number,
  config: ReplayCacheConfig = DEFAULT_REPLAY_CACHE
): ReplayCache {
  const expiresAtBoundary = now - config.ttlMs;
  let cutoff = 0;
  while (cutoff < cache.insertionOrder.length) {
    const k = cache.insertionOrder[cutoff]!;
    const ts = cache.entries[k];
    if (ts !== undefined && ts <= expiresAtBoundary) {
      cutoff += 1;
      continue;
    }
    break;
  }
  if (cutoff === 0) return cache;
  const tail = cache.insertionOrder.slice(cutoff);
  const nextEntries: Record<string, number> = {};
  for (const k of tail) {
    const ts = cache.entries[k];
    if (ts !== undefined) nextEntries[k] = ts;
  }
  return Object.freeze({
    entries: Object.freeze(nextEntries),
    insertionOrder: Object.freeze(tail)
  });
}
