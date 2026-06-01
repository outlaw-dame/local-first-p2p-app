import { tsError } from '../errors.js';
import {
  assertExactVersion,
  assertId,
  assertIso8601,
  assertPlainObject
} from '../validation.js';
import type { LocalControlState } from './projection.js';
import { createEmptyLocalControlState } from './projection.js';

/**
 * Snapshot schema version. Bumping this is an ADR-level decision —
 * snapshots are the cross-app bootstrap path, and a major bump invalidates
 * every app's ability to import older snapshots until they update.
 */
export const LOCAL_CONTROL_SNAPSHOT_SCHEMA = 'lfp2p.local-control-snapshot.v1' as const;
export type LocalControlSnapshotSchema = typeof LOCAL_CONTROL_SNAPSHOT_SCHEMA;

/**
 * Canonical serializable snapshot of `LocalControlState`. Excludes
 * `appliedEventIds` (which is implementation detail, not portable
 * preference state) and includes the schema version so future apps can
 * refuse to import unsupported revisions.
 */
export type LocalControlSnapshot = Readonly<{
  schema: LocalControlSnapshotSchema;
  capturedAt: string;
  includesUpThroughEventId?: string;
  blockedActors: LocalControlState['blockedActors'];
  allowlistedActors: LocalControlState['allowlistedActors'];
  mutedActors: LocalControlState['mutedActors'];
  blockedDomains: LocalControlState['blockedDomains'];
  mutedKeywords: LocalControlState['mutedKeywords'];
  mutedThreads: LocalControlState['mutedThreads'];
  hiddenPosts: LocalControlState['hiddenPosts'];
  labelPreferences: LocalControlState['labelPreferences'];
  policyListSubscriptions: LocalControlState['policyListSubscriptions'];
  notificationPreferences: LocalControlState['notificationPreferences'];
}>;

/**
 * Produce a snapshot from the current state. The result is fully
 * serializable as JSON: no `Set`, no `Map`, no functions, no `undefined`
 * values inside arrays.
 *
 * Use this to wrap your state in a `safety.preferences.snapshot` event
 * so the user's other apps (signed into the same controller identity) can
 * subscribe to account-local sync and bootstrap from one message.
 */
export function exportPreferencesSnapshot(
  state: LocalControlState,
  options?: { capturedAt?: string; includesUpThroughEventId?: string }
): LocalControlSnapshot {
  const capturedAt = options?.capturedAt ?? new Date().toISOString();
  const out: Record<string, unknown> = {
    schema: LOCAL_CONTROL_SNAPSHOT_SCHEMA,
    capturedAt,
    blockedActors: state.blockedActors,
    allowlistedActors: state.allowlistedActors,
    mutedActors: state.mutedActors,
    blockedDomains: state.blockedDomains,
    mutedKeywords: state.mutedKeywords,
    mutedThreads: state.mutedThreads,
    hiddenPosts: state.hiddenPosts,
    labelPreferences: state.labelPreferences,
    policyListSubscriptions: state.policyListSubscriptions,
    notificationPreferences: state.notificationPreferences
  };
  if (options?.includesUpThroughEventId !== undefined) {
    out.includesUpThroughEventId = options.includesUpThroughEventId;
  }
  return Object.freeze(out) as LocalControlSnapshot;
}

/**
 * Validate the shape of a snapshot payload. Throws TS_INVALID_INPUT if
 * the schema is missing or unrecognized; this is fail-closed by design
 * since snapshot import overwrites state.
 */
export function validateLocalControlSnapshot(
  value: unknown,
  label = 'LocalControlSnapshot'
): LocalControlSnapshot {
  const record = assertPlainObject(value, label);
  assertExactVersion(record.schema, LOCAL_CONTROL_SNAPSHOT_SCHEMA, `${label}.schema`);
  assertIso8601(record.capturedAt as string, `${label}.capturedAt`);
  if (record.includesUpThroughEventId !== undefined) {
    assertId(record.includesUpThroughEventId, `${label}.includesUpThroughEventId`);
  }
  // The per-record bodies are validated structurally by the projection on
  // import (every entry is re-frozen). We only assert that each container
  // is a plain object here.
  for (const key of [
    'blockedActors',
    'allowlistedActors',
    'mutedActors',
    'blockedDomains',
    'mutedKeywords',
    'mutedThreads',
    'hiddenPosts',
    'labelPreferences',
    'policyListSubscriptions',
    'notificationPreferences'
  ]) {
    assertPlainObject(record[key], `${label}.${key}`);
  }
  return record as unknown as LocalControlSnapshot;
}

/**
 * Behavior options for snapshot import. The defaults are conservative:
 *
 *  - `mergeStrategy: 'union'` keeps existing entries when the same key
 *    exists in both the snapshot and the current state. The snapshot
 *    value wins for equal keys.
 *  - `mergeStrategy: 'replace'` discards the current state entirely.
 *  - `mergeStrategy: 'merge-newer-wins'` keeps whichever entry has the
 *    later `since` timestamp for each key.
 *
 * `preserveAppliedEventIds` defaults to true so an importing app does not
 * lose its own per-event idempotency state.
 */
