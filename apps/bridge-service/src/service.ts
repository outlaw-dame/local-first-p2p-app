import { verifySignedEventEnvelope } from '@lfp2p/crypto';
import { type SignedEventEnvelope, validateSignedEvent } from '@lfp2p/protocol';
import {
  DEFAULT_MAX_REQUEST_BYTES,
  authorizeRequest,
  badRequestSizeHeaderResponse,
  checkDeclaredContentLength,
  normalizeAuthConfig,
  readRequestBodyWithCap,
  tooLargeResponse,
  tooManyRequestsResponse,
  type AuthorizationOutcome
} from './http-hardening.js';
import { InMemoryBridgeStore } from './stores.js';
import {
  type BridgeDeliveryRequest,
  type BridgeDeliveryResponse,
  type BridgeHttpHandlerOptions,
  type BridgeInboundReadRequest,
  type BridgeInboundReadResponse,
  type BridgeRecord,
  type BridgeServiceOptions,
  type BridgeServiceRole,
  type BridgeServiceSnapshot,
  type InMemoryBridgeServiceOptions,
  type StoredBridgeRecord
} from './types.js';
import {
  BRIDGE_ALLOWED_PRIVACY_SCOPES,
  confirmed,
  normalizeErrorMessage,
  requireIsoDate,
  requireNonEmpty,
  requirePositiveInteger,
  requireSafeNonNegativeInteger,
  responseForExistingRecord,
  withoutExpiry
} from './utils.js';

export const DEFAULT_BRIDGE_INBOUND_READ_LIMIT = 100;
export const MAX_BRIDGE_INBOUND_READ_LIMIT = 500;

// (Phase 4.3) The bearer-token header constants and length cap live in
// `./http-hardening.ts` so the auth implementation is a single source
// of truth.

type JsonResponseHeaders = Readonly<Record<string, string>>;

export class BridgeService {
  readonly role: BridgeServiceRole;
  readonly authoritativeForPrivateState = false as const;
  readonly store: BridgeServiceOptions['store'];
  // Phase 4.1 — optional admission gateway. Held as a private field
  // so the BridgeService surface stays unchanged for callers that
  // don't opt into admission.
  readonly #admission: BridgeServiceOptions['admission'];

  constructor(options: BridgeServiceOptions) {
    this.role = options.role ?? 'stateful-edge-actor';
    this.store = options.store;
    this.#admission = options.admission;
  }

  async acceptDelivery(request: BridgeDeliveryRequest, now = new Date().toISOString()): Promise<BridgeDeliveryResponse> {
    const idempotencyKey = requireNonEmpty(request.idempotencyKey, 'idempotencyKey');
    const target = requireNonEmpty(request.target, 'target');
    const nowMs = requireIsoDate(now, 'now');

    try {
      validateSignedEvent(request.event);
    } catch (error) {
      return rejected(idempotencyKey, `Invalid signed event envelope: ${normalizeErrorMessage(error)}`);
    }

    if (!BRIDGE_ALLOWED_PRIVACY_SCOPES.has(request.event.privacy)) {
      return rejected(idempotencyKey, `Bridge cannot accept ${request.event.privacy} scoped events`);
    }

    if (!verifySignedEventEnvelope(request.event)) {
      return rejected(idempotencyKey, 'Event signature verification failed');
    }

    // Phase 4.1 — trust-safety transport admission. Runs AFTER the
    // signature + protocol-scope checks (those are cheap, deterministic,
    // and don't consume admission budget) and BEFORE the store
    // mutation (so a rejected delivery never lands a record).
    //
    // Order rationale: an envelope that fails signature verification
    // shouldn't consume the producer's per-peer rate-limit budget —
    // a forged envelope from an attacker would otherwise let the
    // attacker burn the legitimate producer's budget.
    //
    // Phase 4.2: we call `admitAndPersist` rather than `admit`. The
    // gateway uses the awaited form to persist the post-admission
    // state via its (optional) `AdmissionStateStore` BEFORE
    // returning a decision. When no store is configured the await
    // resolves synchronously with no I/O side effect; when a store
    // IS configured a persistence failure throws and we surface it
    // as a rejection rather than admitting a delivery whose
    // admission record would be lost on the next restart.
    if (this.#admission !== undefined) {
      let admission;
      try {
        admission = await this.#admission.admitAndPersist(request, nowMs);
      } catch (error) {
        // Fail-closed: admission persistence failure becomes a
        // rejection. The reason carries only the stable error
        // class name + a static label, never payload contents,
        // per the Phase 3.1 privacy-safe-logging doctrine.
        return rejected(
          idempotencyKey,
          `admission-persist-failed:${(error as Error).name}`
        );
      }
      if (!admission.result.admitted) {
        // `drop-duplicate` collapses into a rejection with the
        // engine's stable reason code; callers that want
        // idempotency-style "duplicate" semantics use the existing
        // `store.get(idempotencyKey)` path further down. The
        // admission's replay cache is a separate, time-bound
        // dedup layer for transport-level replay attacks (Phase
        // 1.64), not the application-level idempotency dedup.
        return rejected(idempotencyKey, admission.reason);
      }
    }

    const existing = await this.store.get(idempotencyKey, nowMs);
    if (existing) return responseForExistingRecord(existing, idempotencyKey, target, request.event);

    const result = await this.store.putIfAbsent(
      {
        idempotencyKey,
        target,
        eventId: request.event.eventId,
        author: request.event.author,
        privacy: request.event.privacy,
        acceptedAt: now,
        expiresAt: new Date(nowMs + this.store.ttlMs).toISOString(),
        event: request.event
      },
      nowMs
    );
    if (result.status === 'existing') return responseForExistingRecord(result.record, idempotencyKey, target, request.event);
    return confirmed(result.record, false);
  }

