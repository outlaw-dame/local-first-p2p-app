import { type PrivacyScope, type SignedEventEnvelope } from '@lfp2p/protocol';

export type BridgeServiceRole = 'stateful-edge-actor' | 'persistent-availability-peer';
export type BridgeDeliveryStatus = 'confirmed' | 'conflicted' | 'rejected';
export type BridgeStoreKind = 'memory' | 'json-file' | 'pglite';

/**
 * Single-token configuration (the legacy shape, kept for backward
 * compatibility with pre-Phase-4.3 deployments). New deployments
 * SHOULD use the multi-token form below so the operator can rotate
 * a token without restart and revoke a compromised token without
 * affecting others.
 */
export type BridgeHttpAuthConfigLegacy = Readonly<{
  scheme: 'bearer';
  token: string;
}>;

/**
 * A single bearer-token credential within a multi-token registry.
 *
 * - `id` is operator-supplied and stable. Logged when authentication
 *   succeeds or fails (per the Phase 3.1 privacy-safe-logging
 *   doctrine: the id is metadata, not a secret; the token value is
 *   the secret and is never logged).
 * - `token` is the bearer credential. Constant-time compared.
 * - `label` is optional human-readable text for operator dashboards.
 * - `expiresAt`, when set, is the ISO-8601 instant at which the
 *   token stops being valid. Expired tokens are treated identically
 *   to unknown tokens in the response (same status code, same body)
 *   so a caller cannot distinguish "expired" from "invalid" by
 *   probing.
 */
export type BridgeAuthToken = Readonly<{
  id: string;
  token: string;
  label?: string;
  expiresAt?: string;
}>;

/**
 * Multi-token configuration. The bridge accepts any token in the
 * `tokens` array that matches by constant-time comparison and is not
 * expired. Tokens are identified by `id` after a successful match so
 * downstream layers (rate-limit, audit) can key by the stable id
 * rather than the secret value.
 */
export type BridgeHttpAuthConfigMulti = Readonly<{
  scheme: 'bearer';
  tokens: ReadonlyArray<BridgeAuthToken>;
}>;

export type BridgeHttpAuthConfig =
  | BridgeHttpAuthConfigLegacy
  | BridgeHttpAuthConfigMulti;

export type BridgeHttpHandlerOptions = Readonly<{
  auth?: BridgeHttpAuthConfig;
  /**
   * Phase 4.3 — maximum HTTP request body size in bytes. Requests
   * above this size are rejected with 413 BEFORE the body is parsed
   * or stored. When omitted defaults to 1 MiB (matches the bridge
   * admission engine's `DEFAULT_MAX_BYTES_BY_SURFACE.bridge`).
   *
   * The cap is enforced via Content-Length pre-check AND streaming
   * accumulation cap, so a missing or lying Content-Length cannot
   * bypass it.
   */
  maxRequestBytes?: number;
  /**
   * Phase 4.3 — optional per-token HTTP rate limiter. When set,
   * every authenticated request consumes one token from the
   * `tokenId`'s bucket; exhaustion responds with 429 + Retry-After.
   * Implemented on top of the engine's `tryConsume` primitive so the
   * exponential-backoff semantics are identical to the per-peer
   * admission limiter.
   */
  httpRateLimiter?: BridgeHttpRateLimiterHandle;
  /**
   * Phase 4.3 — reference clock. Defaults to `() => Date.now()`. Tests
   * inject a deterministic clock to exercise expiry + rate-limit
   * recovery without real time progression.
   */
  now?: () => number;
}>;

/**
 * Opaque rate-limiter handle, declared here to keep
 * `BridgeHttpHandlerOptions` free of a cycle with the
 * `http-hardening` implementation file.
 */
export type BridgeHttpRateLimiterHandle = Readonly<{
  consume: (
    tokenId: string,
    nowMs: number
  ) => Readonly<{
    allowed: boolean;
    /**
     * Epoch ms after which the next request from this token will
     * be allowed. Always >= nowMs when `allowed` is false; 0 when
     * `allowed` is true.
     */
    retryAfterMs: number;
  }>;
}>;

export type BridgeDeliveryRequest = Readonly<{
  idempotencyKey: string;
  target: string;
  event: SignedEventEnvelope;
  /**
   * Transport-level peer identifier supplied by the upstream HTTP /
   * WebSocket handler. The admission engine uses this as the key for
   * per-peer rate-limit buckets and reputation tracking.
   *
   * When omitted (e.g. tests, legacy callers, or pre-Phase-4.1
   * deployments) the admission gateway falls back to
   * `event.deviceId`. This keeps the engine functional for testing
   * while making it clear in production wiring that a real
   * transport identifier SHOULD be plumbed in.
   */
  peerId?: string;
}>;

export type BridgeDeliveryResponse =
  | Readonly<{
      status: 'confirmed';
      eventId: string;
      idempotencyKey: string;
      sequence: number;
      acceptedAt: string;
      duplicate: boolean;
    }>
  | Readonly<{
      status: 'conflicted';
      idempotencyKey: string;
      reason: string;
      existingEventId?: string;
    }>
  | Readonly<{
      status: 'rejected';
      idempotencyKey: string;
      reason: string;
    }>;

export type BridgeInboundReadRequest = Readonly<{
  sourceId: string;
  streamId: string;
  scope: string;
  cursor?: string;
  limit?: number;
}>;

export type BridgeInboundReadRecord = Readonly<{
  cursor: string;
  sequence: number;
  event: SignedEventEnvelope;
  receivedAt: string;
}>;

