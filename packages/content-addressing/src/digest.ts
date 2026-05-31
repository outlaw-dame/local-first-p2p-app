import { caError } from './errors.js';
import {
  MAX_CANONICAL_DEPTH,
  assertBase64UrlNoPad,
  assertForbiddenKey,
  assertNonEmptyString,
  assertPlainObject
} from './validation.js';

export type HashAlgorithm = 'sha-256' | 'sha-512';

export const SUPPORTED_HASH_ALGORITHMS: readonly HashAlgorithm[] = ['sha-256', 'sha-512'];

const DIGEST_RAW_LENGTHS: Readonly<Record<HashAlgorithm, number>> = {
  'sha-256': 32,
  'sha-512': 64
};

/**
 * Encoded length of a base64url (no-padding) string for a given raw byte length.
 * Used to reject digests that claim algorithm X but are not the right length.
 */
function expectedEncodedLength(rawByteLength: number): number {
  return Math.ceil((rawByteLength * 4) / 3);
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

export type DigestRef = Readonly<{
  algorithm: HashAlgorithm;
  digest: string;
}>;

export function isHashAlgorithm(value: unknown): value is HashAlgorithm {
  return (
    typeof value === 'string' &&
    SUPPORTED_HASH_ALGORITHMS.includes(value as HashAlgorithm)
  );
}

export function assertHashAlgorithm(value: unknown, label: string): HashAlgorithm {
  if (!isHashAlgorithm(value)) {
    throw caError(
      'CA_UNSUPPORTED_ALGORITHM',
      `${label} must be one of ${SUPPORTED_HASH_ALGORITHMS.join(', ')}`
    );
  }
  return value;
}

export function validateDigestRef(value: unknown): DigestRef {
  const record = assertPlainObject(value, 'DigestRef');
  const algorithm = assertHashAlgorithm(record.algorithm, 'DigestRef.algorithm');
  const digest = assertNonEmptyString(record.digest, 'DigestRef.digest');
  assertBase64UrlNoPad(digest, 'DigestRef.digest');
  const expected = expectedEncodedLength(DIGEST_RAW_LENGTHS[algorithm]);
  if (digest.length !== expected) {
    throw caError(
      'CA_WRONG_DIGEST_LENGTH',
      `DigestRef.digest encoded length ${digest.length} does not match algorithm ${algorithm} (expected ${expected})`
    );
  }
  return { algorithm, digest };
}

export async function createDigest(
  input: JsonValue | string | Uint8Array,
  algorithm: HashAlgorithm = 'sha-256'
): Promise<DigestRef> {
  const normalizedAlgorithm = assertHashAlgorithm(algorithm, 'createDigest.algorithm');
  const bytes = toDigestBytes(input);
  const digestBytes = await digestBytesWithAlgorithm(bytes, normalizedAlgorithm);
  if (digestBytes.byteLength !== DIGEST_RAW_LENGTHS[normalizedAlgorithm]) {
    throw caError(
      'CA_WRONG_DIGEST_LENGTH',
      `Digest output for ${normalizedAlgorithm} produced ${digestBytes.byteLength} bytes; expected ${DIGEST_RAW_LENGTHS[normalizedAlgorithm]}`
    );
  }
  return Object.freeze({
    algorithm: normalizedAlgorithm,
    digest: base64UrlEncode(digestBytes)
  });
}

export async function verifyDigest(
  input: JsonValue | string | Uint8Array,
  digestRef: DigestRef
): Promise<boolean> {
  const validated = validateDigestRef(digestRef);
  const computed = await createDigest(input, validated.algorithm);
  return constantTimeStringEqual(computed.digest, validated.digest);
}

/**
 * Compare two strings in constant time relative to their length. Both
 * strings must be base64url (same alphabet) for this to be meaningful.
 */
function constantTimeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export function canonicalizeJson(value: JsonValue): string {
  return JSON.stringify(toCanonical(value, 0));
}

function toCanonical(value: JsonValue, depth: number): JsonValue {
  if (depth > MAX_CANONICAL_DEPTH) {
    throw caError(
      'CA_RECURSION_LIMIT',
      `JSON nesting depth exceeded ${MAX_CANONICAL_DEPTH}`
    );
  }
  if (value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw caError('CA_NON_FINITE_NUMBER', 'Cannot canonicalize non-finite number');
    }
    return value;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    const out: JsonValue[] = new Array(value.length);
    for (let i = 0; i < value.length; i += 1) {
      const element = value[i];
      if (element === undefined) {
        throw caError(
          'CA_UNDEFINED_VALUE',
          'Arrays must not contain undefined values'
        );
      }
      out[i] = toCanonical(element, depth + 1);
    }
    return out;
  }
  if (typeof value === 'object') {
    const record = value as JsonObject;
    // Only enumerate own enumerable string-keyed properties; do not walk the prototype chain.
    const keys = Object.keys(record);
    const pairs: [string, JsonValue][] = [];
    for (const key of keys) {
      assertForbiddenKey(key, 'JSON object key');
      const raw = record[key];
      if (raw === undefined) {
        throw caError(
          'CA_UNDEFINED_VALUE',
          'JSON objects must not contain undefined values'
        );
      }
      pairs.push([key, toCanonical(raw, depth + 1)]);
    }
    pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    // Use a null-prototype object so subsequent assignments cannot mutate Object.prototype.
    const canonical = Object.create(null) as Record<string, JsonValue>;
    for (const [key, normalizedValue] of pairs) {
      // Define the property explicitly so even reserved-looking keys land on the object,
      // not on the prototype chain.
      Object.defineProperty(canonical, key, {
        value: normalizedValue,
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    return canonical as JsonObject;
  }
  throw caError('CA_UNSUPPORTED_JSON_TYPE', `Unsupported JSON value type: ${typeof value}`);
}

function toDigestBytes(input: JsonValue | string | Uint8Array): Uint8Array {
  if (typeof input === 'string') {
    return new TextEncoder().encode(input);
  }
  if (input instanceof Uint8Array) {
    return input;
  }
  return new TextEncoder().encode(canonicalizeJson(input));
}

async function digestBytesWithAlgorithm(
  bytes: Uint8Array,
  algorithm: HashAlgorithm
): Promise<Uint8Array> {
  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    const webAlgorithm = algorithm === 'sha-256' ? 'SHA-256' : 'SHA-512';
    // Copy into a fresh ArrayBuffer to avoid SharedArrayBuffer/transferred-buffer surprises.
    const buffer = bytes.slice().buffer;
    const digestBuffer = await globalThis.crypto.subtle.digest(webAlgorithm, buffer);
    return new Uint8Array(digestBuffer);
  }
  const cryptoModuleName = 'node:crypto';
  const nodeCrypto = (await import(cryptoModuleName)) as NodeCryptoLike;
  const nodeAlgorithm = algorithm === 'sha-256' ? 'sha256' : 'sha512';
  const hash = nodeCrypto.createHash(nodeAlgorithm);
  hash.update(bytes);
  return new Uint8Array(hash.digest());
}

type NodeCryptoLike = {
  createHash(algorithm: string): {
    update(data: Uint8Array): void;
    digest(): Uint8Array;
  };
};

type BufferLike = {
  from(input: Uint8Array): { toString(encoding: 'base64'): string };
};

function base64UrlEncode(bytes: Uint8Array): string {
  const bufferCtor = (globalThis as { Buffer?: BufferLike }).Buffer;
  if (typeof bufferCtor !== 'undefined') {
    return bufferCtor
      .from(bytes)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