  async readInboundRecords(
    request: BridgeInboundReadRequest,
    now = new Date().toISOString()
  ): Promise<BridgeInboundReadResponse> {
    requireNonEmpty(request.sourceId, 'sourceId');
    const target = requireNonEmpty(request.streamId, 'streamId');
    requireNonEmpty(request.scope, 'scope');
    const afterSequence = request.cursor === undefined ? 0 : parseReadCursor(request.cursor);
    const limit = normalizeReadLimit(request.limit);
    const nowMs = requireIsoDate(now, 'now');
    const records = await this.store.listAfter({ target, afterSequence, limit }, nowMs);

    return {
      records: records
        .filter((record): record is StoredBridgeRecord & { event: SignedEventEnvelope } => record.event !== undefined)
        .map((record) => ({
          cursor: String(record.sequence),
          sequence: record.sequence,
          event: record.event,
          receivedAt: record.acceptedAt
        }))
    };
  }

  async getRecord(idempotencyKey: string, now = new Date().toISOString()): Promise<BridgeRecord | undefined> {
    requireNonEmpty(idempotencyKey, 'idempotencyKey');
    const record = await this.store.get(idempotencyKey, requireIsoDate(now, 'now'));
    return withoutExpiry(record);
  }

  async snapshot(now = new Date().toISOString()): Promise<BridgeServiceSnapshot> {
    return {
      role: this.role,
      authoritativeForPrivateState: false,
      ...(await this.store.snapshot(requireIsoDate(now, 'now')))
    };
  }
}

export class InMemoryBridgeService extends BridgeService {
  constructor(options: BridgeServiceRole | InMemoryBridgeServiceOptions = 'stateful-edge-actor') {
    const normalized = typeof options === 'string' ? { role: options } : options;
    super({
      store: new InMemoryBridgeStore({
        ...(normalized.maxRecords === undefined ? {} : { maxRecords: normalized.maxRecords }),
        ...(normalized.ttlMs === undefined ? {} : { ttlMs: normalized.ttlMs }),
        ...(normalized.initialSequence === undefined ? {} : { initialSequence: normalized.initialSequence })
      }),
      ...(normalized.role === undefined ? {} : { role: normalized.role }),
      ...(normalized.admission === undefined ? {} : { admission: normalized.admission })
    });
  }
}

export async function handleBridgeDeliveryRequest(
  service: BridgeService,
  request: Request,
  now = new Date().toISOString(),
  options: BridgeHttpHandlerOptions = {}
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ status: 'rejected', idempotencyKey: 'unknown', reason: 'Method not allowed' }, 405);
  }

  // Backward-compat: pre-Phase-4.3 tests pass `null` as the options
  // arg; treat that as a misconfigured server rather than throwing.
  if (!isRecord(options)) return bridgeAuthMisconfiguredResponse();

  // Phase 4.3 — cheap-first ordering: size cap → auth → rate-limit
  // → body read with streaming cap → existing flow. Each cheaper
  // check runs first so a hostile client cannot DoS the heavier
  // ones.
  const maxBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  const declared = checkDeclaredContentLength(request, maxBytes);
  if (declared.status === 'too-large') return tooLargeResponse();
  if (declared.status === 'invalid') return badRequestSizeHeaderResponse();

  const authResult = phaseFourThreeAuthorize(request, options);
  if (authResult.status === 'misconfigured') return bridgeAuthMisconfiguredResponse();
  if (authResult.status === 'unauthorized') return bridgeDeliveryUnauthorizedResponse();

  if (options.httpRateLimiter !== undefined) {
    const nowMs = (options.now ?? Date.now)();
    const decision = options.httpRateLimiter.consume(authResult.tokenId, nowMs);
    if (!decision.allowed) return tooManyRequestsResponse(decision.retryAfterMs);
  }

  const body = await readRequestBodyWithCap(request, maxBytes);
  if (body.status === 'too-large') return tooLargeResponse();

  const parsed = parseDeliveryRequestJsonFromText(request, body.text);
  if (parsed.status === 'invalid') {
    return jsonResponse({ status: 'rejected', idempotencyKey: parsed.idempotencyKey, reason: parsed.reason }, 400);
  }

  const response = await service.acceptDelivery(parsed.request, now);
  return jsonResponse(response, statusCodeForBridgeResponse(response));
}

