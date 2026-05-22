import { describe, expect, it } from 'vitest';
import { computeBackoffDelayMs, StaleResponseGuard } from './index.js';

describe('sync retry and staleness helpers', () => {
  it('computes bounded exponential backoff with deterministic jitter', () => {
    expect(
      computeBackoffDelayMs({ attempt: 3, baseDelayMs: 100, maxDelayMs: 1_000, jitterRatio: 0.25, random: () => 0.5 })
    ).toBe(800);
    expect(
      computeBackoffDelayMs({ attempt: 10, baseDelayMs: 100, maxDelayMs: 1_000, jitterRatio: 0, random: () => 0 })
    ).toBe(1_000);
  });

  it('rejects stale response sequences', () => {
    const guard = new StaleResponseGuard();
    expect(guard.accept('feed:home', 10)).toBe(true);
    expect(guard.accept('feed:home', 9)).toBe(false);
    expect(guard.accept('feed:home', 11)).toBe(true);
  });
});
