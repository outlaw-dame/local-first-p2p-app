import {
  canonicalizeJson,
  PRIVATE_PAYLOAD_ENVELOPE_VERSION,
  type EventKind,
  type JsonValue,
  type PayloadKeyRecipientWrap,
  type PrivacyScope,
  type PrivatePayloadEnvelopeV1
} from '@lfp2p/protocol';

export const PRIVATE_PAYLOAD_AAD_VERSION = 'lfp2p.private-payload.aad.v1' as const;
export type PrivatePayloadAadVersion = typeof PRIVATE_PAYLOAD_AAD_VERSION;

export type PrivatePayloadAadContext = Readonly<{
  eventId: string;
  kind: EventKind;
  author: string;
  deviceId: string;
  createdAt: string;
  privacy: Extract<PrivacyScope, 'self' | 'dm' | 'group'>;
  schemaVersion: number;
}>;

export type EncryptPrivatePayloadOptions = Readonly<{
  plaintext: JsonValue;
  context: PrivatePayloadAadContext;
  keyMaterial: string;
  keyId: string;
  recipientWraps?: readonly PayloadKeyRecipientWrap[];
}>;

export type DecryptPrivatePayloadOptions = Readonly<{
  envelope: PrivatePayloadEnvelopeV1;
  context: PrivatePayloadAadContext;
  keyMaterial: string;
}>;

type BrowserEncodingGlobal = Readonly<{
  btoa?: (data: string) => string;
  atob?: (data: string) => string;
}>;

type PayloadCryptoKey = unknown;

type PayloadSubtleCrypto = Readonly<{
  importKey: (
    format: 'raw',
    keyData: Uint8Array,
    algorithm: Readonly<{ name: 'AES-GCM'; length: 256 }>,
    extractable: false,
    keyUsages: readonly ['encrypt', 'decrypt']
  ) => Promise<PayloadCryptoKey>;
  encrypt: (
    algorithm: Readonly<{ name: 'AES-GCM'; iv: Uint8Array; additionalData: Uint8Array }>,
    key: PayloadCryptoKey,
    data: Uint8Array
  ) => Promise<ArrayBuffer>;
  decrypt: (
    algorithm: Readonly<{ name: 'AES-GCM'; iv: Uint8Array; additionalData: Uint8Array }>,
    key: PayloadCryptoKey,
    data: Uint8Array
  ) => Promise<ArrayBuffer>;
}>;

type PayloadCrypto = Readonly<{
  getRandomValues: (array: Uint8Array) => Uint8Array;
  subtle?: PayloadSubtleCrypto;
}>;

export function generatePrivatePayloadKeyMaterial(): string {
  const bytes = new Uint8Array(32);
  requireCrypto().getRandomValues(bytes);
  return toBase64Url(bytes);
}

export function buildPrivatePayloadAad(context: PrivatePayloadAadContext): string {
  validateAadContext(context);
  return canonicalizeJson({
    version: PRIVATE_PAYLOAD_AAD_VERSION,
    eventId: context.eventId,
    kind: context.kind,
    author: context.author,
    deviceId: context.deviceId,
    createdAt: context.createdAt,
    privacy: context.privacy,
    schemaVersion: context.schemaVersion
  });
}

export async function encryptPrivatePayload(
  options: EncryptPrivatePayloadOptions
): Promise<PrivatePayloadEnvelopeV1> {
  const key = await importPayloadKey(options.keyMaterial);
  const nonce = new Uint8Array(12);
  requireCrypto().getRandomValues(nonce);

  const encodedPlaintext = new TextEncoder().encode(canonicalizeJson(options.plaintext));
  const aad = new TextEncoder().encode(buildPrivatePayloadAad(options.context));
  const ciphertext = await requireSubtleCrypto().encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad },
    key,
    encodedPlaintext
  );

  const keyId = requireNonEmpty(options.keyId, 'keyId');
  return {
    version: PRIVATE_PAYLOAD_ENVELOPE_VERSION,
    algorithm: 'aes-gcm-256',
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
    nonce: toBase64Url(nonce),
    keyId,
    ...(options.recipientWraps === undefined
      ? {}
      : { recipientWraps: validateRecipientWraps(options.recipientWraps) })
  };
}

export async function decryptPrivatePayload(
  options: DecryptPrivatePayloadOptions
): Promise<JsonValue> {
  validatePrivatePayloadEnvelopeShape(options.envelope);
  const key = await importPayloadKey(options.keyMaterial);
  const aad = new TextEncoder().encode(buildPrivatePayloadAad(options.context));
  const plaintext = await requireSubtleCrypto().decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(options.envelope.nonce), additionalData: aad },
    key,
    fromBase64Url(options.envelope.ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as JsonValue;
}

