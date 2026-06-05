import nacl from 'tweetnacl';
import {
  canonicalizeJson,
  type JsonValue,
  type SignedEventEnvelope,
  type UnsignedEventEnvelope,
  unsignedProjection,
  validateSignedEvent,
  type PrivatePayloadEnvelopeV1,
  PRIVATE_PAYLOAD_ENVELOPE_VERSION,
  type PayloadKeyRecipientWrap,
  type KeyAgreementAlgorithm
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
