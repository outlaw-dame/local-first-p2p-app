import type { CurationRule, CurationExplanation, CurationSurface } from '../curation.js';
import type { CurationActionKind } from '../curation.js';
import { CURATION_ACTION_KINDS, CURATION_SURFACES, validateCurationExplanation, validateCurationRule } from '../curation.js';
import type { SafetyAuthority } from '../authorities.js';
import { validateSafetyAuthority } from '../authorities.js';
import { tsError } from '../errors.js';
import type { SafetyReasonCode } from '../reason-codes.js';
import { SAFETY_REASON_CODES } from '../reason-codes.js';
import type { SafetySubjectRef } from '../subjects.js';
import { validateSafetySubjectRef } from '../subjects.js';
import {
  assertExactVersion,
  assertFiniteNumberInRange,
  assertId,
  assertIso8601,
  assertOneOf,
  assertPlainObject
} from '../validation.js';

export const CURATION_EVENT_VERSION = 'lfp2p.curation-event.v1' as const;

/**
 * Six lifecycle event kinds, per the Phase 1.65 plan. Each rule lives
 * through `created → disabled` (terminal). Item-level boosts /
 * downranks / exclusions accumulate independently; they do not require
 * a "revert" because every item action records its own source ruleId,
 * and disabling the source rule is the canonical way to neutralize it.
 *
 * Curation explanations are recorded separately so consumers can
 * surface the *why* of any item action without inferring it from rule
 * predicates.
 */
export const CURATION_EVENT_KINDS = [
  'curation.rule.created',
  'curation.rule.disabled',
  'curation.item.boosted',
  'curation.item.downranked',
  'curation.item.excluded',
  'curation.explanation.recorded'
] as const;
export type CurationEventKind = (typeof CURATION_EVENT_KINDS)[number];

/**
 * Reasons a curation rule may exclude an item. Distinct from a
 * `SafetyPolicyDecision` action like `remove-local` — this is reach
 * shaping, not moderation enforcement.
 */
export const EXCLUDE_FROM = ['feed', 'search', 'recommendation'] as const;
export type ExcludeFrom = (typeof EXCLUDE_FROM)[number];

/** Score-delta bound used by boost/downrank events. */
export const MAX_SCORE_DELTA = 100;

type CommonFields = Readonly<{
  version: typeof CURATION_EVENT_VERSION;
  eventId: string;
  createdAt: string;
}>;

export type CurationEvent =
  | Readonly<CommonFields & {
      kind: 'curation.rule.created';
      rule: CurationRule;
    }>
  | Readonly<CommonFields & {
      kind: 'curation.rule.disabled';
      ruleId: string;
      disabledBy: SafetyAuthority;
      disabledAt: string;
      reasonCode: SafetyReasonCode;
    }>
  | Readonly<CommonFields & {
      kind: 'curation.item.boosted';
      itemSubject: SafetySubjectRef;
      surface: CurationSurface;
      sourceRuleId: string;
      scoreDelta: number;
      reasonCode: SafetyReasonCode;
    }>
  | Readonly<CommonFields & {
      kind: 'curation.item.downranked';
      itemSubject: SafetySubjectRef;
      surface: CurationSurface;
      sourceRuleId: string;
      scoreDelta: number;
      reasonCode: SafetyReasonCode;
    }>
  | Readonly<CommonFields & {
      kind: 'curation.item.excluded';
      itemSubject: SafetySubjectRef;
      surface: CurationSurface;
      sourceRuleId: string;
      reasonCode: SafetyReasonCode;
      excludeFrom: ExcludeFrom;
    }>
  | Readonly<CommonFields & {
      kind: 'curation.explanation.recorded';
      explanation: CurationExplanation;
    }>;