export function validatePrivatePayloadEnvelopeShape(
  envelope: PrivatePayloadEnvelopeV1
): PrivatePayloadEnvelopeV1 {
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('private payload envelope must be an object');
  }
  const allowed = new Set(['version', 'algorithm', 'ciphertext', 'nonce', 'keyId', 'recipientWraps']);
  for (const key of Object.keys(envelope)) {
    if (!allowed.has(key)) throw new Error(`unsupported private payload envelope field: ${key}`);
  }
  if (envelope.version !== PRIVATE_PAYLOAD_ENVELOPE_VERSION) {
    throw new Error(`unsupported private payload envelope version: ${String(envelope.version)}`);
  }
  if (envelope.algorithm !== 'aes-gcm-256') {
    throw new Error(`unsupported private payload envelope algorithm: ${String(envelope.algorithm)}`);
  }
  requireNonEmpty(envelope.ciphertext, 'ciphertext');
  requireNonEmpty(envelope.nonce, 'nonce');
  requireNonEmpty(envelope.keyId, 'keyId');
  const nonce = fromBase64Url(envelope.nonce);
  if (nonce.byteLength !== 12) throw new Error('nonce must decode to 12 bytes');
  fromBase64Url(envelope.ciphertext);
  if (envelope.recipientWraps !== undefined) validateRecipientWraps(envelope.recipientWraps);
  return envelope;
}

async function importPayloadKey(keyMaterial: string): Promise<PayloadCryptoKey> {
  const raw = fromBase64Url(requireNonEmpty(keyMaterial, 'keyMaterial'));
  if (raw.byteLength !== 32) throw new Error('keyMaterial must decode to 32 bytes');
  return requireSubtleCrypto().importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt'
  ]);
}

function validateAadContext(context: PrivatePayloadAadContext): void {
  requireNonEmpty(context.eventId, 'context.eventId');
  requireNonEmpty(context.kind, 'context.kind');
  requireNonEmpty(context.author, 'context.author');
  requireNonEmpty(context.deviceId, 'context.deviceId');
  requireNonEmpty(context.createdAt, 'context.createdAt');
  if (!Number.isFinite(Date.parse(context.createdAt))) {
    throw new Error('context.createdAt must be an ISO date string');
  }
  if (!['self', 'dm', 'group'].includes(context.privacy)) {
    throw new Error(`context.privacy must be self, dm, or group (got: ${String(context.privacy)})`);
  }
  if (!Number.isSafeInteger(context.schemaVersion) || context.schemaVersion <= 0) {
    throw new Error('context.schemaVersion must be a safe positive integer');
  }
}

function validateRecipientWraps(
  wraps: readonly PayloadKeyRecipientWrap[]
): ReadonlyArray<PayloadKeyRecipientWrap> {
  if (!Array.isArray(wraps) || wraps.length === 0) {
    throw new Error('recipientWraps must be a non-empty array when present');
  }
  const seen = new Set<string>();
  return wraps.map((wrap, index) => {
    if (wrap === null || typeof wrap !== 'object' || Array.isArray(wrap)) {
      throw new Error(`recipientWraps[${index}] must be an object`);
    }
    requireNonEmpty(wrap.recipientIdentityId, `recipientWraps[${index}].recipientIdentityId`);
    const deviceId = requireNonEmpty(wrap.recipientDeviceId, `recipientWraps[${index}].recipientDeviceId`);
    if (seen.has(deviceId)) throw new Error(`recipientWraps contains duplicate recipientDeviceId: ${deviceId}`);
    seen.add(deviceId);
    if (wrap.keyAgreement !== 'x25519-v1') {
      throw new Error(`recipientWraps[${index}].keyAgreement must be x25519-v1`);
    }
    fromBase64Url(requireNonEmpty(wrap.wrappedKey, `recipientWraps[${index}].wrappedKey`));
    requireNonEmpty(wrap.wrappingKeyRef, `recipientWraps[${index}].wrappingKeyRef`);
    return wrap;
  });
}

function requireNonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function toBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return requireBtoa()(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function fromBase64Url(input: string): Uint8Array {
  const value = requireNonEmpty(input, 'base64url');
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('value must be base64url with no padding');
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = requireAtob()(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function requireBtoa(): (data: string) => string {
  const encoder = (globalThis as BrowserEncodingGlobal).btoa;
  if (encoder === undefined) throw new Error('btoa is required for base64url encoding');
  return encoder;
}

function requireAtob(): (data: string) => string {
  const decoder = (globalThis as BrowserEncodingGlobal).atob;
  if (decoder === undefined) throw new Error('atob is required for base64url decoding');
  return decoder;
}

function requireCrypto(): PayloadCrypto {
  const crypto = (globalThis as Readonly<{ crypto?: PayloadCrypto }>).crypto;
  if (crypto === undefined) throw new Error('WebCrypto is required');
  return crypto;
}

function requireSubtleCrypto(): PayloadSubtleCrypto {
  const subtle = requireCrypto().subtle;
  if (subtle === undefined) throw new Error('WebCrypto subtle crypto is required');
  return subtle;
}
