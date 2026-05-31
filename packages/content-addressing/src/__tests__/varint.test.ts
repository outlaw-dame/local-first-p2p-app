import { describe, expect, it } from 'vitest';
import { MAX_VARINT_BYTES, readUnsignedVarint } from '../index.js';

describe('readUnsignedVarint', () => {
  it('reads single-byte values', () => {
    expect(readUnsignedVarint(new Uint8Array([0]), 0)).toEqual({ value: 0, bytesRead: 1 });
    expect(readUnsignedVarint(new Uint8Array([1]), 0)).toEqual({ value: 1, bytesRead: 1 });
    expect(readUnsignedVarint(new Uint8Array([0x7f]), 0)).toEqual({
      value: 127,
      bytesRead: 1
    });
  });

  it('reads multi-byte values (multicodec dag-json = 0x0129)', () => {
    expect(readUnsignedVarint(new Uint8Array([0xa9, 0x02]), 0)).toEqual({
      value: 0x0129,
      bytesRead: 2
    });
  });

  it('reads values inside a longer buffer at an offset', () => {
    const buf = new Uint8Array([0xff, 0x55, 0xff]);
    expect(readUnsignedVarint(buf, 1)).toEqual({ value: 0x55, bytesRead: 1 });
  });

  it('rejects truncated input (continuation byte never closes)', () => {
    expect(() =>
      readUnsignedVarint(new Uint8Array([0x80, 0x80, 0x80]), 0)
    ).toThrow(/CA_INVALID_CID/);
  });

  it('rejects a non-minimally-encoded varint (trailing zero byte)', () => {
    // 0x01 0x00 -> encodes value 0 with a wasted continuation; not canonical.
    expect(() =>
      readUnsignedVarint(new Uint8Array([0x80, 0x00]), 0)
    ).toThrow(/not minimally encoded/);
  });

  it('rejects continuation runs that would consume more than MAX_VARINT_BYTES', () => {
    // With pure-continuation 0x80 bytes the safe-integer guard fires first;
    // either way the call must throw CA_INVALID_CID before reading
    // unbounded input. The defense-in-depth point is that we never exceed
    // MAX_VARINT_BYTES bytes consumed.
    const tooLong = new Uint8Array(MAX_VARINT_BYTES + 1).fill(0x80);
    expect(() => readUnsignedVarint(tooLong, 0)).toThrow(/CA_INVALID_CID/);
  });

  it('rejects varints whose value would exceed safe-integer range', () => {
    // Six 0xff bytes then a closing 0x01: 7 bytes of base-128 digits, value ≈ 2^49.
    // Eight bytes of continuation 0xff then 0xff closes — value exceeds 2^53.
    const bytes = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]);
    expect(() => readUnsignedVarint(bytes, 0)).toThrow(/safe-integer/);
  });
});
