import nacl from 'tweetnacl';
import { sha256 as nobleSha256 } from '@noble/hashes/sha256';
import {
  canonicalizeJson,
  type JsonValue,
  type SignedEventEnvelope,
  type UnsignedEventEnvelope,
  unsignedProjection,
  validateSignedEvent,
  type PrivatePayloadEnvelopeV1,
  PRIVATE_PAYLOAD_ENVELOPE_VERSION,
  type PayloadKeyRecipientWrap
} from '@lfp2p/protocol';

export type SigningKeypair = Readonly<{
  publicKey: string;
  privateKey: string;
}>;

export type EncryptedKeyMaterial = Readonly<{
  algorithm: 'aes-gcm-256';
  iv: string;
  ciphertext: string;
}>;

export type DetachedJsonSignature = Readonly<{
  algorithm: 'ed25519-detached-json';
  publicKey: string;
  value: string;
}>;

export { type PayloadKeyRecipientWrap, type KeyAgreementAlgorithm } from '@lfp2p/protocol';

export function generateSigningKeypair(): SigningKeypair {
  const pair = nacl.sign.keyPair();
  return {
    publicKey: toBase64Url(pair.publicKey),
    privateKey: toBase64Url(pair.secretKey)
  };
}

export function signingKeypairFromSeed(seed: Uint8Array): SigningKeypair {
  if (seed.byteLength !== 32) throw new Error('Ed25519 seed must be 32 bytes');
  const pair = nacl.sign.keyPair.fromSeed(seed);
  return {
    publicKey: toBase64Url(pair.publicKey),
    privateKey: toBase64Url(pair.secretKey)
  };
}

export function signEventEnvelope(
  event: UnsignedEventEnvelope,
  keypair: SigningKeypair
): SignedEventEnvelope {
  const secretKey = fromBase64Url(keypair.privateKey);
  if (secretKey.byteLength !== nacl.sign.secretKeyLength) {
    throw new Error('Invalid Ed25519 private key length');
  }

  const message = new TextEncoder().encode(canonicalizeJson(event));
  const value = nacl.sign.detached(message, secretKey);

  return {
    ...event,
    signature: {
      algorithm: 'ed25519',
      publicKey: keypair.publicKey,
      value: toBase64Url(value)
    }
  };
}

export function verifySignedEventEnvelope(event: SignedEventEnvelope): boolean {
  try {
    validateSignedEvent(event);
    const publicKey = fromBase64Url(event.signature.publicKey);
    const signature = fromBase64Url(event.signature.value);
    if (publicKey.byteLength !== nacl.sign.publicKeyLength) return false;
    if (signature.byteLength !== nacl.sign.signatureLength) return false;
    const message = new TextEncoder().encode(canonicalizeJson(unsignedProjection(event)));
    return nacl.sign.detached.verify(message, signature, publicKey);
  } catch {
    return false;
  }
}

export function signDetachedJson(payload: JsonValue, keypair: SigningKeypair): DetachedJsonSignature {
  const secretKey = fromBase64Url(keypair.privateKey);
  if (secretKey.byteLength !== nacl.sign.secretKeyLength) {
    throw new Error('Invalid Ed25519 private key length');
  }
  const message = new TextEncoder().encode(canonicalizeJson(payload));
  const value = nacl.sign.detached(message, secretKey);
  return {
    algorithm: 'ed25519-detached-json',
    publicKey: keypair.publicKey,
    value: toBase64Url(value)
  };
}

export function verifyDetachedJsonSignature(payload: JsonValue, signature: DetachedJsonSignature): boolean {
  try {
    if (signature.algorithm !== 'ed25519-detached-json') return false;
    const publicKey = fromBase64Url(signature.publicKey);
    const value = fromBase64Url(signature.value);
    if (publicKey.byteLength !== nacl.sign.publicKeyLength) return false;
    if (value.byteLength !== nacl.sign.signatureLength) return false;
    const message = new TextEncoder().encode(canonicalizeJson(payload));
    return nacl.sign.detached.verify(message, value, publicKey);
  } catch {
    return false;
  }
}

