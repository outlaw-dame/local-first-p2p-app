import { describe, expect, it } from 'vitest';
import type { RateLimitConfig } from '../index.js';
import { createRateLimitBucket, tryConsume, validateRateLimitConfig } from '../index.js';

const TIGHT_CONFIG: RateLimitConfig = Object.freeze({
  capacity: 3,
  refillRatePerSecond: 1,
  baseBackoffMs: 1_000,
  maxBackoffMs: 60_000
});

describe('rate limiter — token bucket', () => {
  it('admits up to capacity in a burst', () => {
    let bucket = createRateLimitBucket(0, TIGHT_CONFIG);
    for (let i = 0; i < 3; i += 1) {
      const r = tryConsume(bucket, 0, TIGHT_CONFIG);
      expect(r.allowed).toBe(true);
      bucket = r.bucket;
    }
    const denied = tryConsume(bucket, 0, TIGHT_CONFIG);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('no-tokens');
  });

  it('refills tokens deterministically by elapsed time (floor)', () => {
    let bucket = createRateLimitBucket(0, TIGHT_CONFIG);
    // Drain.
    for (let i = 0; i < 3; i += 1) bucket = tryConsume(bucket, 0, TIGHT_CONFIG).bucket;
    // 500ms elapsed -> 0 whole tokens.
    expect(tryConsume(bucket, 500, TIGHT_CONFIG).allowed).toBe(false);
    // 1000ms elapsed -> exactly 1 token.
    const allowed = tryConsume(bucket, 1000, TIGHT_CONFIG);
    expect(allowed.allowed).toBe(true);
  });

  it('never exceeds capacity even after long idle', () => {
    const bucket = createRateLimitBucket(0, TIGHT_CONFIG);
    const after = tryConsume(bucket, 365 * 24 * 60 * 60 * 1000, TIGHT_CONFIG);
    expect(after.bucket.tokens).toBeLessThanOrEqual(TIGHT_CONFIG.capacity);
  });
});

describe('rate limiter — exponential backoff', () => {
  it('first refusal sets cooldown = baseBackoffMs', () => {
    let bucket = createRateLimitBucket(0, TIGHT_CONFIG);
    for (let i = 0; i < 3; i += 1) bucket = tryConsume(bucket, 0, TIGHT_CONFIG).bucket;
    const first = tryConsume(bucket, 0, TIGHT_CONFIG);
    expect(first.allowed).toBe(false);
    expect(first.bucket.cooldownUntil).toBe(TIGHT_CONFIG.baseBackoffMs);
    expect(first.retryAfter).toBe(TIGHT_CONFIG.baseBackoffMs);
  });

  it('repeated refusals double the cooldown (exponential backoff)', () => {
    // Use a config whose refill rate is too slow to grant any tokens
    // between cooldown windows, so successive calls keep escalating.
    const slow: RateLimitConfig = Object.freeze({
      capacity: 3,
      refillRatePerSecond: 0.001, // one token per ~16 minutes
      baseBackoffMs: 1_000,
      maxBackoffMs: 60_000
    });
    let bucket = createRateLimitBucket(0, slow);
    for (let i = 0; i < 3; i += 1) bucket = tryConsume(bucket, 0, slow).bucket;
    const observed: number[] = [];
    let now = 0;
    for (let i = 0; i < 4; i += 1) {
      const r = tryConsume(bucket, now, slow);
      expect(r.allowed).toBe(false);
      observed.push(r.bucket.cooldownUntil - now);
      bucket = r.bucket;
      // Move just past the cooldown to retry.
      now = bucket.cooldownUntil + 1;
    }
    expect(observed[0]!).toBe(slow.baseBackoffMs);
    expect(observed[1]!).toBe(slow.baseBackoffMs * 2);
    expect(observed[2]!).toBe(slow.baseBackoffMs * 4);
    expect(observed[3]!).toBe(slow.baseBackoffMs * 8);
  });

  it('backoff caps at maxBackoffMs', () => {
    const slow: RateLimitConfig = Object.freeze({
      capacity: 1,
      refillRatePerSecond: 0.0001,
      baseBackoffMs: 1_000,
      maxBackoffMs: 8_000
    });
    let bucket = createRateLimitBucket(0, slow);
    bucket = tryConsume(bucket, 0, slow).bucket; // drain
    let now = 0;
    let lastWindow = 0;
    for (let i = 0; i < 30; i += 1) {
      const r = tryConsume(bucket, now, slow);
      lastWindow = r.bucket.cooldownUntil - now;
      bucket = r.bucket;
      now = bucket.cooldownUntil + 1;
    }
    expect(lastWindow).toBeLessThanOrEqual(slow.maxBackoffMs);
    expect(lastWindow).toBe(slow.maxBackoffMs);
  });

  it('refuses during cooldown without altering it', () => {
    let bucket = createRateLimitBucket(0, TIGHT_CONFIG);
    for (let i = 0; i < 3; i += 1) bucket = tryConsume(bucket, 0, TIGHT_CONFIG).bucket;
    bucket = tryConsume(bucket, 0, TIGHT_CONFIG).bucket;
    const cooldownAt = bucket.cooldownUntil;
    const inCooldown = tryConsume(bucket, cooldownAt - 1, TIGHT_CONFIG);
    expect(inCooldown.allowed).toBe(false);
    expect(inCooldown.reason).toBe('in-cooldown');
    expect(inCooldown.bucket.cooldownUntil).toBe(cooldownAt);
  });

  it('self-heals: a successful admit resets consecutiveRefusals', () => {
    let bucket = createRateLimitBucket(0, TIGHT_CONFIG);
    for (let i = 0; i < 3; i += 1) bucket = tryConsume(bucket, 0, TIGHT_CONFIG).bucket;
    bucket = tryConsume(bucket, 0, TIGHT_CONFIG).bucket;
    expect(bucket.consecutiveRefusals).toBe(1);
    // Skip past cooldown + enough time to refill 1 token.
    const after = tryConsume(bucket, bucket.cooldownUntil + 1_000, TIGHT_CONFIG);
    expect(after.allowed).toBe(true);
    expect(after.bucket.consecutiveRefusals).toBe(0);
    expect(after.bucket.cooldownUntil).toBe(0);
  });
});

describe('rate limiter — config validation', () => {
  it('rejects malformed config', () => {
    expect(() =>
      validateRateLimitConfig({
        capacity: 0,
        refillRatePerSecond: 1,
        baseBackoffMs: 0,
        maxBackoffMs: 0
      })
    ).toThrow();
    expect(() =>
      validateRateLimitConfig({
        capacity: 1,
        refillRatePerSecond: 1,
        baseBackoffMs: 10_000,
        maxBackoffMs: 5_000
      })
    ).toThrow();
  });
});
