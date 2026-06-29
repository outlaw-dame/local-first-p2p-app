/**
 * Phase 4.5 — Persistent token registry with hot rotation.
 *
 * Replaces the static `BridgeHttpAuthConfig` registry (which cannot
 * rotate credentials without a process restart) with a mutable
 * `BridgeTokenRegistry` that:
 *
 *  - Stores bearer credentials as SHA-256 hex digests only; the
 *    plaintext credential never appears in files or logs (Phase 3.1).
 *  - Exposes `addToken`/`revokeToken` mutations that take effect
 *    immediately on the next request without a restart.
 *  - Persists to a `TokenRegistryStore` (optional) via a `JsonFileTokenRegistryStore`
 *    backed by atomic temp-file rename — the same pattern used by
 *    `JsonFileAdmissionStateStore`.
 *  - `validateBearerToken(presented, nowMs)` hashes the incoming bearer
 *    value and does a constant-time comparison against stored hashes.
 *    Comparing plaintext to a stored hash would always fail; the hash
 *    step is mandatory.
 *
 * The registry is backward-compatible with the existing `BridgeHttpAuthConfig`
 * path: both may coexist. When `BridgeHttpHandlerOptions.tokenRegistry` is
 * present it takes precedence over `auth`.
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import { sha256 } from '@lfp2p/crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A bearer credential stored as a sha-256 hex digest.
 * Plaintext credentials are NEVER stored — the operator hashes them
 * before calling `addToken`, or calls the helper `hashBearerToken`.
 */
export type AuthToken = Readonly<{
  tokenId: string;
  /** SHA-256 hex digest of the bearer credential. */
  hashedValue: string;
  expiresAt?: string;
}>;

export type TokenValidationOutcome =
  | Readonly<{ status: 'valid'; tokenId: string }>
  | Readonly<{ status: 'invalid' }>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Encode a plaintext bearer value to its SHA-256 hex digest. */
