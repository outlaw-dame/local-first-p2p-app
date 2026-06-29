/**
 * Phase 4.3 — HTTP-layer hardening for the bridge endpoint.
 *
 * Defends the cheap-to-attack surface BEFORE delivery reaches the
 * (more expensive) admission engine: request body size cap, bearer
 * token auth with multi-token registry + expiry + constant-time
 * comparison, per-token rate limiting with RFC 7235 `WWW-Authenticate`
 * and RFC 7231 `Retry-After` headers.
 *
 * Design discipline:
 *
 *  - **No primitive duplication.** The per-token rate limiter is
 *    built on the engine's `createRateLimitBucket` + `tryConsume`
 *    (Phase 1.64). Exponential backoff and self-healing semantics
 *    are identical to the admission engine's per-peer limiter.
 *
 *  - **Privacy-safe responses (Phase 3.1).** The HTTP layer never
 *    distinguishes "no token" / "wrong token" / "expired token" /
 *    "rate-limited" in the response BODY — all return a generic
 *    JSON `{ status: "rejected", reason: "Unauthorized" | "Too Many
 *    Requests" | "Payload Too Large" }`. The HTTP status code is
 *    the only signal a probing client receives, and we deliberately
 *    use the standard codes (401, 429, 413) so no fingerprinting
 *    oracle is created.
 *
 *  - **Constant-time token comparison.** Existing service.ts
 *    `constantTimeEqual` is reused via local re-implementation
 *    so the module can stand alone without circular imports.
 *
 *  - **Streaming size cap.** A client that omits or lies about
 *    `Content-Length` cannot defeat the cap: we ALSO accumulate
 *    incoming bytes and abort when the limit is exceeded.
 *
 *  - **Fail-closed on misconfiguration.** Both `authorizeRequest`
 *    and the rate-limiter return a documented disposition; never
 *    a silent pass.
 */
