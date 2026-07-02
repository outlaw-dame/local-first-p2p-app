/**
 * Phase 4.2 — Persistence for `TransportAdmissionState`.
 *
 * The Phase 4.1 wiring runs the trust-safety transport-admission
 * engine on every bridge delivery but holds the resulting state in
 * process memory only. A bridge restart loses every rate-limit
 * bucket, peer-reputation score, replay-cache entry, and quarantine
 * record — meaning an attacker can DoS a bridge until it restarts
 * and then resume with a fresh budget. This module closes that gap.
 *
 * Design discipline:
 *
 *  - **Snapshot, not event-log.** The Phase 1.64 audit log is FIFO-
 *    evicted at capacity, so it cannot serve as the source of truth
 *    for a startup replay. We persist the full state snapshot
 *    instead. The size is bounded by the engine's own per-field caps
 *    (replay-cache `maxEntries`, audit-log `capacity`, etc.).
 *
 *  - **Fail-closed.** A `save` failure (disk full, permission denied,
 *    serialization error) propagates upward; the gateway never
 *    silently advances state when persistence fails. The bridge
 *    that wraps the gateway then returns an admission rejection
 *    rather than admitting and losing the durable record.
 *
 *  - **Atomic on disk.** The `JsonFileAdmissionStateStore` writes to
 *    a sibling temp file then `fs.rename`s. POSIX guarantees rename
 *    is atomic on the same filesystem, so a crash mid-write either
 *    leaves the prior file intact or the new file fully in place —
 *    never a partial state. The temp-file name embeds the process
 *    id + a random suffix to avoid collisions across concurrent
 *    writers (though concurrent writers to the same bridge are not
 *    expected; the gateway docs already require sequential admit
 *    calls).
 *
 *  - **Refuses to start on corruption.** If a persisted state fails
 *    schema validation on load, the factory throws. The operator
 *    decides whether to delete the bad file (and restart with a
 *    clean budget) or recover it. We deliberately do NOT silently
 *    discard corrupted state — that would let an attacker who
 *    corrupted the file (or a buggy upgrade that produced an
 *    incompatible shape) gain a fresh budget every restart.
 *
 *  - **No Sets/Maps on the wire.** The only non-JSON-native type in
 *    `TransportAdmissionState` is `appliedEventIds: ReadonlySet<string>`.
 *    We serialize it as a sorted array and rehydrate as a frozen
 *    Set on load. Everything else is plain JSON.
 *
 *  - **Re-freezing on load.** The deserialized state is run through
 *    the same deep-freeze discipline as the in-memory projection
 *    (per Phase 3.2 invariant 2). The Phase 3.2 integrity test
 *    suite already pins that freeze invariant; a load that
 *    produced an unfrozen state would silently break it.
 */
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { TransportAdmissionState } from '@lfp2p/trust-safety';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface AdmissionStateStore {
  /**
   * Load the persisted state, or `undefined` if no state has been
   * persisted yet (cold-start).
   *
   * Throws when a persisted blob exists but is malformed. The factory
   * surfaces this so the operator decides whether to delete the bad
   * file (and restart with a clean budget) or to recover.
   */
  load(): Promise<TransportAdmissionState | undefined>;

  /**
   * Persist the new state atomically. Returns when the durable write
   * is visible to a subsequent `load`. Throws on any I/O or
   * serialization error. The caller MUST treat a throw as a hard
   * admission failure — the in-memory state and the persisted state
   * have diverged.
   */
  save(state: TransportAdmissionState): Promise<void>;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * On-disk shape. Pinned `version` so a future incompatible change is
 * a structural mismatch rather than a silent corruption.
 */
export const ADMISSION_STATE_SNAPSHOT_VERSION = 'lfp2p.admission-state-snapshot.v1' as const;

export type SerializedAdmissionState = Readonly<{
  version: typeof ADMISSION_STATE_SNAPSHOT_VERSION;
  state: Readonly<{
    peerReputation: TransportAdmissionState['peerReputation'];
    rateLimitState: TransportAdmissionState['rateLimitState'];
    replayCache: TransportAdmissionState['replayCache'];
    quarantinedPeers: TransportAdmissionState['quarantinedPeers'];
    quarantinedEvents: TransportAdmissionState['quarantinedEvents'];
    quarantinedMedia: TransportAdmissionState['quarantinedMedia'];
    auditLog: TransportAdmissionState['auditLog'];
    /** Set serialized as a sorted array. Sorted for deterministic byte output. */
    appliedEventIds: ReadonlyArray<string>;
  }>;
}>;

export function serializeAdmissionState(state: TransportAdmissionState): SerializedAdmissionState {
  return Object.freeze({
    version: ADMISSION_STATE_SNAPSHOT_VERSION,
    state: Object.freeze({
      peerReputation: state.peerReputation,
      rateLimitState: state.rateLimitState,
      replayCache: state.replayCache,
      quarantinedPeers: state.quarantinedPeers,
      quarantinedEvents: state.quarantinedEvents,
      quarantinedMedia: state.quarantinedMedia,
      auditLog: state.auditLog,
      appliedEventIds: Object.freeze([...state.appliedEventIds].sort())
    })
  });
}

/**
 * Deep-freeze a plain-object tree. Mirrors the discipline pinned by
 * the Phase 3.2 integrity suite: every nested object/array is
 * `Object.isFrozen`. Sets and Maps are treated as opaque leaves and
 * frozen by reference.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  if (value instanceof Set || value instanceof Map) {
    Object.freeze(value);
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  Object.freeze(value);
  return value;
}

export class AdmissionStateCorruptError extends Error {
  constructor(detail: string) {
    super(`Persisted admission state is corrupt: ${detail}`);
    this.name = 'AdmissionStateCorruptError';
  }
}

export function deserializeAdmissionState(raw: unknown): TransportAdmissionState {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AdmissionStateCorruptError('snapshot is not a plain object');
  }
  const snapshot = raw as Partial<SerializedAdmissionState>;
  if (snapshot.version !== ADMISSION_STATE_SNAPSHOT_VERSION) {
    throw new AdmissionStateCorruptError(
      `version "${String(snapshot.version)}" is not "${ADMISSION_STATE_SNAPSHOT_VERSION}"`
    );
  }
  const s = snapshot.state;
  if (s === null || typeof s !== 'object' || Array.isArray(s)) {
    throw new AdmissionStateCorruptError('snapshot.state is not a plain object');
  }
  for (const field of [
    'peerReputation',
    'rateLimitState',
    'replayCache',
    'quarantinedPeers',
    'quarantinedEvents',
    'quarantinedMedia',
    'auditLog',
    'appliedEventIds'
  ] as const) {
    if (!(field in s)) {
      throw new AdmissionStateCorruptError(`snapshot.state.${field} is missing`);
    }
  }
  const appliedEventIds = s.appliedEventIds;
  if (!Array.isArray(appliedEventIds)) {
    throw new AdmissionStateCorruptError('snapshot.state.appliedEventIds must be an array');
  }
  for (const id of appliedEventIds) {
    if (typeof id !== 'string') {
      throw new AdmissionStateCorruptError(
        'snapshot.state.appliedEventIds must contain strings only'
      );
    }
  }
  const hydrated: TransportAdmissionState = deepFreeze({
    peerReputation: s.peerReputation,
    rateLimitState: s.rateLimitState,
    replayCache: s.replayCache,
    quarantinedPeers: s.quarantinedPeers,
    quarantinedEvents: s.quarantinedEvents,
    quarantinedMedia: s.quarantinedMedia,
    auditLog: s.auditLog,
    appliedEventIds: Object.freeze(new Set(appliedEventIds))
  } as TransportAdmissionState);
  return hydrated;
}

// ---------------------------------------------------------------------------
// In-memory store (testing)
// ---------------------------------------------------------------------------

/**
 * For tests and ephemeral deployments. Round-trips through the same
 * serialize/deserialize path as the file store so a serializer bug
 * surfaces in either implementation.
 */
export class InMemoryAdmissionStateStore implements AdmissionStateStore {
  #blob: SerializedAdmissionState | undefined;
  /**
   * Test hook: when set, the next `save` invocation throws this
   * error before mutating internal state. Lets the gateway tests
   * exercise the fail-closed contract without needing a real disk
   * failure.
   */
  failNextSaveWith: Error | undefined = undefined;

  async load(): Promise<TransportAdmissionState | undefined> {
    if (this.#blob === undefined) return undefined;
    return deserializeAdmissionState(this.#blob);
  }

  async save(state: TransportAdmissionState): Promise<void> {
    if (this.failNextSaveWith !== undefined) {
      const err = this.failNextSaveWith;
      this.failNextSaveWith = undefined;
      throw err;
    }
    this.#blob = serializeAdmissionState(state);
  }

  /** For tests that want to inspect what was persisted. */
  inspect(): SerializedAdmissionState | undefined {
    return this.#blob;
  }
}

// ---------------------------------------------------------------------------
// JSON-file store (production-ready)
// ---------------------------------------------------------------------------

export type JsonFileAdmissionStateStoreOptions = Readonly<{
  /** Absolute path to the snapshot file. */
  filePath: string;
  /**
   * Optional process id suffix for the temp file (default: random
   * hex). Tests use a fixed value for reproducible filenames.
   */
  tempSuffix?: string;
}>;

/**
 * Persists the snapshot to a JSON file using temp-file-then-rename
 * for atomicity. The temp file lives in the same directory as the
 * target so `rename` is a same-filesystem operation (POSIX
 * guarantees atomicity only on the same filesystem).
 *
 * The store does not perform any concurrency control beyond
 * temp-file isolation: it is the caller's responsibility to
 * serialize `admit` calls. The gateway docs already require this.
 */
export class JsonFileAdmissionStateStore implements AdmissionStateStore {
  readonly #filePath: string;
  readonly #tempSuffix: string;

  constructor(options: JsonFileAdmissionStateStoreOptions) {
    if (typeof options.filePath !== 'string' || options.filePath.length === 0) {
      throw new TypeError('JsonFileAdmissionStateStore: filePath is required');
    }
    this.#filePath = options.filePath;
    this.#tempSuffix = options.tempSuffix ?? Math.random().toString(16).slice(2, 10);
  }

  async load(): Promise<TransportAdmissionState | undefined> {
    let text: string;
    try {
      text = await readFile(this.#filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new AdmissionStateCorruptError(`invalid JSON (${(err as Error).message})`);
    }
    return deserializeAdmissionState(parsed);
  }

  async save(state: TransportAdmissionState): Promise<void> {
    const serialized = serializeAdmissionState(state);
    // JSON.stringify on a frozen object is a value-only read; no
    // proxy magic, no side effects.
    const json = JSON.stringify(serialized);
    const dir = dirname(this.#filePath);
    const tempPath = `${this.#filePath}.${process.pid}.${this.#tempSuffix}.tmp`;
    // Write to temp, then rename. The intermediate temp file is
    // never read by load(); if it gets orphaned (process crash mid-
    // write before rename) it stays in the directory but does not
    // affect the durable snapshot. A future janitor could clean it
    // up; we do not run one here to avoid concurrent-deletion races
    // with another writer's temp file.
    void dir; // dir is informational; rename keeps things on the same fs by design
    await writeFile(tempPath, json, { encoding: 'utf8', mode: 0o600 });
    await rename(tempPath, this.#filePath);
  }
}

// ---------------------------------------------------------------------------
// Test-only utilities (exported for test ergonomics)
// ---------------------------------------------------------------------------

/**
 * Create a unique temp directory and return its path. Used by tests
 * that want a clean directory for the JSON-file store.
 */
export async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** Remove a directory tree. Tests call this in their finally blocks. */
export async function removeDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

/**
 * Optional small backoff used by tests that need to wait for the
 * filesystem to settle between writes (e.g. when verifying atomicity
 * across multiple writes on platforms with looser fsync semantics).
 * Pure delay; no retry loop here.
 */
export const settleFs = (ms = 0): Promise<void> => delay(ms);
