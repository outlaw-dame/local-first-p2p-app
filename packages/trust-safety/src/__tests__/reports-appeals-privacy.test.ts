import { describe, expect, it } from 'vitest';
import type { SafetyReport } from '../index.js';
import {
  applyReportAppealEvent,
  assertPrivateEvidenceOnPrivateSubject,
  canBridgeForwardReport,
  classifyReportPrivacy,
  createEmptyReportsAppealsState
} from '../index.js';

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

const KEY_DIGEST = {
  algorithm: 'sha-256' as const,
  digest: 'ypeBEsobvcr6wjGzmiPcTaeG7_gUfE5yuYB3ha_uSLs'
};

const SAMPLE_CIDV1 = 'bafkreih2akiscaiv2qtnfwa6vlsa3o5pwf3jmkcswxlha6m4q34cqyvcaa';

const PRIVATE_MEDIA_BLOCK = {
  type: 'block-ref' as const,
  source: { kind: 'digest' as const, digest: VALID_DIGEST },
  byteLength: 4096,
  offset: 0,
  privacy: 'private' as const,
  encryption: {
    scheme: 'xchacha20-poly1305' as const,
    keyRef: KEY_DIGEST
  }
};

const PUBLIC_MEDIA_BLOCK = {
  type: 'block-ref' as const,
  source: {
    kind: 'content-link' as const,
    link: { type: 'content-link', cid: SAMPLE_CIDV1, codec: 'raw' as const }
  },
  byteLength: 4096,
  offset: 0,
  privacy: 'public' as const
};

const PRIVATE_BLOB_SUBJECT = {
  type: 'blob' as const,
  blockRef: PRIVATE_MEDIA_BLOCK
};

const EVENT_SUBJECT = { type: 'event' as const, eventId: 'evt_public_xyz' };

function baseReport(): SafetyReport {
  return {
    version: 'lfp2p.safety-report.v1',
    reportId: 'report_x',
    reporter: { kind: 'actor', actor: { actorId: 'actor_damon' } },
    subject: EVENT_SUBJECT,
    targetAuthority: AUTHORITY,
    reasonCode: 'abuse.harassment',
    scope: 'community-local',
    idempotencyKey: 'idem_x',
    createdAt: '2026-05-31T00:00:00Z',
    reporterPrivacy: 'identified-to-authority'
  };
}

describe('classifyReportPrivacy', () => {
  it('event subjects are public-routable', () => {
    expect(classifyReportPrivacy(baseReport())).toBe('public-routable');
  });

  it('blob subjects are private-only', () => {
    const r: SafetyReport = { ...baseReport(), subject: PRIVATE_BLOB_SUBJECT };
    expect(classifyReportPrivacy(r)).toBe('private-only');
  });
});

