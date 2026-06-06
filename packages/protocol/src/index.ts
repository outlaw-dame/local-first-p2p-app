const EVENT_KINDS = [
  'identity.device.created',
  'identity.controller.created',
  'identity.device.authorized',
  'identity.device.revoked',
  'identity.device.rotated',
  'identity.capability.granted',
  'identity.capability.revoked',
  'identity.contact-card.published',
  'contact.petname.set',
  'note.created',
  'outbox.test.created',
  // Phase 1.8.14 — reputation events promoted to first-class
  // protocol kinds so they can ride SignedEventEnvelope, traverse
  // bridge admission (Phase 1.64), and route automatically at the
  // sync-client inbound layer. Structural-only validation here —
  // semantic validation continues in `@lfp2p/trust-safety` at the
  // persistence boundary (defense in depth).
  'reputation.observation.recorded',
  'reputation.attestation.published',
  'reputation.attestation.revoked',
  'reputation.aggregator.published',
  'reputation.aggregator.score.removed'
] as const;

/**
 * Phase 1.8.14 — Doctrine-bound privacy rules for reputation kinds.
 *
 * Aggregator events are PUBLIC broadcasts from labelers (no other
 * privacy makes semantic sense — a private aggregator score reaches
 * no one). Observation / attestation / revocation events are the
 * user's own counters / endorsements — doctrine non-negotiable #2
 * keeps them `device-local` by default, with `self` reserved for the
 * Phase 5.0 cross-device envelope wrapping.
 *
 * Enforced by `validatePayloadPrivacyScope` so any envelope built
 * with the wrong privacy fails at the protocol boundary, NOT later.
 */
const REPUTATION_KIND_ALLOWED_PRIVACY = Object.freeze<
  Readonly<Record<string, ReadonlyArray<PrivacyScope>>>
>({
  'reputation.aggregator.published': ['public'],
  'reputation.aggregator.score.removed': ['public'],
  'reputation.observation.recorded': ['device-local', 'self'],
  'reputation.attestation.published': ['device-local', 'self'],
  'reputation.attestation.revoked': ['device-local', 'self']
});

export const REPUTATION_EVENT_PAYLOAD_VERSION = 'lfp2p.reputation-event.v1' as const;
export type ReputationEventPayloadVersion = typeof REPUTATION_EVENT_PAYLOAD_VERSION;

function isReputationKind(kind: string): boolean {
  return kind.startsWith('reputation.');
}

export function isReputationEventKind(value: unknown): boolean {
  return typeof value === 'string' && isEventKind(value) && isReputationKind(value);
}

const PRIVACY_SCOPES = ['device-local', 'self', 'dm', 'group', 'public'] as const;

