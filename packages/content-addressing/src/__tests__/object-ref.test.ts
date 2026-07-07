import { describe, expect, it } from 'vitest';
import { OBJECT_REF_KINDS, validateObjectRef } from '../index.js';

const VALID_DIGEST = {
  algorithm: 'sha-256' as const,
  digest: '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU'
};

const SAMPLE_CIDV1 = 'bafkreih2akiscaiv2qtnfwa6vlsa3o5pwf3jmkcswxlha6m4q34cqyvcaa';

describe('validateObjectRef — content-backed kinds', () => {
  it.each(['event', 'record', 'safety-label', 'report', 'policy-decision'] as const)(
    'accepts kind=%s with digest',
    (kind) => {
      const ref = validateObjectRef({ type: 'object-ref', kind, digest: VALID_DIGEST });
      expect(ref.kind).toBe(kind);
    }
  );

  it('rejects a content-backed kind missing digest', () => {
    expect(() => validateObjectRef({ type: 'object-ref', kind: 'event' })).toThrow(
      /CA_INVALID_INPUT/
    );
  });

  it('rejects negative schemaVersion', () => {
    expect(() =>
      validateObjectRef({
        type: 'object-ref',
        kind: 'event',
        digest: VALID_DIGEST,
        schemaVersion: -1
      })
    ).toThrow(/CA_INVALID_OBJECT_REF/);
  });
});

describe('validateObjectRef — media', () => {
  it('accepts a public media ref backed by a content-link block', () => {
    const ref = validateObjectRef({
      type: 'object-ref',
      kind: 'media',
      block: {
        type: 'block-ref',
        source: {
          kind: 'content-link',
          link: { type: 'content-link', cid: SAMPLE_CIDV1, codec: 'raw' }
        },
        byteLength: 8192,
        privacy: 'public'
      }
    });
    expect(ref.kind).toBe('media');
  });

  it('rejects a private media ref without encryption (propagated from block validator)', () => {
    expect(() =>
      validateObjectRef({
        type: 'object-ref',
        kind: 'media',
        block: {
          type: 'block-ref',
          source: { kind: 'digest', digest: VALID_DIGEST },
          byteLength: 8192,
          privacy: 'private'
        }
      })
    ).toThrow(/CA_MISSING_ENCRYPTION_DESCRIPTOR/);
  });
});

describe('validateObjectRef — bundle', () => {
  it('accepts a bundle ref with a single root', () => {
    const ref = validateObjectRef({
      type: 'object-ref',
      kind: 'bundle',
      bundle: {
        type: 'bundle-ref',
        format: 'car-v1',
        purpose: 'report-evidence',
        roots: [{ kind: 'digest', digest: VALID_DIGEST }],
        byteLength: 4096,
        encrypted: false
      }
    });
    expect(ref.kind).toBe('bundle');
  });
});

describe('validateObjectRef — url', () => {
  it('accepts a clean https URL', () => {
    const ref = validateObjectRef({
      type: 'object-ref',
      kind: 'url',
      url: 'https://example.com/path?q=1'
    });
    expect(ref.kind).toBe('url');
  });

  it('rejects a URL with credentials', () => {
    expect(() =>
      validateObjectRef({
        type: 'object-ref',
        kind: 'url',
        url: 'https://attacker:hunter2@example.com/'
      })
    ).toThrow(/CA_URL_CREDENTIALS_FORBIDDEN/);
  });

  it('rejects javascript: URLs', () => {
    expect(() =>
      validateObjectRef({
        type: 'object-ref',
        kind: 'url',
        url: 'javascript:alert(1)'
      })
    ).toThrow(/CA_INVALID_URL/);
  });

  it('rejects a malformed URL string', () => {
    expect(() => validateObjectRef({ type: 'object-ref', kind: 'url', url: 'not a url' })).toThrow(
      /CA_INVALID_URL/
    );
  });
});

describe('validateObjectRef — domain', () => {
  it('accepts a simple domain and lowercases it', () => {
    const ref = validateObjectRef({
      type: 'object-ref',
      kind: 'domain',
      domain: 'Example.COM'
    });
    expect(ref).toMatchObject({ kind: 'domain', domain: 'example.com' });
  });

  it('rejects a URL passed as a domain', () => {
    expect(() =>
      validateObjectRef({
        type: 'object-ref',
        kind: 'domain',
        domain: 'https://example.com'
      })
    ).toThrow(/CA_INVALID_OBJECT_REF/);
  });

  it('rejects a domain with invalid label characters', () => {
    expect(() =>
      validateObjectRef({
        type: 'object-ref',
        kind: 'domain',
        domain: 'ex!ample.com'
      })
    ).toThrow(/CA_INVALID_OBJECT_REF/);
  });

  it('rejects an empty-label domain', () => {
    expect(() => validateObjectRef({ type: 'object-ref', kind: 'domain', domain: 'a..b' })).toThrow(
      /CA_INVALID_OBJECT_REF/
    );
  });
});

describe('validateObjectRef — identity kinds (actor, community, infrastructure)', () => {
  it.each(['actor', 'community', 'infrastructure'] as const)(
    'accepts kind=%s with identityRef',
    (kind) => {
      const ref = validateObjectRef({
        type: 'object-ref',
        kind,
        identityRef: 'did:lfp2p:abc'
      });
      expect(ref.kind).toBe(kind);
    }
  );

  it('rejects identityRef with control characters', () => {
    expect(() =>
      validateObjectRef({
        type: 'object-ref',
        kind: 'actor',
        identityRef: 'did::bad'
      })
    ).toThrow(/CA_INVALID_OBJECT_REF/);
  });

  it('rejects empty identityRef', () => {
    expect(() => validateObjectRef({ type: 'object-ref', kind: 'actor', identityRef: '' })).toThrow(
      /CA_INVALID_INPUT/
    );
  });
});

describe('validateObjectRef — input shape', () => {
  it('rejects unknown kind', () => {
    expect(() => validateObjectRef({ type: 'object-ref', kind: 'unicorn' })).toThrow(
      /CA_INVALID_OBJECT_REF/
    );
  });

  it('rejects wrong type tag', () => {
    expect(() =>
      validateObjectRef({ type: 'object', kind: 'event', digest: VALID_DIGEST })
    ).toThrow(/CA_INVALID_OBJECT_REF/);
  });

  it('exposes the documented kind list', () => {
    expect(OBJECT_REF_KINDS).toContain('event');
    expect(OBJECT_REF_KINDS).toContain('media');
    expect(OBJECT_REF_KINDS).toContain('actor');
    expect(OBJECT_REF_KINDS.length).toBe(12);
  });
});