describe('assertPrivateEvidenceOnPrivateSubject', () => {
  it('passes a public-subject report without consulting evidence privacy', () => {
    const r: SafetyReport = {
      ...baseReport(),
      evidenceRefs: [
        {
          type: 'object-ref',
          kind: 'media',
          block: PUBLIC_MEDIA_BLOCK
        }
      ]
    };
    expect(() => assertPrivateEvidenceOnPrivateSubject(r)).not.toThrow();
  });

  it('passes a private-subject report with encrypted media evidence', () => {
    const r: SafetyReport = {
      ...baseReport(),
      subject: PRIVATE_BLOB_SUBJECT,
      evidenceRefs: [
        {
          type: 'object-ref',
          kind: 'media',
          block: PRIVATE_MEDIA_BLOCK
        }
      ]
    };
    expect(() => assertPrivateEvidenceOnPrivateSubject(r)).not.toThrow();
  });

  it('rejects a private-subject report with PUBLIC media evidence', () => {
    const r: SafetyReport = {
      ...baseReport(),
      subject: PRIVATE_BLOB_SUBJECT,
      evidenceRefs: [
        {
          type: 'object-ref',
          kind: 'media',
          block: PUBLIC_MEDIA_BLOCK
        }
      ]
    };
    expect(() => assertPrivateEvidenceOnPrivateSubject(r)).toThrow(/TS_PRIVATE_LEAK/);
  });

  it('rejects a private-subject report with non-encrypted bundle evidence', () => {
    const r: SafetyReport = {
      ...baseReport(),
      subject: PRIVATE_BLOB_SUBJECT,
      evidenceRefs: [
        {
          type: 'object-ref',
          kind: 'bundle',
          bundle: {
            type: 'bundle-ref',
            format: 'car-v1',
            purpose: 'report-evidence',
            roots: [{ kind: 'digest', digest: VALID_DIGEST }],
            byteLength: 1024,
            encrypted: false
          }
        }
      ]
    };
    expect(() => assertPrivateEvidenceOnPrivateSubject(r)).toThrow(/TS_PRIVATE_LEAK/);
  });

  it('accepts a private-subject report whose encryptedBodyRef is content-bearing', () => {
    const r: SafetyReport = {
      ...baseReport(),
      subject: PRIVATE_BLOB_SUBJECT,
      encryptedBodyRef: {
        type: 'object-ref',
        kind: 'report',
        digest: VALID_DIGEST
      }
    };
    expect(() => assertPrivateEvidenceOnPrivateSubject(r)).not.toThrow();
  });

  it('rejects identity-kind ObjectRef as encryptedBodyRef on private-subject', () => {
    const r: SafetyReport = {
      ...baseReport(),
      subject: PRIVATE_BLOB_SUBJECT,
      encryptedBodyRef: {
        type: 'object-ref',
        kind: 'actor',
        identityRef: 'actor_x'
      }
    };
    expect(() => assertPrivateEvidenceOnPrivateSubject(r)).toThrow(/TS_PRIVATE_LEAK/);
  });
});

describe('canBridgeForwardReport', () => {
  it('returns true for a public-subject report', () => {
    expect(canBridgeForwardReport(baseReport())).toBe(true);
  });

  it('returns true for a private-subject report with encrypted evidence', () => {
    const r: SafetyReport = {
      ...baseReport(),
      subject: PRIVATE_BLOB_SUBJECT,
      evidenceRefs: [{ type: 'object-ref', kind: 'media', block: PRIVATE_MEDIA_BLOCK }]
    };
    expect(canBridgeForwardReport(r)).toBe(true);
  });

  it('returns false for a private-subject report with public evidence', () => {
    const r: SafetyReport = {
      ...baseReport(),
      subject: PRIVATE_BLOB_SUBJECT,
      evidenceRefs: [{ type: 'object-ref', kind: 'media', block: PUBLIC_MEDIA_BLOCK }]
    };
    expect(canBridgeForwardReport(r)).toBe(false);
  });
});

describe('projection-level enforcement', () => {
  it('safety.report.created with unsafe evidence on private subject is rejected at apply', () => {
    expect(() =>
      applyReportAppealEvent(createEmptyReportsAppealsState(), {
        version: 'lfp2p.report-appeal-event.v1',
        eventId: 'evt_1',
        createdAt: '2026-05-31T10:00:00Z',
        kind: 'safety.report.created',
        report: {
          ...baseReport(),
          subject: PRIVATE_BLOB_SUBJECT,
          evidenceRefs: [{ type: 'object-ref', kind: 'media', block: PUBLIC_MEDIA_BLOCK }]
        }
      })
    ).toThrow(/TS_PRIVATE_LEAK/);
  });

  it('safety.report.created with encrypted evidence on private subject is accepted', () => {
    const state = applyReportAppealEvent(createEmptyReportsAppealsState(), {
      version: 'lfp2p.report-appeal-event.v1',
      eventId: 'evt_1',
      createdAt: '2026-05-31T10:00:00Z',
      kind: 'safety.report.created',
      report: {
        ...baseReport(),
        subject: PRIVATE_BLOB_SUBJECT,
        evidenceRefs: [{ type: 'object-ref', kind: 'media', block: PRIVATE_MEDIA_BLOCK }]
      }
    });
    expect(state.byReportId['report_x']?.status).toBe('submitted');
  });
});
