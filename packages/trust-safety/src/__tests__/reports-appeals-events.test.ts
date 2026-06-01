import { describe, expect, it } from 'vitest';
import type { ReportAppealEvent } from '../index.js';
import {
  APPEAL_RESOLUTIONS,
  REPORT_APPEAL_KINDS,
  REPORT_RESOLUTIONS,
  validateReportAppealEvent
} from '../index.js';

const AUTHORITY = {
  version: 'lfp2p.safety-authority.v1' as const,
  authorityId: 'auth_mod_42',
  actorId: 'actor_mod_alice',
  role: 'moderator' as const,
  scope: 'community-local' as const,
  createdAt: '2026-05-01T00:00:00Z'
};

const REPORT = {
  version: 'lfp2p.safety-report.v1' as const,
  reportId: 'report_001',
  reporter: { kind: 'actor' as const, actor: { actorId: 'actor_damon' } },
  subject: { type: 'event' as const, eventId: 'event_xyz' },
  targetAuthority: AUTHORITY,
  reasonCode: 'abuse.harassment' as const,
  scope: 'community-local' as const,
  idempotencyKey: 'idem_001',
  createdAt: '2026-05-31T00:00:00Z',
  reporterPrivacy: 'identified-to-authority' as const
};

const APPEAL = {
  version: 'lfp2p.safety-appeal.v1' as const,
  appealId: 'appeal_001',
  appellant: { actorId: 'actor_appellant' },
  decisionId: 'decision_001',
  targetAuthority: AUTHORITY,
  reasonCode: 'context-disputed',
  idempotencyKey: 'idem_appeal_001',
  createdAt: '2026-05-31T00:00:00Z'
};

function base(kind: ReportAppealEvent['kind']): Record<string, unknown> {
  return {
    version: 'lfp2p.report-appeal-event.v1',
    eventId: 'evt_' + Math.random().toString(36).slice(2, 10),
    createdAt: '2026-05-31T10:00:00Z',
    kind
  };
}

describe('validateReportAppealEvent — kinds', () => {
  it('accepts safety.report.created', () => {
    expect(() =>
      validateReportAppealEvent({ ...base('safety.report.created'), report: REPORT })
    ).not.toThrow();
  });

  it('accepts safety.report.acknowledged', () => {
    expect(() =>
      validateReportAppealEvent({
        ...base('safety.report.acknowledged'),
        reportId: 'report_001',
        acknowledgedBy: AUTHORITY,
        acknowledgedAt: '2026-05-31T11:00:00Z'
      })
    ).not.toThrow();
  });

  it('accepts safety.report.resolved with upheld + decisionId', () => {
    expect(() =>
      validateReportAppealEvent({
        ...base('safety.report.resolved'),
        reportId: 'report_001',
        resolvedBy: AUTHORITY,
        resolvedAt: '2026-05-31T12:00:00Z',
        resolution: 'upheld',
        resolutionReasonCode: 'abuse.harassment',
        resolutionDecisionId: 'decision_001'
      })
    ).not.toThrow();
  });

  it('rejects safety.report.resolved with escalated but no escalatedTo', () => {
    expect(() =>
      validateReportAppealEvent({
        ...base('safety.report.resolved'),
        reportId: 'report_001',
        resolvedBy: AUTHORITY,
        resolvedAt: '2026-05-31T12:00:00Z',
        resolution: 'escalated',
        resolutionReasonCode: 'abuse.harassment'
      })
    ).toThrow(/escalatedTo required when resolution === "escalated"/);
  });

  it('rejects safety.report.resolved with non-escalated + escalatedTo', () => {
    expect(() =>
      validateReportAppealEvent({
        ...base('safety.report.resolved'),
        reportId: 'report_001',
        resolvedBy: AUTHORITY,
        resolvedAt: '2026-05-31T12:00:00Z',
        resolution: 'dismissed',
        resolutionReasonCode: 'quality.duplicate',
        escalatedTo: AUTHORITY
      })
    ).toThrow(/escalatedTo only valid when resolution === "escalated"/);
  });

  it('accepts safety.appeal.created', () => {
    expect(() =>
      validateReportAppealEvent({ ...base('safety.appeal.created'), appeal: APPEAL })
    ).not.toThrow();
  });

  it('accepts safety.appeal.resolved with overturned + newDecisionId', () => {
    expect(() =>
      validateReportAppealEvent({
        ...base('safety.appeal.resolved'),
        appealId: 'appeal_001',
        resolvedBy: AUTHORITY,
        resolvedAt: '2026-05-31T14:00:00Z',
        resolution: 'overturned',
        resolutionReasonCode: 'context.unverified-claim',
        newDecisionId: 'decision_v2'
      })
    ).not.toThrow();
  });

  it('rejects safety.appeal.resolved with overturned but no newDecisionId', () => {
    expect(() =>
      validateReportAppealEvent({
        ...base('safety.appeal.resolved'),
        appealId: 'appeal_001',
        resolvedBy: AUTHORITY,
        resolvedAt: '2026-05-31T14:00:00Z',
        resolution: 'overturned',
        resolutionReasonCode: 'context.unverified-claim'
      })
    ).toThrow(/newDecisionId required when resolution === "overturned"/);
  });

  it('rejects unknown kind', () => {
    expect(() =>
      validateReportAppealEvent({ ...base('safety.report.deleted' as unknown as ReportAppealEvent['kind']) })
    ).toThrow(/TS_INVALID_ENUM/);
  });

  it('rejects unknown version', () => {
    expect(() =>
      validateReportAppealEvent({
        ...base('safety.report.created'),
        version: 'lfp2p.report-appeal-event.v2',
        report: REPORT
      })
    ).toThrow(/TS_UNKNOWN_VERSION/);
  });

  it('exposes 5 lifecycle kinds and their resolution enums', () => {
    expect(REPORT_APPEAL_KINDS.length).toBe(5);
    expect(REPORT_RESOLUTIONS).toEqual([
      'upheld',
      'dismissed',
      'duplicate',
      'invalid',
      'escalated'
    ]);
    expect(APPEAL_RESOLUTIONS).toEqual(['overturned', 'upheld', 'dismissed', 'invalid']);
  });
});