export type SnapshotImportOptions = Readonly<{
  mergeStrategy?: 'union' | 'replace' | 'merge-newer-wins';
  preserveAppliedEventIds?: boolean;
}>;

type AnyEntry = Readonly<{ since: string }>;

function mergeRecord<T extends AnyEntry>(
  current: Readonly<Record<string, T>>,
  incoming: Readonly<Record<string, T>>,
  strategy: 'union' | 'replace' | 'merge-newer-wins'
): Readonly<Record<string, T>> {
  if (strategy === 'replace') return Object.freeze({ ...incoming });
  const out: Record<string, T> = { ...current };
  for (const key of Object.keys(incoming)) {
    const incomingEntry = incoming[key];
    if (incomingEntry === undefined) continue;
    if (strategy === 'union') {
      out[key] = incomingEntry;
      continue;
    }
    // merge-newer-wins
    const existing = out[key];
    if (existing === undefined) {
      out[key] = incomingEntry;
      continue;
    }
    const existingTime = Date.parse(existing.since);
    const incomingTime = Date.parse(incomingEntry.since);
    if (Number.isFinite(incomingTime) && incomingTime > existingTime) {
      out[key] = incomingEntry;
    }
  }
  return Object.freeze(out);
}

/**
 * Import a snapshot into the current state. By default this is a *union*
 * merge: incoming entries are applied and existing entries are kept. Use
 * `mergeStrategy: 'replace'` for a hard reset (e.g. an explicit user
 * "Restore from cloud").
 *
 * The result records `snapshotAppliedAt` so a higher layer can refuse to
 * re-import an older snapshot. The `appliedEventIds` set is preserved by
 * default so events that arrived before the snapshot do not double-apply.
 */
export function importPreferencesSnapshot(
  state: LocalControlState,
  snapshot: unknown,
  options?: SnapshotImportOptions,
  label = 'importPreferencesSnapshot'
): LocalControlState {
  const validated = validateLocalControlSnapshot(snapshot, label);
  const strategy: 'union' | 'replace' | 'merge-newer-wins' =
    options?.mergeStrategy ?? 'union';
  const preserveAppliedEventIds = options?.preserveAppliedEventIds ?? true;

  const base = strategy === 'replace' ? createEmptyLocalControlState() : state;

  return Object.freeze({
    ...base,
    blockedActors: mergeRecord(base.blockedActors, validated.blockedActors, strategy),
    allowlistedActors: mergeRecord(
      base.allowlistedActors,
      validated.allowlistedActors,
      strategy
    ),
    mutedActors: mergeRecord(base.mutedActors, validated.mutedActors, strategy),
    blockedDomains: mergeRecord(base.blockedDomains, validated.blockedDomains, strategy),
    mutedKeywords: mergeRecord(base.mutedKeywords, validated.mutedKeywords, strategy),
    mutedThreads: mergeRecord(base.mutedThreads, validated.mutedThreads, strategy),
    hiddenPosts: mergeRecord(base.hiddenPosts, validated.hiddenPosts, strategy),
    labelPreferences: mergeRecord(
      base.labelPreferences,
      validated.labelPreferences,
      strategy
    ),
    policyListSubscriptions: mergeRecord(
      base.policyListSubscriptions,
      validated.policyListSubscriptions,
      strategy
    ),
    notificationPreferences: mergeRecord(
      base.notificationPreferences as Readonly<Record<string, AnyEntry>>,
      validated.notificationPreferences as Readonly<Record<string, AnyEntry>>,
      strategy
    ) as LocalControlState['notificationPreferences'],
    appliedEventIds: preserveAppliedEventIds
      ? base.appliedEventIds
      : Object.freeze(new Set<string>()),
    snapshotAppliedAt: validated.capturedAt
  });
}

/**
 * Convenience: snapshot equality by structural comparison. Useful for
 * tests and for cross-app reconciliation.
 */
export function snapshotsEqual(a: LocalControlSnapshot, b: LocalControlSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Throw if the incoming snapshot is older than the already-applied one. */
export function assertSnapshotIsNotStale(
  state: LocalControlState,
  incomingCapturedAt: string,
  label = 'importPreferencesSnapshot'
): void {
  if (state.snapshotAppliedAt === undefined) return;
  const current = Date.parse(state.snapshotAppliedAt);
  const incoming = Date.parse(incomingCapturedAt);
  if (Number.isFinite(current) && Number.isFinite(incoming) && incoming < current) {
    throw tsError(
      'TS_INVALID_TIMESTAMP',
      `${label}: incoming snapshot capturedAt (${incomingCapturedAt}) is older than the currently applied snapshot (${state.snapshotAppliedAt})`
    );
  }
}