export type EventKind = (typeof EVENT_KINDS)[number];
export type PrivacyScope = (typeof PRIVACY_SCOPES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

export const PRIVATE_PAYLOAD_ENVELOPE_VERSION = 'lfp2p.private-payload.envelope.v1' as const;
export type PrivatePayloadEnvelopeVersion = typeof PRIVATE_PAYLOAD_ENVELOPE_VERSION;
export type PrivatePayloadEnvelopeAlgorithm = 'aes-gcm-256';
export type KeyAgreementAlgorithm = 'x25519-v1';

export type PayloadKeyRecipientWrap = Readonly<{
  recipientIdentityId: string;
  recipientDeviceId: string;
  keyAgreement: KeyAgreementAlgorithm;
  wrappedKey: string;
  wrappingKeyRef: string;
}>;

export type PrivatePayloadEnvelopeV1 = Readonly<{
  version: PrivatePayloadEnvelopeVersion;
  algorithm: PrivatePayloadEnvelopeAlgorithm;
  ciphertext: string;
  nonce: string;
  keyId: string;
  recipientWraps?: ReadonlyArray<PayloadKeyRecipientWrap>;
}>;

/**
 * Phase 5.0E follow-up — placeholder `PrivatePayloadEnvelopeV1`
 * suitable for tests and fixtures that need to satisfy the
 * `validatePayloadPrivacyScope` rule for `dm` / `group` / `self`
 * (non-identity) privacy scopes but are NOT exercising real
 * encryption. Produces a frozen envelope whose `nonce` decodes to
 * 12 zero bytes and whose other fields validate cleanly.
 *
 * Production paths MUST NOT use this — it is intentionally
 * lower-cased `placeholder` in the name to make accidental use
 * obvious in code review. Real encryption flows ship via the
 * `@lfp2p/crypto` Phase 5.0 envelope APIs.
 */
export function placeholderPrivatePayloadEnvelope(
  overrides: Readonly<{ keyId?: string; ciphertext?: string }> = {}
): JsonObject {
  // Return a plain `JsonObject` (not a `PrivatePayloadEnvelopeV1`)
  // so the helper's output is directly assignable to
  // `CreateEventInput.payload`. The runtime shape passes
  // `validatePrivatePayloadEnvelope` cleanly — defense-in-depth
  // verified by the Phase 5.0E-follow-up tests that consume this.
  return Object.freeze({
    version: PRIVATE_PAYLOAD_ENVELOPE_VERSION as string,
    algorithm: 'aes-gcm-256',
    ciphertext: overrides.ciphertext ?? 'AAAA',
    nonce: 'AAAAAAAAAAAAAAAA', // base64url of 12 zero bytes
    keyId: overrides.keyId ?? 'placeholder-key'
  });
}

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
  validatePayloadPrivacyScope(event.privacy, event.kind, event.payload);
  // Reputation envelopes carry an inner payload that ALSO declares
  // version/eventId/kind/createdAt — keep them pinned to the
  // envelope's so an adversary cannot swap or drift the inner
  // payload across the wire. Pinned BEFORE any downstream consumer
  // can see drift.
  if (isReputationKind(event.kind)) {
    validateReputationEnvelopeConsistency(event);
  }
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
    case 'reputation.observation.recorded':
    case 'reputation.attestation.published':
    case 'reputation.attestation.revoked':
    case 'reputation.aggregator.published':
    case 'reputation.aggregator.score.removed': {
      requirePrivacyForReputationEvent(privacy, kind);
      // Structural-only checks at the protocol boundary. Full
      // semantic validation lives in `@lfp2p/trust-safety::
      // validateReputationEvent`, which runs again at the
      // persistence boundary. Keep these checks defensive: a
      // malformed payload here must NOT crash the bridge admission
      // engine — `validateReputationEnvelopeConsistency` re-asserts
      // the cross-field pinning after this.
      requireObjectExactString(
        payload,
        'version',
        REPUTATION_EVENT_PAYLOAD_VERSION,
        kind
      );
      requireObjectString(payload, 'eventId', kind);
      requireObjectString(payload, 'kind', kind);
      requireObjectIsoDate(payload, 'createdAt', kind);
      break;
    }
    default:
      break;
  }
}

/**
 * Phase 1.8.14 — cross-pin envelope.eventId / kind / createdAt to
 * the inner reputation payload. Adversary defense: a labeler
 * cannot swap the inner payload's identity-ish fields after signing
 * without invalidating the envelope-level signature, but a corrupt
 * builder could still produce a self-inconsistent envelope. Fail
 * closed here so downstream `validateReputationEvent` never sees
 * drift.
 */
function validateReputationEnvelopeConsistency(event: UnsignedEventEnvelope): void {
  const payload = event.payload;
  const payloadEventId = payload.eventId;
  if (typeof payloadEventId !== 'string' || payloadEventId !== event.eventId) {
    throw new Error(`${event.kind} payload.eventId must equal envelope.eventId`);
  }
  const payloadKind = payload.kind;
  if (typeof payloadKind !== 'string' || payloadKind !== event.kind) {
    throw new Error(`${event.kind} payload.kind must equal envelope.kind`);
  }
  const payloadCreatedAt = payload.createdAt;
  if (typeof payloadCreatedAt !== 'string' || payloadCreatedAt !== event.createdAt) {
    throw new Error(`${event.kind} payload.createdAt must equal envelope.createdAt`);
  }
}

