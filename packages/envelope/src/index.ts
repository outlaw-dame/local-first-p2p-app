import {
  encryptPayloadEnvelope,
  signEventEnvelope,
  toBase64Url,
  wrapPayloadKeyWithX25519,
  type SigningKeypair
} from '@lfp2p/crypto';
import {
  canonicalizeJson,
  createUnsignedEvent,
  type EventKind,
  type JsonObject,
  type JsonValue,
  type PayloadKeyRecipientWrap,
  type PrivacyScope,
  type SignedEventEnvelope,
  type SourceRef,
  type UnsignedEventEnvelope
} from '@lfp2p/protocol';

export const PRIVATE_PAYLOAD_AAD_VERSION = 'lfp2p.private-payload.aad.v1' as const;

export type EnvelopeScope = 'self' | 'dm' | 'group';
export type RecipientDeviceStatus = 'active' | 'revoked';

const AES_256_KEY_BYTES = 32;
const WRAP_PUBLIC_KEY_BASE64URL_LENGTH = 43;

export type RecipientDevice = Readonly<{
  deviceId: string;
  status: RecipientDeviceStatus;
  wrapPublicKey?: string;
  wrapKeyRef?: string;
}>;

export type RecipientIdentity = Readonly<{
  identityId: string;
  devices: Readonly<Record<string, RecipientDevice>>;
}>;

export type ResolvedRecipient = Readonly<{
  recipientIdentityId: string;
  recipientDeviceId: string;
  wrapPublicKey: string;
  wrapKeyRef: string;
}>;

export type PrivatePayloadAadInput = Readonly<{
  eventId: string;
  kind: EventKind;
  author: string;
  deviceId: string;
  createdAt: string;
  privacy: PrivacyScope;
  lamport?: number;
  schemaVersion?: number;
  refs?: readonly SourceRef[];
}>;

export type CreateEnvelopeEventInput = PrivatePayloadAadInput &
  Readonly<{
    privacy: EnvelopeScope;
    plaintextPayload: JsonObject;
    recipients: readonly ResolvedRecipient[];
    keyId?: string;
  }>;

export type CreateSignedEnvelopeEventInput = CreateEnvelopeEventInput &
  Readonly<{
    signingKeypair: SigningKeypair;
  }>;

export type EnvelopeEventBuildResult = Readonly<{
  event: UnsignedEventEnvelope;
  aad: string;
  keyId: string;
  recipientDeviceIds: readonly string[];
}>;

export type SignedEnvelopeEventBuildResult = Omit<EnvelopeEventBuildResult, 'event'> &
  Readonly<{ event: SignedEventEnvelope }>;

export function resolveRecipients(
  identities: readonly RecipientIdentity[]
): readonly ResolvedRecipient[] {
  const out: ResolvedRecipient[] = [];
  const seen = new Set<string>();
  for (const identity of identities) {
    const identityId = requireText(identity.identityId, 'identityId');
    for (const device of Object.values(identity.devices)) {
      if (device.status === 'revoked') continue;
      if (device.status !== 'active') throw new Error('Unsupported recipient device status');
      const deviceId = requireText(device.deviceId, 'deviceId');
      if (seen.has(deviceId)) throw new Error(`Duplicate recipient device id: ${deviceId}`);
      seen.add(deviceId);
      out.push(
        Object.freeze({
          recipientIdentityId: identityId,
          recipientDeviceId: deviceId,
          wrapPublicKey: requireWrapPublicKey(device.wrapPublicKey, 'wrapPublicKey'),
          wrapKeyRef: requireText(device.wrapKeyRef, 'wrapKeyRef')
        })
      );
    }
  }
  if (out.length === 0) throw new Error('No active recipient devices resolved');
  return Object.freeze(
    out.sort((left, right) => {
      const identityOrder = left.recipientIdentityId.localeCompare(right.recipientIdentityId);
      if (identityOrder !== 0) return identityOrder;
      return left.recipientDeviceId.localeCompare(right.recipientDeviceId);
    })
  );
}