import { rename, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import {
  createRateLimitBucket,
  tryConsume,
  type RateLimitBucket,
  type RateLimitConfig
} from '@lfp2p/trust-safety';
import type {
  BridgeHttpAuthConfig,
  BridgeHttpAuthConfigMulti,
  BridgeHttpRateLimiterHandle
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default body size cap. Matches the bridge admission engine's
 * `DEFAULT_MAX_BYTES_BY_SURFACE.bridge` so the HTTP layer rejects
 * before the admission engine would have anyway, saving the parse
 * and the admission-budget consumption.
 */
export const DEFAULT_MAX_REQUEST_BYTES = 1 * 1024 * 1024;

/** Hard ceiling. Configured caps above this throw at registration time. */
export const ABSOLUTE_MAX_REQUEST_BYTES = 64 * 1024 * 1024;

/** Per RFC 6750 §3. */
const WWW_AUTHENTICATE_HEADER = 'WWW-Authenticate';
const WWW_AUTHENTICATE_VALUE = 'Bearer realm="lfp2p-bridge"';

/** Per RFC 7231 §7.1.3. Always emitted on 429. */
const RETRY_AFTER_HEADER = 'Retry-After';

const AUTHORIZATION_HEADER = 'authorization';
const BEARER_AUTH_PREFIX = 'Bearer ';
const MAX_BRIDGE_AUTH_TOKEN_LENGTH = 4_096;
const MAX_AUTH_TOKEN_ID_LENGTH = 256;

// ---------------------------------------------------------------------------
// Auth registry
// ---------------------------------------------------------------------------

export type AuthorizationOutcome =
  | Readonly<{ status: 'authorized'; tokenId: string }>
  | Readonly<{ status: 'unauthorized' }>
  | Readonly<{ status: 'misconfigured' }>;

/**
 * Normalize the legacy single-token shape and the multi-token shape
 * into the same internal representation. Validates each token.
 * Throws on misconfiguration (caller surfaces a 500); does NOT
 * throw on a request-time auth failure (those are 401).
 */
export function normalizeAuthConfig(
  auth: BridgeHttpAuthConfig
): BridgeHttpAuthConfigMulti {
  if (auth.scheme !== 'bearer') {
    throw new TypeError(`Unsupported auth scheme: ${String(auth.scheme)}`);
  }
  // Legacy single-token shape becomes a 1-entry registry with a stable id.
  if ('token' in auth) {
    if (!isValidBridgeAuthToken(auth.token)) {
      throw new TypeError('BridgeHttpAuthConfig.token is invalid');
    }
    return Object.freeze({
      scheme: 'bearer',
      tokens: Object.freeze([
        Object.freeze({ id: '__legacy__', token: auth.token })
      ])
    });
  }
  // Multi-token shape: validate every entry.
  if (!Array.isArray(auth.tokens) || auth.tokens.length === 0) {
    throw new TypeError('BridgeHttpAuthConfig.tokens must be a non-empty array');
  }
  const seenIds = new Set<string>();
  for (const t of auth.tokens) {
    if (typeof t.id !== 'string' || t.id.length === 0 || t.id.length > MAX_AUTH_TOKEN_ID_LENGTH) {
      throw new TypeError('BridgeAuthToken.id must be 1-256 chars');
    }
    if (seenIds.has(t.id)) {
      throw new TypeError(`Duplicate BridgeAuthToken.id: "${t.id}"`);
    }
    seenIds.add(t.id);
    if (!isValidBridgeAuthToken(t.token)) {
      throw new TypeError(`BridgeAuthToken[id=${t.id}].token is invalid`);
    }
    if (t.expiresAt !== undefined && !Number.isFinite(Date.parse(t.expiresAt))) {
      throw new TypeError(`BridgeAuthToken[id=${t.id}].expiresAt is not ISO-8601`);
    }
  }
  return Object.freeze({ scheme: 'bearer', tokens: Object.freeze([...auth.tokens]) });
}

/**
 * Returns the outcome of authorizing `request` against `auth`. The
 * outcome is `unauthorized` for every failure case (no header,
 * non-bearer scheme, unknown token, expired token, etc.) so the
 * caller cannot fingerprint the registry by probing.
 */
export function authorizeRequest(
  request: Request,
  auth: BridgeHttpAuthConfigMulti | undefined,
  nowMs: number
): AuthorizationOutcome {
  // No auth config = open bridge. The caller decides whether this is
  // acceptable; we surface it as authorized with a sentinel id so
  // downstream rate-limit can still key by id if desired.
  if (auth === undefined) return Object.freeze({ status: 'authorized', tokenId: '__anonymous__' });

  const header = request.headers.get(AUTHORIZATION_HEADER);
  if (
    header === null ||
    header.slice(0, BEARER_AUTH_PREFIX.length).toLowerCase() !==
      BEARER_AUTH_PREFIX.toLowerCase()
  ) {
    return Object.freeze({ status: 'unauthorized' });
  }
  const presented = header.slice(BEARER_AUTH_PREFIX.length);
  if (!isValidBridgeAuthToken(presented)) {
    return Object.freeze({ status: 'unauthorized' });
  }

  // Compare against EVERY token in the registry in constant time —
  // even when the first matches — so a timing oracle cannot reveal
  // registry size or position. The match-side branch picks up the
  // tokenId for the downstream layers.
  let matchedTokenId: string | undefined;
  for (const t of auth.tokens) {
    const isMatch = constantTimeEqual(presented, t.token);
    const notExpired =
      t.expiresAt === undefined || Date.parse(t.expiresAt) > nowMs;
    if (isMatch && notExpired && matchedTokenId === undefined) {
      matchedTokenId = t.id;
    }
  }
  if (matchedTokenId === undefined) {
    return Object.freeze({ status: 'unauthorized' });
  }
  return Object.freeze({ status: 'authorized', tokenId: matchedTokenId });
}

function isValidBridgeAuthToken(token: unknown): token is string {
  if (typeof token !== 'string') return false;
  if (token.length === 0 || token.length > MAX_BRIDGE_AUTH_TOKEN_LENGTH) return false;
  for (const char of token) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined || codePoint < 33 || codePoint > 126) return false;
  }
  return true;
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index]! ^ rightBytes[index]!;
  }
  return difference === 0;
}

// ---------------------------------------------------------------------------
// Body size cap
// ---------------------------------------------------------------------------

export type SizeCheckOutcome =
  | Readonly<{ status: 'ok' }>
  | Readonly<{ status: 'too-large' }>
  | Readonly<{ status: 'invalid' }>;

/**
 * Defensive cap check on `Content-Length`. Returns:
 *  - `ok` if absent (fall back to streaming check) or within cap.
 *  - `too-large` if present and > cap (no body read).
 *  - `invalid` if present and unparseable (rejected as malformed).
 *
 * A caller MUST also enforce the cap during streaming read because
 * a client may omit Content-Length entirely on a chunked-encoded
 * upload, or lie about it.
 */
