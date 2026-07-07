/**
 * Phase 1.8.1 — reputation graph event payloads + pure validator.
 *
 * Five canonical event kinds (see `reputation-graph-doctrine.md`):
 *
 *   - `reputation.observation.recorded`
 *   - `reputation.attestation.published`
 *   - `reputation.attestation.revoked`
 *   - `reputation.aggregator.published`
 *   - `reputation.aggregator.score.removed`
 *
 * Every string-typed field is one of a bounded enum from
 * `./constants.ts`. Every numeric field is range-checked. Every
 * payload object boundary uses `assertPlainObject` so a JSON-parsed
 * `__proto__` key cannot reach a downstream projection (matches the
 * Phase 1.71 + Phase 2.1 defense-in-depth posture). Aggregator
 * batches are subject-count-capped.
 *
 * Doctrine non-negotiable #5 ("observations carry counts and stable
 * tags only, never payload bytes") is enforced HERE — the validator
 * NEVER accepts free-form text on any reputation event.
 *
 * Output is deep-frozen on construction (Phase 3.2 frozen-walk
 * discipline). The validator is a pure function — replaying the
 * same input on a second device produces byte-identical output.
 */

import { tsError } from '../errors.js';
import { validateSafetySubjectRef, type SafetySubjectRef } from '../subjects.js';
import {
  assertExactVersion,
  assertFiniteNumberInRange,
  assertId,
  assertIso8601,
  assertNotBefore,
  assertOneOf,
  assertPlainObject,
  assertReadonlyArray
} from '../validation.js';
import {
  AGGREGATOR_REMOVAL_REASONS,
  ATTESTATION_CONTEXT_TAGS,
  ATTESTATION_VALENCES,
  OBSERVATION_KINDS,
  REPUTATION_ALGORITHMS,
  REPUTATION_LIMITS,
  type AggregatorRemovalReason,
  type AttestationContextTag,
  type AttestationValence,
  type ObservationKind,
  type ReputationAlgorithm
} from './constants.js';

export const REPUTATION_EVENT_VERSION = 'lfp2p.reputation-event.v1' as const;

export const REPUTATION_EVENT_KINDS = Object.freeze([
  'reputation.observation.recorded',
  'reputation.attestation.published',
  'reputation.attestation.revoked',
  'reputation.aggregator.published',
  'reputation.aggregator.score.removed'
] as const);
export type ReputationEventKind = (typeof REPUTATION_EVENT_KINDS)[number];

type CommonFields = Readonly<{
  version: typeof REPUTATION_EVENT_VERSION;
  eventId: string;
  createdAt: string;
}>;

/**
 * Per-subject score row inside `reputation.aggregator.published`.
 * Public when promoted by a labeler; never carries payload bytes.
 */
export type AggregatorSubjectScore = Readonly<{
  subject: SafetySubjectRef;
  /** `[0, 1]` — bounded by the doctrine, validator-enforced. */
  score: number;
  /** `[0, 1]` — bounded confidence interval the aggregator publishes alongside the score. */
  confidence: number;
  /** Non-negative safe integer; an explicit zero means "no observations contributed". */
  observationCount: number;
}>;

export type ReputationEvent =
  | Readonly<
      CommonFields & {
        kind: 'reputation.observation.recorded';
        subject: SafetySubjectRef;
        observationKind: ObservationKind;
        /** `[0, REPUTATION_LIMITS.maxObservationCount]` safe integer. */
        satCount: number;
        /** `[0, REPUTATION_LIMITS.maxObservationCount]` safe integer. */
        unsatCount: number;
        windowStart: string;
        windowEnd: string;
      }
    >
  | Readonly<
      CommonFields & {
        kind: 'reputation.attestation.published';
        subject: SafetySubjectRef;
        valence: AttestationValence;
        contextTag: AttestationContextTag;
        /** `[0, 1]` — endorsement strength. */
        strength: number;
        /** Optional explicit expiry; if present must be after `createdAt`. */
        expiresAt?: string;
      }
    >
  | Readonly<
      CommonFields & {
        kind: 'reputation.attestation.revoked';
        /** Event id of the earlier `reputation.attestation.published` event. */
        attestationId: string;
        revokedAt: string;
      }
    >
  | Readonly<
      CommonFields & {
        kind: 'reputation.aggregator.published';
        algorithm: ReputationAlgorithm;
        computedAt: string;
        subjects: ReadonlyArray<AggregatorSubjectScore>;
      }
    >
  | Readonly<
      CommonFields & {
        kind: 'reputation.aggregator.score.removed';
        subject: SafetySubjectRef;
        reason: AggregatorRemovalReason;
      }
    >;

