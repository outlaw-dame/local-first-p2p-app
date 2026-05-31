import { caError } from './errors.js';

/**
 * RFC 4648 base32 (lower-case, no padding) decoder.
 *
 * Alphabet: abcdefghijklmnopqrstuvwxyz234567
 * Each character carries 5 bits; output byte length = floor(input.length * 5 / 8).
 *
 * This decoder is the one used by multibase prefix 'b'. The matching
 * decoder for prefix 'B' is implemented by lower-casing the input and
 * reusing this function.
 */
export function decodeBase32Lower(input: string): Uint8Array {
  const out = new Uint8Array(Math.floor((input.length * 5) / 8));
  let outIndex = 0;
  let accumulator = 0;
  let accBits = 0;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    let value: number;
    // 'a'..'z' -> 0..25
    if (ch >= 97 && ch <= 122) {
      value = ch - 97;
    } else if (ch >= 50 && ch <= 55) {
      // '2'..'7' -> 26..31
      value = ch - 50 + 26;
    } else {
      throw caError(
        'CA_INVALID_CID',
        `base32 input contains non-alphabet character at index ${i}`
      );
    }
    accumulator = (accumulator << 5) | value;
    accBits += 5;
    if (accBits >= 8) {
      accBits -= 8;
      out[outIndex] = (accumulator >> accBits) & 0xff;
      outIndex += 1;
    }
  }
  // Any leftover bits MUST be zero — otherwise the input is not a canonical
  // base32 encoding of a byte sequence.
  if (accBits > 0) {
    const leftover = accumulator & ((1 << accBits) - 1);
    if (leftover !== 0) {
      throw caError(
        'CA_INVALID_CID',
        'base32 input has non-zero leftover bits (not canonical)'
      );
    }
  }
  return out.subarray(0, outIndex);
}

/**
 * RFC 4648 base16 (hex) decoder. Accepts upper-case via case-insensitive lookup.
 */
export function decodeBase16(input: string): Uint8Array {
  if ((input.length & 1) === 1) {
    throw caError('CA_INVALID_CID', 'base16 input has odd length');
  }
  const out = new Uint8Array(input.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const hi = hexNibble(input.charCodeAt(i * 2), i * 2);
    const lo = hexNibble(input.charCodeAt(i * 2 + 1), i * 2 + 1);
    out[i] = (hi << 4) | lo;
  }
  return out;
}

function hexNibble(charCode: number, index: number): number {
  if (charCode >= 48 && charCode <= 57) return charCode - 48; // 0..9
  if (charCode >= 97 && charCode <= 102) return charCode - 97 + 10; // a..f
  if (charCode >= 65 && charCode <= 70) return charCode - 65 + 10; // A..F
  throw caError(
    'CA_INVALID_CID',
    `base16 input contains non-hex character at index ${index}`
  );
}
