import { describe, expect, it } from 'vitest';
import { computeBackoffDelayMs, type RetryPolicyInput } from './index.js';
import { requireJitterRatio, requireOptionalJitterRatio, resolveJitterRatio } from './retry-policy.js';

const INVALID_JITTER_RATIOS = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.1, 1.1] as const;

describe('retry policy jitter validation', () => {
  it('rejects non-finite and out-of-range jitter ratios before computing backoff', () => {
    for (const jitterRatio of INVALID_JITTER_RATIOS) {
      expect(() => computeBackoffDelayMs({ attempt: 1, jitterRatio })).toThrow('jitterRatio must be between 0 and 1');
    }
  });

  it('treats nullish optional jitter ratios consistently for unsafe runtime callers', () => {
    const nullJitterInput = { attempt: 1, jitterRatio: null } as unknown as RetryPolicyInput;

    expect(requireOptionalJitterRatio(undefined)).toBeUndefined();
    expect(requireOptionalJitterRatio(null)).toBeUndefined();
    expect(resolveJitterRatio(undefined)).toBe(0.35);
    expect(resolveJitterRatio(null)).toBe(0.35);
    expect(computeBackoffDelayMs({ attempt: 1, jitterRatio: undefined, random: () => 0.5 })).toBe(1_000);
    expect(computeBackoffDelayMs({ ...nullJitterInput, random: () => 0.5 })).toBe(1_000);
  });

  it('centralizes required, optional, and default jitter validation', () => {
    expect(requireJitterRatio(0)).toBe(0);
    expect(requireJitterRatio(1)).toBe(1);
    expect(requireOptionalJitterRatio(0.5)).toBe(0.5);
    expect(resolveJitterRatio(0.2)).toBe(0.2);

    for (const jitterRatio of INVALID_JITTER_RATIOS) {
      expect(() => requireJitterRatio(jitterRatio)).toThrow('jitterRatio must be between 0 and 1');
      expect(() => requireOptionalJitterRatio(jitterRatio)).toThrow('jitterRatio must be between 0 and 1');
      expect(() => resolveJitterRatio(jitterRatio)).toThrow('jitterRatio must be between 0 and 1');
    }
  });
});