export async function handleBridgeInboundReadRequest(
  service: BridgeService,
  request: Request,
  now = new Date().toISOString(),
  options: BridgeHttpHandlerOptions = {}
): Promise<Response> {
  if (request.method !== 'POST') return jsonResponse({ reason: 'Method not allowed' }, 405);

  // Backward-compat: pre-Phase-4.3 tests pass `null` as the options
  // arg; treat that as a misconfigured server rather than throwing.
  if (!isRecord(options)) return bridgeAuthMisconfiguredResponse();

  // Same cheap-first ordering as the delivery handler.
  const maxBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  const declared = checkDeclaredContentLength(request, maxBytes);
  if (declared.status === 'too-large') return tooLargeResponse();
  if (declared.status === 'invalid') return badRequestSizeHeaderResponse();

  const authResult = phaseFourThreeAuthorize(request, options);
  if (authResult.status === 'misconfigured') return bridgeAuthMisconfiguredResponse();
  if (authResult.status === 'unauthorized') return bridgeReadUnauthorizedResponse();

  if (options.httpRateLimiter !== undefined) {
    const nowMs = (options.now ?? Date.now)();
    const decision = options.httpRateLimiter.consume(authResult.tokenId, nowMs);
    if (!decision.allowed) return tooManyRequestsResponse(decision.retryAfterMs);
  }

  const body = await readRequestBodyWithCap(request, maxBytes);
  if (body.status === 'too-large') return tooLargeResponse();

  const parsed = parseInboundReadRequestJsonFromText(body.text);
  if (parsed.status === 'invalid') return jsonResponse({ reason: parsed.reason }, 400);

  try {
    return jsonResponse(await service.readInboundRecords(parsed.request, now), 200);
  } catch {
    return jsonResponse({ reason: 'Bridge inbound read failed' }, 503);
  }
}

/**
 * Backward-compatible 401 body for the delivery endpoint. Pre-Phase-4.3
 * tests assert the exact shape including `idempotencyKey: 'unknown'`.
 */
function bridgeDeliveryUnauthorizedResponse(): Response {
  return jsonResponse(
    { status: 'rejected', idempotencyKey: 'unknown', reason: 'Unauthorized' },
    401,
    { 'www-authenticate': 'Bearer realm="lfp2p-bridge"' }
  );
}

/**
 * Backward-compatible 401 body for the inbound-read endpoint. The
 * read endpoint has no idempotencyKey concept; the body is the
 * legacy shape `{ reason: 'Unauthorized' }`.
 */
function bridgeReadUnauthorizedResponse(): Response {
  return jsonResponse({ reason: 'Unauthorized' }, 401, {
    'www-authenticate': 'Bearer realm="lfp2p-bridge"'
  });
}

/**
 * Authorize a request via the Phase 4.3 multi-token registry, with
 * backward compat for the legacy single-token shape. Returns a
 * sentinel `__anonymous__` tokenId when no auth config is supplied,
 * so the downstream rate-limiter and audit have a stable key. A
 * misconfigured auth (caught by `normalizeAuthConfig`) becomes a
 * 503 — operator action required.
 */
function phaseFourThreeAuthorize(
  request: Request,
  options: BridgeHttpHandlerOptions
): AuthorizationOutcome {
  if (options.auth === undefined) {
    return Object.freeze({ status: 'authorized', tokenId: '__anonymous__' });
  }
  let normalized;
  try {
    normalized = normalizeAuthConfig(options.auth);
  } catch {
    return Object.freeze({ status: 'misconfigured' });
  }
  const nowMs = (options.now ?? Date.now)();
  return authorizeRequest(request, normalized, nowMs);
}

export const bridgeServicePlaceholder = {
  role: 'stateful-edge-actor' satisfies BridgeServiceRole,
  authoritativeForPrivateState: false
};

