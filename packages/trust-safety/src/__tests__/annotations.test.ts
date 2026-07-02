import { describe, expect, it } from 'vitest';
import { ANNOTATION_MOTIVATIONS, validateSafetyAnnotation } from '../index.js';

const AUTHORITY = {
  version: 'lfp2p.safety-authority.v1' as const,
  authorityId: 'auth_1',
  actorId: 'actor_1',
  scope: 'community-local' as const,
  createdAt: '2026-01-01T00:00:00Z'
};

const VALID_DIGEST = {
  algorithm: 'sha-256' as const,
  digest: '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU'
};

const ANNOTATION_BASE = {
  version: 'lfp2p.safety-annotation.v1' as const,
  annotationId: 'ann_1',
  issuer: AUTHORITY,
  subject: { type: 'event' as const, eventId: 'evt_1' },
  motivation: 'classifying' as const,
  body: { format: 'text/plain' as const, value: 'Classification text' },
  scope: 'community-local' as const,
  createdAt: '2026-05-31T00:00:00Z'
};

describe('validateSafetyAnnotation', () => {
  it('accepts a minimal annotation', () => {
    expect(() => validateSafetyAnnotation(ANNOTATION_BASE)).not.toThrow();
  });

  it('rejects unknown motivation', () => {
    expect(() => validateSafetyAnnotation({ ...ANNOTATION_BASE, motivation: 'shouting' })).toThrow(
      /TS_INVALID_ENUM/
    );
  });

  it('rejects unsupported body format', () => {
    expect(() =>
      validateSafetyAnnotation({
        ...ANNOTATION_BASE,
        body: { format: 'image/png', value: 'binary' }
      })
    ).toThrow(/TS_INVALID_ENUM/);
  });

  it('rejects private subject at network-advisory scope', () => {
    const subj = {
      type: 'media' as const,
      mediaId: 'm1',
      objectRef: {
        type: 'object-ref' as const,
        kind: 'media' as const,
        block: {
          type: 'block-ref' as const,
          source: { kind: 'digest' as const, digest: VALID_DIGEST },
          byteLength: 1024,
          privacy: 'private' as const,
          encryption: { scheme: 'xchacha20-poly1305' as const, keyRef: VALID_DIGEST }
        }
      }
    };
    expect(() =>
      validateSafetyAnnotation({ ...ANNOTATION_BASE, subject: subj, scope: 'network-advisory' })
    ).toThrow(/TS_PRIVATE_LEAK/);
  });

  it('ANNOTATION_MOTIVATIONS contains the documented set', () => {
    expect(ANNOTATION_MOTIVATIONS).toEqual([
      'classifying',
      'assessing',
      'commenting',
      'describing',
      'tagging'
    ]);
  });
});
