import { describe, expect, it } from 'vitest';
import {
  MULTICODEC_CODES,
  MULTIHASH_CODES,
  decodeMultibaseBody,
  parseCidBinary,
  validateCidV1String
} from '../index.js';

/** A real CIDv1 with raw codec + SHA-256 over an empty payload (base32 lower). */
const SAMPLE_CIDV1_RAW_SHA256 = 'bafkreih2akiscaiv2qtnfwa6vlsa3o5pwf3jmkcswxlha6m4q34cqyvcaa';

describe('parseCidBinary — happy path', () => {
  it('parses a CIDv1 raw + SHA-256 from binary', () => {
    // version=1, codec=0x55 (raw), mh=0x12 (sha2-256), len=32, then 32 zero bytes
    const bytes = new Uint8Array([0x01, 0x55, 0x12, 0x20, ...new Uint8Array(32)]);
    const parsed = parseCidBinary(bytes, 'X');
    expect(parsed.version).toBe(1);
    expect(parsed.multicodec).toBe(0x55);
    expect(parsed.multicodecName).toBe('raw');
    expect(parsed.multihash).toBe(0x12);
    expect(parsed.digestLength).toBe(32);
  });

  it('parses a multi-byte multicodec (dag-json = 0x0129)', () => {
    const bytes = new Uint8Array([
      0x01,
      0xa9,
      0x02, // 0x0129
      0x12,
      0x20,
      ...new Uint8Array(32)
    ]);
    const parsed = parseCidBinary(bytes, 'X');
    expect(parsed.multicodec).toBe(0x0129);
    expect(parsed.multicodecName).toBe('dag-json');
  });

  it('parses SHA-512 (multihash 0x13, length 64)', () => {
    const bytes = new Uint8Array([0x01, 0x55, 0x13, 0x40, ...new Uint8Array(64)]);
    const parsed = parseCidBinary(bytes, 'X');
    expect(parsed.multihash).toBe(0x13);
    expect(parsed.digestLength).toBe(64);
  });

  it('parses BLAKE3 (multihash 0x1e, length 32)', () => {
    const bytes = new Uint8Array([0x01, 0x55, 0x1e, 0x20, ...new Uint8Array(32)]);
    const parsed = parseCidBinary(bytes, 'X');
    expect(parsed.multihash).toBe(0x1e);
  });

  it('decodes the sample CIDv1 string through the full pipeline', () => {
    const decoded = decodeMultibaseBody('b', SAMPLE_CIDV1_RAW_SHA256.slice(1));
    expect(decoded).toBeDefined();
    if (decoded === undefined) throw new Error('unreachable');
    const parsed = parseCidBinary(decoded, 'sample');
    expect(parsed.multicodecName).toBe('raw');
    expect(parsed.multihash).toBe(0x12);
    expect(parsed.digestLength).toBe(32);
  });
});

describe('parseCidBinary — adversarial', () => {
  it('rejects an empty binary', () => {
    expect(() => parseCidBinary(new Uint8Array(0), 'X')).toThrow(/empty CID binary/);
  });

  it('rejects CIDv0 binary (version != 1)', () => {
    const bytes = new Uint8Array([0x00, 0x55, 0x12, 0x20, ...new Uint8Array(32)]);
    expect(() => parseCidBinary(bytes, 'X')).toThrow(/CA_UNSUPPORTED_CID_VERSION/);
  });

  it('rejects an unknown multihash code', () => {
    const bytes = new Uint8Array([0x01, 0x55, 0x77, 0x20, ...new Uint8Array(32)]);
    expect(() => parseCidBinary(bytes, 'X')).toThrow(/unsupported multihash code/);
  });

  it('rejects a digest length that does not match the multihash code', () => {
    const bytes = new Uint8Array([0x01, 0x55, 0x12, 0x10, ...new Uint8Array(16)]);
    expect(() => parseCidBinary(bytes, 'X')).toThrow(/does not match sha2-256/);
  });

  it('rejects trailing bytes after the declared digest', () => {
    const bytes = new Uint8Array([0x01, 0x55, 0x12, 0x20, ...new Uint8Array(33)]);
    expect(() => parseCidBinary(bytes, 'X')).toThrow(/trailing byte/);
  });

  it('rejects a truncated digest', () => {
    const bytes = new Uint8Array([0x01, 0x55, 0x12, 0x20, ...new Uint8Array(10)]);
    expect(() => parseCidBinary(bytes, 'X')).toThrow(/digest truncated/);
  });

  it('rejects a binary larger than the bound', () => {
    const bytes = new Uint8Array(257);
    expect(() => parseCidBinary(bytes, 'X')).toThrow(/exceeds 256/);
  });
});

describe('validateCidV1String integration', () => {
  it('accepts a CID whose binary parse passes', () => {
    expect(() => validateCidV1String(SAMPLE_CIDV1_RAW_SHA256, 'X')).not.toThrow();
  });

  it('rejects a base32 CID whose binary is structurally invalid', () => {
    // "bgaaaa..." — first byte after base32 decode is not 0x01.
    // This is hand-built to look like a CID but is not a valid CIDv1.
    const bogus = 'b' + 'gaaaaaaaaaaaaaaaaaaaaaaaa';
    // Either alphabet check, base32 leftover-bits, or parser rejects it.
    expect(() => validateCidV1String(bogus, 'X')).toThrow();
  });
});

describe('multicodec and multihash tables', () => {
  it('expose the canonical codes we accept', () => {
    expect(MULTICODEC_CODES[0x55]).toBe('raw');
    expect(MULTICODEC_CODES[0x70]).toBe('dag-pb');
    expect(MULTICODEC_CODES[0x71]).toBe('dag-cbor');
    expect(MULTICODEC_CODES[0x0129]).toBe('dag-json');
    expect(MULTIHASH_CODES[0x12]?.name).toBe('sha2-256');
    expect(MULTIHASH_CODES[0x13]?.name).toBe('sha2-512');
    expect(MULTIHASH_CODES[0x1e]?.name).toBe('blake3');
  });
});
