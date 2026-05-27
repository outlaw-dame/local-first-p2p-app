const EVENT_KINDS = [
  'identity.device.created',
  'identity.controller.created',
  'identity.device.authorized',
  'identity.device.revoked',
  'identity.capability.granted',
  'identity.capability.revoked',
  'contact.petname.set',
  'note.created',
  'outbox.test.created'
] as const;

const PRIVACY_SCOPES = ['device-local', 'self', 'dm', 'group', 'public'] as const;

export type EventKind = (typeof EVENT_KINDS)[number];
export type PrivacyScope = (typeof PRIVACY_SCOPES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

export type SourceRef = Readonly<{
  sourceId: string;
  sequence?: number;
  hash?: string;
}>;

export type UnsignedEventEnvelope = Readonly<{
  version: 'lfp2p.event.v1';
  eventId: string;
  kind: EventKind;
  author: string;
  deviceId: string;
  createdAt: string;
  lamport: number;
  privacy: PrivacyScope;
  schemaVersion: number;
  payload: JsonObject;
  refs?: readonly SourceRef[];
}>;

export type SignedEventEnvelope = UnsignedEventEnvelope &
  Readonly<{
    signature: Readonly<{
      algorithm: 'ed25519';
      publicKey: string;
      value: string;
    }>;
  }>;

export type CreateEventInput = Readonly<{
  eventId: string;
  kind: EventKind;
  author: string;
  deviceId: string;
  createdAt: string;
  lamport?: number;
  privacy: PrivacyScope;
  payload: JsonObject;
  refs?: readonly SourceRef[];
  schemaVersion?: number;
}>;

export function createUnsignedEvent(input: CreateEventInput): UnsignedEventEnvelope {
  const event: UnsignedEventEnvelope = {
    version: 'lfp2p.event.v1',
    eventId: requireNonEmpty(input.eventId, 'eventId'),
    kind: requireEventKind(input.kind),
    author: requireNonEmpty(input.author, 'author'),
    deviceId: requireNonEmpty(input.deviceId, 'deviceId'),
    createdAt: requireIsoDate(input.createdAt),
    lamport: requireSafeNonNegativeInteger(input.lamport ?? 0, 'lamport'),
    privacy: requirePrivacyScope(input.privacy),
    schemaVersion: requireSafePositiveInteger(input.schemaVersion ?? 1, 'schemaVersion'),
    payload: assertJsonObject(input.payload, 'payload'),
    ...(input.refs === undefined ? {} : { refs: input.refs.map(validateSourceRef) })
  };

  validateUnsignedEvent(event);
  return event;
}

export function validateUnsignedEvent(event: UnsignedEventEnvelope): void {
  if (event.version !== 'lfp2p.event.v1') throw new Error('Unsupported event version');
  requireNonEmpty(event.eventId, 'eventId');
  requireEventKind(event.kind);
  requireNonEmpty(event.author, 'author');
  requireNonEmpty(event.deviceId, 'deviceId');
  requireIsoDate(event.createdAt);
  requireSafeNonNegativeInteger(event.lamport, 'lamport');
  requirePrivacyScope(event.privacy);
  requireSafePositiveInteger(event.schemaVersion, 'schemaVersion');
  assertJsonObject(event.payload, 'payload');
  validatePayloadForKind(event.kind, event.payload, event.privacy);
  event.refs?.forEach(validateSourceRef);
}

export function validateSignedEvent(event: SignedEventEnvelope): void {
  validateUnsignedEvent(event);
  if (event.signature.algorithm !== 'ed25519') throw new Error('Unsupported signature algorithm');
  requireNonEmpty(event.signature.publicKey, 'signature.publicKey');
  requireNonEmpty(event.signature.value, 'signature.value');
}

export function unsignedProjection(event: SignedEventEnvelope): UnsignedEventEnvelope {
  return {
    version: event.version,
    eventId: event.eventId,
    kind: event.kind,
    author: event.author,
    deviceId: event.deviceId,
    createdAt: event.createdAt,
    lamport: event.lamport,
    privacy: event.privacy,
    schemaVersion: event.schemaVersion,
    payload: event.payload,
    ...(event.refs === undefined ? {} : { refs: event.refs })
  };
}

export function canonicalizeJson(value: JsonValue | UnsignedEventEnvelope): string {
  return JSON.stringify(toCanonical(value));
}

export function isEventKind(value: unknown): value is EventKind {
  return typeof value === 'string' && EVENT_KINDS.includes(value as EventKind);
}

export function isPrivacyScope(value: unknown): value is PrivacyScope {
  return typeof value === 'string' && PRIVACY_SCOPES.includes(value as PrivacyScope);
}

function toCanonical(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(toCanonical);
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot canonicalize non-finite number');
    return value;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = toCanonical(record[key]);
        return acc;
      }, {});
  }
  throw new Error(`Cannot canonicalize value of type ${typeof value}`);
}

