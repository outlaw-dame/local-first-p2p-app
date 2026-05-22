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
