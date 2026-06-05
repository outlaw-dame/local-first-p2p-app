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

export type BridgeHttpRateLimiterOptions = Readonly<{
  /** Engine rate-limit config. Defaults to the engine's DEFAULT_RATE_LIMIT. */
  config?: RateLimitConfig;
}>;

/**
 * In-memory per-token bucket map. Built directly on the engine's
 * `tryConsume` so exponential backoff + self-healing match the
 * admission engine's behaviour without duplicating logic.
 *
 * Concurrency note: a single instance is assumed to be called
 * sequentially per token (the bridge HTTP handler is request-scoped
 * but tokens can be reused across overlapping requests). The
 * `consume` operation is atomic in JavaScript's single-threaded
 * event loop; we do not need locks. If a future runtime introduces
 * shared concurrent handlers across worker threads with one
 * limiter instance, the caller MUST wrap `consume` in a mutex.
 */
export class BridgeHttpRateLimiter implements BridgeHttpRateLimiterHandle {
  readonly #config: RateLimitConfig | undefined;
  readonly #buckets: Map<string, RateLimitBucket> = new Map();

  constructor(options: BridgeHttpRateLimiterOptions = {}) {
    if (options.config !== undefined) this.#config = options.config;
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
    const decision = this.#config !== undefined
      ? tryConsume(bucket, nowMs, this.#config)
      : tryConsume(bucket, nowMs);
    this.#buckets.set(tokenId, decision.bucket);
    return Object.freeze({
      allowed: decision.allowed,
      retryAfterMs: decision.allowed
        ? 0
        : Math.max(0, decision.retryAfter - nowMs)
    });
  }

  /** Test hook: snapshot the buckets for inspection. */
  inspectBucket(tokenId: string): RateLimitBucket | undefined {
    return this.#buckets.get(tokenId);
  }
}
