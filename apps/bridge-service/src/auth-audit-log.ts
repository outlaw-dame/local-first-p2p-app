/**
 * Phase 4.5 — Auth audit log.
 *
 * Captures accepted, rejected, and expired authentication attempts at
 * the bridge HTTP layer. Design discipline:
 *
 *  - Phase 3.1 redaction: `tokenIdPrefix` is the first 8 chars of the
 *    configured `tokenId` metadata — NOT a hash prefix, NOT the
 *    plaintext credential. Only populated when a configured token was
 *    matched (accepted or expired); unmatched rejections carry no
 *    prefix so we never log a derivative of the presented secret.
 *  - Bounded FIFO: when capacity is reached the oldest entry is
 *    evicted before the new one is appended. Prevents unbounded
 *    memory growth on long-lived bridges under sustained auth pressure.
 *  - Optional persistence via `JsonFileAuthAuditStore`. The file is
 *    NOT written atomically (append semantics; acceptable because audit
 *    logs are append-only and partial writes are recoverable). A
 *    production deployment that needs strict durability should ship
 *    the log to an external SIEM instead.
 *  - `clientIp` is optional and operator-local only — never forwarded
 *    to any external service.
 */
import { appendFile, readFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthAuditOutcome = 'accepted' | 'rejected' | 'expired';

export type AuthAuditRecord = Readonly<{
  timestamp: string;
  /**
   * First 8 chars of the configured `tokenId` (never a hash prefix,
   * never the plaintext bearer). Only present when a configured token
   * was identified. Absent for unmatched rejections (unknown bearer,
   * missing header, malformed auth).
   */
  tokenIdPrefix?: string;
  outcome: AuthAuditOutcome;
  /** Present only when the caller supplies it; operator-local. */
  clientIp?: string;
  requestPath: string;
}>;

// ---------------------------------------------------------------------------
// In-process FIFO
// ---------------------------------------------------------------------------

const DEFAULT_CAPACITY = 10_000;

export interface AuthAuditStore {
  /** Append a serialized record. Called after every auth decision. */
  append(record: AuthAuditRecord): Promise<void>;
  /** Cold-start load: returns all stored records (optional; may return []). */
  load(): Promise<ReadonlyArray<AuthAuditRecord>>;
}

export type AuthAuditLogOptions = Readonly<{
  capacity?: number;
  store?: AuthAuditStore;
}>;

export class AuthAuditLog {
  readonly #capacity: number;
  readonly #store: AuthAuditStore | undefined;
  readonly #entries: AuthAuditRecord[] = [];

  constructor(options: AuthAuditLogOptions = {}) {
    this.#capacity = options.capacity ?? DEFAULT_CAPACITY;
    this.#store = options.store;
  }

  /**
   * Record an auth decision. Evicts the oldest entry if capacity is
   * reached BEFORE appending the new one (FIFO).
   *
   * The store write is best-effort: a failing store write is caught
   * and does not surface to the caller — audit logs MUST NOT block
   * the request path.
   */
  record(record: AuthAuditRecord): void {
    if (this.#entries.length >= this.#capacity) {
      this.#entries.shift();
    }
    this.#entries.push(Object.freeze({ ...record }));
    if (this.#store !== undefined) {
      void this.#store.append(record).catch(() => {
        // Best-effort; audit store failures never surface to callers.
      });
    }
  }

  /** Read-only snapshot. Oldest first. */
  entries(): ReadonlyArray<AuthAuditRecord> {
    return Object.freeze([...this.#entries]);
  }

  get size(): number {
    return this.#entries.length;
  }
}

// ---------------------------------------------------------------------------
// JSON-lines file store
// ---------------------------------------------------------------------------

export type JsonFileAuthAuditStoreOptions = Readonly<{
  filePath: string;
}>;

/**
 * Appends one JSON-line per audit record. Append-only; no atomic
 * rename needed. A crash mid-line leaves a truncated line at the end
 * of the file; `load()` skips non-parseable lines rather than
 * refusing to start (acceptable for an audit log — unlike the
 * admission state store, a partial line doesn't corrupt earlier
 * records).
 */
export class JsonFileAuthAuditStore implements AuthAuditStore {
  readonly #filePath: string;

  constructor(options: JsonFileAuthAuditStoreOptions) {
    if (typeof options.filePath !== 'string' || options.filePath.length === 0) {
      throw new TypeError('JsonFileAuthAuditStore: filePath is required');
    }
    this.#filePath = options.filePath;
  }

  async append(record: AuthAuditRecord): Promise<void> {
    await appendFile(this.#filePath, JSON.stringify(record) + '\n', {
      encoding: 'utf8',
      mode: 0o600
    });
  }

  async load(): Promise<ReadonlyArray<AuthAuditRecord>> {
    let text: string;
    try {
      text = await readFile(this.#filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return Object.freeze([]);
      throw err;
    }
    const results: AuthAuditRecord[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        results.push(JSON.parse(trimmed) as AuthAuditRecord);
      } catch {
        // Partial/corrupted line — skip silently (audit log resilience).
      }
    }
    return Object.freeze(results);
  }
}
