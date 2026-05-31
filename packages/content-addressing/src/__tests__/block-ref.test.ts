import { describe, expect, it } from 'vitest';
import {
  MAX_BLOCK_BYTE_LENGTH,
  MAX_COMPRESSION_RATIO,
  MAX_DECODED_BYTE_LENGTH,
  MAX_STORAGE_HINTS,
  createBlockRef,
  validateBlockRef
} from '../index.js';

const VALID_DIGEST = {
  algorithm: 'sha-256' as const,
  digest: '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU'
};

const OTHER_DIGEST = {
  algorithm: 'sha-256' as const,
  digest: 'ypeBEsobvcr6wjGzmiPcTaeG7_gUfE5yuYB3ha_uSLs'
};

describe('validateBlockRef — happy path', () => {
  it('accepts a public block ref with digest source', () => {
    const ref = validateBlockRef({
      type: 'block-ref',
      source: { kind: 'digest', digest: VALID_DIGEST },
      byteLength: 1024,
      privacy: 'public'
    });
    expect(ref.byteLength).toBe(1024);
    expect(ref.offset).toBe(0);
    expect(ref.privacy).toBe('public');
  });

  it('accepts a private block ref with required encryption descriptor', () => {
    const ref = validateBlockRef({
      type: 'block-ref',
      source: { kind: 'digest', digest: VALID_DIGEST },
      byteLength: 4096,
      privacy: 'private',
      encryption: {
        scheme: 'xchacha20-poly1305',
        keyRef: OTHER_DIGEST
      }
    });
    expect(ref.encryption?.scheme).toBe('xchacha20-poly1305');
  });

  it('accepts compression within ratio limits', () => {
    const ref = validateBlockRef({
      type: 'block-ref',
      source: { kind: 'digest', digest: VALID_DIGEST },
      byteLength: 1024,
      privacy: 'public',
      compression: {
        algorithm: 'zstd',
        encodedSize: 1024,
        decodedSize: 32768
      }
    });
    expect(ref.compression?.algorithm).toBe('zstd');
  });

  it('createBlockRef wraps validateBlockRef with the type tag', () => {
    const ref = createBlockRef({
      source: { kind: 'digest', digest: VALID_DIGEST },
      byteLength: 0,
      privacy: 'public'
    });
    expect(ref.type).toBe('block-ref');
  });
});

