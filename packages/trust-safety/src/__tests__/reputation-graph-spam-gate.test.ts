/**
 * Phase 1.8.3 — spam gate adversarial tests. Pin the three-condition
 * AND, fail-open on unknown input, frozen-output discipline, and the
 * doctrine non-negotiable #7 boundary.
 */
import { describe, expect, it } from 'vitest';
import {
  computeSpamGateDecision,
  DEFAULT_SPAM_GATE_CONFIG,
  resolveSpamGateConfig,
  SPAM_GATE_REASON_CODES,
  SPAM_GATE_VERSION,
  TrustSafetyError,
  type SpamGateInput
} from '../index.js';

const base: SpamGateInput = Object.freeze({
  score: 0.01,
  seedDistance: 5,
  hasPositiveAttestation: false
});

describe('computeSpamGateDecision — happy path', () => {
  it('flags when all three conditions hold (low score, far from seed, no positive attestation)', () => {
    const dec = computeSpamGateDecision(base);
    expect(dec.flagSpam).toBe(true);
    expect(dec.reasonCode).toBe('flagged');
    expect(dec.version).toBe(SPAM_GATE_VERSION);
  });

  it('flagged decision is frozen at every level', () => {
    const dec = computeSpamGateDecision(base);
    expect(Object.isFrozen(dec)).toBe(true);
    expect(Object.isFrozen(dec.bandSnapshot)).toBe(true);
  });

  it('every reason code is in the documented enum', () => {
    expect(Object.isFrozen(SPAM_GATE_REASON_CODES)).toBe(true);
    const inputs: SpamGateInput[] = [
      { score: 0.9, seedDistance: 5, hasPositiveAttestation: false }, // score-above-threshold
      { score: 0.01, seedDistance: 1, hasPositiveAttestation: false }, // within-seed-distance
      { score: 0.01, seedDistance: 5, hasPositiveAttestation: true }, // positive-attestation-present
      { score: 0.01, seedDistance: 5, hasPositiveAttestation: false }, // flagged
      // unknown-input — NaN score
      { score: NaN, seedDistance: 5, hasPositiveAttestation: false }
    ];
    for (const i of inputs) {
      const dec = computeSpamGateDecision(i);
      expect((SPAM_GATE_REASON_CODES as readonly string[]).includes(dec.reasonCode)).toBe(true);
    }
  });
});

describe('computeSpamGateDecision — each guard short-circuits separately', () => {
  it('high score skips the flag', () => {
    const dec = computeSpamGateDecision({ ...base, score: 0.9 });
    expect(dec.flagSpam).toBe(false);
    expect(dec.reasonCode).toBe('score-above-threshold');
    expect(dec.bandSnapshot.atOrAboveThreshold).toBe(true);
  });

  it('near seed skips the flag (even with very low score)', () => {
    const dec = computeSpamGateDecision({ ...base, seedDistance: 2 });
    expect(dec.flagSpam).toBe(false);
    expect(dec.reasonCode).toBe('within-seed-distance');
  });

  it('positive attestation present skips the flag', () => {
    const dec = computeSpamGateDecision({ ...base, hasPositiveAttestation: true });
    expect(dec.flagSpam).toBe(false);
    expect(dec.reasonCode).toBe('positive-attestation-present');
  });

  it('unreachable from seed (Infinity) satisfies the far-from-seed condition', () => {
    const dec = computeSpamGateDecision({ ...base, seedDistance: Number.POSITIVE_INFINITY });
    expect(dec.flagSpam).toBe(true);
  });
});

describe('computeSpamGateDecision — fail open on unknown input', () => {
  it('NaN score returns unknown-input (does NOT spuriously flag)', () => {
    const dec = computeSpamGateDecision({ ...base, score: NaN });
    expect(dec.flagSpam).toBe(false);
    expect(dec.reasonCode).toBe('unknown-input');
  });

  it('negative score returns unknown-input', () => {
    const dec = computeSpamGateDecision({ ...base, score: -0.1 });
    expect(dec.flagSpam).toBe(false);
    expect(dec.reasonCode).toBe('unknown-input');
  });

  it('non-numeric score returns unknown-input', () => {
    // @ts-expect-error: testing runtime guard
    const dec = computeSpamGateDecision({ ...base, score: 'oops' });
    expect(dec.flagSpam).toBe(false);
    expect(dec.reasonCode).toBe('unknown-input');
  });

  it('non-boolean hasPositiveAttestation returns unknown-input', () => {
    const dec = computeSpamGateDecision({
      ...base,
      // @ts-expect-error: testing runtime guard
      hasPositiveAttestation: 'yes'
    });
    expect(dec.flagSpam).toBe(false);
    expect(dec.reasonCode).toBe('unknown-input');
  });

  it('negative seedDistance returns unknown-input', () => {
    const dec = computeSpamGateDecision({ ...base, seedDistance: -1 });
    expect(dec.flagSpam).toBe(false);
    expect(dec.reasonCode).toBe('unknown-input');
  });
});

describe('resolveSpamGateConfig', () => {
  it('returns the documented defaults', () => {
    const c = resolveSpamGateConfig();
    expect(c).toEqual(DEFAULT_SPAM_GATE_CONFIG);
    expect(Object.isFrozen(c)).toBe(true);
  });

  it('accepts user overrides within ranges', () => {
    const c = resolveSpamGateConfig({ spamScoreThreshold: 0.5, spamSeedDistanceMax: 5 });
    expect(c.spamScoreThreshold).toBe(0.5);
    expect(c.spamSeedDistanceMax).toBe(5);
  });

  it('rejects out-of-range thresholds', () => {
    expect(() => resolveSpamGateConfig({ spamScoreThreshold: -0.1 })).toThrow(TrustSafetyError);
    expect(() => resolveSpamGateConfig({ spamScoreThreshold: 1.5 })).toThrow(TrustSafetyError);
    expect(() => resolveSpamGateConfig({ spamScoreThreshold: NaN })).toThrow(TrustSafetyError);
  });

  it('rejects non-integer / negative seed distance', () => {
    expect(() => resolveSpamGateConfig({ spamSeedDistanceMax: 1.5 })).toThrow(TrustSafetyError);
    expect(() => resolveSpamGateConfig({ spamSeedDistanceMax: -1 })).toThrow(TrustSafetyError);
    expect(() => resolveSpamGateConfig({ spamSeedDistanceMax: NaN })).toThrow(TrustSafetyError);
  });
});

describe('computeSpamGateDecision — user override discipline', () => {
  it('a stricter threshold can flag a previously-non-spam subject', () => {
    const input: SpamGateInput = { score: 0.3, seedDistance: 5, hasPositiveAttestation: false };
    expect(computeSpamGateDecision(input).flagSpam).toBe(false); // 0.3 > 0.05 default
    expect(
      computeSpamGateDecision(input, { spamScoreThreshold: 0.5 }).flagSpam
    ).toBe(true);
  });

  it('a stricter seed-distance can flag a previously-non-spam subject', () => {
    const input: SpamGateInput = { score: 0.01, seedDistance: 2, hasPositiveAttestation: false };
    expect(computeSpamGateDecision(input).flagSpam).toBe(false); // distance=2 ≤ 3 default
    expect(
      computeSpamGateDecision(input, { spamSeedDistanceMax: 1 }).flagSpam
    ).toBe(true);
  });
});