export type BridgeInboundReadResponse = Readonly<{
  records: readonly BridgeInboundReadRecord[];
}>;

export type BridgeRecord = Readonly<{
  idempotencyKey: string;
  target: string;
  eventId: string;
  author: string;
  privacy: PrivacyScope;
  sequence: number;
  acceptedAt: string;
}>;

export type BridgeRecordDraft = Omit<BridgeRecord, 'sequence'>;
export type StoredBridgeRecord = BridgeRecord & Readonly<{ expiresAt: string; event?: SignedEventEnvelope }>;
export type StoredBridgeRecordDraft = BridgeRecordDraft & Readonly<{ expiresAt: string; event: SignedEventEnvelope }>;

export type BridgeStoreListInput = Readonly<{
  target: string;
  afterSequence: number;
  limit: number;
}>;

export type BridgeStoreSnapshot = Readonly<{
  storeKind: BridgeStoreKind;
  acceptedCount: number;
  maxRecords: number;
  ttlMs: number;
  latestSequence: number;
}>;

export type BridgeServiceSnapshot = BridgeStoreSnapshot &
  Readonly<{
    role: BridgeServiceRole;
    authoritativeForPrivateState: false;
  }>;

export type BridgeStorePutResult =
  | Readonly<{ status: 'inserted'; record: StoredBridgeRecord }>
  | Readonly<{ status: 'existing'; record: StoredBridgeRecord }>;

export type BridgeStore = Readonly<{
  readonly kind: BridgeStoreKind;
  readonly maxRecords: number;
  readonly ttlMs: number;
  get(idempotencyKey: string, nowMs: number): Promise<StoredBridgeRecord | undefined>;
  putIfAbsent(record: StoredBridgeRecordDraft, nowMs: number): Promise<BridgeStorePutResult>;
  listAfter(input: BridgeStoreListInput, nowMs: number): Promise<readonly StoredBridgeRecord[]>;
  pruneExpired(nowMs: number): Promise<void>;
  snapshot(nowMs: number): Promise<BridgeStoreSnapshot>;
}>;

export type BridgeServiceOptions = Readonly<{
  role?: BridgeServiceRole;
  store: BridgeStore;
  /**
   * Phase 4.1 — optional admission gateway. When supplied the bridge
   * runs every accepted delivery through the Phase 1.64
   * trust-safety transport-admission engine BEFORE persisting it,
   * applying the engine's rate limit, peer reputation, replay
   * cache, byte cap, kind allowlist, and privacy-scope checks.
   *
   * When omitted the bridge behaves exactly as before (the existing
   * signature + protocol-scope + idempotency checks still run).
   * Production deployments MUST configure admission; the option is
   * non-required only for backward compatibility with pre-Phase-4.1
   * test code.
   */
  admission?: BridgeAdmissionGatewayHandle;
}>;

/**
 * Opaque handle for the admission gateway instance, declared in
 * `./admission-gateway.ts`. Declared here as a type-only handle to
 * keep `BridgeServiceOptions` free of a cycle with the gateway
 * implementation file.
 */
type AdmissionDecisionResult = Readonly<{
  result: Readonly<{
    decision: Readonly<{
      action:
        | 'accept'
        | 'accept-limited'
        | 'reject'
        | 'quarantine'
        | 'rate-limit'
        | 'drop-duplicate';
      reasonCode: string;
    }>;
    admitted: boolean;
  }>;
  reason: string;
}>;

export type BridgeAdmissionGatewayHandle = Readonly<{
  /**
   * Process one delivery through admission and return the decision.
   * The gateway holds the underlying admission state internally and
   * advances it atomically per call.
   */
  admit: (request: BridgeDeliveryRequest, nowMs: number) => AdmissionDecisionResult;
  /**
   * Phase 4.2 — process one delivery through admission, persist the
   * new state via the configured `stateStore`, and only then
   * advance the in-memory reference. When no store is configured
   * this is equivalent to `admit`. When a store IS configured a
   * persistence failure throws (fail-closed) and the in-memory
   * state stays unchanged.
   */
  admitAndPersist: (
    request: BridgeDeliveryRequest,
    nowMs: number
  ) => Promise<AdmissionDecisionResult>;
}>;

export type InMemoryBridgeStoreOptions = Readonly<{
  maxRecords?: number;
  ttlMs?: number;
  initialSequence?: number;
}>;

export type InMemoryBridgeServiceOptions = InMemoryBridgeStoreOptions &
  Readonly<{
    role?: BridgeServiceRole;
    /** Phase 4.1 — forwarded to the base `BridgeService`. */
    admission?: BridgeAdmissionGatewayHandle;
  }>;

export type JsonFileBridgeStoreOptions = Readonly<{
  filePath: string;
  maxRecords?: number;
  ttlMs?: number;
  initialSequence?: number;
  tempFileSuffix?: string;
}>;

export type PgliteBridgeStoreOptions = Readonly<{
  dataDir?: string;
  maxRecords?: number;
  ttlMs?: number;
  initialSequence?: number;
}>;

export type JsonBridgeStoreState = Readonly<{
  recordType: 'lfp2p.bridge.store.v1';
  latestSequence: number;
  records: StoredBridgeRecord[];
}>;

export type MutableJsonBridgeStoreState = {
  recordType: 'lfp2p.bridge.store.v1';
  latestSequence: number;
  records: StoredBridgeRecord[];
};