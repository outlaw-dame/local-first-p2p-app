/**
 * Phase 1.8.3 — surface integration for the reputation graph.
 *
 * This module is intentionally NARROW: it produces parameter
 * multipliers, not new admission engine math. The Phase 1.64
 * admission engine (`packages/trust-safety/src/transport-admission/`)
 * already implements rate-limit-bucket capacity / refill / cooldown
 * with full hardening; Phase 1.8.3 only modulates those parameters
 * by multiplying them per the doctrine's band table. Same for
 * curation: Phase 1.65 curation produces ranking weights;
 * Phase 1.8.3 supplies a multiplier in `[0, 1]` that downranks
 * low-score sources without changing the curation algorithm.
 *
 * This matches the project's "no duplicate code, no drift" rule:
 * one piece of code in the engine, one parameter in the surface
 * integration, no parallel rate-limit / curation logic.
 *
 * Audit-friendliness: every output of this module is a small frozen
 * record. Consumers (admission engine + curation surface) log the
 * BAND name (e.g. `"high"`, `"low"`) rather than the raw score so
 * Phase 3.1 privacy-safe-logging is preserved without changing the
 * existing log shapes.
 */

import { tsError } from '../errors.js';
import type { LocalReputationScore } from './computer.js';

/* -------------------------------------------------------------------------- */
/*                          reputation band                                   */
/* -------------------------------------------------------------------------- */

/** Privacy-safe stable string id. Logged + audited; never the raw score. */
export type ReputationBand = 'high' | 'mid' | 'low' | 'untrusted';

export const REPUTATION_BANDS = Object.freeze(['high', 'mid', 'low', 'untrusted'] as const);

/**
 * Band thresholds per the doctrine's "Admission engine" subsection.
 * Frozen at module load.
 */
export const REPUTATION_BAND_THRESHOLDS = Object.freeze({
  high: 0.5,
  mid: 0.1,
  low: 0.01
} as const);

/**
 * Map a score into one of four bands. Unknown / undefined / NaN /
 * negative all collapse to `'untrusted'` — fail closed. Scores ≥ 1
 * are clamped into `'high'`.
 */
export function getReputationBand(score: number | undefined): ReputationBand {
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
    return 'untrusted';
  }
  if (score >= REPUTATION_BAND_THRESHOLDS.high) return 'high';
  if (score >= REPUTATION_BAND_THRESHOLDS.mid) return 'mid';
  if (score >= REPUTATION_BAND_THRESHOLDS.low) return 'low';
  return 'untrusted';
}

/**
 * Multiplier set applied to the Phase 1.64 admission engine
 * parameters for a given peer. The engine takes a baseline bucket
 * (capacity, refill, cooldown exponent) and the integration layer
 * multiplies the relevant fields through these factors. The engine
 * math is unchanged.
 *
 * Doctrine table:
 *
 *   high  : 2× capacity, 2× refill,  0.5× cooldown exponent
 *   mid   : 1× capacity, 1× refill,  1.0× cooldown exponent
 *   low   : 0.5× capacity, 0.5× refill, 1.5× cooldown exponent
 *   untrusted : 0.25× capacity, 0.25× refill, 2.0× cooldown exponent
 */
export type AdmissionBandMultipliers = Readonly<{
  band: ReputationBand;
  capacityMultiplier: number;
  refillMultiplier: number;
  cooldownExponentMultiplier: number;
}>;

const HIGH: AdmissionBandMultipliers = Object.freeze({
  band: 'high',
  capacityMultiplier: 2,
  refillMultiplier: 2,
  cooldownExponentMultiplier: 0.5
});
const MID: AdmissionBandMultipliers = Object.freeze({
  band: 'mid',
  capacityMultiplier: 1,
  refillMultiplier: 1,
  cooldownExponentMultiplier: 1
});
const LOW: AdmissionBandMultipliers = Object.freeze({
  band: 'low',
  capacityMultiplier: 0.5,
  refillMultiplier: 0.5,
  cooldownExponentMultiplier: 1.5
});
const UNTRUSTED: AdmissionBandMultipliers = Object.freeze({
  band: 'untrusted',
  capacityMultiplier: 0.25,
  refillMultiplier: 0.25,
  cooldownExponentMultiplier: 2
});

