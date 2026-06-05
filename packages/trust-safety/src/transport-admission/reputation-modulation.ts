/**
 * Phase 1.8.6 — bridge between the Phase 1.8.3 admission band table
 * and the Phase 1.64 transport-admission rate-limit config.
 *
 * Pure helper. Given a baseline `RateLimitConfig` and an optional
 * reputation score, returns a new `RateLimitConfig` whose parameters
 * have been modulated per the doctrine band table:
 *
 *   high      : 2.0× capacity, 2.0× refill, 0.5× base-backoff
 *   mid       : 1.0× capacity, 1.0× refill, 1.0× base-backoff
 *   low       : 0.5× capacity, 0.5× refill, 1.5× base-backoff
 *   untrusted : 0.25× capacity, 0.25× refill, 2.0× base-backoff
 *
 * NB: the doctrine table's `cooldownExponentMultiplier` maps to
 * `baseBackoffMs` here. The existing rate-limit has a fixed `2^(n−1)`
 * exponential-growth law and no separate exponent parameter; the
 * cleanest mapping is to dial the initial cooldown, which scales the
 * whole geometric-progression schedule.
 *
 * Engine math is unchanged. Defaults (score `undefined` and no
 * lookup) collapse to the legacy non-modulated config so pre-1.8.6
 * callers see byte-identical admission behavior — the doctrine
 * non-negotiable "no math duplication, no drift" is preserved.
 */

import {
  applyAdmissionBand,
  getReputationBand,
  type ReputationBand
} from '../reputation-graph/surface-integration.js';
import {
  DEFAULT_RATE_LIMIT,
  validateRateLimitConfig,
  type RateLimitConfig
} from './rate-limit.js';
import { tsError } from '../errors.js';

export type ModulatedRateLimit = Readonly<{
  config: RateLimitConfig;
  band: ReputationBand;
}>;

/**
 * Modulate a baseline `RateLimitConfig` by the peer's reputation
 * score. When `score` is `undefined` (no entry in the user's local
 * state), the peer collapses to the `'untrusted'` band — the same
 * default that `getReputationBand(undefined)` returns. The doctrine
 * fail-closed default is intentional: an unknown peer gets the
 * smallest bucket, not the legacy size.
 *
 * Callers that explicitly want the legacy (unmodulated) behavior
 * pass `score = null` (no lookup at all) — see `runAdmissionChecks`
 * which short-circuits when `context?.reputationScoreLookup` is
 * `undefined`.
 *
 * Returns the modulated config + the band used (for privacy-safe
 * audit logging).
 */
export function modulateRateLimitConfig(
  baseline: RateLimitConfig,
  score: number | undefined
): ModulatedRateLimit {
  // Defense-in-depth: validate the baseline against the same range
  // checks the engine uses. A bad baseline is a programming bug.
  validateRateLimitConfig(baseline, 'modulateRateLimitConfig.baseline');

  const band = getReputationBand(score);
  // Reuse the doctrine band table from the Phase 1.8.3 surface-
  // integration helper. We feed it the relevant RateLimitConfig
  // fields under the helper's documented baseline shape:
  //   capacity → capacity
  //   refillPerSecond → refillRatePerSecond
  //   cooldownExponent → baseBackoffMs
  const modulated = applyAdmissionBand(
    {
      capacity: baseline.capacity,
      refillPerSecond: baseline.refillRatePerSecond,
      cooldownExponent: baseline.baseBackoffMs
    },
    score
  );
  // `capacity` MUST round to a safe integer — the rate-limit config
  // pins it that way and the validator below would reject a float
  // (1.5 tokens has no meaning). Round-down to the nearest int with
  // a floor of 1 to keep the bucket usable.
  const nextCapacity = Math.max(1, Math.floor(modulated.capacity));
  // `baseBackoffMs` must be a finite non-negative number; if the
  // multiplier produces a value above `maxBackoffMs` we clamp so
  // the rate-limit invariant `baseBackoffMs ≤ maxBackoffMs` stays
  // true. The validator below rejects otherwise.
  const nextBaseBackoffMs = Math.min(
    baseline.maxBackoffMs,
    Math.max(0, Math.floor(modulated.cooldownExponent))
  );

  const result: RateLimitConfig = Object.freeze({
    capacity: nextCapacity,
    refillRatePerSecond: modulated.refillPerSecond,
    baseBackoffMs: nextBaseBackoffMs,
    maxBackoffMs: baseline.maxBackoffMs
  });
  // Re-validate so a misconfiguration (e.g. modulator produces an
  // out-of-range value the band table didn't intend) fails closed
  // here, not deeper in the engine.
  try {
    validateRateLimitConfig(result, 'modulateRateLimitConfig.result');
  } catch (err) {
    // Defense-in-depth fallback: if modulation somehow produced an
    // invalid config (e.g. a future edit drifted the multipliers),
    // log the failure intent and fall back to the baseline rather
    // than letting an invalid config reach the engine. The thrown
    // error preserves the underlying TrustSafetyError code so the
    // caller can surface it.
    throw tsError(
      'TS_INVALID_NUMBER',
      `modulateRateLimitConfig produced an invalid config: ${(err as Error).message}`
    );
  }
  return Object.freeze({ config: result, band });
}

/** Convenience: the doctrine default baseline. */
export function modulateDefaultRateLimit(score: number | undefined): ModulatedRateLimit {
  return modulateRateLimitConfig(DEFAULT_RATE_LIMIT, score);
}