export function checkDeclaredContentLength(
  request: Request,
  maxBytes: number
): SizeCheckOutcome {
  const raw = request.headers.get('content-length');
  if (raw === null) return Object.freeze({ status: 'ok' });
  if (raw.length === 0 || raw.length > 20) {
    return Object.freeze({ status: 'invalid' });
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return Object.freeze({ status: 'invalid' });
  }
  if (parsed > maxBytes) return Object.freeze({ status: 'too-large' });
  return Object.freeze({ status: 'ok' });
}

/**
 * Read the request body as text with a hard byte cap. Aborts as
 * soon as the accumulated payload exceeds `maxBytes`. Returns
 * `{ status: 'ok', text }` on success or
 * `{ status: 'too-large' }` when the cap is exceeded mid-read.
 *
 * Uses the `Request.body` ReadableStream so a hostile uploader
 * cannot force us to buffer GB of payload into memory before the
 * cap fires.
 */
export async function readRequestBodyWithCap(
  request: Request,
  maxBytes: number
): Promise<
  Readonly<{ status: 'ok'; text: string } | { status: 'too-large' }>
> {
  if (request.body === null) {
    // Request bodies that are null on the platform are treated as
    // empty — JSON.parse will fail and the upstream handler returns
    // 400 Bad Request.
    return Object.freeze({ status: 'ok', text: '' });
  }
  // Some test polyfills don't implement the stream interface; fall
  // back to text() with a post-read size check.
  if (typeof request.body.getReader !== 'function') {
    const text = await request.text();
    if (text.length > maxBytes) return Object.freeze({ status: 'too-large' });
    return Object.freeze({ status: 'ok', text });
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = 0;
  let out = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value !== undefined) {
      accumulated += value.byteLength;
      if (accumulated > maxBytes) {
        // Best-effort cancel of the reader; we still drop any
        // already-decoded text by returning early.
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        return Object.freeze({ status: 'too-large' });
      }
      out += decoder.decode(value, { stream: true });
    }
  }
  out += decoder.decode();
  return Object.freeze({ status: 'ok', text: out });
}

// ---------------------------------------------------------------------------
// Standard responses
// ---------------------------------------------------------------------------

const JSON_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'content-type': 'application/json'
});

export function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({ status: 'rejected', reason: 'Unauthorized' }),
    {
      status: 401,
      headers: {
        ...JSON_HEADERS,
        [WWW_AUTHENTICATE_HEADER]: WWW_AUTHENTICATE_VALUE
      }
    }
  );
}

export function tooLargeResponse(): Response {
  return new Response(
    JSON.stringify({ status: 'rejected', reason: 'Payload Too Large' }),
    { status: 413, headers: JSON_HEADERS }
  );
}

export function badRequestSizeHeaderResponse(): Response {
  return new Response(
    JSON.stringify({ status: 'rejected', reason: 'Invalid Content-Length' }),
    { status: 400, headers: JSON_HEADERS }
  );
}

