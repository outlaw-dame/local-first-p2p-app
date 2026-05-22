import { verifySignedEventEnvelope } from '@lfp2p/crypto';
import { type PrivacyScope, type SignedEventEnvelope, validateSignedEvent } from '@lfp2p/protocol';

export type BridgeServiceRole = 'stateful-edge-actor' | 'persistent-availability-peer';
export type BridgeDeliveryStatus = 'confirmed' | 'conflicted' | 'rejected';

export type BridgeDeliveryRequest = Readonly<{
  idempotencyKey: string;
  target: string;
  event: SignedEventEnvelope;
  receivedAt?: string;
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

export type BridgeRecord = Readonly<{
  idempotencyKey: string;
  target: string;
  eventId: string;
  author: string;
  privacy: PrivacyScope;
  sequence: number;
  acceptedAt: string;
}>;

export type BridgeServiceSnapshot = Readonly<{
  role: BridgeServiceRole;
  authoritativeForPrivateState: false;
  acceptedCount: number;
}>;

const BRIDGE_ALLOWED_PRIVACY_SCOPES = new Set<PrivacyScope>(['dm', 'group', 'public']);

export class InMemoryBridgeService {
  readonly #recordsByIdempotencyKey = new Map<string, BridgeRecord>();
  #sequence = 0;

  readonly role: BridgeServiceRole;
  readonly authoritativeForPrivateState = false as const;

  constructor(role: BridgeServiceRole = 'stateful-edge-actor') {
    this.role = role;
  }

  acceptDelivery(request: BridgeDeliveryRequest, now = new Date().toISOString()): BridgeDeliveryResponse {
    const idempotencyKey = requireNonEmpty(request.idempotencyKey, 'idempotencyKey');
    const target = requireNonEmpty(request.target, 'target');
    requireIsoDate(now, 'now');

    try {
      validateSignedEvent(request.event);
    } catch (error) {
      return rejected(idempotencyKey, `Invalid signed event envelope: ${normalizeErrorMessage(error)}`);
    }

    const existing = this.#recordsByIdempotencyKey.get(idempotencyKey);
    if (existing) {
      if (existing.eventId !== request.event.eventId) {
        return {
          status: 'conflicted',
          idempotencyKey,
          reason: 'Idempotency key already belongs to a different event',
          existingEventId: existing.eventId
        };
      }

      return {
        status: 'confirmed',
        idempotencyKey,
        eventId: existing.eventId,
        sequence: existing.sequence,
        acceptedAt: existing.acceptedAt,
        duplicate: true
      };
    }

    if (!BRIDGE_ALLOWED_PRIVACY_SCOPES.has(request.event.privacy)) {
      return rejected(idempotencyKey, `Bridge cannot accept ${request.event.privacy} scoped events`);
    }

    if (!verifySignedEventEnvelope(request.event)) {
      return rejected(idempotencyKey, 'Event signature verification failed');
    }

    const acceptedAt = request.receivedAt ?? now;
    requireIsoDate(acceptedAt, 'receivedAt');
    const record: BridgeRecord = {
      idempotencyKey,
      target,
      eventId: request.event.eventId,
      author: request.event.author,
      privacy: request.event.privacy,
      sequence: this.#nextSequence(),
      acceptedAt
    };
    this.#recordsByIdempotencyKey.set(idempotencyKey, record);

    return {
      status: 'confirmed',
      idempotencyKey,
      eventId: record.eventId,
      sequence: record.sequence,
      acceptedAt: record.acceptedAt,
      duplicate: false
    };
  }

  getRecord(idempotencyKey: string): BridgeRecord | undefined {
    return this.#recordsByIdempotencyKey.get(idempotencyKey);
  }

  snapshot(): BridgeServiceSnapshot {
    return {
      role: this.role,
      authoritativeForPrivateState: false,
      acceptedCount: this.#recordsByIdempotencyKey.size
    };
  }

  #nextSequence(): number {
    this.#sequence += 1;
    return this.#sequence;
  }
}

export async function handleBridgeDeliveryRequest(
  service: InMemoryBridgeService,
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

  const response = service.acceptDelivery(parsed.request, now);
  return jsonResponse(response, statusCodeForBridgeResponse(response));
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
    const bridgeRequest: BridgeDeliveryRequest = {
      idempotencyKey,
      target,
      event: parsed.event as SignedEventEnvelope
    };
    return { status: 'valid', request: bridgeRequest };
  } catch (error) {
    return invalid('unknown', `Invalid request body: ${normalizeErrorMessage(error)}`);
  }
}

function jsonResponse(body: BridgeDeliveryResponse, status: number): Response {
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

function rejected(idempotencyKey: string, reason: string): BridgeDeliveryResponse {
  return { status: 'rejected', idempotencyKey, reason };
}

function coerceString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} is required`);
  return value;
}

function requireNonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} is required`);
  return value;
}

function requireIsoDate(value: string, label: string): string {
  requireNonEmpty(value, label);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO date string`);
  return value;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return 'unknown validation error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