function commonFields(record: Record<string, unknown>, label: string): CommonFields {
  assertExactVersion(record.version, CURATION_EVENT_VERSION, `${label}.version`);
  const eventId = assertId(record.eventId, `${label}.eventId`);
  const createdAt = assertIso8601(record.createdAt, `${label}.createdAt`);
  return Object.freeze({ version: CURATION_EVENT_VERSION, eventId, createdAt });
}

export function validateCurationEvent(value: unknown, label = 'CurationEvent'): CurationEvent {
  const record = assertPlainObject(value, label);
  const kind = record.kind;
  if (
    typeof kind !== 'string' ||
    !(CURATION_EVENT_KINDS as readonly string[]).includes(kind)
  ) {
    throw tsError(
      'TS_INVALID_ENUM',
      `${label}.kind must be one of ${CURATION_EVENT_KINDS.join(', ')} (got: ${String(kind)})`
    );
  }
  const k = kind as CurationEventKind;
  const common = commonFields(record, label);

  switch (k) {
    case 'curation.rule.created': {
      const rule = validateCurationRule(record.rule, `${label}.rule`);
      return Object.freeze({ ...common, kind: 'curation.rule.created', rule });
    }
    case 'curation.rule.disabled': {
      const ruleId = assertId(record.ruleId, `${label}.ruleId`);
      const disabledBy = validateSafetyAuthority(record.disabledBy, `${label}.disabledBy`);
      const disabledAt = assertIso8601(record.disabledAt, `${label}.disabledAt`);
      const reasonCode = assertOneOf(
        record.reasonCode,
        SAFETY_REASON_CODES,
        `${label}.reasonCode`
      );
      return Object.freeze({
        ...common,
        kind: 'curation.rule.disabled',
        ruleId,
        disabledBy,
        disabledAt,
        reasonCode
      });
    }
    case 'curation.item.boosted':
    case 'curation.item.downranked': {
      const itemSubject = validateSafetySubjectRef(record.itemSubject, `${label}.itemSubject`);
      const surface = assertOneOf(record.surface, CURATION_SURFACES, `${label}.surface`);
      const sourceRuleId = assertId(record.sourceRuleId, `${label}.sourceRuleId`);
      const scoreDelta = assertFiniteNumberInRange(
        record.scoreDelta,
        `${label}.scoreDelta`,
        0,
        MAX_SCORE_DELTA
      );
      if (!Number.isSafeInteger(scoreDelta) || scoreDelta < 0) {
        throw tsError(
          'TS_INVALID_NUMBER',
          `${label}.scoreDelta must be a non-negative safe integer`
        );
      }
      const reasonCode = assertOneOf(record.reasonCode, SAFETY_REASON_CODES, `${label}.reasonCode`);
      return Object.freeze({
        ...common,
        kind: k,
        itemSubject,
        surface,
        sourceRuleId,
        scoreDelta,
        reasonCode
      });
    }
    case 'curation.item.excluded': {
      const itemSubject = validateSafetySubjectRef(record.itemSubject, `${label}.itemSubject`);
      const surface = assertOneOf(record.surface, CURATION_SURFACES, `${label}.surface`);
      const sourceRuleId = assertId(record.sourceRuleId, `${label}.sourceRuleId`);
      const reasonCode = assertOneOf(record.reasonCode, SAFETY_REASON_CODES, `${label}.reasonCode`);
      const excludeFrom = assertOneOf(record.excludeFrom, EXCLUDE_FROM, `${label}.excludeFrom`);
      return Object.freeze({
        ...common,
        kind: 'curation.item.excluded',
        itemSubject,
        surface,
        sourceRuleId,
        reasonCode,
        excludeFrom
      });
    }
    case 'curation.explanation.recorded': {
      const explanation = validateCurationExplanation(
        record.explanation,
        `${label}.explanation`
      );
      return Object.freeze({
        ...common,
        kind: 'curation.explanation.recorded',
        explanation
      });
    }
  }
}

// Re-exports for downstream consumers.
export type { CurationActionKind, CurationRule, CurationExplanation, CurationSurface };
export { CURATION_ACTION_KINDS };
