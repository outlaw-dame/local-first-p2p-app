import {
  canonicalizeJson,
  PRIVATE_PAYLOAD_ENVELOPE_VERSION,
  type EventKind,
  type JsonValue,
  type PayloadKeyRecipientWrap,
  type PrivacyScope,
  type PrivatePayloadEnvelopeV1,
  type SourceRef
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
  /** Monotonic counter matching the envelope builder's lamport field. Defaults to 0. */
  lamport?: number;
  /** Content refs matching the envelope builder's refs field. Defaults to []. */
  refs?: readonly SourceRef[];
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
  // Field names and set must exactly match @lfp2p/envelope's buildPrivatePayloadAad
  // so that envelopes produced by one package can be decrypted by the other.
  // AES-GCM authenticates the exact AAD bytes — any deviation produces a split-brain
  // where same-version envelopes are mutually undecryptable. (Codex review #103 P2)
  return canonicalizeJson({
    aadVersion: PRIVATE_PAYLOAD_AAD_VERSION,
    eventVersion: 'lfp2p.event.v1',
    eventId: context.eventId,
    kind: context.kind,
    author: context.author,
    deviceId: context.deviceId,
    createdAt: context.createdAt,
    lamport: context.lamport ?? 0,
    privacy: context.privacy,
    schemaVersion: context.schemaVersion,
    refs: normalizeAadRefs(context.refs) as unknown as JsonValue
  } as JsonValue);
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
  const allowed = new Set([
    'version',
    'algorithm',
    'ciphertext',
    'nonce',
    'keyId',
    'recipientWraps'
  ]);
  for (const key of Object.keys(envelope)) {
    if (!allowed.has(key)) throw new Error(`unsupported private payload envelope field: ${key}`);
  }
  if (envelope.version !== PRIVATE_PAYLOAD_ENVELOPE_VERSION) {
    throw new Error(`unsupported private payload envelope version: ${String(envelope.version)}`);
  }
  if (envelope.algorithm !== 'aes-gcm-256') {
    throw new Error(
      `unsupported private payload envelope algorithm: ${String(envelope.algorithm)}`
    );
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
  if (
    context.lamport !== undefined &&
    (!Number.isSafeInteger(context.lamport) || context.lamport < 0)
  ) {
    throw new Error('context.lamport must be a safe non-negative integer when provided');
  }
  if (context.refs !== undefined && !Array.isArray(context.refs)) {
    throw new Error('context.refs must be an array when provided');
  }
}

// Mirrors @lfp2p/envelope's normalizeRefs — strips unknown fields so the AAD
// byte sequence matches whether the caller passes raw SourceRef objects (which
// may carry extra properties) or already-normalized refs. (Codex review #108 P2)
function normalizeAadRefs(refs: readonly SourceRef[] | undefined): Array<Record<string, unknown>> {
  if (refs === undefined || refs.length === 0) return [];
  return refs.map((ref, index) => {
    requireNonEmpty(ref.sourceId, `refs[${index}].sourceId`);
    const normalized: Record<string, unknown> = { sourceId: ref.sourceId };
    if (ref.sequence !== undefined) {
      if (!Number.isSafeInteger(ref.sequence) || ref.sequence < 0) {
        throw new Error(`refs[${index}].sequence must be a safe non-negative integer`);
      }
      normalized['sequence'] = ref.sequence;
    }
    if (ref.hash !== undefined) {
      requireNonEmpty(ref.hash, `refs[${index}].hash`);
      normalized['hash'] = ref.hash;
    }
    return normalized;
  });
}

const ALLOWED_WRAP_KEYS = new Set([
  'recipientIdentityId',
  'recipientDeviceId',
  'keyAgreement',
  'wrappedKey',
  'wrappingKeyRef'
]);

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
    // Strict key check — consistent with @lfp2p/protocol's validatePrivatePayloadEnvelope.
    // An envelope with extra fields passes validation here but fails at the protocol layer,
    // so we reject unknown fields early. (Gemini review #103)
    for (const key of Object.keys(wrap)) {
      if (!ALLOWED_WRAP_KEYS.has(key)) {
        throw new Error(`recipientWraps[${index}] contains unsupported field: ${key}`);
      }
    }
    requireNonEmpty(wrap.recipientIdentityId, `recipientWraps[${index}].recipientIdentityId`);
    const deviceId = requireNonEmpty(
      wrap.recipientDeviceId,
      `recipientWraps[${index}].recipientDeviceId`
    );
    if (seen.has(deviceId))
      throw new Error(`recipientWraps contains duplicate recipientDeviceId: ${deviceId}`);
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
  if (encoder !== undefined) return encoder;
  // Fall back to Node's Buffer for environments without a global btoa
  // (older Node.js versions, custom runtimes). (Gemini review #103)
  const buf = (globalThis as Record<string, unknown>)['Buffer'] as
    | { from(data: string, enc: string): { toString(enc: string): string } }
    | undefined;
  if (buf !== undefined) return (data: string) => buf.from(data, 'binary').toString('base64');
  throw new Error('btoa or Buffer is required for base64url encoding');
}

function requireAtob(): (data: string) => string {
  const decoder = (globalThis as BrowserEncodingGlobal).atob;
  if (decoder !== undefined) return decoder;
  // Fall back to Node's Buffer for environments without a global atob. (Gemini review #103)
  const buf = (globalThis as Record<string, unknown>)['Buffer'] as
    | { from(data: string, enc: string): { toString(enc: string): string } }
    | undefined;
  if (buf !== undefined) return (data: string) => buf.from(data, 'base64').toString('binary');
  throw new Error('atob or Buffer is required for base64url decoding');
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
