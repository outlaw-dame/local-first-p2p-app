/**
 * Pure-function token bucket rate limiter with exponential backoff on
 * repeated refusals. Every operation takes an explicit `now` (epoch ms)
 * so the algorithm is fully deterministic and replayable.
 *
 * Threat model:
 *  - An attacker SHOULD NOT be able to bypass the limit by sending many
 *    requests in a tiny time window. The bucket is bounded by `capacity`
 *    and refills only via elapsed time.
 *  - An attacker SHOULD NOT be able to recover from a refusal by spamming
 *    "just one more". `consecutiveRefusals` doubles the next cooldown,
 *    capped at `maxBackoffMs`. Each successful admit clears the counter
 *    (self-healing).
 *  - The implementation never uses floating-point comparisons for the
 *    pass/fail decision: the bucket is integer-valued.
 */

import { tsError } from '../errors.js';
import { assertFiniteNumberInRange, assertNonEmptyString } from '../validation.js';

export type RateLimitConfig = Readonly<{
  /** Maximum tokens the bucket can hold. */
  capacity: number;
  /** Tokens added per second of elapsed time. */
  refillRatePerSecond: number;
  /** Initial cooldown applied on the first refusal (epoch ms). */
  baseBackoffMs: number;
  /** Hard cap on the backoff window so the algorithm cannot stall forever. */
  maxBackoffMs: number;
}>;

export const DEFAULT_RATE_LIMIT: RateLimitConfig = Object.freeze({
  capacity: 60,
  refillRatePerSecond: 1,
  baseBackoffMs: 1_000,
  maxBackoffMs: 60 * 60 * 1_000
});

export type RateLimitBucket = Readonly<{
  /** Integer tokens currently in the bucket (0 .. capacity). */
  tokens: number;
  /** Epoch ms of the last refill. */
  lastRefillAt: number;
  /** Number of refusals since the last successful admit. */
  consecutiveRefusals: number;
  /** Epoch ms before which no further admit will be granted. */
  cooldownUntil: number;
}>;

export type RateLimitDecision = Readonly<{
  allowed: boolean;
  /** Bucket state after the operation. */
  bucket: RateLimitBucket;
  /**
   * Epoch ms before which the caller should not retry. Always set when
   * `allowed === false`. When `allowed === true`, equals 0.
   */
  retryAfter: number;
  /** Reason code surface — useful for audit logging. */
  reason: 'allowed' | 'no-tokens' | 'in-cooldown';
}>;

export function validateRateLimitConfig(config: RateLimitConfig, label = 'RateLimitConfig'): RateLimitConfig {
  assertFiniteNumberInRange(config.capacity, `${label}.capacity`, 1, 1_000_000);
  if (!Number.isSafeInteger(config.capacity)) {
    throw tsError('TS_INVALID_NUMBER', `${label}.capacity must be a safe integer`);
  }
  assertFiniteNumberInRange(
    config.refillRatePerSecond,
    `${label}.refillRatePerSecond`,
    1 / 86_400,
    100_000
  );
  assertFiniteNumberInRange(config.baseBackoffMs, `${label}.baseBackoffMs`, 0, 60 * 60 * 1_000);
  assertFiniteNumberInRange(
    config.maxBackoffMs,
    `${label}.maxBackoffMs`,
    config.baseBackoffMs,
    24 * 60 * 60 * 1_000
  );
  return config;
}

export function createRateLimitBucket(now: number, config: RateLimitConfig = DEFAULT_RATE_LIMIT): RateLimitBucket {
  validateRateLimitConfig(config);
  return Object.freeze({
    tokens: config.capacity,
    lastRefillAt: now,
    consecutiveRefusals: 0,
    cooldownUntil: 0
  });
}

/**
 * Refill the bucket based on elapsed time, mutating no state — returns
 * a new frozen bucket.
 */
function refill(bucket: RateLimitBucket, now: number, config: RateLimitConfig): RateLimitBucket {
  if (now <= bucket.lastRefillAt) return bucket;
  const elapsedSeconds = (now - bucket.lastRefillAt) / 1000;
  // Integer-floor the refill so an attacker cannot exploit
  // fractional-token rounding.
  const added = Math.floor(elapsedSeconds * config.refillRatePerSecond);
  if (added <= 0) return bucket;
  const newTokens = Math.min(config.capacity, bucket.tokens + added);
  // Advance lastRefillAt only by the exact whole-token portion to avoid
  // losing fractional progress permanently.
  const consumedMs = Math.floor((added / config.refillRatePerSecond) * 1000);
  return Object.freeze({
    ...bucket,
    tokens: newTokens,
    lastRefillAt: bucket.lastRefillAt + consumedMs
  });
}

function nextBackoffMs(consecutiveRefusals: number, config: RateLimitConfig): number {
  // 2^(n-1) growth, capped, with n starting at 1 for the first refusal.
  const exponent = Math.max(0, consecutiveRefusals - 1);
  // Compute as integer math; cap at maxBackoffMs.
  const unbounded = config.baseBackoffMs * Math.pow(2, exponent);
  if (!Number.isFinite(unbounded)) return config.maxBackoffMs;
  return Math.min(config.maxBackoffMs, Math.floor(unbounded));
}

/**
 * Attempt to consume one token. Returns the decision plus the next
 * bucket state. Pure; the caller is responsible for persisting the
 * returned bucket.
 *
 * Behavior:
 *  - If `now < bucket.cooldownUntil`, refusal with `in-cooldown`. The
 *    cooldown is preserved; `retryAfter === cooldownUntil`.
 *  - Otherwise refill, try to consume one token. On success, clear
 *    `consecutiveRefusals` to 0 (self-heal); cooldown stays cleared.
 *  - On failure, increment `consecutiveRefusals`, compute the next
 *    backoff window, set `cooldownUntil = now + nextBackoffMs`.
 */
export function tryConsume(
  bucket: RateLimitBucket,
  now: number,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT
): RateLimitDecision {
  if (now < bucket.cooldownUntil) {
    return Object.freeze({
      allowed: false,
      bucket,
      retryAfter: bucket.cooldownUntil,
      reason: 'in-cooldown'
    });
  }
  const refilled = refill(bucket, now, config);
  if (refilled.tokens >= 1) {
    const nextBucket: RateLimitBucket = Object.freeze({
      ...refilled,
      tokens: refilled.tokens - 1,
      consecutiveRefusals: 0,
      cooldownUntil: 0
    });
    return Object.freeze({
      allowed: true,
      bucket: nextBucket,
      retryAfter: 0,
      reason: 'allowed'
    });
  }
  const consecutiveRefusals = refilled.consecutiveRefusals + 1;
  const backoff = nextBackoffMs(consecutiveRefusals, config);
  const cooldownUntil = now + backoff;
  return Object.freeze({
    allowed: false,
    bucket: Object.freeze({
      ...refilled,
      consecutiveRefusals,
      cooldownUntil
    }),
    retryAfter: cooldownUntil,
    reason: 'no-tokens'
  });
}

/** Convenience: peer-id key normalization. */
export function assertPeerId(value: unknown, label = 'peerId'): string {
  return assertNonEmptyString(value, label);
}
