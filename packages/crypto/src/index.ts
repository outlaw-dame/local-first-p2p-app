import nacl from 'tweetnacl';
import {
  canonicalizeJson,
  type SignedEventEnvelope,
  type UnsignedEventEnvelope,
  unsignedProjection,
  validateSignedEvent
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
  const ciphertext = await requireSubtleCrypto().encrypt({ name: 'AES-GCM', iv }, protectionKey, encoded);
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
    { name: 'AES-GCM', iv },
    protectionKey,
    ciphertext
  );
  return new TextDecoder().decode(plaintext);
}

export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await requireSubtleCrypto().digest('SHA-256', new TextEncoder().encode(input));
  return toBase64Url(new Uint8Array(digest));
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

function requireSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto subtle crypto is required');
  return subtle;
}
