/**
 * Phase 1.8.3 tests for `surface-integration.ts` — admission band
 * table + curation downrank input.
 *
 * The integration is intentionally narrow (multipliers, not new
 * engine math); the tests pin band boundaries, monotonicity, frozen
 * outputs, and fail-closed handling of bad inputs.
 */
import { describe, expect, it } from 'vitest';
import {
  ADMISSION_BAND_TABLE,
  applyAdmissionBand,
  CURATION_FLOOR,
  computeReputation,
  getAdmissionBandMultipliers,
  getCurationDownrankFactor,
  getReputationBand,
  getScore,
  REPUTATION_BAND_THRESHOLDS,
  REPUTATION_BANDS,
  TrustSafetyError,
  type LocalReputationScore,
  type ReputationBand
} from '../index.js';

describe('getReputationBand', () => {
  it('produces a band per score range matching the doctrine table', () => {
    const cases: Array<readonly [number, ReputationBand]> = [
      [0.99, 'high'],
      [0.5, 'high'],
      [0.49, 'mid'],
      [0.1, 'mid'],
      [0.099, 'low'],
      [0.01, 'low'],
      [0.0099, 'untrusted'],
      [0, 'untrusted']
    ];
    for (const [score, expected] of cases) {
      expect(getReputationBand(score)).toBe(expected);
    }
  });

  it('clamps scores above 1 into the high band', () => {
    expect(getReputationBand(1.0)).toBe('high');
    expect(getReputationBand(99)).toBe('high');
  });

  it('NaN / Infinity / negative collapse to untrusted (fail closed)', () => {
    expect(getReputationBand(NaN)).toBe('untrusted');
    expect(getReputationBand(Infinity)).toBe('untrusted');
    expect(getReputationBand(-Infinity)).toBe('untrusted');
    expect(getReputationBand(-0.5)).toBe('untrusted');
  });

  it('undefined input collapses to untrusted', () => {
    expect(getReputationBand(undefined)).toBe('untrusted');
  });

  it('REPUTATION_BANDS tuple is frozen', () => {
    expect(Object.isFrozen(REPUTATION_BANDS)).toBe(true);
    expect(Object.isFrozen(REPUTATION_BAND_THRESHOLDS)).toBe(true);
  });
});

describe('getAdmissionBandMultipliers', () => {
  it('multipliers match the doctrine table verbatim', () => {
    expect(getAdmissionBandMultipliers(0.9)).toMatchObject({
      band: 'high',
      capacityMultiplier: 2,
      refillMultiplier: 2,
      cooldownExponentMultiplier: 0.5
    });
    expect(getAdmissionBandMultipliers(0.3)).toMatchObject({
      band: 'mid',
      capacityMultiplier: 1,
      refillMultiplier: 1,
      cooldownExponentMultiplier: 1
    });
    expect(getAdmissionBandMultipliers(0.05)).toMatchObject({
      band: 'low',
      capacityMultiplier: 0.5,
      refillMultiplier: 0.5,
      cooldownExponentMultiplier: 1.5
    });
    expect(getAdmissionBandMultipliers(0)).toMatchObject({
      band: 'untrusted',
      capacityMultiplier: 0.25,
      refillMultiplier: 0.25,
      cooldownExponentMultiplier: 2
    });
  });

  it('ADMISSION_BAND_TABLE entries are frozen at module load', () => {
    expect(Object.isFrozen(ADMISSION_BAND_TABLE)).toBe(true);
    for (const band of REPUTATION_BANDS) {
      expect(Object.isFrozen(ADMISSION_BAND_TABLE[band])).toBe(true);
    }
  });
});

describe('applyAdmissionBand', () => {
  const baseline = Object.freeze({
    capacity: 100,
    refillPerSecond: 10,
    cooldownExponent: 1.5
  });

  it('multipliers compose into the baseline correctly', () => {
    const out = applyAdmissionBand(baseline, 0.9);
    expect(out.band).toBe('high');
    expect(out.capacity).toBe(200);
    expect(out.refillPerSecond).toBe(20);
    expect(out.cooldownExponent).toBe(0.75);
    expect(Object.isFrozen(out)).toBe(true);
  });

  it('untrusted score downscales every parameter', () => {
    const out = applyAdmissionBand(baseline, 0);
    expect(out.band).toBe('untrusted');
    expect(out.capacity).toBe(25);
    expect(out.refillPerSecond).toBe(2.5);
    expect(out.cooldownExponent).toBe(3);
  });

  it('unknown score collapses to untrusted', () => {
    const out = applyAdmissionBand(baseline, undefined);
    expect(out.band).toBe('untrusted');
  });

  it('throws TS_INVALID_NUMBER on a bad baseline (programming bug; fail-closed)', () => {
    expect(() => applyAdmissionBand({ ...baseline, capacity: -1 }, 0.5)).toThrow(
      TrustSafetyError
    );
    expect(() => applyAdmissionBand({ ...baseline, capacity: NaN }, 0.5)).toThrow(
      TrustSafetyError
    );
    expect(() => applyAdmissionBand({ ...baseline, refillPerSecond: 0 }, 0.5)).toThrow(
      TrustSafetyError
    );
  });
});

