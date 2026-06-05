/**
 * Phase 1.8.3 — spam-gate decision (Farcaster-style use case).
 *
 * Pure function that takes a per-subject reputation score AND the
 * topology context (seed distance + positive-attestation presence)
 * and returns a stable spam decision.
 *
 * Doctrine non-negotiable #7 ("Reputation never causes silent
 * deletion") is enforced HERE — the spam gate produces a LABEL
 * suggestion (`flagSpam: true`), never an immediate hide / delete.
 * The downstream Phase 1.66 labeler layer is what emits the label;
 * a user's local-controls (Phase 1.62) ALWAYS override per the
 * labeler runtime contract.
 *
 * The three-condition AND ensures false positives stay low. Each
 * condition is necessary, none alone is sufficient:
 *
 *   1. `score < spamScoreThreshold`              — low reputation
 *   2. `seedDistance > spamSeedDistanceMax`      — far from the
 *                                                  user's trust
 *                                                  graph (defeats
 *                                                  the "low-score
 *                                                  but my friend
 *                                                  vouches" false
 *                                                  positive)
 *   3. `!hasPositiveAttestation`                 — nobody has
 *                                                  explicitly
 *                                                  vouched for this
 *                                                  subject
 *
 * Defaults are conservative (high score threshold + low distance
 * threshold). A consumer that wants more aggressive filtering passes
 * a stricter config.
 */

import { tsError } from '../errors.js';
import { assertFiniteNumberInRange, assertPlainObject } from '../validation.js';

export const SPAM_GATE_VERSION = 'lfp2p.reputation-spam-gate.v1' as const;

/**
 * Stable reason codes returned by the gate. Logged audit-safely;
 * never the raw score / seed distance values. Matches the Phase 3.1
 * privacy-safe logging doctrine.
 */
export const SPAM_GATE_REASON_CODES = Object.freeze([
  'score-above-threshold',
  'within-seed-distance',
  'positive-attestation-present',
  'unknown-input',
  'flagged'
] as const);
export type SpamGateReasonCode = (typeof SPAM_GATE_REASON_CODES)[number];

export type SpamGateConfig = Readonly<{
  /** Subjects with score < this are CANDIDATES for spam. Default 0.05. */
  spamScoreThreshold: number;
  /**
   * Subjects whose seed distance is > this are CANDIDATES for spam.
   * Default 3 — anything more than 3 hops from any seed is treated
   * as far. `Number.POSITIVE_INFINITY` (= unreachable) ALWAYS
   * satisfies this condition.
   */
  spamSeedDistanceMax: number;
}>;

export const DEFAULT_SPAM_GATE_CONFIG: SpamGateConfig = Object.freeze({
  spamScoreThreshold: 0.05,
  spamSeedDistanceMax: 3
});

export type SpamGateInput = Readonly<{
  score: number;
  seedDistance: number;
  hasPositiveAttestation: boolean;
}>;

export type SpamGateDecision = Readonly<{
  version: typeof SPAM_GATE_VERSION;
  flagSpam: boolean;
  reasonCode: SpamGateReasonCode;
  /** Echoes the band the input score fell into — privacy-safe (Phase 3.1). */
  bandSnapshot: Readonly<{ atOrAboveThreshold: boolean }>;
}>;

/**
 * Compute the spam-gate decision. Returns a frozen decision record
 * regardless of input — never throws on malformed reputation data
 * (we fall closed to `unknown-input`).
 *
 * Misconfiguration (negative thresholds, NaN config values) DOES
 * throw — that's a programming error, not a runtime condition.
 */
export function computeSpamGateDecision(
  input: SpamGateInput,
  configOverride: Partial<SpamGateConfig> = {}
): SpamGateDecision {
  const config = resolveSpamGateConfig(configOverride);
  // Treat NaN / Infinity / negative score as "unknown" — fail open
  // (do NOT flag as spam) so a missing data point cannot cause a
  // false-positive spam label. Doctrine non-negotiable #7 +
  // doctrine threat-model row "hostile aggregator publishing
  // biased scores" — better to under-flag than over-flag.
  const validScore =
    typeof input.score === 'number' && Number.isFinite(input.score) && input.score >= 0;
  const validDistance =
    typeof input.seedDistance === 'number' &&
    (input.seedDistance >= 0 || input.seedDistance === Number.POSITIVE_INFINITY);
  const validBool = typeof input.hasPositiveAttestation === 'boolean';
  if (!validScore || !validDistance || !validBool) {
    return Object.freeze({
      version: SPAM_GATE_VERSION,
      flagSpam: false,
      reasonCode: 'unknown-input',
      bandSnapshot: Object.freeze({ atOrAboveThreshold: false })
    });
  }
  const lowScore = input.score < config.spamScoreThreshold;
  const farFromSeed = input.seedDistance > config.spamSeedDistanceMax;
  const noPositiveAttestation = !input.hasPositiveAttestation;

  if (!lowScore) {
    return Object.freeze({
      version: SPAM_GATE_VERSION,
      flagSpam: false,
      reasonCode: 'score-above-threshold',
      bandSnapshot: Object.freeze({ atOrAboveThreshold: true })
    });
  }
  if (!farFromSeed) {
    return Object.freeze({
      version: SPAM_GATE_VERSION,
      flagSpam: false,
      reasonCode: 'within-seed-distance',
      bandSnapshot: Object.freeze({ atOrAboveThreshold: false })
    });
  }
  if (!noPositiveAttestation) {
    return Object.freeze({
      version: SPAM_GATE_VERSION,
      flagSpam: false,
      reasonCode: 'positive-attestation-present',
      bandSnapshot: Object.freeze({ atOrAboveThreshold: false })
    });
  }
  return Object.freeze({
    version: SPAM_GATE_VERSION,
    flagSpam: true,
    reasonCode: 'flagged',
    bandSnapshot: Object.freeze({ atOrAboveThreshold: false })
  });
}

export function resolveSpamGateConfig(override: Partial<SpamGateConfig> = {}): SpamGateConfig {
  if (override !== null && typeof override === 'object') {
    assertPlainObject(override, 'SpamGateConfig');
  } else if (override !== undefined) {
    throw tsError('TS_INVALID_INPUT', 'SpamGateConfig override must be a plain object');
  }
  const merged = { ...DEFAULT_SPAM_GATE_CONFIG, ...override };
  assertFiniteNumberInRange(merged.spamScoreThreshold, 'spamScoreThreshold', 0, 1);
  if (
    typeof merged.spamSeedDistanceMax !== 'number' ||
    !Number.isFinite(merged.spamSeedDistanceMax) ||
    merged.spamSeedDistanceMax < 0 ||
    !Number.isInteger(merged.spamSeedDistanceMax)
  ) {
    throw tsError(
      'TS_INVALID_NUMBER',
      'spamSeedDistanceMax must be a non-negative integer'
    );
  }
  return Object.freeze({ ...merged });
}
