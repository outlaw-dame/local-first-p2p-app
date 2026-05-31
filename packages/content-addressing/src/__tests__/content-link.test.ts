import { describe, expect, it } from 'vitest';
import {
  CONTENT_LINK_CODECS,
  createContentLink,
  validateCidV1String,
  validateContentLink
} from '../index.js';

const SAMPLE_CIDV1 = 'bafkreih2akiscaiv2qtnfwa6vlsa3o5pwf3jmkcswxlha6m4q34cqyvcaa';

describe('validateCidV1String', () => {
  it('accepts a valid CIDv1 base32 lower string', () => {
    expect(validateCidV1String(SAMPLE_CIDV1, 'X')).toBe(SAMPLE_CIDV1);
  });

  it('rejects CIDv0 ("Qm…" 46 chars base58btc)', () => {
    expect(() =>
      validateCidV1String('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG', 'X')
    ).toThrow(/CA_UNSUPPORTED_CID_VERSION/);
  });

  it('rejects URLs masquerading as CIDs', () => {
    expect(() => validateCidV1String('https://example.com/cid', 'X')).toThrow(/CA_CID_IS_URL/);
    expect(() => validateCidV1String('ipfs://bafkrei...', 'X')).toThrow(/CA_CID_IS_URL/);
    expect(() => validateCidV1String('bafkrei/abc', 'X')).toThrow(/CA_CID_IS_URL/);
  });

  it('rejects unknown multibase prefixes', () => {
    expect(() => validateCidV1String('!abc12345678901234567890', 'X')).toThrow(/CA_INVALID_CID/);
  });

  it('rejects body characters outside the multibase alphabet', () => {
    // base32 lower must not contain digits 0,1,8,9 or any uppercase
    expect(() => validateCidV1String('b0123456789ABCDEFGHIJ', 'X')).toThrow(/CA_INVALID_CID/);
  });

  it('rejects too-short and too-long bodies', () => {
    expect(() => validateCidV1String('bshort', 'X')).toThrow(/CA_INVALID_CID/);
    expect(() => validateCidV1String('b' + 'a'.repeat(1025), 'X')).toThrow(/CA_INVALID_CID/);
  });
});

describe('validateContentLink', () => {
  it('accepts a well-formed raw content link', () => {
    const link = validateContentLink({
      type: 'content-link',
      cid: SAMPLE_CIDV1,
      codec: 'raw'
    });
    expect(link.type).toBe('content-link');
    expect(link.cid).toBe(SAMPLE_CIDV1);
    expect(link.codec).toBe('raw');
  });

  it('rejects unsupported codecs', () => {
    expect(() =>
      validateContentLink({ type: 'content-link', cid: SAMPLE_CIDV1, codec: 'application/json' })
    ).toThrow(/CA_UNSUPPORTED_CODEC/);
  });

  it('rejects wrong type tag', () => {
    expect(() =>
      validateContentLink({ type: 'content-blob', cid: SAMPLE_CIDV1, codec: 'raw' })
    ).toThrow(/CA_INVALID_INPUT/);
  });

  it('rejects mediaType with control characters (header-injection risk)', () => {
    expect(() =>
      validateContentLink({
        type: 'content-link',
        cid: SAMPLE_CIDV1,
        codec: 'raw',
        mediaType: 'application/json\r\nX-Inject: 1'
      })
    ).toThrow(/CA_INVALID_INPUT/);
  });

  it('rejects negative/non-integer size', () => {
    expect(() =>
      validateContentLink({
        type: 'content-link',
        cid: SAMPLE_CIDV1,
        codec: 'raw',
        size: -1
      })
    ).toThrow();
    expect(() =>
      validateContentLink({
        type: 'content-link',
        cid: SAMPLE_CIDV1,
        codec: 'raw',
        size: 1.5
      })
    ).toThrow();
  });

  it('createContentLink wraps validateContentLink with the type tag', () => {
    const link = createContentLink({ cid: SAMPLE_CIDV1, codec: 'raw' });
    expect(link.type).toBe('content-link');
    expect(link.codec).toBe('raw');
  });

  it('exposes the documented codec list', () => {
    expect(CONTENT_LINK_CODECS).toContain('raw');
    expect(CONTENT_LINK_CODECS).toContain('dag-cbor');
    expect(CONTENT_LINK_CODECS).toContain('car-v1');
    expect(CONTENT_LINK_CODECS).toContain('lfp2p-bundle-v1');
  });

  it('freezes the result so callers cannot mutate it in place', () => {
    const link = createContentLink({ cid: SAMPLE_CIDV1, codec: 'raw' });
    expect(Object.isFrozen(link)).toBe(true);
  });
});
