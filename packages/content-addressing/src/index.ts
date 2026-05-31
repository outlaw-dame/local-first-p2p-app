export type HashAlgorithm = 'sha256' | 'sha512';

export const CONTENT_ADDRESSING_VERSION = 'lfp2p.content-addressing.v1' as const;

export type ContentAddressingVersion = typeof CONTENT_ADDRESSING_VERSION;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

export type DigestRef = Readonly<{
  algorithm: HashAlgorithm;
  digest: string;
}>;

export type ContentLink = Readonly<{
  type: 'content-link';
  ref: DigestRef;
  mediaType?: string;
  size?: number;
}>;

export type BlockRef = Readonly<{
  type: 'block-ref';
  ref: DigestRef;
  offset?: number;
  length?: number;
  storageLocationHint?: StorageLocationHint;
}>;

export type ObjectRef = Readonly<{
  type: 'object-ref';
  ref: DigestRef;
  schemaVersion?: number;
}>;

export type BundleRef = Readonly<{
  type: 'bundle-ref';
  ref: DigestRef;
  itemCount?: number;
  contentType?: string;
}>;

export type StorageLocationHint = Readonly<{
  kind: 'http' | 'ipfs' | 'hypercore' | 'local' | 'custom';
  uri: string;
  metadata?: JsonObject;
}>;

const SUPPORTED_HASH_ALGORITHMS: readonly HashAlgorithm[] = ['sha256', 'sha512'];
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export async function createDigest(
  input: JsonValue | string | Uint8Array,
  algorithm: HashAlgorithm = 'sha256'
): Promise<DigestRef> {
  const normalizedAlgorithm = requireHashAlgorithm(algorithm);
  const bytes = toDigestBytes(input);
  const digestBytes = await digestBytesWithAlgorithm(bytes, normalizedAlgorithm);
  return {
    algorithm: normalizedAlgorithm,
    digest: base64UrlEncode(digestBytes)
  };
}

export async function verifyDigest(
  input: JsonValue | string | Uint8Array,
  digestRef: DigestRef
): Promise<boolean> {
  validateDigestRef(digestRef);
  const computed = await createDigest(input, digestRef.algorithm);
  return computed.digest === digestRef.digest;
}

export function createContentLink(
  ref: DigestRef,
  options?: Readonly<{ mediaType?: string; size?: number }>
): ContentLink {
  validateDigestRef(ref);
  return {
    type: 'content-link',
    ref,
    ...(options?.mediaType === undefined ? {} : { mediaType: options.mediaType }),
    ...(options?.size === undefined ? {} : { size: options.size })
  };
}

export function createBlockRef(
  ref: DigestRef,
  options?: Readonly<{
    offset?: number;
    length?: number;
    storageLocationHint?: StorageLocationHint;
  }>
): BlockRef {
  validateDigestRef(ref);
  if (options?.offset !== undefined && !Number.isSafeInteger(options.offset)) {
    throw new Error('BlockRef.offset must be a safe integer');
  }
  if (options?.offset !== undefined && options.offset < 0) {
    throw new Error('BlockRef.offset must be non-negative');
  }
  if (options?.length !== undefined && !Number.isSafeInteger(options.length)) {
    throw new Error('BlockRef.length must be a safe integer');
  }
  if (options?.length !== undefined && options.length < 0) {
    throw new Error('BlockRef.length must be non-negative');
  }
  return {
    type: 'block-ref',
    ref,
    ...(options?.offset === undefined ? {} : { offset: options.offset }),
    ...(options?.length === undefined ? {} : { length: options.length }),
    ...(options?.storageLocationHint === undefined
      ? {}
      : { storageLocationHint: validateStorageLocationHint(options.storageLocationHint) })
  };
}

export function createObjectRef(
  ref: DigestRef,
  options?: Readonly<{ schemaVersion?: number }>
): ObjectRef {
  validateDigestRef(ref);
  if (options?.schemaVersion !== undefined && !Number.isSafeInteger(options.schemaVersion)) {
    throw new Error('ObjectRef.schemaVersion must be a safe integer');
  }
  return {
    type: 'object-ref',
    ref,
    ...(options?.schemaVersion === undefined ? {} : { schemaVersion: options.schemaVersion })
  };
}

