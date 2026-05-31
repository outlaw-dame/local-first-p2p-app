import type { ContentLink } from './content-link.js';
import { validateContentLink } from './content-link.js';
import type { DigestRef } from './digest.js';
import { validateDigestRef } from './digest.js';
import type { StorageLocationHint } from './location-hint.js';
import { validateStorageLocationHint } from './location-hint.js';
import { caError } from './errors.js';
import {
  assertNonEmptyString,
  assertPlainObject,
  assertSafeNonNegativeInteger
} from './validation.js';

/** Hard bound on individual block size to keep validators sane. */
export const MAX_BLOCK_BYTE_LENGTH = 1024 * 1024 * 1024; // 1 GiB

/** Hard bound on decoded size of a compressed block to prevent bombs. */
export const MAX_DECODED_BYTE_LENGTH = 16 * 1024 * 1024 * 1024; // 16 GiB

/**
 * Maximum decoded:encoded compression ratio. Real-world high-quality
 * compression of textual data tops out around ~30x. We pad the cap to
 * 1024x to allow exotic-but-plausible cases while still rejecting
 * intentional bombs (which can easily exceed 10^6:1).
 */
export const MAX_COMPRESSION_RATIO = 1024;

export const MAX_STORAGE_HINTS = 32;

export const ENCRYPTION_SCHEMES = [
  'aes-256-gcm',
  'xchacha20-poly1305',
  'mls-v1',
  'lfp2p-envelope-v1'
] as const;

export type EncryptionScheme = (typeof ENCRYPTION_SCHEMES)[number];

export const COMPRESSION_ALGORITHMS = ['identity', 'zstd', 'gzip', 'br'] as const;

export type CompressionAlgorithm = (typeof COMPRESSION_ALGORITHMS)[number];

export type Privacy = 'public' | 'private';

export type EncryptionDescriptor = Readonly<{
  scheme: EncryptionScheme;
  keyRef: DigestRef;
}>;

export type CompressionDescriptor = Readonly<{
  algorithm: CompressionAlgorithm;
  encodedSize: number;
  decodedSize: number;
  dictionaryRef?: DigestRef;
}>;

export type BlockSource =
  | Readonly<{ kind: 'digest'; digest: DigestRef }>
  | Readonly<{ kind: 'content-link'; link: ContentLink }>;

export type BlockRef = Readonly<{
  type: 'block-ref';
  source: BlockSource;
  byteLength: number;
  offset: number;
  privacy: Privacy;
  encryption?: EncryptionDescriptor;
  compression?: CompressionDescriptor;
  storageHints?: ReadonlyArray<StorageLocationHint>;
}>;

function validatePrivacy(value: unknown): Privacy {
  if (value === 'public' || value === 'private') return value;
  throw caError('CA_INVALID_INPUT', 'BlockRef.privacy must be "public" or "private"');
}

function validateBlockSource(value: unknown): BlockSource {
  const record = assertPlainObject(value, 'BlockRef.source');
  if (record.kind === 'digest') {
    const digest = validateDigestRef(record.digest);
    return Object.freeze({ kind: 'digest' as const, digest });
  }
  if (record.kind === 'content-link') {
    const link = validateContentLink(record.link);
    return Object.freeze({ kind: 'content-link' as const, link });
  }
  throw caError(
    'CA_INVALID_INPUT',
    'BlockRef.source.kind must be "digest" or "content-link"'
  );
}

function sourceDigestForComparison(source: BlockSource): string | undefined {
  if (source.kind === 'digest') return source.digest.digest;
  return undefined;
}

function validateEncryption(value: unknown): EncryptionDescriptor {
  const record = assertPlainObject(value, 'BlockRef.encryption');
  assertNonEmptyString(record.scheme, 'BlockRef.encryption.scheme');
  if (!ENCRYPTION_SCHEMES.includes(record.scheme as EncryptionScheme)) {
    throw caError(
      'CA_INVALID_ENCRYPTION_DESCRIPTOR',
      `BlockRef.encryption.scheme must be one of ${ENCRYPTION_SCHEMES.join(', ')}`
    );
  }
  const keyRef = validateDigestRef(record.keyRef);
  return Object.freeze({ scheme: record.scheme as EncryptionScheme, keyRef });
}

