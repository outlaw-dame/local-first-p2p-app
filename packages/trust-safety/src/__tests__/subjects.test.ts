import { describe, expect, it } from 'vitest';
import { SAFETY_SUBJECT_TYPES, validateSafetySubjectRef } from '../index.js';

const VALID_DIGEST = {
  algorithm: 'sha-256' as const,
  digest: '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU'
};

describe('validateSafetySubjectRef — happy path', () => {
  it('accepts every documented variant', () => {
    const cases: Array<readonly [string, unknown]> = [
      ['event', { type: 'event', eventId: 'e1' }],
      ['actor', { type: 'actor', actorId: 'a1' }],
      ['device', { type: 'device', deviceId: 'd1', actorId: 'a1' }],
      ['community', { type: 'community', communityId: 'c1' }],
      ['thread', { type: 'thread', threadId: 't1' }],
      [
        'media',
        {
          type: 'media',
          mediaId: 'm1',
          objectRef: { type: 'object-ref', kind: 'event', digest: VALID_DIGEST }
        }
      ],
      [
        'blob',
        {
          type: 'blob',
          blockRef: {
            type: 'block-ref',
            source: { kind: 'digest', digest: VALID_DIGEST },
            byteLength: 1024,
            privacy: 'public'
          }
        }
      ],
      ['url', { type: 'url', normalizedUrl: 'https://example.com/x' }],
      ['domain', { type: 'domain', domain: 'Example.COM' }],
      ['topic', { type: 'topic', value: 'sports.basketball' }],
      ['bridge', { type: 'bridge', bridgeId: 'b1' }],
      ['relay', { type: 'relay', relayId: 'r1' }],
      ['super-peer', { type: 'super-peer', superPeerId: 'sp1' }],
      ['policy-list', { type: 'policy-list', policyListId: 'pl1' }]
    ];
    for (const [name, input] of cases) {
      expect(() => validateSafetySubjectRef(input), `kind=${name}`).not.toThrow();
    }
  });

  it('lowercases domain subjects', () => {
    const r = validateSafetySubjectRef({ type: 'domain', domain: 'Example.COM' });
    expect(r).toMatchObject({ type: 'domain', domain: 'example.com' });
  });
});

describe('validateSafetySubjectRef — adversarial', () => {
  it('rejects unknown subject type', () => {
    expect(() => validateSafetySubjectRef({ type: 'alien' })).toThrow(/TS_INVALID_SUBJECT/);
  });

  it('rejects URL with userinfo (privacy leak)', () => {
    expect(() =>
      validateSafetySubjectRef({
        type: 'url',
        normalizedUrl: 'https://user:pass@example.com/x'
      })
    ).toThrow(/TS_PRIVATE_LEAK/);
  });

  it('rejects javascript: URL', () => {
    expect(() =>
      validateSafetySubjectRef({ type: 'url', normalizedUrl: 'javascript:alert(1)' })
    ).toThrow(/TS_INVALID_SUBJECT/);
  });

  it('rejects URL passed as a domain', () => {
    expect(() =>
      validateSafetySubjectRef({ type: 'domain', domain: 'https://example.com' })
    ).toThrow(/TS_INVALID_SUBJECT/);
  });

  it('rejects oversized URL', () => {
    const big = 'https://example.com/' + 'a'.repeat(8200);
    expect(() => validateSafetySubjectRef({ type: 'url', normalizedUrl: big })).toThrow();
  });

  it('exposes SAFETY_SUBJECT_TYPES with all 14 variants', () => {
    expect(SAFETY_SUBJECT_TYPES.length).toBe(14);
  });
});
