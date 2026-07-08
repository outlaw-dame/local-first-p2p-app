/**
 * Pure shape validators for identity-control events.
 *
 * The validators mirror the Phase 1.61 pattern: validate the unsigned
 * envelope shape and payload before any projection mutation. They
 * never touch storage, never fetch, never resolve a public key. They
 * verify:
 *
 *  - the event `version`, `kind`, `payload` shape;
 *  - field types and length bounds;
 *  - the public-key wire format;
 *  - prototype-pollution defense (forbidden property names);
 *  - payload size cap;
 *  - per-kind cross-checks (e.g. `rotated.previousPublicKey !== newPublicKey`).
 *
 * The projection (`applyIdentityControlEvent`) consumes validated
 * events and enforces lifecycle/authority constraints that depend on
 * existing state.
 */
import { identityError } from './errors.js';

export const IDENTITY_EVENT_VERSION = 'lfp2p.identity-event.v1' as const;

/**
 * The full set of identity-control event kinds. Order pinned for
 * stable enumeration.
 */
export const IDENTITY_EVENT_KINDS = [
  'identity.controller.created',
  'identity.device.authorized',
  'identity.device.revoked',
  'identity.device.rotated',
  'identity.capability.granted',
  'identity.capability.revoked',
  'identity.contact-card.published'
] as const;
export type IdentityEventKind = (typeof IDENTITY_EVENT_KINDS)[number];

const FORBIDDEN_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toString',
  'toLocaleString',
  'valueOf'
]);

const MAX_ID_LENGTH = 256;
const MAX_SCOPE_LENGTH = 256;
const MAX_PAYLOAD_BYTES = 16 * 1024;

/**
 * Public key wire format. We accept base64-url-encoded keys (the
 * format produced by `@lfp2p/crypto`'s signing helpers) with a
 * conservative length bound that allows for Ed25519 (43 chars) and
 * future RSA/Dilithium (longer) without collapsing on a single
 * algorithm. The bound is structural; algorithm fitness lives in
 * `@lfp2p/crypto`.
 */
const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{1,2048}$/;

/**
 * Digest reference for contact-card events. Accept the same
 * canonical form as `@lfp2p/content-addressing`'s `DigestRef`
 * stringification: `algorithm:base64url`. We do not import the
 * package here to avoid a layering cycle (identity is below
 * content-addressing in dependency order at the contract level).
 */
const DIGEST_REF_PATTERN = /^(sha-256|sha-512|blake3):[A-Za-z0-9_-]{20,4096}$/;

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type ValidatedIdentityEventCommon = Readonly<{
  version: typeof IDENTITY_EVENT_VERSION;
  kind: IdentityEventKind;
  /**
   * The deeply-validated, frozen payload. Caller must not mutate.
   */
  payload: Readonly<Record<string, unknown>>;
}>;

export type ValidatedIdentityEvent =
  | (ValidatedIdentityEventCommon &
      Readonly<{
        kind: 'identity.controller.created';
        payload: Readonly<{ controllerPublicKey: string; initialDeviceId: string }>;
      }>)
  | (ValidatedIdentityEventCommon &
      Readonly<{
        kind: 'identity.device.authorized';
        payload: Readonly<{
          authorizedDeviceId: string;
          authorizedPublicKey: string;
          epoch: number;
          wrapPublicKey?: string;
          wrapKeyRef?: string;
        }>;
      }>)
  | (ValidatedIdentityEventCommon &
      Readonly<{
        kind: 'identity.device.revoked';
        payload: Readonly<{ revokedDeviceId: string; epoch: number }>;
      }>)
  | (ValidatedIdentityEventCommon &
      Readonly<{
        kind: 'identity.device.rotated';
        payload: Readonly<{
          deviceId: string;
          previousPublicKey: string;
          newPublicKey: string;
          epoch: number;
        }>;
      }>)
  | (ValidatedIdentityEventCommon &
      Readonly<{
        kind: 'identity.capability.granted';
        payload: Readonly<{
          capabilityId: string;
          delegateDeviceId: string;
          scope: string;
          expiresAt: string;
        }>;
      }>)
  | (ValidatedIdentityEventCommon &
      Readonly<{
        kind: 'identity.capability.revoked';
        payload: Readonly<{ capabilityId: string; delegateDeviceId: string }>;
      }>)
  | (ValidatedIdentityEventCommon &
      Readonly<{
        kind: 'identity.contact-card.published';
        payload: Readonly<{ contactCardDigest: string; capturedAt: string }>;
      }>);

/**
 * Pure validator: takes an unknown value, returns a strongly-typed
 * frozen ValidatedIdentityEvent or throws `IdentityError`.
 *
 * The validator does NOT sign-verify the envelope; that is the
 * caller's responsibility (see `@lfp2p/protocol/validateSignedEvent`).
 * The validator does NOT consult any projection state; lifecycle
 * checks live in the projection.
 */