export const ADMISSION_BAND_TABLE: Readonly<Record<ReputationBand, AdmissionBandMultipliers>> =
  Object.freeze({
    high: HIGH,
    mid: MID,
    low: LOW,
    untrusted: UNTRUSTED
  });

export function getAdmissionBandMultipliers(score: number | undefined): AdmissionBandMultipliers {
  return ADMISSION_BAND_TABLE[getReputationBand(score)];
}

/**
 * Convenience: apply the multipliers to a baseline params object,
 * returning a new frozen record. Consumers may use this directly OR
 * read the multipliers and apply them manually (e.g. when the
 * baseline isn't all in one record).
 *
 * Fails closed: NaN/Infinity in either side throws — a bad baseline
 * is a bug, not a runtime condition.
 */
export type AdmissionBucketBaseline = Readonly<{
  capacity: number;
  refillPerSecond: number;
  cooldownExponent: number;
}>;

export function applyAdmissionBand(
  baseline: AdmissionBucketBaseline,
  score: number | undefined
): AdmissionBucketBaseline & { readonly band: ReputationBand } {
  assertPositiveFinite(baseline.capacity, 'baseline.capacity');
  assertPositiveFinite(baseline.refillPerSecond, 'baseline.refillPerSecond');
  assertPositiveFinite(baseline.cooldownExponent, 'baseline.cooldownExponent');
  const m = getAdmissionBandMultipliers(score);
  return Object.freeze({
    band: m.band,
    capacity: baseline.capacity * m.capacityMultiplier,
    refillPerSecond: baseline.refillPerSecond * m.refillMultiplier,
    cooldownExponent: baseline.cooldownExponent * m.cooldownExponentMultiplier
  });
}

/* -------------------------------------------------------------------------- */
/*                           curation downrank                                */
/* -------------------------------------------------------------------------- */

/**
 * Multiplier in `[0, 1]` for the Phase 1.65 curation surface to apply
 * to a content item's ranking weight. Higher reputation → higher
 * multiplier. Always returns a value in `[CURATION_FLOOR, 1]` so a
 * low score downranks but NEVER fully suppresses content — that's
 * the spam gate's job (and only when explicitly opted in).
 *
 * The doctrine non-negotiable #7 ("Reputation never causes silent
 * deletion") is enforced HERE — there's no value of `score` that
 * makes this function return 0.
 */
export const CURATION_FLOOR = 0.1 as const;

export function getCurationDownrankFactor(score: number | undefined): number {
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
    return CURATION_FLOOR;
  }
  if (score >= 1) return 1;
  // Linear between CURATION_FLOOR and 1.0 over score ∈ [0, 1].
  return CURATION_FLOOR + (1 - CURATION_FLOOR) * score;
}

/* -------------------------------------------------------------------------- */
/*                            score lookup helper                             */
/* -------------------------------------------------------------------------- */

/**
 * Extract the score from a `LocalReputationScore | undefined`. Folds
 * the two undefined paths (no entry vs entry-with-undefined) into a
 * single `undefined` so consumers can simply chain
 * `getReputationBand(getScore(state, key))`.
 */
export function getScore(
  state: { readonly scores: ReadonlyMap<string, LocalReputationScore> },
  key: string
): number | undefined {
  const entry = state.scores.get(key);
  return entry?.score;
}

/* -------------------------------------------------------------------------- */
/*                                helpers                                     */
/* -------------------------------------------------------------------------- */

function assertPositiveFinite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw tsError('TS_INVALID_NUMBER', `${label} must be a positive finite number`);
  }
  return value;
}