export function createBundleRef(
  ref: DigestRef,
  options?: Readonly<{ itemCount?: number; contentType?: string }>
): BundleRef {
  validateDigestRef(ref);
  if (options?.itemCount !== undefined && !Number.isSafeInteger(options.itemCount)) {
    throw new Error('BundleRef.itemCount must be a safe integer');
  }
  return {
    type: 'bundle-ref',
    ref,
    ...(options?.itemCount === undefined ? {} : { itemCount: options.itemCount }),
    ...(options?.contentType === undefined ? {} : { contentType: options.contentType })
  };
}

export function validateDigestRef(value: DigestRef): DigestRef {
  if (typeof value !== 'object' || value === null) {
    throw new Error('DigestRef must be an object');
  }
  const algorithm = value.algorithm;
  if (!SUPPORTED_HASH_ALGORITHMS.includes(algorithm)) {
    throw new Error(`Unsupported hash algorithm: ${String(algorithm)}`);
  }
  if (typeof value.digest !== 'string' || value.digest.length === 0) {
    throw new Error('DigestRef.digest must be a non-empty string');
  }
  if (!BASE64URL_PATTERN.test(value.digest)) {
    throw new Error('DigestRef.digest must be base64url encoded without padding');
  }
  return value;
}

export function validateStorageLocationHint(value: StorageLocationHint): StorageLocationHint {
  if (typeof value !== 'object' || value === null) {
    throw new Error('StorageLocationHint must be an object');
  }
  const { kind, uri, metadata } = value;
  if (!['http', 'ipfs', 'hypercore', 'local', 'custom'].includes(kind)) {
    throw new Error(`StorageLocationHint.kind must be one of http, ipfs, hypercore, local, custom`);
  }
  if (typeof uri !== 'string' || uri.trim().length === 0) {
    throw new Error('StorageLocationHint.uri must be a non-empty string');
  }
  if (metadata !== undefined) {
    assertJsonObject(metadata, 'StorageLocationHint.metadata');
  }
  return value;
}

export function canonicalizeJson(value: JsonValue): string {
  return JSON.stringify(toCanonical(value));
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
    const webAlgorithm = algorithm === 'sha256' ? 'SHA-256' : 'SHA-512';
    const digestBuffer = await globalThis.crypto.subtle.digest(
      webAlgorithm,
      bytes.buffer as ArrayBuffer
    );
    return new Uint8Array(digestBuffer);
  }

  const nodeCrypto = (await import('node:crypto')) as NodeCryptoLike;
  const hash = nodeCrypto.createHash(algorithm);
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

function requireHashAlgorithm(value: string): HashAlgorithm {
  if (!SUPPORTED_HASH_ALGORITHMS.includes(value as HashAlgorithm)) {
    throw new Error(`Unsupported hash algorithm: ${String(value)}`);
  }
  return value as HashAlgorithm;
}

function toCanonical(value: JsonValue): JsonValue {
  if (value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Cannot canonicalize non-finite number');
    }
    return value;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toCanonical);
  }
  if (typeof value === 'object') {
    const record = value as JsonObject;
    const keys = Object.keys(record);
    const canonicalPairs: [string, JsonValue][] = keys.map((key) => {
      const raw = record[key];
      if (raw === undefined) {
        throw new Error('JSON objects must not contain undefined values');
      }
      return [key, toCanonical(raw)];
    });
    canonicalPairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const canonicalObject: Record<string, JsonValue> = {};
    for (const [key, normalizedValue] of canonicalPairs) {
      canonicalObject[key] = normalizedValue;
    }
    return canonicalObject as JsonObject;
  }
  throw new Error(`Unsupported JSON value type: ${typeof value}`);
}

function assertJsonObject(value: JsonObject, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  toCanonical(value);
  return value;
}