export function validateIdentityEvent(value: unknown): ValidatedIdentityEvent {
  const record = assertPlainObject(value, 'IdentityEvent');
  assertVersion(record.version, 'IdentityEvent.version');
  const kind = assertEventKind(record.kind, 'IdentityEvent.kind');
  const payload = assertPlainObject(record.payload, 'IdentityEvent.payload');
  assertPayloadByteSize(payload, 'IdentityEvent.payload');

  switch (kind) {
    case 'identity.controller.created':
      return Object.freeze({
        version: IDENTITY_EVENT_VERSION,
        kind,
        payload: Object.freeze({
          controllerPublicKey: assertPublicKey(
            payload.controllerPublicKey,
            'payload.controllerPublicKey'
          ),
          initialDeviceId: assertId(payload.initialDeviceId, 'payload.initialDeviceId')
        })
      }) as ValidatedIdentityEvent;
    case 'identity.device.authorized': {
      const wrapPublicKey = assertOptionalPublicKey(payload.wrapPublicKey, 'payload.wrapPublicKey');
      const wrapKeyRef = assertOptionalId(payload.wrapKeyRef, 'payload.wrapKeyRef');
      if ((wrapPublicKey === undefined) !== (wrapKeyRef === undefined)) {
        throw identityError(
          'IDENTITY_INVALID_INPUT',
          'identity.device.authorized payload.wrapPublicKey and payload.wrapKeyRef must be present together'
        );
      }
      return Object.freeze({
        version: IDENTITY_EVENT_VERSION,
        kind,
        payload: Object.freeze({
          authorizedDeviceId: assertId(payload.authorizedDeviceId, 'payload.authorizedDeviceId'),
          authorizedPublicKey: assertPublicKey(
            payload.authorizedPublicKey,
            'payload.authorizedPublicKey'
          ),
          epoch: assertPositiveInteger(payload.epoch, 'payload.epoch'),
          ...(wrapPublicKey === undefined ? {} : { wrapPublicKey }),
          ...(wrapKeyRef === undefined ? {} : { wrapKeyRef })
        })
      }) as ValidatedIdentityEvent;
    }
    case 'identity.device.revoked':
      return Object.freeze({
        version: IDENTITY_EVENT_VERSION,
        kind,
        payload: Object.freeze({
          revokedDeviceId: assertId(payload.revokedDeviceId, 'payload.revokedDeviceId'),
          epoch: assertPositiveInteger(payload.epoch, 'payload.epoch')
        })
      }) as ValidatedIdentityEvent;
    case 'identity.device.rotated': {
      const deviceId = assertId(payload.deviceId, 'payload.deviceId');
      const previousPublicKey = assertPublicKey(
        payload.previousPublicKey,
        'payload.previousPublicKey'
      );
      const newPublicKey = assertPublicKey(payload.newPublicKey, 'payload.newPublicKey');
      if (previousPublicKey === newPublicKey) {
        throw identityError(
          'IDENTITY_DEVICE_REUSE',
          'identity.device.rotated payload.newPublicKey must differ from payload.previousPublicKey'
        );
      }
      return Object.freeze({
        version: IDENTITY_EVENT_VERSION,
        kind,
        payload: Object.freeze({
          deviceId,
          previousPublicKey,
          newPublicKey,
          epoch: assertPositiveInteger(payload.epoch, 'payload.epoch')
        })
      }) as ValidatedIdentityEvent;
    }
    case 'identity.capability.granted': {
      const expiresAt = assertIso8601(payload.expiresAt, 'payload.expiresAt');
      return Object.freeze({
        version: IDENTITY_EVENT_VERSION,
        kind,
        payload: Object.freeze({
          capabilityId: assertId(payload.capabilityId, 'payload.capabilityId'),
          delegateDeviceId: assertId(payload.delegateDeviceId, 'payload.delegateDeviceId'),
          scope: assertScope(payload.scope, 'payload.scope'),
          expiresAt
        })
      }) as ValidatedIdentityEvent;
    }
    case 'identity.capability.revoked':
      return Object.freeze({
        version: IDENTITY_EVENT_VERSION,
        kind,
        payload: Object.freeze({
          capabilityId: assertId(payload.capabilityId, 'payload.capabilityId'),
          delegateDeviceId: assertId(payload.delegateDeviceId, 'payload.delegateDeviceId')
        })
      }) as ValidatedIdentityEvent;
    case 'identity.contact-card.published':
      return Object.freeze({
        version: IDENTITY_EVENT_VERSION,
        kind,
        payload: Object.freeze({
          contactCardDigest: assertDigestRef(
            payload.contactCardDigest,
            'payload.contactCardDigest'
          ),
          capturedAt: assertIso8601(payload.capturedAt, 'payload.capturedAt')
        })
      }) as ValidatedIdentityEvent;
  }
}