/**
 * Verify a raw Ed25519 detached signature over arbitrary bytes.
 *
 * Wraps `tweetnacl.sign.detached.verify` with strict length guards
 * (Ed25519 public keys are 32 bytes, signatures are 64 bytes). All
 * thrown errors are caught and surfaced as `false` so a single
 * malformed input cannot crash the caller — fail closed.
 *
 * Used by `@lfp2p/ucan-verifier` (and other future scheme verifiers)
 * to verify signatures over signing-input strings, where the
 * envelope/JSON wrappers in this module don't fit.
 */
export function verifyEd25519(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): boolean {
  try {
    if (publicKey.byteLength !== nacl.sign.publicKeyLength) return false;
    if (signature.byteLength !== nacl.sign.signatureLength) return false;
    return nacl.sign.detached.verify(message, signature, publicKey);
  } catch {
    return false;
  }
}

/**
 * Synchronous SHA-256 over raw bytes. Returns the 32-byte digest.
 *
 * SubtleCrypto's `digest('SHA-256', …)` is async, which doesn't fit
 * the synchronous `CapabilityProofVerifier` slot used by the proof
 * registry. `@noble/hashes` is an audited, dependency-free
 * implementation widely used across the TS ecosystem (viem, ethers,
 * @noble/curves).
 */
export function sha256(input: Uint8Array): Uint8Array {
  return nobleSha256(input);
}

/**
 * Decode a base58btc string (the Bitcoin alphabet, no leading byte)
 * into raw bytes. Returns `undefined` for any character outside the
 * alphabet so the caller can fail-closed on malformed input rather
 * than guessing.
 *
 * Iterative big-number conversion — no recursion, no eval. Empty
 * input returns an empty array. Leading `'1'` characters round-trip
 * to leading `0x00` bytes per the standard.
 *
 * Used by `didKeyToEd25519PublicKey` and (re-exported for) UCAN/VC
 * scheme verifiers that decode `did:key:z…` issuers.
 */
export function decodeBase58Btc(input: string): Uint8Array | undefined {
  if (typeof input !== 'string') return undefined;
  if (input.length === 0) return new Uint8Array();
  let leadingZeros = 0;
  while (leadingZeros < input.length && input[leadingZeros] === '1') leadingZeros += 1;
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === undefined) return undefined;
    const digit = BASE58_BTC_MAP.get(ch);
    if (digit === undefined) return undefined;
    let carry = digit;
    for (let j = bytes.length - 1; j >= 0; j -= 1) {
      const cur = (bytes[j] as number) * 58 + carry;
      bytes[j] = cur & 0xff;
      carry = cur >>> 8;
    }
    while (carry > 0) {
      bytes.unshift(carry & 0xff);
      carry >>>= 8;
    }
  }
  const out = new Uint8Array(leadingZeros + bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    out[leadingZeros + i] = bytes[i] as number;
  }
  return out;
}

const BASE58_BTC_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_BTC_MAP: ReadonlyMap<string, number> = (() => {
  const m = new Map<string, number>();
  for (let i = 0; i < BASE58_BTC_ALPHABET.length; i += 1) {
    m.set(BASE58_BTC_ALPHABET[i] as string, i);
  }
  return m;
})();

/**
 * Parse a `did:key:z<multibase-multicodec-pubkey>` into the raw
 * Ed25519 public key bytes (32 bytes). Returns `undefined` for any
 * other DID method, multibase prefix, or multicodec — strictly
 * Ed25519 only. Other algorithms are an explicit non-goal of the
 * proof-verifier slots and must fail closed, not fall through.
 *
 * Multicodec prefix for Ed25519 = varint `0xed 0x01` followed by 32
 * pubkey bytes.
 */
export function didKeyToEd25519PublicKey(did: string): Uint8Array | undefined {
  if (typeof did !== 'string') return undefined;
  const PREFIX = 'did:key:z';
  if (!did.startsWith(PREFIX)) return undefined;
  const body = did.slice(PREFIX.length);
  const decoded = decodeBase58Btc(body);
  if (decoded === undefined) return undefined;
  if (decoded.byteLength !== 2 + 32 || decoded[0] !== 0xed || decoded[1] !== 0x01) {
    return undefined;
  }
  return decoded.slice(2);
}