function validatePayloadPrivacyScope(privacy: PrivacyScope, kind: EventKind, payload: JsonObject): void {
  if (privacy === 'device-local' || privacy === 'public') {
    if (looksLikePrivatePayloadEnvelope(payload)) {
      throw new Error(`${kind} with privacy ${privacy} must not contain a private payload envelope`);
    }
    return;
  }

  if (privacy === 'self') {
    if (kind.startsWith('identity.')) {
      return;
    }
    if (!looksLikePrivatePayloadEnvelope(payload)) {
      throw new Error(`${kind} with privacy ${privacy} must contain a private payload envelope`);
    }
    validatePrivatePayloadEnvelope(payload);
    return;
  }

  if (privacy === 'dm' || privacy === 'group') {
    if (!looksLikePrivatePayloadEnvelope(payload)) {
      throw new Error(`${kind} with privacy ${privacy} must contain a private payload envelope`);
    }
    validatePrivatePayloadEnvelope(payload);
    return;
  }

  throw new Error(`Unsupported privacy scope: ${privacy}`);
}

function validatePrivatePayloadEnvelope(value: JsonObject): PrivatePayloadEnvelopeV1 {
  const envelope = assertJsonObject(value, 'payload');
  const allowedKeys = new Set(['version', 'algorithm', 'ciphertext', 'nonce', 'keyId', 'recipientWraps']);
  Object.keys(envelope).forEach((key) => {
    if (!allowedKeys.has(key)) {
      throw new Error(`payload contains unsupported private payload envelope field: ${key}`);
    }
  });

  const version = requireNonEmptyString(envelope.version, 'payload.version');
  if (version !== PRIVATE_PAYLOAD_ENVELOPE_VERSION) {
    throw new Error(`Unsupported private payload envelope version: ${String(version)}`);
  }

  const algorithm = requireNonEmptyString(envelope.algorithm, 'payload.algorithm');
  if (algorithm !== 'aes-gcm-256') {
    throw new Error(`Unsupported private payload envelope algorithm: ${String(algorithm)}`);
  }

  const ciphertext = requireNonEmptyString(envelope.ciphertext, 'payload.ciphertext');
  validateBase64Url(ciphertext, 'payload.ciphertext');

  const nonce = requireNonEmptyString(envelope.nonce, 'payload.nonce');
  const decodedNonce = validateBase64Url(nonce, 'payload.nonce');
  if (decodedNonce.byteLength !== 12) {
    throw new Error('payload.nonce must decode to 12 bytes');
  }

  const keyId = requireNonEmptyString(envelope.keyId, 'payload.keyId');

  let recipientWraps: ReadonlyArray<PayloadKeyRecipientWrap> | undefined;
  if (envelope.recipientWraps !== undefined) {
    if (!Array.isArray(envelope.recipientWraps)) {
      throw new Error('payload.recipientWraps must be an array');
    }
    if (envelope.recipientWraps.length === 0) {
      throw new Error('payload.recipientWraps must not be empty when present');
    }

    const seenDeviceIds = new Set<string>();
    recipientWraps = envelope.recipientWraps.map((wrap, index) => {
      if (wrap === null || typeof wrap !== 'object' || Array.isArray(wrap)) {
        throw new Error(`payload.recipientWraps[${index}] must be an object`);
      }
      const record = wrap as Record<string, unknown>;
      const recipientIdentityId = requireNonEmptyString(
        record.recipientIdentityId,
        `payload.recipientWraps[${index}].recipientIdentityId`
      );
      const recipientDeviceId = requireNonEmptyString(
        record.recipientDeviceId,
        `payload.recipientWraps[${index}].recipientDeviceId`
      );

      if (seenDeviceIds.has(recipientDeviceId)) {
        throw new Error(`payload.recipientWraps contains duplicate recipientDeviceId: ${recipientDeviceId}`);
      }
      seenDeviceIds.add(recipientDeviceId);

      const keyAgreement = requireNonEmptyString(
        record.keyAgreement,
        `payload.recipientWraps[${index}].keyAgreement`
      );
      if (keyAgreement !== 'x25519-v1') {
        throw new Error(
          `Unsupported key agreement algorithm at payload.recipientWraps[${index}].keyAgreement: ${keyAgreement}`
        );
      }

      const wrappedKey = requireNonEmptyString(
        record.wrappedKey,
        `payload.recipientWraps[${index}].wrappedKey`
      );
      validateBase64Url(wrappedKey, `payload.recipientWraps[${index}].wrappedKey`);

      const wrappingKeyRef = requireNonEmptyString(
        record.wrappingKeyRef,
        `payload.recipientWraps[${index}].wrappingKeyRef`
      );

      Object.keys(record).forEach((key) => {
        const allowedWrapKeys = new Set([
          'recipientIdentityId',
          'recipientDeviceId',
          'keyAgreement',
          'wrappedKey',
          'wrappingKeyRef'
        ]);
        if (!allowedWrapKeys.has(key)) {
          throw new Error(
            `payload.recipientWraps[${index}] contains unsupported field: ${key}`
          );
        }
      });

      return {
        recipientIdentityId,
        recipientDeviceId,
        keyAgreement: keyAgreement as KeyAgreementAlgorithm,
        wrappedKey,
        wrappingKeyRef
      };
    });
  }

  return {
    version: PRIVATE_PAYLOAD_ENVELOPE_VERSION,
    algorithm: 'aes-gcm-256',
    ciphertext,
    nonce,
    keyId,
    ...(recipientWraps === undefined ? {} : { recipientWraps })
  };
}

