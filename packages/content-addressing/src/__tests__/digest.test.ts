import { describe, expect, it } from 'vitest';
import {
  CONTENT_ADDRESSING_VERSION,
  SUPPORTED_HASH_ALGORITHMS,
  canonicalizeJson,
  createDigest,
  validateDigestRef,
  verifyDigest
} from '../index.js';

describe('CONTENT_ADDRESSING_VERSION', () => {
  it('is the v1 stable identifier', () => {
    expect(CONTENT_ADDRESSING_VERSION).toBe('lfp2p.content-addressing.v1');
  });
});

describe('createDigest', () => {
  it('reproduces a known SHA-256 over the empty string', async () => {
    const ref = await createDigest('');
    expect(ref.algorithm).toBe('sha-256');
    // SHA-256("") = e3b0c442... → base64url = 47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU
    expect(ref.digest).toBe('47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU');
  });

  it('produces a 43-char base64url SHA-256 digest body', async () => {
    const ref = await createDigest('hello world');
    expect(ref.digest).toHaveLength(43);
    expect(ref.digest).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces an 86-char base64url SHA-512 digest body', async () => {
    const ref = await createDigest('hello world', 'sha-512');
    expect(ref.algorithm).toBe('sha-512');
    expect(ref.digest).toHaveLength(86);
  });

  it('is deterministic regardless of object key order', async () => {
    const a = await createDigest({ b: 2, a: 1, c: [3, 2, 1] });
    const b = await createDigest({ c: [3, 2, 1], a: 1, b: 2 });
    expect(a.digest).toBe(b.digest);
  });

  it('produces different digests for value-different objects', async () => {
    const a = await createDigest({ a: 1, b: 2 });
    const b = await createDigest({ a: 1, b: 3 });
    expect(a.digest).not.toBe(b.digest);
  });

  it('rejects unsupported algorithms', async () => {
    await expect(() => createDigest('x', 'sha-1' as unknown as 'sha-256')).rejects.toThrow(
      /CA_UNSUPPORTED_ALGORITHM/
    );
  });

  it('rejects non-finite numbers when digesting JSON', async () => {
    await expect(() => createDigest({ a: Number.NaN as unknown as number })).rejects.toThrow(
      /CA_NON_FINITE_NUMBER/
    );
  });

  it('rejects undefined values inside objects', async () => {
    await expect(() => createDigest({ a: undefined as unknown as number })).rejects.toThrow(
      /CA_UNDEFINED_VALUE/
    );
  });
});

describe('verifyDigest', () => {
  it('accepts a matching input/digest pair', async () => {
    const ref = await createDigest('hello');
    expect(await verifyDigest('hello', ref)).toBe(true);
  });

  it('rejects a tampered input', async () => {
    const ref = await createDigest('hello');
    expect(await verifyDigest('Hello', ref)).toBe(false);
  });

  it('rejects an invalid digest ref shape without computing', async () => {
    await expect(() =>
      verifyDigest('x', { algorithm: 'sha-256', digest: 'too short' } as unknown as Parameters<
        typeof verifyDigest
      >[1])
    ).rejects.toThrow(/CA_INVALID_BASE64URL|CA_WRONG_DIGEST_LENGTH/);
  });
});

describe('validateDigestRef', () => {
  it('accepts a valid SHA-256 ref', () => {
    expect(() =>
      validateDigestRef({
        algorithm: 'sha-256',
        digest: '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU'
      })
    ).not.toThrow();
  });

  it('rejects unknown algorithms', () => {
    expect(() => validateDigestRef({ algorithm: 'md5', digest: 'x' })).toThrow(
      /CA_UNSUPPORTED_ALGORITHM/
    );
  });

  it('rejects wrong digest length for the algorithm', () => {
    expect(() => validateDigestRef({ algorithm: 'sha-256', digest: 'short' })).toThrow(
      /CA_WRONG_DIGEST_LENGTH/
    );
  });

  it('rejects non-base64url characters', () => {
    expect(() =>
      validateDigestRef({
        algorithm: 'sha-256',
        digest: '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU'
      })
    ).toThrow(/CA_INVALID_BASE64URL/);
  });

  it('rejects null and non-object inputs', () => {
    expect(() => validateDigestRef(null)).toThrow(/CA_INVALID_INPUT/);
    expect(() => validateDigestRef('not an object')).toThrow(/CA_INVALID_INPUT/);
  });
});

describe('canonicalizeJson — adversarial', () => {
  it('sorts object keys lexicographically', () => {
    expect(canonicalizeJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it('rejects __proto__ keys', () => {
    // Use Object.defineProperty to make __proto__ an own enumerable string-keyed
    // property; a plain `{ __proto__: ... }` literal sets the prototype instead.
    const evil = Object.defineProperty({} as Record<string, unknown>, '__proto__', {
      value: 'pwn',
      enumerable: true,
      writable: true,
      configurable: true
    });
    expect(() => canonicalizeJson(evil as unknown as Record<string, never>)).toThrow(
      /CA_FORBIDDEN_KEY/
    );
  });

  it('rejects constructor keys', () => {
    const evil = { constructor: 'pwn' };
    expect(() => canonicalizeJson(evil)).toThrow(/CA_FORBIDDEN_KEY/);
  });

  it('rejects prototype keys', () => {
    const evil = { prototype: 'pwn' };
    expect(() => canonicalizeJson(evil)).toThrow(/CA_FORBIDDEN_KEY/);
  });

  it('rejects extreme nesting depth', () => {
    let nested: unknown = 1;
    for (let i = 0; i < 200; i += 1) {
      nested = { x: nested };
    }
    expect(() => canonicalizeJson(nested as Record<string, unknown>)).toThrow(/CA_RECURSION_LIMIT/);
  });

  it('does not pollute Object.prototype via canonicalization output', () => {
    const before = (Object.prototype as Record<string, unknown>).polluted;
    canonicalizeJson({ a: 1, b: 2 });
    const after = (Object.prototype as Record<string, unknown>).polluted;
    expect(after).toBe(before);
  });

  it('digest of object with adversarial __proto__ key is rejected (no collision with {})', async () => {
    const evil = Object.defineProperty({} as Record<string, unknown>, '__proto__', {
      value: { x: 1 },
      enumerable: true,
      writable: true,
      configurable: true
    });
    await expect(() => createDigest(evil as unknown as Record<string, never>)).rejects.toThrow(
      /CA_FORBIDDEN_KEY/
    );
  });
});

describe('SUPPORTED_HASH_ALGORITHMS', () => {
  it('is the documented set (including reserved blake3)', () => {
    expect(SUPPORTED_HASH_ALGORITHMS).toEqual(['sha-256', 'sha-512', 'blake3']);
  });
});