describe('validateBlockRef — adversarial', () => {
  it('rejects private without encryption', () => {
    expect(() =>
      validateBlockRef({
        type: 'block-ref',
        source: { kind: 'digest', digest: VALID_DIGEST },
        byteLength: 1024,
        privacy: 'private'
      })
    ).toThrow(/CA_MISSING_ENCRYPTION_DESCRIPTOR/);
  });

  it('rejects negative byteLength', () => {
    expect(() =>
      validateBlockRef({
        type: 'block-ref',
        source: { kind: 'digest', digest: VALID_DIGEST },
        byteLength: -1,
        privacy: 'public'
      })
    ).toThrow();
  });

  it('rejects non-integer byteLength', () => {
    expect(() =>
      validateBlockRef({
        type: 'block-ref',
        source: { kind: 'digest', digest: VALID_DIGEST },
        byteLength: 1.5,
        privacy: 'public'
      })
    ).toThrow();
  });

  it('rejects byteLength above MAX_BLOCK_BYTE_LENGTH', () => {
    expect(() =>
      validateBlockRef({
        type: 'block-ref',
        source: { kind: 'digest', digest: VALID_DIGEST },
        byteLength: MAX_BLOCK_BYTE_LENGTH + 1,
        privacy: 'public'
      })
    ).toThrow(/CA_INVALID_BYTE_LENGTH/);
  });

  it('rejects compression with no decoded-size bound (above MAX_DECODED_BYTE_LENGTH)', () => {
    expect(() =>
      validateBlockRef({
        type: 'block-ref',
        source: { kind: 'digest', digest: VALID_DIGEST },
        byteLength: 1024,
        privacy: 'public',
        compression: {
          algorithm: 'zstd',
          encodedSize: 1024,
          decodedSize: MAX_DECODED_BYTE_LENGTH + 1
        }
      })
    ).toThrow(/CA_UNSAFE_COMPRESSION/);
  });

  it('rejects compression bomb by ratio', () => {
    expect(() =>
      validateBlockRef({
        type: 'block-ref',
        source: { kind: 'digest', digest: VALID_DIGEST },
        byteLength: 1024,
        privacy: 'public',
        compression: {
          algorithm: 'zstd',
          encodedSize: 1024,
          decodedSize: 1024 * (MAX_COMPRESSION_RATIO + 1)
        }
      })
    ).toThrow(/CA_UNSAFE_COMPRESSION/);
  });

  it('rejects identity compression where encoded != decoded', () => {
    expect(() =>
      validateBlockRef({
        type: 'block-ref',
        source: { kind: 'digest', digest: VALID_DIGEST },
        byteLength: 1024,
        privacy: 'public',
        compression: {
          algorithm: 'identity',
          encodedSize: 1024,
          decodedSize: 1025
        }
      })
    ).toThrow(/CA_INVALID_COMPRESSION_DESCRIPTOR/);
  });

  it('rejects compression with encodedSize 0 for non-identity algorithm', () => {
    expect(() =>
      validateBlockRef({
        type: 'block-ref',
        source: { kind: 'digest', digest: VALID_DIGEST },
        byteLength: 1024,
        privacy: 'public',
        compression: {
          algorithm: 'zstd',
          encodedSize: 0,
          decodedSize: 1024
        }
      })
    ).toThrow(/CA_INVALID_COMPRESSION_DESCRIPTOR/);
  });

  it('rejects dictionaryRef that equals the block source digest (recursive)', () => {
    expect(() =>
      validateBlockRef({
        type: 'block-ref',
        source: { kind: 'digest', digest: VALID_DIGEST },
        byteLength: 1024,
        privacy: 'public',
        compression: {
          algorithm: 'zstd',
          encodedSize: 1024,
          decodedSize: 2048,
          dictionaryRef: VALID_DIGEST
        }
      })
    ).toThrow(/CA_UNSAFE_DICTIONARY_REF/);
  });

  it('rejects unsupported encryption scheme', () => {
    expect(() =>
      validateBlockRef({
        type: 'block-ref',
        source: { kind: 'digest', digest: VALID_DIGEST },
        byteLength: 1024,
        privacy: 'private',
        encryption: {
          scheme: 'rot13',
          keyRef: OTHER_DIGEST
        }
      })
    ).toThrow(/CA_INVALID_ENCRYPTION_DESCRIPTOR/);
  });

  it('rejects storage hints array beyond MAX_STORAGE_HINTS', () => {
    const hint = {
      kind: 'bridge-store',
      uri: 'https://bridge.example.com/x'
    };
    const tooMany = new Array(MAX_STORAGE_HINTS + 1).fill(hint);
    expect(() =>
      validateBlockRef({
        type: 'block-ref',
        source: { kind: 'digest', digest: VALID_DIGEST },
        byteLength: 1024,
        privacy: 'public',
        storageHints: tooMany
      })
    ).toThrow();
  });

  it('rejects invalid storage hint inside an otherwise valid block', () => {
    expect(() =>
      validateBlockRef({
        type: 'block-ref',
        source: { kind: 'digest', digest: VALID_DIGEST },
        byteLength: 1024,
        privacy: 'public',
        storageHints: [
          {
            kind: 'bridge-store',
            uri: 'https://attacker:hunter2@bridge.example.com/x'
          }
        ]
      })
    ).toThrow(/CA_URL_CREDENTIALS_FORBIDDEN/);
  });
});
