import { describe, expect, it } from 'vitest';
import { validateSafetyReport } from '../index.js';

const AUTHORITY = {
  version: 'lfp2p.safety-authority.v1' as const,
  authorityId: 'auth_mod_42',
  actorId: 'actor_mod_alice',
  role: 'moderator' as const,
  scope: 'community-local' as const,
  createdAt: '2026-05-01T00:00:00Z'
};

const VALID_DIGEST = {
  algorithm: 'sha-256' as const,
  digest: '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU'
};

const REPORT_BASE = {
  version: 'lfp2p.safety-report.v1' as const,
  reportId: 'report_1',
  reporter: { kind: 'actor' as const, actor: { actorId: 'actor_damon' } },
  subject: { type: 'event' as const, eventId: 'evt_offending' },
  targetAuthority: AUTHORITY,
  reasonCode: 'abuse.harassment' as const,
  scope: 'community-local' as const,
  idempotencyKey: 'idem_1',
  createdAt: '2026-05-31T00:00:00Z',
  reporterPrivacy: 'identified-to-authority' as const
};

describe('validateSafetyReport', () => {
  it('accepts a minimal report', () => {
    expect(() => validateSafetyReport(REPORT_BASE)).not.toThrow();
  });

  it('rejects missing idempotencyKey', () => {
    const rest: Partial<typeof REPORT_BASE> = { ...REPORT_BASE };
    delete rest.idempotencyKey;
    expect(() => validateSafetyReport(rest)).toThrow();
  });

  it('rejects empty idempotencyKey', () => {
    expect(() =>
      validateSafetyReport({ ...REPORT_BASE, idempotencyKey: '' })
    ).toThrow();
  });

  it('rejects unknown reasonCode', () => {
    expect(() =>
      validateSafetyReport({ ...REPORT_BASE, reasonCode: 'abuse.unknown' })
    ).toThrow(/TS_INVALID_ENUM/);
  });

  it('rejects unknown reporterPrivacy', () => {
    expect(() =>
      validateSafetyReport({
        ...REPORT_BASE,
        reporterPrivacy: 'shouted-from-rooftops'
      })
    ).toThrow(/TS_INVALID_ENUM/);
  });

  it('rejects private-by-nature media subject at network-advisory scope', () => {
    const mediaSubject = {
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
      validateSafetyReport({
        ...REPORT_BASE,
        subject: mediaSubject,
        scope: 'network-advisory'
      })
    ).toThrow(/TS_PRIVATE_LEAK/);
  });

  it('rejects oversized idempotencyKey', () => {
    const big = 'a'.repeat(257);
    expect(() =>
      validateSafetyReport({ ...REPORT_BASE, idempotencyKey: big })
    ).toThrow();
  });
});
