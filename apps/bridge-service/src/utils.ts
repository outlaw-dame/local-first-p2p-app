import { type SignedEventEnvelope, validateSignedEvent } from '@lfp2p/protocol';
import {
  type BridgeDeliveryResponse,
  type BridgeRecord,
  type JsonBridgeStoreState,
  type MutableJsonBridgeStoreState,
  type StoredBridgeRecord,
  type StoredBridgeRecordDraft
} from './types.js';

export const BRIDGE_ALLOWED_PRIVACY_SCOPES = new Set(['dm', 'group', 'public']);
export const DEFAULT_MAX_RECORDS = 10_000;
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function confirmed(record: StoredBridgeRecord, duplicate: boolean): BridgeDeliveryResponse {
  return {
    status: 'confirmed',
    idempotencyKey: record.idempotencyKey,
    eventId: record.eventId,
    sequence: record.sequence,
    acceptedAt: record.acceptedAt,
    duplicate
  };
}

export function responseForExistingRecord(
  existing: StoredBridgeRecord,
  idempotencyKey: string,
  target: string,
  event: SignedEventEnvelope
): BridgeDeliveryResponse {
  if (existing.eventId !== event.eventId) {
    return {
      status: 'conflicted',
      idempotencyKey,
      reason: 'Idempotency key already belongs to a different event',
      existingEventId: existing.eventId
    };
  }

  if (existing.target !== target) {
    return {
      status: 'conflicted',
      idempotencyKey,
      reason: 'Idempotency key already belongs to a different target',
      existingEventId: existing.eventId
    };
  }

  return confirmed(existing, true);
}

export function withoutExpiry(record: StoredBridgeRecord | undefined): BridgeRecord | undefined {
  if (!record) return undefined;
  return {
    idempotencyKey: record.idempotencyKey,
    target: record.target,
    eventId: record.eventId,
    author: record.author,
    privacy: record.privacy,
    sequence: record.sequence,
    acceptedAt: record.acceptedAt
  };
}

export function withAllocatedSequence(
  record: StoredBridgeRecordDraft,
  sequence: number
): StoredBridgeRecord {
  return { ...record, sequence };
}

export function nextSequence(currentSequence: number, nowMs: number): number {
  return Math.max(currentSequence + 1, Math.min(nowMs * 1000, Number.MAX_SAFE_INTEGER - 1));
}

export function nextSequenceForState(state: MutableJsonBridgeStoreState, nowMs: number): number {
  state.latestSequence = nextSequence(state.latestSequence, nowMs);
  return state.latestSequence;
}

export function pruneExpiredRecords(state: MutableJsonBridgeStoreState, nowMs: number): boolean {
  const previousLength = state.records.length;
  state.records = state.records.filter((record) => Date.parse(record.expiresAt) > nowMs);
  return state.records.length !== previousLength;
}

export function validateJsonBridgeStoreState(
  value: unknown,
  initialSequence: number
): JsonBridgeStoreState {
  if (!isRecord(value)) throw new Error('Bridge store state must be a JSON object');
  if (value.recordType !== 'lfp2p.bridge.store.v1')
    throw new Error('Unsupported bridge store record type');
  const latestSequence = requireSafeNonNegativeInteger(
    Number(value.latestSequence),
    'latestSequence'
  );
  if (!Array.isArray(value.records)) throw new Error('Bridge store records must be an array');
  const records = value.records.map((record) => {
    if (!isRecord(record)) throw new Error('Bridge store record must be a JSON object');
    return validateStoredBridgeRecord(record as Partial<StoredBridgeRecord>);
  });

  return {
    recordType: 'lfp2p.bridge.store.v1',
    latestSequence: Math.max(
      initialSequence,
      latestSequence,
      ...records.map((record) => record.sequence)
    ),
    records
  };
}

export function validateStoredBridgeRecord(
  record: Partial<StoredBridgeRecord>
): StoredBridgeRecord {
  const metadata = validateStoredBridgeRecordMetadata(record);
  return {
    ...metadata,
    sequence: requireSafeNonNegativeInteger(Number(record.sequence), 'record.sequence'),
    ...(record.event === undefined ? {} : { event: validateStoredEvent(record.event) })
  };
}

export function validateStoredBridgeRecordDraft(
  record: Partial<StoredBridgeRecordDraft>
): StoredBridgeRecordDraft {
  return {
    ...validateStoredBridgeRecordMetadata(record),
    event: validateStoredEvent(record.event)
  };
}

export function mutableState(state: JsonBridgeStoreState): MutableJsonBridgeStoreState {
  return {
    recordType: state.recordType,
    latestSequence: state.latestSequence,
    records: state.records.map((record) => ({ ...record }))
  };
}

export function requireNonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${label} is required`);
  return value;
}

export function requireIsoDate(value: string, label: string): number {
  requireNonEmpty(value, label);
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new Error(`${label} must be an ISO date string`);
  return millis;
}

export function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be positive`);
  return value;
}

export function requireSafeNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a safe non-negative integer`);
  return value;
}

export function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return 'unknown validation error';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function validateStoredBridgeRecordMetadata(
  record: Partial<StoredBridgeRecord>
): Omit<StoredBridgeRecord, 'sequence' | 'event'> {
  const idempotencyKey = requireNonEmpty(
    String(record.idempotencyKey ?? ''),
    'record.idempotencyKey'
  );
  const target = requireNonEmpty(String(record.target ?? ''), 'record.target');
  const eventId = requireNonEmpty(String(record.eventId ?? ''), 'record.eventId');
  const author = requireNonEmpty(String(record.author ?? ''), 'record.author');
  const privacy = record.privacy;
  if (privacy !== 'dm' && privacy !== 'group' && privacy !== 'public') {
    throw new Error('record.privacy must be bridge-safe');
  }
  const acceptedAt = requireNonEmpty(String(record.acceptedAt ?? ''), 'record.acceptedAt');
  requireIsoDate(acceptedAt, 'record.acceptedAt');
  const expiresAt = requireNonEmpty(String(record.expiresAt ?? ''), 'record.expiresAt');
  requireIsoDate(expiresAt, 'record.expiresAt');

  return { idempotencyKey, target, eventId, author, privacy, acceptedAt, expiresAt };
}

function validateStoredEvent(value: unknown): SignedEventEnvelope {
  if (!isRecord(value)) throw new Error('record.event must be a JSON object');
  const event = value as SignedEventEnvelope;
  validateSignedEvent(event);
  return event;
}
