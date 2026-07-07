import type { SafetyAppeal } from '../appeals.js';
import { validateSafetyAppeal } from '../appeals.js';
import type { SafetyAuthority } from '../authorities.js';
import { validateSafetyAuthority } from '../authorities.js';
import { tsError } from '../errors.js';
import type { SafetyReasonCode } from '../reason-codes.js';
import { SAFETY_REASON_CODES } from '../reason-codes.js';
import type { SafetyReport } from '../reports.js';
import { validateSafetyReport } from '../reports.js';
import {
  assertExactVersion,
  assertId,
  assertIso8601,
  assertOneOf,
  assertPlainObject
} from '../validation.js';

export const REPORT_APPEAL_EVENT_VERSION = 'lfp2p.report-appeal-event.v1' as const;

/**
 * Lifecycle event kinds wrapping the existing `SafetyReport` and
 * `SafetyAppeal` shape objects (Phase 1.61) with the create / ack /
 * resolve transitions called out by the Phase 1.63 plan.
 */
export const REPORT_APPEAL_KINDS = [
  'safety.report.created',
  'safety.report.acknowledged',
  'safety.report.resolved',
  'safety.appeal.created',
  'safety.appeal.resolved'
] as const;
export type ReportAppealKind = (typeof REPORT_APPEAL_KINDS)[number];

/**
 * Final dispositions a report can receive. Mirrors the doctrine: a
 * report can be `upheld` (the authority enforced something based on it),
 * `dismissed` (no violation), `duplicate` (already handled under another
 * id — important for idempotency analytics), `invalid` (malformed or
 * irrelevant), or `escalated` (passed to a higher authority — the
 * resolution event records the next target authority).
 */
export const REPORT_RESOLUTIONS = [
  'upheld',
  'dismissed',
  'duplicate',
  'invalid',
  'escalated'
] as const;
export type ReportResolution = (typeof REPORT_RESOLUTIONS)[number];

/**
 * Final dispositions for appeals. Narrower than report resolutions
 * because an appeal targets a specific decision and either succeeds
 * (the decision is overturned) or fails.
 */
export const APPEAL_RESOLUTIONS = ['overturned', 'upheld', 'dismissed', 'invalid'] as const;
export type AppealResolution = (typeof APPEAL_RESOLUTIONS)[number];

const MAX_RESOLUTION_NOTES_LENGTH = 4096;

type CommonFields = Readonly<{
  version: typeof REPORT_APPEAL_EVENT_VERSION;
  eventId: string;
  createdAt: string;
}>;

export type ReportAppealEvent =
  | Readonly<
      CommonFields & {
        kind: 'safety.report.created';
        report: SafetyReport;
      }
    >
  | Readonly<
      CommonFields & {
        kind: 'safety.report.acknowledged';
        reportId: string;
        acknowledgedBy: SafetyAuthority;
        acknowledgedAt: string;
        ackReasonCode?: SafetyReasonCode;
      }
    >
  | Readonly<
      CommonFields & {
        kind: 'safety.report.resolved';
        reportId: string;
        resolvedBy: SafetyAuthority;
        resolvedAt: string;
        resolution: ReportResolution;
        resolutionReasonCode: SafetyReasonCode;
        /**
         * If a SafetyPolicyDecision was produced as a consequence of this
         * report, its decisionId. Lets a caller cross-reference an upheld
         * report with the decision row.
         */
        resolutionDecisionId?: string;
        /**
         * Optional escalation target. Only meaningful when
         * `resolution === 'escalated'`. The new authority that has
         * accepted the escalation.
         */
        escalatedTo?: SafetyAuthority;
        /** Optional human-readable resolution notes (bounded). */
        resolutionNotes?: string;
      }
    >
  | Readonly<
      CommonFields & {
        kind: 'safety.appeal.created';
        appeal: SafetyAppeal;
      }
    >
  | Readonly<
      CommonFields & {
        kind: 'safety.appeal.resolved';
        appealId: string;
        resolvedBy: SafetyAuthority;
        resolvedAt: string;
        resolution: AppealResolution;
        resolutionReasonCode: SafetyReasonCode;
        /**
         * If the appeal overturned a decision, the new SafetyPolicyDecision
         * id that supersedes the original. The original decision's id
         * lives on `SafetyAppeal.decisionId`.
         */
        newDecisionId?: string;
        resolutionNotes?: string;
      }
    >;

function commonFields(record: Record<string, unknown>, label: string): CommonFields {
  assertExactVersion(record.version, REPORT_APPEAL_EVENT_VERSION, `${label}.version`);
  const eventId = assertId(record.eventId, `${label}.eventId`);
  const createdAt = assertIso8601(record.createdAt, `${label}.createdAt`);
  return Object.freeze({
    version: REPORT_APPEAL_EVENT_VERSION,
    eventId,
    createdAt
  });
}