export function buildPrivatePayloadAad(input: PrivatePayloadAadInput): string {
  const privacy = requireEnvelopeScope(input.privacy);
  const lamport = input.lamport ?? 0;
  const schemaVersion = input.schemaVersion ?? 1;
  requireSafeNonNegativeInteger(lamport, 'lamport');
  requireSafePositiveInteger(schemaVersion, 'schemaVersion');

  return canonicalizeJson({
    aadVersion: PRIVATE_PAYLOAD_AAD_VERSION,
    eventVersion: 'lfp2p.event.v1',
    eventId: requireText(input.eventId, 'eventId'),
    kind: input.kind,
    author: requireText(input.author, 'author'),
    deviceId: requireText(input.deviceId, 'deviceId'),
    createdAt: requireIsoDate(input.createdAt, 'createdAt'),
    lamport,
    privacy,
    schemaVersion,
    refs: normalizeRefs(input.refs)
  });
}

export async function createEnvelopeEvent(
  input: CreateEnvelopeEventInput
): Promise<EnvelopeEventBuildResult> {
  const privacy = requireEnvelopeScope(input.privacy);
  const recipients = normalizeRecipients(input.recipients);
  const lamport = input.lamport ?? 0;
  const schemaVersion = input.schemaVersion ?? 1;
  const aad = buildPrivatePayloadAad({
    eventId: input.eventId,
    kind: input.kind,
    author: input.author,
    deviceId: input.deviceId,
    createdAt: input.createdAt,
    lamport,
    privacy,
    schemaVersion,
    ...(input.refs === undefined ? {} : { refs: input.refs })
  });
  const contentKey = await generateContentKey(input.keyId);
  const recipientWraps = recipients.map<PayloadKeyRecipientWrap>((recipient) => ({
    recipientIdentityId: recipient.recipientIdentityId,
    recipientDeviceId: recipient.recipientDeviceId,
    keyAgreement: 'x25519-v1',
    wrappedKey: wrapPayloadKeyWithX25519(contentKey.rawKey, recipient.wrapPublicKey),
    wrappingKeyRef: recipient.wrapKeyRef
  }));
  const payload = await encryptPayloadEnvelope(
    input.plaintextPayload,
    aad,
    contentKey.cryptoKey,
    contentKey.keyId,
    recipientWraps
  );
  const event = createUnsignedEvent({
    eventId: input.eventId,
    kind: input.kind,
    author: input.author,
    deviceId: input.deviceId,
    createdAt: input.createdAt,
    lamport,
    privacy,
    schemaVersion,
    payload: payload as unknown as JsonObject,
    ...(input.refs === undefined ? {} : { refs: input.refs })
  });

  return Object.freeze({
    event,
    aad,
    keyId: contentKey.keyId,
    recipientDeviceIds: Object.freeze(recipients.map((recipient) => recipient.recipientDeviceId))
  });
}

export async function createSignedEnvelopeEvent(
  input: CreateSignedEnvelopeEventInput
): Promise<SignedEnvelopeEventBuildResult> {
  const built = await createEnvelopeEvent(input);
  return Object.freeze({
    ...built,
    event: signEventEnvelope(built.event, input.signingKeypair)
  });
}

export function summarizeEnvelopeEventForLog(
  event: UnsignedEventEnvelope | SignedEventEnvelope
): JsonObject {
  const payload = event.payload as Record<string, unknown>;
  const summary: Record<string, JsonValue> = {
    version: event.version,
    eventId: event.eventId,
    kind: event.kind,
    author: event.author,
    deviceId: event.deviceId,
    createdAt: event.createdAt,
    lamport: event.lamport,
    privacy: event.privacy,
    schemaVersion: event.schemaVersion,
    payload: {
      envelope: event.privacy === 'self' || event.privacy === 'dm' || event.privacy === 'group',
      version: typeof payload.version === 'string' ? payload.version : 'unknown',
      algorithm: typeof payload.algorithm === 'string' ? payload.algorithm : 'unknown',
      recipientWrapCount: Array.isArray(payload.recipientWraps) ? payload.recipientWraps.length : 0
    }
  };
  if (event.refs !== undefined) summary.refs = normalizeRefs(event.refs);
  if ('signature' in event) summary.signature = { algorithm: event.signature.algorithm };
  return Object.freeze(summary) as JsonObject;
}

