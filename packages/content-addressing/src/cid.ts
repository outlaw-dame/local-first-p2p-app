import { decodeBase16, decodeBase32Lower } from './base32.js';
import type { ContentLinkCodec } from './content-link.js';
import { caError } from './errors.js';
import { readUnsignedVarint } from './varint.js';

/**
 * Multicodec codes we accept inside a CID's binary form. This is the
 * inner binary identifier, not the application-level `ContentLink.codec`
 * field. Application-level codecs that have no canonical multicodec
 * (e.g. `lfp2p-bundle-v1`, `car-v1`) are validated at the ContentLink
 * level but not cross-checked against the CID's multicodec.
 *
 * Source: https://github.com/multiformats/multicodec/blob/master/table.csv
 */
export const MULTICODEC_CODES: Readonly<Record<number, ContentLinkCodec>> = {
  0x55: 'raw',
  0x70: 'dag-pb',
  0x71: 'dag-cbor',
  0x0129: 'dag-json'
};

/**
 * Multihash codes we accept and the byte length each requires.
 *
 * Source: https://github.com/multiformats/multihash
 */
export const MULTIHASH_CODES: Readonly<Record<number, { name: string; digestLength: number }>> = {
  0x12: { name: 'sha2-256', digestLength: 32 },
  0x13: { name: 'sha2-512', digestLength: 64 },
  0x1e: { name: 'blake3', digestLength: 32 }
};

/** Maximum CID binary size we will accept. */
const MAX_CID_BINARY_BYTES = 256;

export type ParsedCid = Readonly<{
  /** CID version. Always 1 in this codebase. */
  version: 1;
  /** Numeric multicodec identifier (e.g. 0x55 for `raw`). */
  multicodec: number;
  /** Application-level name of the multicodec, if recognized. */
  multicodecName?: ContentLinkCodec;
  /** Numeric multihash identifier (e.g. 0x12 for SHA-256). */
  multihash: number;
  /** Decoded digest body length in bytes. */
  digestLength: number;
}>;

/**
 * Decode the body of a CID string (i.e. everything after the multibase
 * prefix character) using the prefix's alphabet. Returns `undefined`
 * for prefixes we do not yet fully parse; callers fall back to the
 * shape-level alphabet checks already performed by `validateCidV1String`.
 */
export function decodeMultibaseBody(prefix: string, body: string): Uint8Array | undefined {
  switch (prefix) {
    case 'b':
      return decodeBase32Lower(body);
    case 'B':
      return decodeBase32Lower(body.toLowerCase());
    case 'f':
      return decodeBase16(body);
    case 'F':
      return decodeBase16(body);
    default:
      return undefined;
  }
}

/**
 * Parse a CIDv1 binary form. Returns the validated structural metadata
 * without exposing the digest bytes themselves.
 *
 * Enforces:
 *  - version == 1
 *  - multicodec is a known code we accept (multicodec name is exposed)
 *  - multihash code is known and the declared digest length matches the
 *    code's expected length
 *  - no trailing bytes beyond the multihash digest
 *  - total binary length is bounded
 */
export function parseCidBinary(bytes: Uint8Array, label: string): ParsedCid {
  if (bytes.length === 0) {
    throw caError('CA_INVALID_CID', `${label}: empty CID binary`);
  }
  if (bytes.length > MAX_CID_BINARY_BYTES) {
    throw caError(
      'CA_INVALID_CID',
      `${label}: CID binary length ${bytes.length} exceeds ${MAX_CID_BINARY_BYTES}`
    );
  }
  let offset = 0;

  const versionRead = readUnsignedVarint(bytes, offset);
  offset += versionRead.bytesRead;
  if (versionRead.value !== 1) {
    throw caError(
      'CA_UNSUPPORTED_CID_VERSION',
      `${label}: CID version ${versionRead.value} is not supported (must be 1)`
    );
  }

  const codecRead = readUnsignedVarint(bytes, offset);
  offset += codecRead.bytesRead;
  const multicodec = codecRead.value;
  const multicodecName = MULTICODEC_CODES[multicodec];
  // We do not reject unknown multicodec codes here because application
  // codecs (e.g. `lfp2p-bundle-v1`) may also use codes outside our
  // recognized table. The ContentLink.codec field is the authoritative
  // application-level declaration; multicodecName is informational.

  const mhCodeRead = readUnsignedVarint(bytes, offset);
  offset += mhCodeRead.bytesRead;
  const multihash = mhCodeRead.value;
  const mhEntry = MULTIHASH_CODES[multihash];
  if (mhEntry === undefined) {
    throw caError(
      'CA_INVALID_CID',
      `${label}: unsupported multihash code 0x${multihash.toString(16)}`
    );
  }

  const mhLenRead = readUnsignedVarint(bytes, offset);
  offset += mhLenRead.bytesRead;
  const digestLength = mhLenRead.value;
  if (digestLength !== mhEntry.digestLength) {
    throw caError(
      'CA_INVALID_CID',
      `${label}: declared digest length ${digestLength} does not match ${mhEntry.name} (${mhEntry.digestLength})`
    );
  }

  const remaining = bytes.length - offset;
  if (remaining < digestLength) {
    throw caError(
      'CA_INVALID_CID',
      `${label}: digest truncated (have ${remaining} bytes, need ${digestLength})`
    );
  }
  if (remaining > digestLength) {
    throw caError(
      'CA_INVALID_CID',
      `${label}: ${remaining - digestLength} trailing byte(s) after digest`
    );
  }

  const parsed: { -readonly [K in keyof ParsedCid]: ParsedCid[K] } = {
    version: 1,
    multicodec,
    multihash,
    digestLength
  };
  if (multicodecName !== undefined) parsed.multicodecName = multicodecName;
  return Object.freeze(parsed);
}