// ---------------------------------------------------------------------------
// Field-level asserts
// ---------------------------------------------------------------------------

export function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw identityError('IDENTITY_INVALID_INPUT', `${label} must be a plain object`);
  }
  for (const k of Object.keys(value)) {
    if (FORBIDDEN_PROPERTY_NAMES.has(k)) {
      throw identityError(
        'IDENTITY_FORBIDDEN_KEY',
        `${label} contains forbidden property name "${k}" (prototype-pollution defense)`
      );
    }
  }
  return value as Record<string, unknown>;
}

function assertVersion(value: unknown, label: string): typeof IDENTITY_EVENT_VERSION {
  if (typeof value !== 'string') {
    throw identityError('IDENTITY_INVALID_INPUT', `${label} must be a string`);
  }
  if (value !== IDENTITY_EVENT_VERSION) {
    throw identityError(
      'IDENTITY_UNKNOWN_VERSION',
      `${label} must equal "${IDENTITY_EVENT_VERSION}" (got "${value}")`
    );
  }
  return IDENTITY_EVENT_VERSION;
}

function assertEventKind(value: unknown, label: string): IdentityEventKind {
  if (typeof value !== 'string') {
    throw identityError('IDENTITY_INVALID_INPUT', `${label} must be a string`);
  }
  if (!(IDENTITY_EVENT_KINDS as readonly string[]).includes(value)) {
    throw identityError(
      'IDENTITY_UNKNOWN_KIND',
      `${label} must be one of ${IDENTITY_EVENT_KINDS.join(', ')} (got "${value}")`
    );
  }
  return value as IdentityEventKind;
}

function assertId(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw identityError('IDENTITY_INVALID_ID', `${label} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw identityError('IDENTITY_INVALID_ID', `${label} must be non-empty`);
  }
  if (trimmed.length > MAX_ID_LENGTH) {
    throw identityError(
      'IDENTITY_INVALID_ID',
      `${label} must be at most ${MAX_ID_LENGTH} characters (got ${trimmed.length})`
    );
  }
  if (FORBIDDEN_PROPERTY_NAMES.has(trimmed)) {
    throw identityError(
      'IDENTITY_FORBIDDEN_KEY',
      `${label} must not be a reserved property name (got "${trimmed}")`
    );
  }
  return trimmed;
}

function assertOptionalId(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return assertId(value, label);
}

function assertPublicKey(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw identityError('IDENTITY_INVALID_PUBLIC_KEY', `${label} must be a string`);
  }
  if (!PUBLIC_KEY_PATTERN.test(value)) {
    throw identityError(
      'IDENTITY_INVALID_PUBLIC_KEY',
      `${label} must be a base64url-encoded public key (1-2048 chars, [A-Za-z0-9_-])`
    );
  }
  return value;
}

function assertOptionalPublicKey(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return assertPublicKey(value, label);
}

function assertPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw identityError('IDENTITY_INVALID_NUMBER', `${label} must be a safe positive integer`);
  }
  return value;
}

function assertScope(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw identityError('IDENTITY_INVALID_SCOPE', `${label} must be a string`);
  }
  if (value.length === 0 || value.length > MAX_SCOPE_LENGTH) {
    throw identityError(
      'IDENTITY_INVALID_SCOPE',
      `${label} must be 1-${MAX_SCOPE_LENGTH} characters (got ${value.length})`
    );
  }
  return value;
}

function assertIso8601(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw identityError('IDENTITY_INVALID_TIMESTAMP', `${label} must be a string`);
  }
  if (!Number.isFinite(Date.parse(value))) {
    throw identityError('IDENTITY_INVALID_TIMESTAMP', `${label} must be an ISO-8601 timestamp`);
  }
  return value;
}

function assertDigestRef(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw identityError('IDENTITY_INVALID_DIGEST', `${label} must be a string`);
  }
  if (!DIGEST_REF_PATTERN.test(value)) {
    throw identityError(
      'IDENTITY_INVALID_DIGEST',
      `${label} must be of the form "<algorithm>:<base64url>" with a known algorithm`
    );
  }
  return value;
}

function assertPayloadByteSize(payload: object, label: string): void {
  // JSON.stringify is sufficient: payloads ride inside SignedEventEnvelope
  // which is already capped by the protocol layer. This is a
  // belt-and-suspenders check so an oversized payload that slipped
  // upstream cannot land in the identity projection.
  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_PAYLOAD_BYTES) {
    throw identityError(
      'IDENTITY_PAYLOAD_TOO_LARGE',
      `${label} serialized size ${serialized.length} exceeds cap ${MAX_PAYLOAD_BYTES}`
    );
  }
}