export function hashBearerToken(plaintext: string): string {
  const bytes = new TextEncoder().encode(plaintext);
  const digest = sha256(bytes);
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface TokenRegistryStore {
  load(): Promise<ReadonlyArray<AuthToken>>;
  save(tokens: ReadonlyArray<AuthToken>): Promise<void>;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

const TOKEN_REGISTRY_VERSION = 'lfp2p.token-registry.v1' as const;

type SerializedTokenRegistry = Readonly<{
  version: typeof TOKEN_REGISTRY_VERSION;
  tokens: ReadonlyArray<AuthToken>;
}>;

export class TokenRegistryCorruptError extends Error {
  constructor(detail: string) {
    super(`Persisted token registry is corrupt: ${detail}`);
    this.name = 'TokenRegistryCorruptError';
  }
}

function deserializeTokenRegistry(raw: unknown): ReadonlyArray<AuthToken> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TokenRegistryCorruptError('snapshot is not a plain object');
  }
  const snap = raw as Partial<SerializedTokenRegistry>;
  if (snap.version !== TOKEN_REGISTRY_VERSION) {
    throw new TokenRegistryCorruptError(
      `version "${String(snap.version)}" is not "${TOKEN_REGISTRY_VERSION}"`
    );
  }
  if (!Array.isArray(snap.tokens)) {
    throw new TokenRegistryCorruptError('tokens must be an array');
  }
  return Object.freeze(
    snap.tokens.map((t, i) => {
      if (typeof t.tokenId !== 'string' || t.tokenId.length === 0) {
        throw new TokenRegistryCorruptError(`tokens[${i}].tokenId is missing`);
      }
      if (
        typeof t.hashedValue !== 'string' ||
        !/^[0-9a-f]{64}$/.test(t.hashedValue)
      ) {
        throw new TokenRegistryCorruptError(
          `tokens[${i}].hashedValue must be a 64-char hex sha-256 digest`
        );
      }
      const out: { -readonly [K in keyof AuthToken]: AuthToken[K] } = {
        tokenId: t.tokenId,
        hashedValue: t.hashedValue
      };
      if (t.expiresAt !== undefined) {
        if (!Number.isFinite(Date.parse(t.expiresAt))) {
          throw new TokenRegistryCorruptError(
            `tokens[${i}].expiresAt is not ISO-8601`
          );
        }
        out.expiresAt = t.expiresAt;
      }
      return Object.freeze(out) as AuthToken;
    })
  );
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

export class InMemoryTokenRegistryStore implements TokenRegistryStore {
  #blob: SerializedTokenRegistry | undefined;

  async load(): Promise<ReadonlyArray<AuthToken>> {
    if (this.#blob === undefined) return Object.freeze([]);
    return deserializeTokenRegistry(this.#blob);
  }

  async save(tokens: ReadonlyArray<AuthToken>): Promise<void> {
    this.#blob = Object.freeze({
      version: TOKEN_REGISTRY_VERSION,
      tokens: Object.freeze([...tokens])
    });
  }
}

// ---------------------------------------------------------------------------
// JSON-file store
// ---------------------------------------------------------------------------

export type JsonFileTokenRegistryStoreOptions = Readonly<{
  filePath: string;
  tempSuffix?: string;
}>;

export class JsonFileTokenRegistryStore implements TokenRegistryStore {
  readonly #filePath: string;
  readonly #tempSuffix: string;

  constructor(options: JsonFileTokenRegistryStoreOptions) {
    if (typeof options.filePath !== 'string' || options.filePath.length === 0) {
      throw new TypeError('JsonFileTokenRegistryStore: filePath is required');
    }
    this.#filePath = options.filePath;
    this.#tempSuffix =
      options.tempSuffix ?? Math.random().toString(16).slice(2, 10);
  }

  async load(): Promise<ReadonlyArray<AuthToken>> {
    let text: string;
    try {
      text = await readFile(this.#filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return Object.freeze([]);
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new TokenRegistryCorruptError(
        `invalid JSON (${(err as Error).message})`
      );
    }
    return deserializeTokenRegistry(parsed);
  }

  async save(tokens: ReadonlyArray<AuthToken>): Promise<void> {
    const serialized: SerializedTokenRegistry = Object.freeze({
      version: TOKEN_REGISTRY_VERSION,
      tokens: Object.freeze([...tokens])
    });
    const json = JSON.stringify(serialized);
    // Per-call unique suffix prevents write collisions when concurrent
    // addToken/revokeToken calls both reach save at the same time.
    const callSuffix = Math.random().toString(16).slice(2, 10);
    const tempPath = `${this.#filePath}.${process.pid}.${this.#tempSuffix}.${callSuffix}.tmp`;
    await writeFile(tempPath, json, { encoding: 'utf8', mode: 0o600 });
    await rename(tempPath, this.#filePath);
  }
}

// ---------------------------------------------------------------------------
// Registry class
// ---------------------------------------------------------------------------

export type BridgeTokenRegistryOptions = Readonly<{
  initialTokens?: ReadonlyArray<AuthToken>;
  store?: TokenRegistryStore;
}>;

/**
 * Mutable token registry that supports hot credential rotation.
 * `addToken`/`revokeToken` take effect immediately on the next call
 * to `validateBearerToken` without restarting the process.
 *
 * Token values are stored as SHA-256 hex digests. The registry
 * NEVER stores or logs the plaintext bearer credential.
 */
export class BridgeTokenRegistry {
  readonly #store: TokenRegistryStore | undefined;
  #tokens: Map<string, AuthToken>;

  constructor(options: BridgeTokenRegistryOptions = {}) {
    this.#store = options.store;
    this.#tokens = new Map(
      (options.initialTokens ?? []).map((t) => [t.tokenId, t])
    );
  }

  static async create(
    options: BridgeTokenRegistryOptions = {}
  ): Promise<BridgeTokenRegistry> {
    if (options.store !== undefined) {
      const loaded = await options.store.load();
      if (loaded.length > 0) {
        return new BridgeTokenRegistry({ ...options, initialTokens: loaded });
      }
    }
    return new BridgeTokenRegistry(options);
  }

  /**
   * Add a token to the registry and persist. Throws if the tokenId
   * already exists — callers must revoke first.
   */
  async addToken(token: AuthToken): Promise<void> {
    if (this.#tokens.has(token.tokenId)) {
      throw new Error(`tokenId "${token.tokenId}" already exists — revoke it first`);
    }
    if (!/^[0-9a-f]{64}$/.test(token.hashedValue)) {
      throw new TypeError(
        `AuthToken.hashedValue must be a 64-char hex sha-256 digest`
      );
    }
    if (token.expiresAt !== undefined && !Number.isFinite(Date.parse(token.expiresAt))) {
      throw new TypeError(`AuthToken.expiresAt must be ISO-8601`);
    }
    this.#tokens.set(token.tokenId, Object.freeze({ ...token }));
    await this.#persist();
  }

  /** Remove a token. No-op if the tokenId does not exist. */
  async revokeToken(tokenId: string): Promise<void> {
    this.#tokens.delete(tokenId);
    await this.#persist();
  }

  /**
   * Validate an incoming bearer token. Hashes the presented value and
   * runs a constant-time comparison against every stored hash so
   * timing oracles cannot reveal registry contents or size.
   *
   * Returns `{ status: 'valid', tokenId }` when a non-expired match
   * is found, `{ status: 'invalid' }` for every failure case. The
   * caller cannot distinguish "no token", "wrong token", "expired
   * token", or "empty registry" from the response shape.
   */
  validateBearerToken(presented: string, nowMs: number): TokenValidationOutcome {
    const presentedHash = hashBearerToken(presented);
    let matchedTokenId: string | undefined;
    for (const t of this.#tokens.values()) {
      const isHashMatch = constantTimeEqualHex(presentedHash, t.hashedValue);
      const notExpired =
        t.expiresAt === undefined || Date.parse(t.expiresAt) > nowMs;
      if (isHashMatch && notExpired && matchedTokenId === undefined) {
        matchedTokenId = t.tokenId;
      }
    }
    if (matchedTokenId === undefined) {
      return Object.freeze({ status: 'invalid' });
    }
    return Object.freeze({ status: 'valid', tokenId: matchedTokenId });
  }

  /** Read-only snapshot for tests or persistence. */
  snapshot(): ReadonlyArray<AuthToken> {
    return Object.freeze([...this.#tokens.values()]);
  }

  async #persist(): Promise<void> {
    if (this.#store !== undefined) {
      await this.#store.save(this.snapshot());
    }
  }
}