function validateSourceRef(ref: SourceRef): SourceRef {
  requireNonEmpty(ref.sourceId, 'ref.sourceId');
  if (ref.sequence !== undefined) requireSafeNonNegativeInteger(ref.sequence, 'ref.sequence');
  if (ref.hash !== undefined) requireNonEmpty(ref.hash, 'ref.hash');
  return ref;
}

function requireEventKind(value: EventKind): EventKind {
  if (!isEventKind(value)) throw new Error(`Unsupported event kind: ${String(value)}`);
  return value;
}

function requirePrivacyScope(value: PrivacyScope): PrivacyScope {
  if (!isPrivacyScope(value)) throw new Error(`Unsupported privacy scope: ${String(value)}`);
  return value;
}

function assertJsonObject(value: JsonObject, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  canonicalizeJson(value);
  return value;
}

function requireNonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireIsoDate(value: string): string {
  requireNonEmpty(value, 'createdAt');
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new Error('createdAt must be an ISO date string');
  return value;
}

function requireSafeNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a safe non-negative integer`);
  }
  return value;
}

function requireSafePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a safe positive integer`);
  }
  return value;
}

function validatePayloadForKind(kind: EventKind, payload: JsonObject, privacy: PrivacyScope): void {
  switch (kind) {
    case 'identity.controller.created': {
      requirePrivacyForIdentityEvent(privacy, kind);
      requireObjectString(payload, 'controllerPublicKey', kind);
      requireObjectString(payload, 'initialDeviceId', kind);
      break;
    }
    case 'identity.device.authorized': {
      requirePrivacyForIdentityEvent(privacy, kind);
      requireObjectString(payload, 'authorizedDeviceId', kind);
      requireObjectString(payload, 'authorizedPublicKey', kind);
      requireObjectSafePositiveInteger(payload, 'epoch', kind);
      break;
    }
    case 'identity.device.revoked': {
      requirePrivacyForIdentityEvent(privacy, kind);
      requireObjectString(payload, 'revokedDeviceId', kind);
      requireObjectSafePositiveInteger(payload, 'epoch', kind);
      break;
    }
    case 'identity.capability.granted': {
      requirePrivacyForIdentityEvent(privacy, kind);
      requireObjectString(payload, 'capabilityId', kind);
      requireObjectString(payload, 'delegateDeviceId', kind);
      requireObjectString(payload, 'scope', kind);
      requireObjectIsoDate(payload, 'expiresAt', kind);
      break;
    }
    case 'identity.capability.revoked': {
      requirePrivacyForIdentityEvent(privacy, kind);
      requireObjectString(payload, 'capabilityId', kind);
      requireObjectString(payload, 'delegateDeviceId', kind);
      break;
    }
    default:
      break;
  }
}

function requirePrivacyForIdentityEvent(privacy: PrivacyScope, kind: EventKind): void {
  if (privacy !== 'self') {
    throw new Error(`${kind} must use privacy scope self`);
  }
}

function requireObjectString(payload: JsonObject, field: string, kind: EventKind): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${kind} payload.${field} must be a non-empty string`);
  }
  return value;
}

function requireObjectSafePositiveInteger(payload: JsonObject, field: string, kind: EventKind): number {
  const value = payload[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${kind} payload.${field} must be a safe positive integer`);
  }
  return value;
}

function requireObjectIsoDate(payload: JsonObject, field: string, kind: EventKind): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.trim().length === 0 || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${kind} payload.${field} must be an ISO date string`);
  }
  return value;
}
