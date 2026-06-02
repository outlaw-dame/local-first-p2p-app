/**
 * Pure-function peer reputation tracker with bounded score, time-based
 * decay, and automatic quarantine / auto-lift transitions (self-healing).
 *
 * Threat model:
 *  - Score is bounded [-1000, 1000] so a single attack window cannot
 *    push the peer into an unrecoverable state.
 *  - Score decays toward 0 over time at a constant rate. Decay rate is
 *    configurable; defaults make a peer with score -500 take ~24 hours
 *    to climb back to -100 without external events.
 *  - Quarantine is automatic when score drops below `quarantineThreshold`
 *    (default -500). Auto-lift when score climbs back above
 *    `recoveryThreshold` (default -100), keeping a hysteresis gap to
 *    prevent flapping.
 *  - Quarantine also carries a hard TTL so a peer is never stuck forever
 *    regardless of reputation. After `maxQuarantineMs` the entry is
 *    eligible for auto-lift even without recovery.
 *  - All transitions are pure; the caller persists the returned record.
 */

import { tsError } from '../errors.js';
import { assertFiniteNumberInRange } from '../validation.js';

export type ReputationConfig = Readonly<{
  /** Lower clamp on score. */
  minScore: number;
  /** Upper clamp on score. */
  maxScore: number;
  /** Score units decayed per second toward 0. */
  decayPerSecond: number;
  /** Score at or below which the peer is auto-quarantined. */
  quarantineThreshold: number;
  /** Score above which an active quarantine is auto-lifted. */
  recoveryThreshold: number;
  /** Hard upper bound on a quarantine's duration in ms. */
  maxQuarantineMs: number;
}>;

export const DEFAULT_REPUTATION: ReputationConfig = Object.freeze({
  minScore: -1_000,
  maxScore: 1_000,
  decayPerSecond: 1 / 60, // ~60 score units per hour back toward 0
  quarantineThreshold: -500,
  recoveryThreshold: -100,
  maxQuarantineMs: 7 * 24 * 60 * 60 * 1_000 // one week
});

export type PeerReputation = Readonly<{
  score: number;
  /** Epoch ms of the last score update. Used for decay computation. */
  lastUpdatedAt: number;
  /**
   * If set, the peer is in an active quarantine. The `until` is the
   * epoch ms at which the quarantine auto-lifts unconditionally. The
   * quarantine may also lift earlier if score recovers above
   * `recoveryThreshold`.
   */
  quarantineUntil?: number;
  /** Last reason recorded for telemetry/audit. Not authoritative. */
  lastReason?: string;
}>;

export function validateReputationConfig(
  config: ReputationConfig,
  label = 'ReputationConfig'
): ReputationConfig {
  assertFiniteNumberInRange(config.minScore, `${label}.minScore`, -1_000_000, 0);
  assertFiniteNumberInRange(config.maxScore, `${label}.maxScore`, 0, 1_000_000);
  if (config.minScore >= config.maxScore) {
    throw tsError('TS_INVALID_NUMBER', `${label}.minScore must be < maxScore`);
  }
  assertFiniteNumberInRange(config.decayPerSecond, `${label}.decayPerSecond`, 0, 1_000);
  assertFiniteNumberInRange(
    config.quarantineThreshold,
    `${label}.quarantineThreshold`,
    config.minScore,
    config.maxScore
  );
  assertFiniteNumberInRange(
    config.recoveryThreshold,
    `${label}.recoveryThreshold`,
    config.quarantineThreshold,
    config.maxScore
  );
  if (config.recoveryThreshold <= config.quarantineThreshold) {
    throw tsError(
      'TS_INVALID_NUMBER',
      `${label}.recoveryThreshold must be > quarantineThreshold (hysteresis gap)`
    );
  }
  assertFiniteNumberInRange(
    config.maxQuarantineMs,
    `${label}.maxQuarantineMs`,
    1_000,
    365 * 24 * 60 * 60 * 1_000
  );
  return config;
}

export function createReputation(now: number): PeerReputation {
  return Object.freeze({ score: 0, lastUpdatedAt: now });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Decay the score toward 0 by elapsed time. Pure; returns a new record.
 * Decay never crosses zero (a positive score does not become negative
 * via decay, and vice versa).
 */
export function decayReputation(
  rep: PeerReputation,
  now: number,
  config: ReputationConfig = DEFAULT_REPUTATION
): PeerReputation {
  if (now <= rep.lastUpdatedAt) return rep;
  if (rep.score === 0) {
    return Object.freeze({ ...rep, lastUpdatedAt: now });
  }
  const elapsedSeconds = (now - rep.lastUpdatedAt) / 1000;
  const magnitude = Math.abs(rep.score);
  const decayed = Math.max(0, magnitude - elapsedSeconds * config.decayPerSecond);
  // Normalize negative zero to +0 so equality tests behave intuitively.
  const signed = decayed === 0 ? 0 : rep.score < 0 ? -decayed : decayed;
  return Object.freeze({
    ...rep,
    score: clamp(signed, config.minScore, config.maxScore),
    lastUpdatedAt: now
  });
}

/**
 * Apply a score delta. Negative delta subtracts (penalty); positive adds
 * (credit). Score is clamped; transitions into/out of quarantine are
 * computed automatically.
 */
export function applyReputationDelta(
  rep: PeerReputation,
  delta: number,
  now: number,
  reason: string,
  config: ReputationConfig = DEFAULT_REPUTATION
): PeerReputation {
  if (!Number.isFinite(delta)) {
    throw tsError('TS_INVALID_NUMBER', 'reputation delta must be finite');
  }
  const decayed = decayReputation(rep, now, config);
  const nextScore = clamp(decayed.score + delta, config.minScore, config.maxScore);
  let quarantineUntil = decayed.quarantineUntil;

  // Enter quarantine when score crosses below threshold.
  if (quarantineUntil === undefined && nextScore <= config.quarantineThreshold) {
    quarantineUntil = now + config.maxQuarantineMs;
  }
  // Auto-lift when score recovers above the recovery threshold.
  if (quarantineUntil !== undefined && nextScore >= config.recoveryThreshold) {
    quarantineUntil = undefined;
  }
  // Auto-lift when TTL elapses regardless of score.
  if (quarantineUntil !== undefined && now >= quarantineUntil) {
    quarantineUntil = undefined;
  }

  const out: { -readonly [K in keyof PeerReputation]: PeerReputation[K] } = {
    score: nextScore,
    lastUpdatedAt: now,
    lastReason: reason
  };
  if (quarantineUntil !== undefined) out.quarantineUntil = quarantineUntil;
  return Object.freeze(out);
}

/** Returns true if the peer is currently quarantined at `now`. */
export function isQuarantined(rep: PeerReputation, now: number): boolean {
  if (rep.quarantineUntil === undefined) return false;
  return now < rep.quarantineUntil;
}