/* -------------------------------------------------------------------------- */
/*                              shared helpers                                */
/* -------------------------------------------------------------------------- */

function commonFields(record: Record<string, unknown>, label: string): CommonFields {
  assertExactVersion(record.version, REPUTATION_EVENT_VERSION, `${label}.version`);
  const eventId = assertId(record.eventId, `${label}.eventId`);
  const createdAt = assertIso8601(record.createdAt, `${label}.createdAt`);
  return Object.freeze({
    version: REPUTATION_EVENT_VERSION,
    eventId,
    createdAt
  });
}

/**
 * Per-doctrine: observation counts are bounded non-negative safe
 * integers. The cap (`REPUTATION_LIMITS.maxObservationCount`) is a
 * sanity bound — a single event reporting > 1M sat events is almost
 * certainly an overflow or adversarial input.
 */
function assertCount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw tsError('TS_INVALID_NUMBER', `${label} must be a safe non-negative integer`);
  }
  if (value < 0 || value > REPUTATION_LIMITS.maxObservationCount) {
    throw tsError(
      'TS_INVALID_NUMBER',
      `${label} ${value} is outside [0, ${REPUTATION_LIMITS.maxObservationCount}]`
    );
  }
  return value;
}

function assertUnitInterval(value: unknown, label: string): number {
  // [0, 1] inclusive. Range check uses the existing helper, which
  // also rejects NaN/Infinity for us.
  return assertFiniteNumberInRange(value, label, 0, 1);
}

function validateAggregatorSubjectScore(value: unknown, label: string): AggregatorSubjectScore {
  const record = assertPlainObject(value, label);
  return Object.freeze({
    subject: validateSafetySubjectRef(record.subject, `${label}.subject`),
    score: assertUnitInterval(record.score, `${label}.score`),
    confidence: assertUnitInterval(record.confidence, `${label}.confidence`),
    observationCount: assertCount(record.observationCount, `${label}.observationCount`)
  });
}

/* -------------------------------------------------------------------------- */
/*                            top-level validator                             */
/* -------------------------------------------------------------------------- */

