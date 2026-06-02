import { describe, expect, it } from 'vitest';
import type { ReputationConfig } from '../index.js';
import {
  applyReputationDelta,
  createReputation,
  decayReputation,
  isQuarantined,
  validateReputationConfig
} from '../index.js';

const FAST_DECAY: ReputationConfig = Object.freeze({
  minScore: -1_000,
  maxScore: 1_000,
  decayPerSecond: 1, // 1 unit/sec for fast tests
  quarantineThreshold: -100,
  recoveryThreshold: -50,
  maxQuarantineMs: 10_000
});

describe('peer reputation — decay', () => {
  it('decays a negative score toward 0', () => {
    let rep = createReputation(0);
    rep = applyReputationDelta(rep, -100, 0, 'penalty', FAST_DECAY);
    const decayed = decayReputation(rep, 50_000, FAST_DECAY);
    expect(decayed.score).toBeGreaterThan(rep.score);
    expect(decayed.score).toBeLessThanOrEqual(0);
  });

  it('decay never crosses zero', () => {
    let rep = createReputation(0);
    rep = applyReputationDelta(rep, -10, 0, 'penalty', FAST_DECAY);
    const decayed = decayReputation(rep, 1_000_000, FAST_DECAY);
    expect(decayed.score).toBe(0);
  });

  it('a positive score also decays toward 0 (never to negative)', () => {
    let rep = createReputation(0);
    rep = applyReputationDelta(rep, 100, 0, 'credit', FAST_DECAY);
    const decayed = decayReputation(rep, 1_000_000, FAST_DECAY);
    expect(decayed.score).toBe(0);
  });

  it('score is clamped within [minScore, maxScore]', () => {
    let rep = createReputation(0);
    rep = applyReputationDelta(rep, -10_000, 0, 'huge-penalty', FAST_DECAY);
    expect(rep.score).toBe(FAST_DECAY.minScore);
    rep = applyReputationDelta(rep, 100_000, 1, 'huge-credit', FAST_DECAY);
    expect(rep.score).toBe(FAST_DECAY.maxScore);
  });
});

describe('peer reputation — quarantine transitions', () => {
  it('auto-quarantines when score drops below threshold', () => {
    let rep = createReputation(0);
    rep = applyReputationDelta(rep, -150, 0, 'attack', FAST_DECAY);
    expect(rep.quarantineUntil).toBeDefined();
    expect(isQuarantined(rep, 0)).toBe(true);
  });

  it('does not quarantine when score is just below recoveryThreshold but above quarantineThreshold', () => {
    let rep = createReputation(0);
    rep = applyReputationDelta(rep, -75, 0, 'mild', FAST_DECAY);
    expect(rep.quarantineUntil).toBeUndefined();
    expect(isQuarantined(rep, 0)).toBe(false);
  });

  it('auto-lifts quarantine when score recovers above recoveryThreshold (hysteresis)', () => {
    let rep = createReputation(0);
    rep = applyReputationDelta(rep, -150, 0, 'attack', FAST_DECAY);
    expect(rep.quarantineUntil).toBeDefined();
    rep = applyReputationDelta(rep, 110, 1, 'credit', FAST_DECAY);
    expect(rep.quarantineUntil).toBeUndefined();
  });

  it('keeps quarantine when score is between quarantineThreshold and recoveryThreshold', () => {
    let rep = createReputation(0);
    rep = applyReputationDelta(rep, -150, 0, 'attack', FAST_DECAY);
    // Climb back to -75 (between -100 and -50)
    rep = applyReputationDelta(rep, 75, 1, 'partial-credit', FAST_DECAY);
    expect(rep.quarantineUntil).toBeDefined();
    expect(isQuarantined(rep, 1)).toBe(true);
  });

  it('quarantine auto-lifts after maxQuarantineMs regardless of score', () => {
    let rep = createReputation(0);
    rep = applyReputationDelta(rep, -150, 0, 'attack', FAST_DECAY);
    expect(rep.quarantineUntil).toBeDefined();
    const lifted = applyReputationDelta(
      rep,
      0,
      FAST_DECAY.maxQuarantineMs + 1,
      'tick',
      FAST_DECAY
    );
    expect(lifted.quarantineUntil).toBeUndefined();
  });
});

describe('peer reputation — adversarial', () => {
  it('rejects NaN / Infinity deltas', () => {
    const rep = createReputation(0);
    expect(() => applyReputationDelta(rep, Number.NaN, 0, 'bad', FAST_DECAY)).toThrow();
    expect(() => applyReputationDelta(rep, Infinity, 0, 'bad', FAST_DECAY)).toThrow();
  });

  it('config validation rejects inverted bounds and missing hysteresis gap', () => {
    expect(() =>
      validateReputationConfig({
        minScore: 100,
        maxScore: -100,
        decayPerSecond: 1,
        quarantineThreshold: -50,
        recoveryThreshold: -25,
        maxQuarantineMs: 1000
      })
    ).toThrow();
    expect(() =>
      validateReputationConfig({
        ...FAST_DECAY,
        recoveryThreshold: FAST_DECAY.quarantineThreshold
      })
    ).toThrow();
  });
});