function looksLikePrivatePayloadEnvelope(value: JsonObject): boolean {
  return (
    typeof value.version === 'string' &&
    typeof value.algorithm === 'string' &&
    typeof value.ciphertext === 'string' &&
    typeof value.nonce === 'string' &&
    typeof value.keyId === 'string'
  );
}

function validateBase64Url(value: string, label: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${label} must be base64url with no padding`);
  }
  return decodeBase64Url(value, label);
}

function decodeBase64Url(value: string, label: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');

  try {
    if (typeof atob === 'function') {
      const binary = atob(padded);
      return Uint8Array.from(binary, (char) => char.charCodeAt(0));
    }
  } catch {
    // fall through to Buffer fallback
  }

  const globalBuffer = (globalThis as unknown as { Buffer?: { from(input: string, encoding: string): Uint8Array } })
    .Buffer;
  if (typeof globalBuffer === 'object' || typeof globalBuffer === 'function') {
    return Uint8Array.from(globalBuffer!.from(padded, 'base64'));
  }

  throw new Error(`${label} could not be decoded from base64url`);
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requirePrivacyForIdentityEvent(privacy: PrivacyScope, kind: EventKind): void {
  if (privacy !== 'self') {
    throw new Error(`${kind} must use privacy scope self`);
  }
}

function requirePrivacyForReputationEvent(privacy: PrivacyScope, kind: EventKind): void {
  const allowed = REPUTATION_KIND_ALLOWED_PRIVACY[kind];
  if (allowed === undefined) {
    // Unreachable — caller already pinned `kind` to one of the five
    // reputation kinds via the switch above. Defense-in-depth only.
    throw new Error(`${kind} has no privacy policy registered`);
  }
  if (!allowed.includes(privacy)) {
    throw new Error(
      `${kind} must use privacy scope ${allowed.join(' or ')} (got: ${privacy})`
    );
  }
}

function requireObjectExactString(
  payload: JsonObject,
  field: string,
  expected: string,
  kind: EventKind
): string {
  const value = requireObjectString(payload, field, kind);
  if (value !== expected) {
    throw new Error(`${kind} payload.${field} must equal ${expected} (got: ${value})`);
  }
  return value;
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