/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 *
 * Produces a deterministic, byte-stable canonical JSON string for a
 * JSON value (the kind of value you would get from `JSON.parse`).
 * Used by `eddsa-jcs-2022` VC verification — where signer and
 * verifier MUST agree on the exact bytes to hash — and exposed for
 * any future scheme verifier that needs JCS canonicalization
 * without dragging in a JSON-LD canonicalization library.
 *
 * Rules:
 *   - object keys sorted by UTF-16 code unit (JS default string sort)
 *   - no whitespace anywhere
 *   - strings serialized per RFC 8259 (JSON.stringify is compliant
 *     in modern V8 / WebKit / SpiderMonkey for the JSON character
 *     subset that JCS targets)
 *   - finite numbers serialized per ECMAScript Number-to-String
 *     (which RFC 8785 §3.2.2.3 specifies)
 *   - undefined values inside objects are skipped (mirrors
 *     JSON.stringify); undefined as the top-level input throws
 *   - non-finite numbers (NaN, ±Infinity) throw — they cannot be
 *     canonicalized into valid JSON
 *
 * The function walks `Object.keys()` only, so inherited properties
 * (prototype pollution) cannot influence the output. Plain objects
 * and arrays only — typed arrays / Maps / Sets are out of scope and
 * will be treated as plain objects (the caller is responsible for
 * passing JSON-shaped input).
 */
export function canonicalizeJcs(value: unknown): string {
  if (value === undefined) {
    throw new TypeError('canonicalizeJcs: top-level value cannot be undefined');
  }
  return canonicalizeJcsImpl(value);
}

function canonicalizeJcsImpl(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('canonicalizeJcs: non-finite numbers cannot be canonicalized');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const parts = new Array<string>(value.length);
    for (let i = 0; i < value.length; i += 1) {
      const v = value[i];
      // JSON.stringify replaces undefined array entries with `null`;
      // RFC 8785 does the same. Match that behavior.
      parts[i] = v === undefined ? 'null' : canonicalizeJcsImpl(v);
    }
    return '[' + parts.join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) continue;
      parts.push(JSON.stringify(k) + ':' + canonicalizeJcsImpl(v));
    }
    return '{' + parts.join(',') + '}';
  }
  throw new TypeError(
    `canonicalizeJcs: unsupported value type '${typeof value}'`
  );
}

export async function generateNonExtractableAesGcmKey(): Promise<CryptoKey> {
  return requireSubtleCrypto().generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt'
  ]);
}

export async function encryptKeyMaterial(
  plaintext: string,
  protectionKey: CryptoKey
): Promise<EncryptedKeyMaterial> {
  if (plaintext.length === 0) throw new Error('Cannot encrypt empty key material');
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await requireSubtleCrypto().encrypt(
    { name: 'AES-GCM', iv: toArrayBufferView(iv) },
    protectionKey,
    toArrayBufferView(encoded)
  );
  return {
    algorithm: 'aes-gcm-256',
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertext))
  };
}

export async function decryptKeyMaterial(
  encrypted: EncryptedKeyMaterial,
  protectionKey: CryptoKey
): Promise<string> {
  if (encrypted.algorithm !== 'aes-gcm-256') throw new Error('Unsupported key material algorithm');
  const iv = fromBase64Url(encrypted.iv);
  const ciphertext = fromBase64Url(encrypted.ciphertext);
  const plaintext = await requireSubtleCrypto().decrypt(
    { name: 'AES-GCM', iv: toArrayBufferView(iv) },
    protectionKey,
    toArrayBufferView(ciphertext)
  );
  return new TextDecoder().decode(plaintext);
}

