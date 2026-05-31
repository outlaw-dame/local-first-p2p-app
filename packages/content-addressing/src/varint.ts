import { caError } from './errors.js';

/**
 * Maximum number of bytes we will consume when reading an unsigned varint.
 *
 * The multicodec/multihash codes we accept all fit in ≤2 bytes; bounding to
 * 9 keeps us comfortably under JavaScript's safe-integer ceiling (2^53-1
 * needs 8 base-128 digits) while preventing an attacker from forcing
 * unbounded work or producing a non-canonical encoding.
 */
export const MAX_VARINT_BYTES = 9;

/** Result of reading one varint from a byte stream. */
export type VarintRead = Readonly<{ value: number; bytesRead: number }>;

/**
 * Read an unsigned varint from `bytes` starting at `offset`.
 *
 * Enforces:
 *  - presence of the continuation byte
 *  - bounded length (≤ MAX_VARINT_BYTES)
 *  - safe-integer result
 *  - canonical (minimal) encoding: a varint of length N must require N bytes;
 *    a value that could be encoded in fewer bytes is rejected.
 *
 * Throws `CA_INVALID_CID` on any violation; the caller decides whether to
 * rewrap the error with a more specific label.
 */
export function readUnsignedVarint(bytes: Uint8Array, offset: number): VarintRead {
  let value = 0;
  let shift = 0;
  for (let i = 0; i < MAX_VARINT_BYTES; i += 1) {
    const pos = offset + i;
    if (pos >= bytes.length) {
      throw caError('CA_INVALID_CID', `varint truncated at offset ${pos}`);
    }
    const byte = bytes[pos]!;
    const part = byte & 0x7f;
    if (shift > 49) {
      throw caError('CA_INVALID_CID', 'varint exceeds safe-integer range');
    }
    value += part * Math.pow(2, shift);
    if (!Number.isSafeInteger(value)) {
      throw caError('CA_INVALID_CID', 'varint exceeds safe-integer range');
    }
    if ((byte & 0x80) === 0) {
      // Canonical-encoding check: the final byte must not be 0 unless the
      // whole varint is a single zero byte.
      if (i > 0 && part === 0) {
        throw caError(
          'CA_INVALID_CID',
          `varint is not minimally encoded at offset ${offset}`
        );
      }
      return { value, bytesRead: i + 1 };
    }
    shift += 7;
  }
  throw caError(
    'CA_INVALID_CID',
    `varint exceeds MAX_VARINT_BYTES (${MAX_VARINT_BYTES})`
  );
}
