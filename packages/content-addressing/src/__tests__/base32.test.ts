import { describe, expect, it } from 'vitest';
import { decodeBase16, decodeBase32Lower } from '../index.js';

describe('decodeBase32Lower', () => {
  it('decodes an empty input to an empty buffer', () => {
    expect(decodeBase32Lower('')).toEqual(new Uint8Array(0));
  });

  it('decodes a known sequence (RFC 4648 §6 vector "fo" -> "mzxq")', () => {
    expect(decodeBase32Lower('mzxq')).toEqual(new Uint8Array([0x66, 0x6f]));
  });

  it('rejects non-alphabet characters', () => {
    expect(() => decodeBase32Lower('mzxq?')).toThrow(/non-alphabet/);
    // '8' is not a base32 digit
    expect(() => decodeBase32Lower('mzx8')).toThrow(/non-alphabet/);
    // uppercase is not accepted by the lower-case decoder
    expect(() => decodeBase32Lower('MZXQ')).toThrow(/non-alphabet/);
  });

  it('rejects non-canonical leftover bits', () => {
    // 'b' -> 5 bits = 00001; not a whole byte. The 5 leftover bits would
    // need to be zero (i.e. character 'a'), so 'b' alone is non-canonical.
    expect(() => decodeBase32Lower('b')).toThrow(/leftover bits/);
  });

  it('accepts canonical zero-leftover encodings', () => {
    // 'a' = 0b00000 -> single 5-bit chunk, leftover bits == 0, output is empty.
    expect(decodeBase32Lower('a')).toEqual(new Uint8Array(0));
  });
});

describe('decodeBase16', () => {
  it('decodes hex strings', () => {
    expect(decodeBase16('00ff')).toEqual(new Uint8Array([0x00, 0xff]));
    expect(decodeBase16('DEADBEEF')).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('rejects odd-length inputs', () => {
    expect(() => decodeBase16('abc')).toThrow(/odd length/);
  });

  it('rejects non-hex characters', () => {
    expect(() => decodeBase16('zz')).toThrow(/non-hex/);
    expect(() => decodeBase16('gh')).toThrow(/non-hex/);
  });
});
