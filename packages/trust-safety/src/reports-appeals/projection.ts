import type { SafetyAppeal } from '../appeals.js';
import type { SafetyAuthority } from '../authorities.js';
import { tsError } from '../errors.js';
import {
  withFrozenAppliedEventId as withAppliedEventId,
  withFrozenBucketAppend as pushToBucket,
  withFrozenRecordSet as withRecordSet
} from '../projection-helpers.js';
import type { SafetyReasonCode } from '../reason-codes.js';
import type { SafetyReport } from '../reports.js';
import type {
  AppealResolution,
  ReportAppealEvent,
  ReportResolution
} from './events.js';
import { validateReportAppealEvent } from './events.js';
import { assertPrivateEvidenceOnPrivateSubject } from './privacy.js';

// --- Record shapes -------------------------------------------------------

export const REPORT_STATUSES = ['submitted', 'acknowledged', 'resolved'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const APPEAL_STATUSES = ['submitted', 'resolved'] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

export type ReportRecord = Readonly<{
  reportId: string;
  report: SafetyReport;
  status: ReportStatus;
  acknowledgedBy?: SafetyAuthority;
  acknowledgedAt?: string;
  ackReasonCode?: SafetyReasonCode;
  resolvedBy?: SafetyAuthority;
  resolvedAt?: string;
  resolution?: ReportResolution;
  resolutionReasonCode?: SafetyReasonCode;
  resolutionDecisionId?: string;
  escalatedTo?: SafetyAuthority;
  resolutionNotes?: string;
}>;

export type AppealRecord = Readonly<{
  appealId: string;
  appeal: SafetyAppeal;
  status: AppealStatus;
  resolvedBy?: SafetyAuthority;
  resolvedAt?: string;
  resolution?: AppealResolution;
  resolutionReasonCode?: SafetyReasonCode;
  newDecisionId?: string;
  resolutionNotes?: string;
}>;

// --- State ---------------------------------------------------------------

/**
 * Frozen projection state for reports and appeals. Deterministically
 * rebuildable from the event log. The shape is intentionally
 * serializable for downstream persistence (Phase 1.64 / local-store).
 *
 * Indexes:
 *  - `byReportId` / `byAppealId`: primary records keyed by id.
 *  - `byReportIdempotencyKey`: dedup index. A repeat
 *    `safety.report.created` whose embedded report carries an already-
 *    seen `idempotencyKey` is silently ignored.
 *  - `byTargetAuthority`: reportIds grouped by the targeted authority,
 *    useful for moderator inboxes downstream.
 *  - `byAppealedDecisionId`: appealIds grouped by the decision they
 *    target, useful for surfacing all appeals against a single
 *    decision.
 *  - `appliedEventIds`: idempotency on `eventId` for replay safety.
 */
export type ReportsAppealsState = Readonly<{
  byReportId: Readonly<Record<string, ReportRecord>>;
  byReportIdempotencyKey: Readonly<Record<string, string>>;
  byTargetAuthority: Readonly<Record<string, ReadonlyArray<string>>>;
  byAppealId: Readonly<Record<string, AppealRecord>>;
  byAppealIdempotencyKey: Readonly<Record<string, string>>;
  byAppealedDecisionId: Readonly<Record<string, ReadonlyArray<string>>>;
  appliedEventIds: ReadonlySet<string>;
}>;

export function createEmptyReportsAppealsState(): ReportsAppealsState {
  return Object.freeze({
    byReportId: Object.freeze({}),
    byReportIdempotencyKey: Object.freeze({}),
    byTargetAuthority: Object.freeze({}),
    byAppealId: Object.freeze({}),
    byAppealIdempotencyKey: Object.freeze({}),
    byAppealedDecisionId: Object.freeze({}),
    appliedEventIds: Object.freeze(new Set<string>())
  });
}

// --- Helpers -------------------------------------------------------------
// Projection helpers live in `../projection-helpers.js` (imported above).

/**
 * Encode a SafetyAuthority for an index key in a way that is stable,
 * collision-resistant for distinct authorityIds, and does not leak
 * actor identity into the keying space. We use the `authorityId` field
 * directly — it's already required and unique per authority record.
 */
function authorityKey(authority: SafetyAuthority): string {
  return authority.authorityId;
}

// --- Apply ---------------------------------------------------------------

/**
 * Apply a single lifecycle event to a state snapshot, returning a new
 * frozen state.
 *
 * Determinism rules:
 *  - Validates the event before any state mutation. Malformed payloads
 *    throw without changing `state`.
 *  - Applying the same event twice (matching `eventId`) is a no-op.
 *  - Idempotency-key duplicates on `safety.report.created` and
 *    `safety.appeal.created` are silent no-ops at the projection
 *    layer; the duplicate record does not appear, the existing record
 *    is preserved, and the eventId is still recorded so replay does
 *    not loop.
 *  - State-machine transitions are enforced:
 *      report:  submitted -> acknowledged -> resolved (terminal)
 *      appeal:  submitted -> resolved                (terminal)
 *    Illegal transitions throw `TS_LIFECYCLE_TRANSITION` and do not
 *    mutate state.
 *  - `safety.report.created` events for private-by-nature subjects are
 *    additionally checked by `assertPrivateEvidenceOnPrivateSubject`
 *    so encrypted-evidence rules are enforced before the record is
 *    written into the projection.
 */
export function applyReportAppealEvent(
  state: ReportsAppealsState,
  event: ReportAppealEvent | unknown,
  label = 'applyReportAppealEvent'
): ReportsAppealsState {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    throw tsError('TS_INVALID_INPUT', `${label}: event must be a plain object`);
  }
  const e = validateReportAppealEvent(event, label);

  if (state.appliedEventIds.has(e.eventId)) {
    return state;
  }
  const nextAppliedEventIds = withAppliedEventId(state.appliedEventIds, e.eventId);

  switch (e.kind) {
    case 'safety.report.created': {
      const report = e.report;
      // Duplicate idempotency key -> silent no-op (still record eventId).
      if (state.byReportIdempotencyKey[report.idempotencyKey] !== undefined) {
        return Object.freeze({ ...state, appliedEventIds: nextAppliedEventIds });
      }
      // Private-evidence enforcement before mutation.
      assertPrivateEvidenceOnPrivateSubject(report, `${label}.report`);

      const record: ReportRecord = Object.freeze({
        reportId: report.reportId,
        report,
        status: 'submitted'
      });
      return Object.freeze({
        ...state,
        byReportId: withRecordSet(state.byReportId, report.reportId, record),
        byReportIdempotencyKey: withRecordSet(
          state.byReportIdempotencyKey,
          report.idempotencyKey,
          report.reportId
        ),
        byTargetAuthority: pushToBucket(
          state.byTargetAuthority,
          authorityKey(report.targetAuthority),
          report.reportId
        ),
        appliedEventIds: nextAppliedEventIds
      });
    }
    case 'safety.report.acknowledged': {
      const existing = state.byReportId[e.reportId];
      if (existing === undefined) {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: cannot acknowledge unknown reportId "${e.reportId}"`
        );
      }
      if (existing.status !== 'submitted') {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: report "${e.reportId}" status is "${existing.status}"; expected "submitted" to acknowledge`
        );
      }
      const next: ReportRecord = Object.freeze({
        ...existing,
        status: 'acknowledged',
        acknowledgedBy: e.acknowledgedBy,
        acknowledgedAt: e.acknowledgedAt,
        ...(e.ackReasonCode !== undefined ? { ackReasonCode: e.ackReasonCode } : {})
      });
      return Object.freeze({
        ...state,
        byReportId: withRecordSet(state.byReportId, e.reportId, next),
        appliedEventIds: nextAppliedEventIds
      });
    }
    case 'safety.report.resolved': {
      const existing = state.byReportId[e.reportId];
      if (existing === undefined) {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: cannot resolve unknown reportId "${e.reportId}"`
        );
      }
      if (existing.status === 'resolved') {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: report "${e.reportId}" is already resolved (terminal)`
        );
      }
      // submitted -> resolved is allowed (skip ack), per the doctrine
      // that a target authority MAY resolve immediately for clear cases.
      const next: ReportRecord = Object.freeze({
        ...existing,
        status: 'resolved',
        resolvedBy: e.resolvedBy,
        resolvedAt: e.resolvedAt,
        resolution: e.resolution,
        resolutionReasonCode: e.resolutionReasonCode,
        ...(e.resolutionDecisionId !== undefined
          ? { resolutionDecisionId: e.resolutionDecisionId }
          : {}),
        ...(e.escalatedTo !== undefined ? { escalatedTo: e.escalatedTo } : {}),
        ...(e.resolutionNotes !== undefined ? { resolutionNotes: e.resolutionNotes } : {})
      });
      return Object.freeze({
        ...state,
        byReportId: withRecordSet(state.byReportId, e.reportId, next),
        appliedEventIds: nextAppliedEventIds
      });
    }
    case 'safety.appeal.created': {
      const appeal = e.appeal;
      if (state.byAppealIdempotencyKey[appeal.idempotencyKey] !== undefined) {
        return Object.freeze({ ...state, appliedEventIds: nextAppliedEventIds });
      }
      const record: AppealRecord = Object.freeze({
        appealId: appeal.appealId,
        appeal,
        status: 'submitted'
      });
      return Object.freeze({
        ...state,
        byAppealId: withRecordSet(state.byAppealId, appeal.appealId, record),
        byAppealIdempotencyKey: withRecordSet(
          state.byAppealIdempotencyKey,
          appeal.idempotencyKey,
          appeal.appealId
        ),
        byAppealedDecisionId: pushToBucket(
          state.byAppealedDecisionId,
          appeal.decisionId,
          appeal.appealId
        ),
        appliedEventIds: nextAppliedEventIds
      });
    }
    case 'safety.appeal.resolved': {
      const existing = state.byAppealId[e.appealId];
      if (existing === undefined) {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: cannot resolve unknown appealId "${e.appealId}"`
        );
      }
      if (existing.status === 'resolved') {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: appeal "${e.appealId}" is already resolved (terminal)`
        );
      }
      const next: AppealRecord = Object.freeze({
        ...existing,
        status: 'resolved',
        resolvedBy: e.resolvedBy,
        resolvedAt: e.resolvedAt,
        resolution: e.resolution,
        resolutionReasonCode: e.resolutionReasonCode,
        ...(e.newDecisionId !== undefined ? { newDecisionId: e.newDecisionId } : {}),
        ...(e.resolutionNotes !== undefined ? { resolutionNotes: e.resolutionNotes } : {})
      });
      return Object.freeze({
        ...state,
        byAppealId: withRecordSet(state.byAppealId, e.appealId, next),
        appliedEventIds: nextAppliedEventIds
      });
    }
  }
}

/**
 * Replay a full event sequence from empty state. Equivalent to a left
 * fold of `applyReportAppealEvent`. Provided because store rebuild
 * after reopen is the canonical use case.
 */
export function seedReportsAppealsState(
  events: Iterable<ReportAppealEvent | unknown>,
  label = 'seedReportsAppealsState'
): ReportsAppealsState {
  let state = createEmptyReportsAppealsState();
  let i = 0;
  for (const event of events) {
    state = applyReportAppealEvent(state, event, `${label}[${i}]`);
    i += 1;
  }
  return state;
}