type ContentKey = Readonly<{
  keyId: string;
  rawKey: string;
  cryptoKey: CryptoKey;
}>;

async function generateContentKey(
  keyId = `payload-key:${globalThis.crypto.randomUUID()}`
): Promise<ContentKey> {
  const rawKeyBytes = globalThis.crypto.getRandomValues(new Uint8Array(AES_256_KEY_BYTES));
  const rawKey = toBase64Url(rawKeyBytes);
  const cryptoKey = await requireSubtleCrypto().importKey(
    'raw',
    rawKeyBytes as Uint8Array<ArrayBuffer>,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
  return Object.freeze({
    keyId: requireText(keyId, 'keyId').trim(),
    rawKey,
    cryptoKey
  });
}

function normalizeRecipients(
  recipients: readonly ResolvedRecipient[]
): readonly ResolvedRecipient[] {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error('Envelope recipients must not be empty');
  }
  const seen = new Set<string>();
  return Object.freeze(
    recipients.map((recipient, index) => {
      const recipientIdentityId = requireText(
        recipient.recipientIdentityId,
        `recipients[${index}].recipientIdentityId`
      );
      const recipientDeviceId = requireText(
        recipient.recipientDeviceId,
        `recipients[${index}].recipientDeviceId`
      );
      if (seen.has(recipientDeviceId))
        throw new Error(`Duplicate recipient device id: ${recipientDeviceId}`);
      seen.add(recipientDeviceId);
      return Object.freeze({
        recipientIdentityId,
        recipientDeviceId,
        wrapPublicKey: requireWrapPublicKey(
          recipient.wrapPublicKey,
          `recipients[${index}].wrapPublicKey`
        ),
        wrapKeyRef: requireText(recipient.wrapKeyRef, `recipients[${index}].wrapKeyRef`)
      });
    })
  );
}

function requireEnvelopeScope(value: PrivacyScope): EnvelopeScope {
  if (value !== 'self' && value !== 'dm' && value !== 'group') {
    throw new Error(
      `Envelope payload builder requires self, dm, or group privacy; got ${String(value)}`
    );
  }
  return value;
}

function normalizeRefs(refs: readonly SourceRef[] | undefined): JsonObject[] {
  if (refs === undefined) return [];
  return refs.map((ref, index) => {
    const normalized: Record<string, JsonValue> = {
      sourceId: requireText(ref.sourceId, `refs[${index}].sourceId`)
    };
    if (ref.sequence !== undefined) {
      normalized.sequence = requireSafeNonNegativeInteger(ref.sequence, `refs[${index}].sequence`);
    }
    if (ref.hash !== undefined) {
      normalized.hash = requireText(ref.hash, `refs[${index}].hash`);
    }
    return Object.freeze(normalized) as JsonObject;
  });
}

function requireText(value: string | undefined, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireWrapPublicKey(value: string | undefined, label: string): string {
  const encoded = requireText(value, label).trim();
  if (encoded.length !== WRAP_PUBLIC_KEY_BASE64URL_LENGTH) {
    throw new Error(`${label} must be a 32-byte base64url wrapping public key`);
  }
  for (const char of encoded) {
    const code = char.charCodeAt(0);
    const isDigit = code >= 48 && code <= 57;
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;
    if (!isDigit && !isUpper && !isLower && char !== '-' && char !== '_') {
      throw new Error(`${label} must be base64url with no padding`);
    }
  }
  return encoded;
}

function requireIsoDate(value: string, label: string): string {
  requireText(value, label);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO date string`);
  return value;
}

function requireSafeNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a safe non-negative integer`);
  return value;
}

function requireSafePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${label} must be a safe positive integer`);
  return value;
}

function requireSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto subtle crypto is required');
  return subtle;
}