describe('getCurationDownrankFactor — monotonic + floor', () => {
  it('factor is monotonically non-decreasing in score', () => {
    const samples = [0, 0.01, 0.1, 0.2, 0.5, 0.75, 1.0];
    let prev = -1;
    for (const s of samples) {
      const f = getCurationDownrankFactor(s);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it('factor at score=0 is exactly CURATION_FLOOR', () => {
    expect(getCurationDownrankFactor(0)).toBe(CURATION_FLOOR);
  });

  it('factor at score=1 is exactly 1.0', () => {
    expect(getCurationDownrankFactor(1)).toBe(1);
  });

  it('factor for NaN / Infinity / negative is CURATION_FLOOR (fail closed without zeroing)', () => {
    expect(getCurationDownrankFactor(NaN)).toBe(CURATION_FLOOR);
    expect(getCurationDownrankFactor(Infinity)).toBe(CURATION_FLOOR);
    expect(getCurationDownrankFactor(-1)).toBe(CURATION_FLOOR);
    expect(getCurationDownrankFactor(undefined)).toBe(CURATION_FLOOR);
  });

  it('doctrine non-negotiable #7 — factor NEVER reaches 0 (no silent deletion)', () => {
    // Sweep many scores; assert every output is strictly positive.
    const sweep = Array.from({ length: 101 }, (_, i) => i / 100);
    for (const s of sweep) {
      expect(getCurationDownrankFactor(s)).toBeGreaterThan(0);
    }
    // Even adversarial inputs:
    expect(getCurationDownrankFactor(-99)).toBeGreaterThan(0);
    expect(getCurationDownrankFactor(NaN)).toBeGreaterThan(0);
  });
});

describe('getScore — convenience helper', () => {
  it('returns the score when present', () => {
    const score: LocalReputationScore = Object.freeze({
      score: 0.42,
      confidence: 0.9,
      seedDistance: 1
    });
    const state = {
      scores: new Map<string, LocalReputationScore>([['actor:alice', score]])
    };
    expect(getScore(state, 'actor:alice')).toBe(0.42);
  });

  it('returns undefined when the key is absent', () => {
    const state = { scores: new Map<string, LocalReputationScore>() };
    expect(getScore(state, 'actor:nobody')).toBeUndefined();
  });
});

describe('end-to-end — band assignment composes with computeReputation', () => {
  it('a seed contact lands in the high band; the rest scale down', () => {
    const state = computeReputation({
      observations: [
        // alice (seed) → bob → carol → dave (a chain that decays score with distance)
        { observer: 'actor:alice', subject: 'actor:bob', observationKind: 'outbox.useful', satCount: 5, unsatCount: 0, windowStart: '2026-05-25T00:00:00Z', windowEnd: '2026-06-01T00:00:00Z', createdAt: '2026-06-01T00:00:00Z' },
        { observer: 'actor:bob', subject: 'actor:carol', observationKind: 'outbox.useful', satCount: 5, unsatCount: 0, windowStart: '2026-05-25T00:00:00Z', windowEnd: '2026-06-01T00:00:00Z', createdAt: '2026-06-01T00:00:00Z' }
      ],
      attestations: [],
      revocations: [],
      seedContacts: [{ subject: 'actor:alice', strength: 1.0, attestedAt: '2026-06-01T00:00:00Z' }],
      nowIso: '2026-06-01T12:00:00Z'
    });
    const aliceScore = getScore(state, 'actor:alice');
    const bobScore = getScore(state, 'actor:bob');
    const carolScore = getScore(state, 'actor:carol');
    expect(aliceScore).toBeDefined();
    // Bands are monotonic with score by construction.
    const orderRank: Record<ReputationBand, number> = { high: 3, mid: 2, low: 1, untrusted: 0 };
    expect(orderRank[getReputationBand(aliceScore)]).toBeGreaterThanOrEqual(
      orderRank[getReputationBand(bobScore)]
    );
    expect(orderRank[getReputationBand(bobScore)]).toBeGreaterThanOrEqual(
      orderRank[getReputationBand(carolScore)]
    );
  });
});
