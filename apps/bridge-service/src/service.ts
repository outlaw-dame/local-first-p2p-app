import { verifySignedEventEnvelope } from '@lfp2p/crypto';
import { type SignedEventEnvelope, validateSignedEvent } from '@lfp2p/protocol';
import { InMemoryBridgeStore } from './stores.js';
import {
  type BridgeDeliveryRequest,
  type BridgeDeliveryResponse,
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

export class BridgeService {
  readonly role: BridgeServiceRole;
  readonly authoritativeForPrivateState = false as const;
  readonly store: BridgeServiceOptions['store'];

  constructor(options: BridgeServiceOptions) {
    this.role = options.role ?? 'stateful-edge-actor';
    this.store = options.store;
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
      ...(normalized.role === undefined ? {} : { role: normalized.role })
    });
  }
}

export async function handleBridgeDeliveryRequest(
  service: BridgeService,
  request: Request,
  now = new Date().toISOString()
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ status: 'rejected', idempotencyKey: 'unknown', reason: 'Method not allowed' }, 405);
  }

  const parsed = await parseDeliveryRequestJson(request);
  if (parsed.status === 'invalid') {
    return jsonResponse({ status: 'rejected', idempotencyKey: parsed.idempotencyKey, reason: parsed.reason }, 400);
  }

  const response = await service.acceptDelivery(parsed.request, now);
  return jsonResponse(response, statusCodeForBridgeResponse(response));
}

export async function handleBridgeInboundReadRequest(
  service: BridgeService,
  request: Request,
  now = new Date().toISOString()
): Promise<Response> {
  if (request.method !== 'POST') return jsonResponse({ reason: 'Method not allowed' }, 405);

  const parsed = await parseInboundReadRequestJson(request);
  if (parsed.status === 'invalid') return jsonResponse({ reason: parsed.reason }, 400);

  try {
    return jsonResponse(await service.readInboundRecords(parsed.request, now), 200);
  } catch {
    return jsonResponse({ reason: 'Bridge inbound read failed' }, 503);
  }
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

async function parseDeliveryRequestJson(
  request: Request
): Promise<
  | Readonly<{ status: 'valid'; request: BridgeDeliveryRequest }>
  | Readonly<{ status: 'invalid'; idempotencyKey: string; reason: string }>
> {
  try {
    const parsed: unknown = await request.json();
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

async function parseInboundReadRequestJson(
  request: Request
): Promise<
  | Readonly<{ status: 'valid'; request: BridgeInboundReadRequest }>
  | Readonly<{ status: 'invalid'; reason: string }>
> {
  try {
    const parsed: unknown = await request.json();
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

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
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