export function tooManyRequestsResponse(retryAfterMs: number): Response {
  // Retry-After per RFC 7231 §7.1.3: integer seconds, ceil-rounded
  // and clamped to a sensible range so we never advise a client to
  // sleep for years on a tiny cooldown bug.
  const seconds = Math.max(1, Math.min(3_600, Math.ceil(retryAfterMs / 1000)));
  return new Response(
    JSON.stringify({ status: 'rejected', reason: 'Too Many Requests' }),
    {
      status: 429,
      headers: {
        ...JSON_HEADERS,
        [RETRY_AFTER_HEADER]: String(seconds)
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Per-token rate limiter
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Persistent rate-limit bucket store
// ---------------------------------------------------------------------------

/**
 * Serializable snapshot of a single rate-limit bucket. Field-for-field
 * identical to `RateLimitBucket` so round-trips are lossless.
 */
export type RateLimitBucketState = Readonly<{
  tokens: number;
  lastRefillAt: number;
  consecutiveRefusals: number;
  cooldownUntil: number;
}>;

const HTTP_RATE_LIMIT_SNAPSHOT_VERSION =
  'lfp2p.http-rate-limit-snapshot.v1' as const;

type SerializedHttpRateLimitSnapshot = Readonly<{
  version: typeof HTTP_RATE_LIMIT_SNAPSHOT_VERSION;
  buckets: Readonly<Record<string, RateLimitBucketState>>;
}>;

export class HttpRateLimitStoreCorruptError extends Error {
  constructor(detail: string) {
    super(`Persisted HTTP rate-limit snapshot is corrupt: ${detail}`);
    this.name = 'HttpRateLimitStoreCorruptError';
  }
}

function deserializeRateLimitSnapshot(
  raw: unknown
): Map<string, RateLimitBucketState> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpRateLimitStoreCorruptError('snapshot is not a plain object');
  }
  const snap = raw as Partial<SerializedHttpRateLimitSnapshot>;
  if (snap.version !== HTTP_RATE_LIMIT_SNAPSHOT_VERSION) {
    throw new HttpRateLimitStoreCorruptError(
      `version "${String(snap.version)}" is not "${HTTP_RATE_LIMIT_SNAPSHOT_VERSION}"`
    );
  }
  if (snap.buckets === null || typeof snap.buckets !== 'object' || Array.isArray(snap.buckets)) {
    throw new HttpRateLimitStoreCorruptError('buckets must be a plain object');
  }
  const out = new Map<string, RateLimitBucketState>();
  for (const [tokenId, b] of Object.entries(snap.buckets)) {
    if (
      typeof b.tokens !== 'number' ||
      typeof b.lastRefillAt !== 'number' ||
      typeof b.consecutiveRefusals !== 'number' ||
      typeof b.cooldownUntil !== 'number'
    ) {
      throw new HttpRateLimitStoreCorruptError(
        `bucket "${tokenId}" has invalid fields`
      );
    }
    out.set(tokenId, Object.freeze({
      tokens: b.tokens,
      lastRefillAt: b.lastRefillAt,
      consecutiveRefusals: b.consecutiveRefusals,
      cooldownUntil: b.cooldownUntil
    }));
  }
  return out;
}

export interface HttpRateLimitStore {
  load(): Promise<Map<string, RateLimitBucketState>>;
  save(buckets: Map<string, RateLimitBucketState>): Promise<void>;
}

/** No-op store for in-memory (test/ephemeral) deployments. */
export class InMemoryHttpRateLimitStore implements HttpRateLimitStore {
  #blob: Map<string, RateLimitBucketState> | undefined;

  async load(): Promise<Map<string, RateLimitBucketState>> {
    return new Map(this.#blob ?? []);
  }

  async save(buckets: Map<string, RateLimitBucketState>): Promise<void> {
    this.#blob = new Map(buckets);
  }
}

export type JsonFileHttpRateLimitStoreOptions = Readonly<{
  filePath: string;
  tempSuffix?: string;
}>;

/**
 * Persists the per-token bucket map to a JSON file using
 * temp-file-then-rename for atomicity (same pattern as
 * `JsonFileAdmissionStateStore`). Fail-closed on load corruption:
 * throws rather than silently starting fresh so an attacker who
 * corrupted the file cannot gain a reset budget on restart.
 */
export class JsonFileHttpRateLimitStore implements HttpRateLimitStore {
  readonly #filePath: string;
  readonly #tempSuffix: string;

  constructor(options: JsonFileHttpRateLimitStoreOptions) {
    if (typeof options.filePath !== 'string' || options.filePath.length === 0) {
      throw new TypeError('JsonFileHttpRateLimitStore: filePath is required');
    }
    this.#filePath = options.filePath;
    this.#tempSuffix =
      options.tempSuffix ?? Math.random().toString(16).slice(2, 10);
  }

  async load(): Promise<Map<string, RateLimitBucketState>> {
    let text: string;
    try {
      text = await readFile(this.#filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new HttpRateLimitStoreCorruptError(
        `invalid JSON (${(err as Error).message})`
      );
    }
    return deserializeRateLimitSnapshot(parsed);
  }

  async save(buckets: Map<string, RateLimitBucketState>): Promise<void> {
    const bucketsObj: Record<string, RateLimitBucketState> = {};
    for (const [id, b] of buckets) bucketsObj[id] = b;
    const serialized: SerializedHttpRateLimitSnapshot = Object.freeze({
      version: HTTP_RATE_LIMIT_SNAPSHOT_VERSION,
      buckets: Object.freeze(bucketsObj)
    });
    const json = JSON.stringify(serialized);
    const tempPath = `${this.#filePath}.${process.pid}.${this.#tempSuffix}.tmp`;
    await writeFile(tempPath, json, { encoding: 'utf8', mode: 0o600 });
    await rename(tempPath, this.#filePath);
  }
}

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

const DEFAULT_FLUSH_INTERVAL_MS = 5_000;

export type BridgeHttpRateLimiterOptions = Readonly<{
  /** Engine rate-limit config. Defaults to the engine's DEFAULT_RATE_LIMIT. */
  config?: RateLimitConfig;
  /**
   * Phase 4.5 — optional persistent store. When set, buckets are
   * seeded from the store on construction and flushed on a
   * write-coalesced timer so disk I/O never lands on the hot path.
   * A flooding attack cannot exhaust disk I/O by triggering per-request
   * saves.
   */
  store?: HttpRateLimitStore;
  /**
   * How often (ms) the dirty-flag flush timer fires. Default 5 000 ms.
   * Tests may pass a smaller value to verify persistence without
   * real-time delay.
   */
  flushIntervalMs?: number;
}>;

/**
 * Per-token bucket map. Built on the engine's `tryConsume` so
 * exponential backoff and self-healing semantics match the admission
 * engine's per-peer limiter without duplicating logic.
 *
 * Persistence is write-coalesced: mutations mark a `#dirty` flag; the
 * flush timer saves and clears it. Saving is never synchronous on the
 * request hot-path. Call `dispose()` on graceful shutdown to flush
 * any pending dirty state and cancel the timer.
 */
export class BridgeHttpRateLimiter implements BridgeHttpRateLimiterHandle {
  readonly #config: RateLimitConfig | undefined;
  readonly #store: HttpRateLimitStore | undefined;
  readonly #buckets: Map<string, RateLimitBucket> = new Map();
  #dirty = false;
  #flushTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: BridgeHttpRateLimiterOptions = {}) {
    if (options.config !== undefined) this.#config = options.config;
    if (options.store !== undefined) {
      this.#store = options.store;
      const intervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
      this.#flushTimer = setInterval(() => {
        void this.#flushIfDirty();
      }, intervalMs);
      // Allow the process to exit even if this timer is still running.
      if (typeof this.#flushTimer.unref === 'function') {
        this.#flushTimer.unref();
      }
    }
  }

  /**
   * Async factory: pre-loads persisted buckets before returning.
   * Fail-closed: throws on corrupt state so the operator decides
   * whether to delete the bad snapshot.
   */
  static async create(
    options: BridgeHttpRateLimiterOptions = {}
  ): Promise<BridgeHttpRateLimiter> {
    const limiter = new BridgeHttpRateLimiter(options);
    if (options.store !== undefined) {
      const loaded = await options.store.load();
      for (const [tokenId, state] of loaded) {
        // `RateLimitBucketState` is field-identical to `RateLimitBucket`.
        limiter.#buckets.set(tokenId, state as unknown as RateLimitBucket);
      }
    }
    return limiter;
  }

  consume(
    tokenId: string,
    nowMs: number
  ): Readonly<{ allowed: boolean; retryAfterMs: number }> {
    const existing = this.#buckets.get(tokenId);
    const bucket =
      existing ??
      (this.#config !== undefined
        ? createRateLimitBucket(nowMs, this.#config)
        : createRateLimitBucket(nowMs));
    const decision =
      this.#config !== undefined
        ? tryConsume(bucket, nowMs, this.#config)
        : tryConsume(bucket, nowMs);
    this.#buckets.set(tokenId, decision.bucket);
    this.#dirty = true;
    return Object.freeze({
      allowed: decision.allowed,
      retryAfterMs: decision.allowed
        ? 0
        : Math.max(0, decision.retryAfter - nowMs)
    });
  }

  /** Flush pending state and cancel the timer. Call on graceful shutdown. */
  async dispose(): Promise<void> {
    if (this.#flushTimer !== undefined) {
      clearInterval(this.#flushTimer);
      this.#flushTimer = undefined;
    }
    await this.#flushIfDirty();
  }

  /** Test hook: snapshot the buckets for inspection. */
  inspectBucket(tokenId: string): RateLimitBucket | undefined {
    return this.#buckets.get(tokenId);
  }

  /** Test hook: check dirty flag. */
  get isDirty(): boolean {
    return this.#dirty;
  }

  /** Force an immediate flush regardless of dirty flag. Used by tests. */
  async forceFlush(): Promise<void> {
    await this.#flush();
  }

  async #flushIfDirty(): Promise<void> {
    if (!this.#dirty) return;
    await this.#flush();
  }

  async #flush(): Promise<void> {
    if (this.#store === undefined) return;
    const snapshot = new Map<string, RateLimitBucketState>();
    for (const [tokenId, bucket] of this.#buckets) {
      snapshot.set(tokenId, {
        tokens: bucket.tokens,
        lastRefillAt: bucket.lastRefillAt,
        consecutiveRefusals: bucket.consecutiveRefusals,
        cooldownUntil: bucket.cooldownUntil
      });
    }
    await this.#store.save(snapshot);
    this.#dirty = false;
  }
}