export async function encryptPayloadEnvelope(
  plaintext: string | JsonValue,
  aad: string | undefined,
  contentKey: CryptoKey,
  keyId: string,
  recipientWraps?: readonly PayloadKeyRecipientWrap[]
): Promise<PrivatePayloadEnvelopeV1> {
  const serialized =
    typeof plaintext === 'string'
      ? plaintext
      : canonicalizeJson(plaintext as JsonValue);

  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(serialized);
  const ciphertext = await requireSubtleCrypto().encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBufferView(iv),
      additionalData: aad === undefined ? undefined : new TextEncoder().encode(aad)
    },
    contentKey,
    toArrayBufferView(encoded)
  );

  if (typeof keyId !== 'string' || keyId.trim().length === 0) {
    throw new Error('keyId must be a non-empty string');
  }

  const envelope: PrivatePayloadEnvelopeV1 = {
    version: PRIVATE_PAYLOAD_ENVELOPE_VERSION,
    algorithm: 'aes-gcm-256',
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
    nonce: toBase64Url(iv),
    keyId: keyId.trim(),
    ...(recipientWraps === undefined ? {} : { recipientWraps: validateRecipientWrapsStructure(recipientWraps) })
  };

  return envelope;
}

export async function decryptPayloadEnvelope(
  envelope: PrivatePayloadEnvelopeV1,
  contentKey: CryptoKey,
  aad?: string
): Promise<string> {
  if (envelope.version !== PRIVATE_PAYLOAD_ENVELOPE_VERSION) {
    throw new Error(`Unsupported private payload envelope version: ${String(envelope.version)}`);
  }
  if (envelope.algorithm !== 'aes-gcm-256') {
    throw new Error(`Unsupported private payload envelope algorithm: ${String(envelope.algorithm)}`);
  }

  const iv = fromBase64Url(envelope.nonce);
  const ciphertext = fromBase64Url(envelope.ciphertext);

  const plaintext = await requireSubtleCrypto().decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBufferView(iv),
      additionalData: aad === undefined ? undefined : new TextEncoder().encode(aad)
    },
    contentKey,
    toArrayBufferView(ciphertext)
  );

  return new TextDecoder().decode(plaintext);
}

function validateRecipientWrapsStructure(
  recipientWraps: readonly PayloadKeyRecipientWrap[]
): readonly PayloadKeyRecipientWrap[] {
  return recipientWraps.map((wrap, index) => {
    if (wrap === null || typeof wrap !== 'object') {
      throw new Error(`recipientWraps[${index}] must be an object`);
    }
    if (typeof wrap.recipientIdentityId !== 'string' || wrap.recipientIdentityId.trim().length === 0) {
      throw new Error(`recipientWraps[${index}].recipientIdentityId must be a non-empty string`);
    }
    if (typeof wrap.recipientDeviceId !== 'string' || wrap.recipientDeviceId.trim().length === 0) {
      throw new Error(`recipientWraps[${index}].recipientDeviceId must be a non-empty string`);
    }
    if (typeof wrap.keyAgreement !== 'string' || wrap.keyAgreement.trim().length === 0) {
      throw new Error(`recipientWraps[${index}].keyAgreement must be a non-empty string`);
    }
    if (wrap.keyAgreement !== 'x25519-v1') {
      throw new Error(`recipientWraps[${index}].keyAgreement must be 'x25519-v1', got '${wrap.keyAgreement}'`);
    }
    if (typeof wrap.wrappedKey !== 'string' || wrap.wrappedKey.trim().length === 0) {
      throw new Error(`recipientWraps[${index}].wrappedKey must be a non-empty string`);
    }
    validateBase64Url(wrap.wrappedKey, `recipientWraps[${index}].wrappedKey`);
    if (typeof wrap.wrappingKeyRef !== 'string' || wrap.wrappingKeyRef.trim().length === 0) {
      throw new Error(`recipientWraps[${index}].wrappingKeyRef must be a non-empty string`);
    }
    return wrap;
  });
}

