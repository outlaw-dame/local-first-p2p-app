import { describe, expect, it } from 'vitest';
import {
  COMPUTABLE_HASH_ALGORITHMS,
  SUPPORTED_HASH_ALGORITHMS,
  createDigest,
  validateDigestRef,
  verifyDigest
} from '../index.js';

describe('BLAKE3 reservation', () => {
  it('blake3 is in the supported (network-accepted) algorithm list', () => {
    expect(SUPPORTED_HASH_ALGORITHMS).toContain('blake3');
  });

  it('blake3 is NOT in the computable algorithm list (fail-closed locally)', () => {
    expect(COMPUTABLE_HASH_ALGORITHMS).not.toContain('blake3' as never);
    expect(COMPUTABLE_HASH_ALGORITHMS).toEqual(['sha-256', 'sha-512']);
  });

  it('validateDigestRef accepts a well-formed blake3 ref (network passthrough)', () => {
    // 32-byte blake3 digest encodes to 43 base64url chars (same as sha-256).
    expect(() =>
      validateDigestRef({
        algorithm: 'blake3',
        digest: '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU'
      })
    ).not.toThrow();
  });

  it('createDigest with blake3 throws a clear "reserved" error', async () => {
    await expect(() => createDigest('hi', 'blake3')).rejects.toThrow(/reserved/i);
  });

  it('verifyDigest against a blake3 ref throws a clear "reserved" error', async () => {
    await expect(() =>
      verifyDigest('hi', {
        algorithm: 'blake3',
        digest: '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU'
      })
    ).rejects.toThrow(/reserved|fail-closed/i);
  });
});