function validateCompression(value: unknown, source: BlockSource): CompressionDescriptor {
  const record = assertPlainObject(value, 'BlockRef.compression');
  if (!COMPRESSION_ALGORITHMS.includes(record.algorithm as CompressionAlgorithm)) {
    throw caError(
      'CA_INVALID_COMPRESSION_DESCRIPTOR',
      `BlockRef.compression.algorithm must be one of ${COMPRESSION_ALGORITHMS.join(', ')}`
    );
  }
  const algorithm = record.algorithm as CompressionAlgorithm;

  const encodedSize = assertSafeNonNegativeInteger(
    record.encodedSize,
    'BlockRef.compression.encodedSize'
  );
  const decodedSize = assertSafeNonNegativeInteger(
    record.decodedSize,
    'BlockRef.compression.decodedSize'
  );
  if (decodedSize > MAX_DECODED_BYTE_LENGTH) {
    throw caError(
      'CA_UNSAFE_COMPRESSION',
      `BlockRef.compression.decodedSize ${decodedSize} exceeds MAX_DECODED_BYTE_LENGTH ${MAX_DECODED_BYTE_LENGTH}`
    );
  }
  if (algorithm === 'identity') {
    if (encodedSize !== decodedSize) {
      throw caError(
        'CA_INVALID_COMPRESSION_DESCRIPTOR',
        'BlockRef.compression.identity requires encodedSize === decodedSize'
      );
    }
  } else if (encodedSize === 0) {
    // Non-identity compression must describe a positive encoded size.
    throw caError(
      'CA_INVALID_COMPRESSION_DESCRIPTOR',
      `BlockRef.compression.${algorithm} requires encodedSize > 0`
    );
  } else {
    const ratio = decodedSize / encodedSize;
    if (ratio > MAX_COMPRESSION_RATIO) {
      throw caError(
        'CA_UNSAFE_COMPRESSION',
        `BlockRef.compression: decoded:encoded ratio ${ratio.toFixed(2)} exceeds MAX_COMPRESSION_RATIO ${MAX_COMPRESSION_RATIO}`
      );
    }
  }

  let dictionaryRef: DigestRef | undefined;
  if (record.dictionaryRef !== undefined) {
    dictionaryRef = validateDigestRef(record.dictionaryRef);
    const ownDigest = sourceDigestForComparison(source);
    if (ownDigest !== undefined && dictionaryRef.digest === ownDigest) {
      throw caError(
        'CA_UNSAFE_DICTIONARY_REF',
        'BlockRef.compression.dictionaryRef must not equal the block source digest (would recurse)'
      );
    }
  }

  const out: { -readonly [K in keyof CompressionDescriptor]: CompressionDescriptor[K] } = {
    algorithm,
    encodedSize,
    decodedSize
  };
  if (dictionaryRef !== undefined) out.dictionaryRef = dictionaryRef;
  return Object.freeze(out);
}

function validateStorageHints(value: unknown): ReadonlyArray<StorageLocationHint> {
  if (!Array.isArray(value)) {
    throw caError('CA_INVALID_INPUT', 'BlockRef.storageHints must be an array');
  }
  if (value.length > MAX_STORAGE_HINTS) {
    throw caError(
      'CA_INVALID_INPUT',
      `BlockRef.storageHints length ${value.length} exceeds MAX_STORAGE_HINTS ${MAX_STORAGE_HINTS}`
    );
  }
  const out: StorageLocationHint[] = [];
  for (const hint of value) {
    out.push(validateStorageLocationHint(hint));
  }
  return Object.freeze(out);
}

export function validateBlockRef(value: unknown): BlockRef {
  const record = assertPlainObject(value, 'BlockRef');
  if (record.type !== 'block-ref') {
    throw caError('CA_INVALID_INPUT', 'BlockRef.type must equal "block-ref"');
  }
  const source = validateBlockSource(record.source);
  const byteLength = assertSafeNonNegativeInteger(record.byteLength, 'BlockRef.byteLength');
  if (byteLength > MAX_BLOCK_BYTE_LENGTH) {
    throw caError(
      'CA_INVALID_BYTE_LENGTH',
      `BlockRef.byteLength ${byteLength} exceeds MAX_BLOCK_BYTE_LENGTH ${MAX_BLOCK_BYTE_LENGTH}`
    );
  }
  const offset = record.offset === undefined
    ? 0
    : assertSafeNonNegativeInteger(record.offset, 'BlockRef.offset');
  const privacy = validatePrivacy(record.privacy);

  let encryption: EncryptionDescriptor | undefined;
  if (record.encryption !== undefined) {
    encryption = validateEncryption(record.encryption);
  }
  if (privacy === 'private' && encryption === undefined) {
    throw caError(
      'CA_MISSING_ENCRYPTION_DESCRIPTOR',
      'BlockRef.privacy="private" requires an encryption descriptor'
    );
  }

  let compression: CompressionDescriptor | undefined;
  if (record.compression !== undefined) {
    compression = validateCompression(record.compression, source);
  }

  let storageHints: ReadonlyArray<StorageLocationHint> | undefined;
  if (record.storageHints !== undefined) {
    storageHints = validateStorageHints(record.storageHints);
  }

  const out: { -readonly [K in keyof BlockRef]: BlockRef[K] } = {
    type: 'block-ref',
    source,
    byteLength,
    offset,
    privacy
  };
  if (encryption !== undefined) out.encryption = encryption;
  if (compression !== undefined) out.compression = compression;
  if (storageHints !== undefined) out.storageHints = storageHints;
  return Object.freeze(out);
}

export function createBlockRef(input: {
  source: BlockSource;
  byteLength: number;
  privacy: Privacy;
  offset?: number;
  encryption?: EncryptionDescriptor;
  compression?: CompressionDescriptor;
  storageHints?: ReadonlyArray<StorageLocationHint>;
}): BlockRef {
  return validateBlockRef({ type: 'block-ref', ...input });
}