export function validateReportAppealEvent(
  value: unknown,
  label = 'ReportAppealEvent'
): ReportAppealEvent {
  const record = assertPlainObject(value, label);
  const kind = record.kind;
  if (typeof kind !== 'string' || !(REPORT_APPEAL_KINDS as readonly string[]).includes(kind)) {
    throw tsError(
      'TS_INVALID_ENUM',
      `${label}.kind must be one of ${REPORT_APPEAL_KINDS.join(', ')} (got: ${String(kind)})`
    );
  }
  const k = kind as ReportAppealKind;
  const common = commonFields(record, label);

  switch (k) {
    case 'safety.report.created': {
      return Object.freeze({
        ...common,
        kind: 'safety.report.created',
        report: validateSafetyReport(record.report, `${label}.report`)
      });
    }
    case 'safety.report.acknowledged': {
      const reportId = assertId(record.reportId, `${label}.reportId`);
      const acknowledgedBy = validateSafetyAuthority(
        record.acknowledgedBy,
        `${label}.acknowledgedBy`
      );
      const acknowledgedAt = assertIso8601(record.acknowledgedAt, `${label}.acknowledgedAt`);
      const out: {
        -readonly [K in keyof Extract<
          ReportAppealEvent,
          { kind: 'safety.report.acknowledged' }
        >]: Extract<ReportAppealEvent, { kind: 'safety.report.acknowledged' }>[K];
      } = {
        ...common,
        kind: 'safety.report.acknowledged',
        reportId,
        acknowledgedBy,
        acknowledgedAt
      };
      if (record.ackReasonCode !== undefined) {
        out.ackReasonCode = assertOneOf(
          record.ackReasonCode,
          SAFETY_REASON_CODES,
          `${label}.ackReasonCode`
        );
      }
      return Object.freeze(out);
    }
    case 'safety.report.resolved': {
      const reportId = assertId(record.reportId, `${label}.reportId`);
      const resolvedBy = validateSafetyAuthority(record.resolvedBy, `${label}.resolvedBy`);
      const resolvedAt = assertIso8601(record.resolvedAt, `${label}.resolvedAt`);
      const resolution = assertOneOf(record.resolution, REPORT_RESOLUTIONS, `${label}.resolution`);
      const resolutionReasonCode = assertOneOf(
        record.resolutionReasonCode,
        SAFETY_REASON_CODES,
        `${label}.resolutionReasonCode`
      );
      if (resolution !== 'escalated' && record.escalatedTo !== undefined) {
        throw tsError(
          'TS_INVALID_INPUT',
          `${label}.escalatedTo only valid when resolution === "escalated"`
        );
      }
      if (resolution === 'escalated' && record.escalatedTo === undefined) {
        throw tsError(
          'TS_INVALID_INPUT',
          `${label}.escalatedTo required when resolution === "escalated"`
        );
      }
      const out: {
        -readonly [K in keyof Extract<
          ReportAppealEvent,
          { kind: 'safety.report.resolved' }
        >]: Extract<ReportAppealEvent, { kind: 'safety.report.resolved' }>[K];
      } = {
        ...common,
        kind: 'safety.report.resolved',
        reportId,
        resolvedBy,
        resolvedAt,
        resolution,
        resolutionReasonCode
      };
      if (record.resolutionDecisionId !== undefined) {
        out.resolutionDecisionId = assertId(
          record.resolutionDecisionId,
          `${label}.resolutionDecisionId`
        );
      }
      if (record.escalatedTo !== undefined) {
        out.escalatedTo = validateSafetyAuthority(record.escalatedTo, `${label}.escalatedTo`);
      }
      if (record.resolutionNotes !== undefined) {
        out.resolutionNotes = assertId(
          record.resolutionNotes,
          `${label}.resolutionNotes`,
          MAX_RESOLUTION_NOTES_LENGTH
        );
      }
      return Object.freeze(out);
    }
    case 'safety.appeal.created': {
      return Object.freeze({
        ...common,
        kind: 'safety.appeal.created',
        appeal: validateSafetyAppeal(record.appeal, `${label}.appeal`)
      });
    }
    case 'safety.appeal.resolved': {
      const appealId = assertId(record.appealId, `${label}.appealId`);
      const resolvedBy = validateSafetyAuthority(record.resolvedBy, `${label}.resolvedBy`);
      const resolvedAt = assertIso8601(record.resolvedAt, `${label}.resolvedAt`);
      const resolution = assertOneOf(record.resolution, APPEAL_RESOLUTIONS, `${label}.resolution`);
      const resolutionReasonCode = assertOneOf(
        record.resolutionReasonCode,
        SAFETY_REASON_CODES,
        `${label}.resolutionReasonCode`
      );
      if (resolution === 'overturned' && record.newDecisionId === undefined) {
        throw tsError(
          'TS_INVALID_INPUT',
          `${label}.newDecisionId required when resolution === "overturned"`
        );
      }
      if (resolution !== 'overturned' && record.newDecisionId !== undefined) {
        throw tsError(
          'TS_INVALID_INPUT',
          `${label}.newDecisionId only valid when resolution === "overturned"`
        );
      }
      const out: {
        -readonly [K in keyof Extract<
          ReportAppealEvent,
          { kind: 'safety.appeal.resolved' }
        >]: Extract<ReportAppealEvent, { kind: 'safety.appeal.resolved' }>[K];
      } = {
        ...common,
        kind: 'safety.appeal.resolved',
        appealId,
        resolvedBy,
        resolvedAt,
        resolution,
        resolutionReasonCode
      };
      if (record.newDecisionId !== undefined) {
        out.newDecisionId = assertId(record.newDecisionId, `${label}.newDecisionId`);
      }
      if (record.resolutionNotes !== undefined) {
        out.resolutionNotes = assertId(
          record.resolutionNotes,
          `${label}.resolutionNotes`,
          MAX_RESOLUTION_NOTES_LENGTH
        );
      }
      return Object.freeze(out);
    }
  }
}