function statusCodeForBridgeResponse(response: BridgeDeliveryResponse): number {
  if (response.status === 'confirmed') return response.duplicate ? 200 : 202;
  if (response.status === 'conflicted') return 409;
  return 422;
}

// Phase 4.3: the legacy authorizeBridgeHttpRequest /
// isValidBridgeHttpAuthConfig / isValidBridgeAuthToken /
// constantTimeEqual helpers were inlined here pre-Phase-4.3. They
// were superseded by the multi-token registry in
// `./http-hardening.ts`, which is the single source of truth for
// auth shape validation, constant-time comparison, and token-format
// rules. We deliberately do NOT keep both paths to satisfy the
// project's "no duplicate code" standard.

/**
 * Phase 4.3 — text-taking variant. The handler reads the body via
 * `readRequestBodyWithCap` so the cap fires even for chunked / no-
 * Content-Length uploads; this function then parses the already-
 * read text.
 */
function parseDeliveryRequestJsonFromText(
  request: Request,
  text: string
):
  | Readonly<{ status: 'valid'; request: BridgeDeliveryRequest }>
  | Readonly<{ status: 'invalid'; idempotencyKey: string; reason: string }> {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return invalid('unknown', 'Request body must be a JSON object');
    const idempotencyKey = coerceString(parsed.idempotencyKey, 'idempotencyKey');
    const target = coerceString(parsed.target, 'target');
    if (!isRecord(parsed.event)) return invalid(idempotencyKey, 'event must be a JSON object');
    const headerKey = request.headers.get('x-lfp2p-idempotency-key');
    if (headerKey !== null && headerKey !== idempotencyKey) {
      return invalid(idempotencyKey, 'Idempotency header does not match request body');
    }
    return { status: 'valid', request: { idempotencyKey, target, event: parsed.event as SignedEventEnvelope } };
  } catch (error) {
    return invalid('unknown', `Invalid request body: ${normalizeErrorMessage(error)}`);
  }
}

function parseInboundReadRequestJsonFromText(
  text: string
):
  | Readonly<{ status: 'valid'; request: BridgeInboundReadRequest }>
  | Readonly<{ status: 'invalid'; reason: string }> {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return invalidRead('Request body must be a JSON object');
    const sourceId = coerceString(parsed.sourceId, 'sourceId');
    const streamId = coerceString(parsed.streamId, 'streamId');
    const scope = coerceString(parsed.scope, 'scope');
    const cursor = parsed.cursor === undefined ? undefined : coerceString(parsed.cursor, 'cursor');
    if (cursor !== undefined) parseReadCursor(cursor);
    const limit = parsed.limit === undefined ? undefined : coercePositiveInteger(parsed.limit, 'limit');
    if (limit !== undefined) normalizeReadLimit(limit);
    return {
      status: 'valid',
      request: {
        sourceId,
        streamId,
        scope,
        ...(cursor === undefined ? {} : { cursor }),
        ...(limit === undefined ? {} : { limit })
      }
    };
  } catch (error) {
    return invalidRead(normalizeErrorMessage(error));
  }
}

function parseReadCursor(cursor: string): number {
  requireNonEmpty(cursor, 'cursor');
  if (!/^\d+$/.test(cursor)) throw new Error('cursor must be a non-negative integer string');
  return requireSafeNonNegativeInteger(Number(cursor), 'cursor');
}

function normalizeReadLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_BRIDGE_INBOUND_READ_LIMIT;
  const normalized = requirePositiveInteger(limit, 'limit');
  if (normalized > MAX_BRIDGE_INBOUND_READ_LIMIT) throw new Error(`limit must be at most ${MAX_BRIDGE_INBOUND_READ_LIMIT}`);
  return normalized;
}

function jsonResponse(body: unknown, status: number, headers: JsonResponseHeaders = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers
    }
  });
}

function bridgeAuthMisconfiguredResponse(): Response {
  return jsonResponse({ reason: 'Bridge auth misconfigured' }, 503);
}

function invalid(idempotencyKey: string, reason: string): Readonly<{ status: 'invalid'; idempotencyKey: string; reason: string }> {
  return { status: 'invalid', idempotencyKey, reason };
}

function invalidRead(reason: string): Readonly<{ status: 'invalid'; reason: string }> {
  return { status: 'invalid', reason };
}

function rejected(idempotencyKey: string, reason: string): BridgeDeliveryResponse {
  return { status: 'rejected', idempotencyKey, reason };
}

function coerceString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} is required`);
  return value;
}

function coercePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be positive`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function bridgeRecordForTest(record: StoredBridgeRecord): StoredBridgeRecord {
  return record;
}