function validateBase64Url(value: string, label: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${label} must be base64url with no padding`);
  }
  return fromBase64Url(value);
}

export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await requireSubtleCrypto().digest('SHA-256', new TextEncoder().encode(input));
  return toBase64Url(new Uint8Array(digest));
}

export type X25519Keypair = Readonly<{
  publicKey: string;
  privateKey: string;
}>;

export function generateX25519Keypair(): X25519Keypair {
  const pair = nacl.box.keyPair();
  return {
    publicKey: toBase64Url(pair.publicKey),
    privateKey: toBase64Url(pair.secretKey)
  };
}

export function x25519KeypairFromSeed(seed: Uint8Array): X25519Keypair {
  if (seed.byteLength !== 32) throw new Error('X25519 seed must be 32 bytes');
  const pair = nacl.box.keyPair.fromSecretKey(seed);
  return {
    publicKey: toBase64Url(pair.publicKey),
    privateKey: toBase64Url(pair.secretKey)
  };
}

export function wrapPayloadKeyWithX25519(
  payloadKeyBase64Url: string,
  recipientPublicKeyBase64Url: string,
  senderPrivateKeyBase64Url?: string
): string {
  const payloadKeyBytes = fromBase64Url(payloadKeyBase64Url);
  const recipientPubKey = fromBase64Url(recipientPublicKeyBase64Url);

  if (payloadKeyBytes.byteLength === 0) {
    throw new Error('Payload key cannot be empty');
  }
  if (recipientPubKey.byteLength !== nacl.box.publicKeyLength) {
    throw new Error('Invalid recipient public key length for X25519');
  }

  let ephemeralKeypair: nacl.BoxKeyPair;
  if (senderPrivateKeyBase64Url) {
    const sk = fromBase64Url(senderPrivateKeyBase64Url);
    if (sk.byteLength !== nacl.box.secretKeyLength) {
      throw new Error('Invalid sender private key length for X25519');
    }
    ephemeralKeypair = nacl.box.keyPair.fromSecretKey(sk);
  } else {
    ephemeralKeypair = nacl.box.keyPair();
  }

  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(nacl.box.nonceLength));
  const encrypted = nacl.box(payloadKeyBytes, nonce, recipientPubKey, ephemeralKeypair.secretKey);

  if (!encrypted) {
    throw new Error('X25519 key wrapping failed');
  }

  const wrappedKeyWithEphemeral = new Uint8Array(
    ephemeralKeypair.publicKey.byteLength + nonce.byteLength + encrypted.byteLength
  );
  wrappedKeyWithEphemeral.set(ephemeralKeypair.publicKey, 0);
  wrappedKeyWithEphemeral.set(nonce, ephemeralKeypair.publicKey.byteLength);
  wrappedKeyWithEphemeral.set(encrypted, ephemeralKeypair.publicKey.byteLength + nonce.byteLength);

  return toBase64Url(wrappedKeyWithEphemeral);
}

export function unwrapPayloadKeyWithX25519(
  wrappedKeyBase64Url: string,
  recipientPrivateKeyBase64Url: string
): string {
  const wrappedKeyBytes = fromBase64Url(wrappedKeyBase64Url);
  const recipientPrivateKey = fromBase64Url(recipientPrivateKeyBase64Url);

  if (recipientPrivateKey.byteLength !== nacl.box.secretKeyLength) {
    throw new Error('Invalid recipient private key length for X25519');
  }

  const ephemeralPublicKeyLength = nacl.box.publicKeyLength;
  const nonceLength = nacl.box.nonceLength;
  const expectedLength = ephemeralPublicKeyLength + nonceLength + nacl.secretbox.overheadLength;

  if (wrappedKeyBytes.byteLength < expectedLength) {
    throw new Error('Wrapped key is too short');
  }

  const ephemeralPublicKey = wrappedKeyBytes.slice(0, ephemeralPublicKeyLength);
  const nonce = wrappedKeyBytes.slice(ephemeralPublicKeyLength, ephemeralPublicKeyLength + nonceLength);
  const encrypted = wrappedKeyBytes.slice(ephemeralPublicKeyLength + nonceLength);

  const decrypted = nacl.box.open(encrypted, nonce, ephemeralPublicKey, recipientPrivateKey);

  if (!decrypted) {
    throw new Error('X25519 key unwrapping failed: decryption unsuccessful');
  }

  return toBase64Url(decrypted);
}

export function toBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

export function fromBase64Url(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toArrayBufferView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Array.from(bytes));
}

function requireSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto subtle crypto is required');
  return subtle;
}