export function validateReputationEvent(
  value: unknown,
  label = 'ReputationEvent'
): ReputationEvent {
  const record = assertPlainObject(value, label);
  const kind = record.kind;
  if (typeof kind !== 'string' || !(REPUTATION_EVENT_KINDS as readonly string[]).includes(kind)) {
    throw tsError(
      'TS_INVALID_ENUM',
      `${label}.kind must be one of ${REPUTATION_EVENT_KINDS.join(', ')} (got: ${String(kind)})`
    );
  }
  const k = kind as ReputationEventKind;
  const common = commonFields(record, label);

  switch (k) {
    case 'reputation.observation.recorded': {
      const subject = validateSafetySubjectRef(record.subject, `${label}.subject`);
      const observationKind = assertOneOf(
        record.observationKind,
        OBSERVATION_KINDS,
        `${label}.observationKind`
      );
      const satCount = assertCount(record.satCount, `${label}.satCount`);
      const unsatCount = assertCount(record.unsatCount, `${label}.unsatCount`);
      // Both counts MUST not be zero — an event reporting zero
      // observations is meaningless and would waste storage. Fail
      // closed at the protocol boundary.
      if (satCount === 0 && unsatCount === 0) {
        throw tsError(
          'TS_INVALID_REPUTATION',
          `${label}: satCount and unsatCount cannot both be zero`
        );
      }
      const windowStart = assertIso8601(record.windowStart, `${label}.windowStart`);
      const windowEnd = assertIso8601(record.windowEnd, `${label}.windowEnd`);
      // windowStart <= windowEnd, AND duration <= maxWindowMs to
      // bound the observation window we'll honor in Phase 1.8.2.
      assertNotBefore(windowStart, windowEnd, `${label}.windowStart`, `${label}.windowEnd`);
      const startMs = Date.parse(windowStart);
      const endMs = Date.parse(windowEnd);
      if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
        const span = endMs - startMs;
        if (span < 0) {
          // Defensive — `assertNotBefore` should have already caught
          // this; we keep the second-line check because a
          // future timezone-anomaly edge case must still fail closed.
          throw tsError(
            'TS_INVALID_REPUTATION',
            `${label}: windowEnd before windowStart after ISO parse`
          );
        }
        if (span > REPUTATION_LIMITS.maxWindowMs) {
          throw tsError(
            'TS_INVALID_REPUTATION',
            `${label}: window spans ${span} ms, exceeds maxWindowMs ${REPUTATION_LIMITS.maxWindowMs}`
          );
        }
      }
      return Object.freeze({
        ...common,
        kind: 'reputation.observation.recorded',
        subject,
        observationKind,
        satCount,
        unsatCount,
        windowStart,
        windowEnd
      });
    }
    case 'reputation.attestation.published': {
      const subject = validateSafetySubjectRef(record.subject, `${label}.subject`);
      const valence = assertOneOf(record.valence, ATTESTATION_VALENCES, `${label}.valence`);
      const contextTag = assertOneOf(
        record.contextTag,
        ATTESTATION_CONTEXT_TAGS,
        `${label}.contextTag`
      );
      const strength = assertUnitInterval(record.strength, `${label}.strength`);
      const out: {
        -readonly [K in keyof Extract<
          ReputationEvent,
          { kind: 'reputation.attestation.published' }
        >]: Extract<ReputationEvent, { kind: 'reputation.attestation.published' }>[K];
      } = {
        ...common,
        kind: 'reputation.attestation.published',
        subject,
        valence,
        contextTag,
        strength
      };
      if (record.expiresAt !== undefined) {
        const expiresAt = assertIso8601(record.expiresAt, `${label}.expiresAt`);
        assertNotBefore(common.createdAt, expiresAt, `${label}.createdAt`, `${label}.expiresAt`);
        out.expiresAt = expiresAt;
      }
      return Object.freeze(out);
    }
    case 'reputation.attestation.revoked': {
      const attestationId = assertId(record.attestationId, `${label}.attestationId`);
      const revokedAt = assertIso8601(record.revokedAt, `${label}.revokedAt`);
      assertNotBefore(common.createdAt, revokedAt, `${label}.createdAt`, `${label}.revokedAt`);
      return Object.freeze({
        ...common,
        kind: 'reputation.attestation.revoked',
        attestationId,
        revokedAt
      });
    }
    case 'reputation.aggregator.published': {
      const algorithm = assertOneOf(record.algorithm, REPUTATION_ALGORITHMS, `${label}.algorithm`);
      const computedAt = assertIso8601(record.computedAt, `${label}.computedAt`);
      // The aggregator MUST have computed at or before the time it
      // signed the event. Equality is allowed (same instant).
      assertNotBefore(computedAt, common.createdAt, `${label}.computedAt`, `${label}.createdAt`);
      const subjects = assertReadonlyArray(
        record.subjects,
        `${label}.subjects`,
        REPUTATION_LIMITS.maxSubjectsPerAggregatorBatch,
        (item, index) => validateAggregatorSubjectScore(item, `${label}.subjects[${index}]`)
      );
      if (subjects.length === 0) {
        // Empty batches are meaningless and would silently inflate
        // the event log. Fail closed.
        throw tsError('TS_INVALID_REPUTATION', `${label}.subjects must contain at least one entry`);
      }
      return Object.freeze({
        ...common,
        kind: 'reputation.aggregator.published',
        algorithm,
        computedAt,
        subjects
      });
    }
    case 'reputation.aggregator.score.removed': {
      const subject = validateSafetySubjectRef(record.subject, `${label}.subject`);
      const reason = assertOneOf(record.reason, AGGREGATOR_REMOVAL_REASONS, `${label}.reason`);
      return Object.freeze({
        ...common,
        kind: 'reputation.aggregator.score.removed',
        subject,
        reason
      });
    }
  }
}
