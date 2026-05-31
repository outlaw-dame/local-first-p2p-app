import { describe, expect, it } from 'vitest';
import {
  BUNDLE_FORMATS,
  BUNDLE_PURPOSES,
  MAX_BUNDLE_BYTE_LENGTH,
  MAX_BUNDLE_ROOTS,
  createBundleRef,
  validateBundleRef
} from '../index.js';

const VALID_DIGEST = {
  algorithm: 'sha-256' as const,
  digest: '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU'
};

describe('validateBundleRef — happy path', () => {
  it('accepts a single-root CAR-v1 bundle', () => {
    const ref = validateBundleRef({
      type: 'bundle-ref',
      format: 'car-v1',
      purpose: 'report-evidence',
      roots: [{ kind: 'digest', digest: VALID_DIGEST }],
      byteLength: 65536,
      encrypted: false
    });
    expect(ref.format).toBe('car-v1');
    expect(ref.purpose).toBe('report-evidence');
    expect(ref.roots).toHaveLength(1);
  });

  it('createBundleRef wraps validateBundleRef with the type tag', () => {
    const ref = createBundleRef({
      format: 'lfp2p-bundle-v1',
      purpose: 'archive',
      roots: [{ kind: 'digest', digest: VALID_DIGEST }],
      byteLength: 1024,
      encrypted: true
    });
    expect(ref.type).toBe('bundle-ref');
    expect(ref.encrypted).toBe(true);
  });
});

describe('validateBundleRef — adversarial', () => {
  it('rejects empty roots', () => {
    expect(() =>
      validateBundleRef({
        type: 'bundle-ref',
        format: 'car-v1',
        purpose: 'report-evidence',
        roots: [],
        byteLength: 1024,
        encrypted: false
      })
    ).toThrow(/CA_EMPTY_ROOTS/);
  });

  it('rejects unknown format', () => {
    expect(() =>
      validateBundleRef({
        type: 'bundle-ref',
        format: 'tar',
        purpose: 'archive',
        roots: [{ kind: 'digest', digest: VALID_DIGEST }],
        byteLength: 1024,
        encrypted: false
      })
    ).toThrow(/CA_INVALID_BUNDLE_REF/);
  });

  it('rejects unknown purpose', () => {
    expect(() =>
      validateBundleRef({
        type: 'bundle-ref',
        format: 'car-v1',
        purpose: 'unknown-purpose',
        roots: [{ kind: 'digest', digest: VALID_DIGEST }],
        byteLength: 1024,
        encrypted: false
      })
    ).toThrow(/CA_INVALID_BUNDLE_REF/);
  });

  it('rejects non-boolean encrypted flag', () => {
    expect(() =>
      validateBundleRef({
        type: 'bundle-ref',
        format: 'car-v1',
        purpose: 'archive',
        roots: [{ kind: 'digest', digest: VALID_DIGEST }],
        byteLength: 1024,
        encrypted: 'no'
      })
    ).toThrow(/CA_INVALID_BUNDLE_REF/);
  });

  it('rejects byteLength above MAX_BUNDLE_BYTE_LENGTH', () => {
    expect(() =>
      validateBundleRef({
        type: 'bundle-ref',
        format: 'car-v1',
        purpose: 'archive',
        roots: [{ kind: 'digest', digest: VALID_DIGEST }],
        byteLength: MAX_BUNDLE_BYTE_LENGTH + 1,
        encrypted: false
      })
    ).toThrow(/CA_INVALID_BYTE_LENGTH/);
  });

  it('rejects roots length above MAX_BUNDLE_ROOTS', () => {
    const roots = new Array(MAX_BUNDLE_ROOTS + 1).fill({
      kind: 'digest',
      digest: VALID_DIGEST
    });
    expect(() =>
      validateBundleRef({
        type: 'bundle-ref',
        format: 'car-v1',
        purpose: 'archive',
        roots,
        byteLength: 1024,
        encrypted: false
      })
    ).toThrow(/CA_INVALID_BUNDLE_REF/);
  });

  it('rejects a root with unknown kind', () => {
    expect(() =>
      validateBundleRef({
        type: 'bundle-ref',
        format: 'car-v1',
        purpose: 'archive',
        roots: [{ kind: 'unknown' }],
        byteLength: 1024,
        encrypted: false
      })
    ).toThrow(/CA_INVALID_INPUT/);
  });

  it('exposes documented enums', () => {
    expect(BUNDLE_FORMATS).toContain('car-v1');
    expect(BUNDLE_FORMATS).toContain('car-v2');
    expect(BUNDLE_FORMATS).toContain('lfp2p-bundle-v1');
    expect(BUNDLE_PURPOSES).toContain('report-evidence');
  });
});
