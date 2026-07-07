/**
 * Phase 1.8.7 — adversarial tests for the reputation settings
 * view-model. Pins:
 *   - spam-gate slider clamping + warning emission,
 *   - device-local privacy notice frozen content,
 *   - aggregator-subscription doctrine non-negotiable (local
 *     always owns priority 0; reserved sentinel cannot be subscribed),
 *   - duplicate-labeler dedup,
 *   - input validation against the doctrine ranges.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPAM_GATE_CONFIG,
  LOCAL_REPUTATION_SOURCE,
  REPUTATION_LIMITS
} from '@lfp2p/trust-safety';
import {
  ATTESTATION_FORM_DEFAULTS,
  buildAggregatorSubscriptionList,
  clampSpamGateInput,
  DEVICE_LOCAL_PRIVACY_NOTICE,
  OBSERVATION_FORM_DEFAULTS,
  REMOVAL_FORM_DEFAULTS,
  type AggregatorSubscriptionInput
} from './pwa-reputation-state.js';

/* -------------------------------------------------------------------------- */
/*                              spam-gate                                     */
/* -------------------------------------------------------------------------- */

describe('clampSpamGateInput — defaults pass through unchanged', () => {
  it('returns the doctrine default config with no warnings on default input', () => {
    const out = clampSpamGateInput({
      spamScoreThreshold: DEFAULT_SPAM_GATE_CONFIG.spamScoreThreshold,
      spamSeedDistanceMax: DEFAULT_SPAM_GATE_CONFIG.spamSeedDistanceMax
    });
    expect(out.config).toEqual(DEFAULT_SPAM_GATE_CONFIG);
    expect(out.warnings).toEqual([]);
    expect(Object.isFrozen(out.warnings)).toBe(true);
  });
});

describe('clampSpamGateInput — clamping discipline', () => {
  it('clamps threshold > 1 down to 1 with a warning', () => {
    const out = clampSpamGateInput({ spamScoreThreshold: 2, spamSeedDistanceMax: 3 });
    expect(out.config.spamScoreThreshold).toBe(1);
    expect(out.warnings.some((w) => w.includes('clamped'))).toBe(true);
  });

  it('resets NaN threshold to default with a warning', () => {
    const out = clampSpamGateInput({ spamScoreThreshold: NaN, spamSeedDistanceMax: 3 });
    expect(out.config.spamScoreThreshold).toBe(DEFAULT_SPAM_GATE_CONFIG.spamScoreThreshold);
    expect(out.warnings.some((w) => w.includes('reset to default'))).toBe(true);
  });

  it('warns when threshold > 0.5 (permissive)', () => {
    const out = clampSpamGateInput({ spamScoreThreshold: 0.6, spamSeedDistanceMax: 3 });
    expect(out.config.spamScoreThreshold).toBe(0.6);
    expect(out.warnings.some((w) => w.includes('above 0.5'))).toBe(true);
  });

  it('clamps distance > 10 down with a warning', () => {
    const out = clampSpamGateInput({
      spamScoreThreshold: 0.05,
      spamSeedDistanceMax: 99
    });
    expect(out.config.spamSeedDistanceMax).toBe(10);
    expect(out.warnings.some((w) => w.includes('above 10'))).toBe(true);
  });

  it('resets non-integer distance to default with a warning', () => {
    const out = clampSpamGateInput({
      spamScoreThreshold: 0.05,
      spamSeedDistanceMax: 1.5
    });
    expect(out.config.spamSeedDistanceMax).toBe(DEFAULT_SPAM_GATE_CONFIG.spamSeedDistanceMax);
    expect(out.warnings.some((w) => w.includes('reset to default'))).toBe(true);
  });

  it('rejects negative threshold with a warning', () => {
    const out = clampSpamGateInput({
      spamScoreThreshold: -0.1,
      spamSeedDistanceMax: 3
    });
    expect(out.config.spamScoreThreshold).toBe(DEFAULT_SPAM_GATE_CONFIG.spamScoreThreshold);
    expect(out.warnings.some((w) => w.includes('reset to default'))).toBe(true);
  });

  it('config output is frozen', () => {
    const out = clampSpamGateInput({
      spamScoreThreshold: 0.1,
      spamSeedDistanceMax: 3
    });
    expect(Object.isFrozen(out.config)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*                          privacy notice                                    */
/* -------------------------------------------------------------------------- */

describe('DEVICE_LOCAL_PRIVACY_NOTICE — frozen content the UI MUST surface', () => {
  it('is frozen at module load', () => {
    expect(Object.isFrozen(DEVICE_LOCAL_PRIVACY_NOTICE)).toBe(true);
  });

  it('explicitly mentions "device" and "not shared"', () => {
    expect(DEVICE_LOCAL_PRIVACY_NOTICE.title.toLowerCase()).toContain('device');
    expect(DEVICE_LOCAL_PRIVACY_NOTICE.body.toLowerCase()).toContain('not shared');
  });
});

/* -------------------------------------------------------------------------- */
/*                          form defaults                                     */
/* -------------------------------------------------------------------------- */

describe('form defaults — bounded enums frozen for UI binding', () => {
  it('OBSERVATION_FORM_DEFAULTS contains every observation kind', () => {
    expect(Object.isFrozen(OBSERVATION_FORM_DEFAULTS)).toBe(true);
    expect(OBSERVATION_FORM_DEFAULTS.kinds.length).toBeGreaterThan(0);
    expect(OBSERVATION_FORM_DEFAULTS.maxCount).toBe(REPUTATION_LIMITS.maxObservationCount);
  });

  it('ATTESTATION_FORM_DEFAULTS exposes both valences and tags frozen', () => {
    expect(Object.isFrozen(ATTESTATION_FORM_DEFAULTS)).toBe(true);
    expect(ATTESTATION_FORM_DEFAULTS.valences).toContain('positive');
    expect(ATTESTATION_FORM_DEFAULTS.contextTags).toContain('contact.verified-in-person');
  });

  it('REMOVAL_FORM_DEFAULTS exposes every removal reason', () => {
    expect(Object.isFrozen(REMOVAL_FORM_DEFAULTS)).toBe(true);
    expect(REMOVAL_FORM_DEFAULTS.reasons).toContain('revoked');
  });
});

/* -------------------------------------------------------------------------- */
/*                          subscription list                                 */
/* -------------------------------------------------------------------------- */

describe('buildAggregatorSubscriptionList — doctrine non-negotiables', () => {
  it('LOCAL ALWAYS WINS: reserved sentinel labeler id is rejected outright', () => {
    const out = buildAggregatorSubscriptionList([
      { labelerId: LOCAL_REPUTATION_SOURCE, priority: 1, algorithm: 'openrank.v1' }
    ]);
    expect(out.list).toEqual([]);
    expect(out.warnings.some((w) => w.includes('__local__'))).toBe(true);
  });

  it('bumps priority 0 to priority 1 with a warning', () => {
    const out = buildAggregatorSubscriptionList([
      { labelerId: 'openrank', priority: 0, algorithm: 'openrank.v1' }
    ]);
    expect(out.list[0]!.priority).toBe(1);
    expect(out.warnings.some((w) => w.includes('Priority 0'))).toBe(true);
  });

  it('rejects non-integer or negative priorities, falling back to 1', () => {
    const out = buildAggregatorSubscriptionList([
      { labelerId: 'a', priority: 1.5, algorithm: 'openrank.v1' },
      { labelerId: 'b', priority: -3, algorithm: 'openrank.v1' }
    ]);
    expect(out.list.find((s) => s.labelerId === 'a')!.priority).toBe(1);
    expect(out.list.find((s) => s.labelerId === 'b')!.priority).toBe(1);
    expect(out.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('drops subscriptions with empty labeler ids', () => {
    const out = buildAggregatorSubscriptionList([
      { labelerId: '', priority: 1, algorithm: 'openrank.v1' }
    ]);
    expect(out.list).toEqual([]);
    expect(out.warnings.some((w) => w.includes('empty labeler id'))).toBe(true);
  });

  it('drops subscriptions with unknown algorithms', () => {
    const out = buildAggregatorSubscriptionList([
      {
        labelerId: 'unknown-alg',
        priority: 1,
        algorithm: 'made-up.v9' as unknown as AggregatorSubscriptionInput['algorithm']
      }
    ]);
    expect(out.list).toEqual([]);
    expect(out.warnings.some((w) => w.includes('unknown algorithm'))).toBe(true);
  });

  it('dedups duplicate labelerIds keeping the highest-priority entry', () => {
    const out = buildAggregatorSubscriptionList([
      { labelerId: 'openrank', priority: 5, algorithm: 'openrank.v1' },
      { labelerId: 'openrank', priority: 2, algorithm: 'openrank.v1' },
      { labelerId: 'openrank', priority: 8, algorithm: 'openrank.v1' }
    ]);
    expect(out.list).toHaveLength(1);
    expect(out.list[0]!.priority).toBe(2);
    expect(out.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('output sorted ascending by priority, ties broken by labeler id', () => {
    const out = buildAggregatorSubscriptionList([
      { labelerId: 'zebra', priority: 2, algorithm: 'openrank.v1' },
      { labelerId: 'apple', priority: 2, algorithm: 'openrank.v1' },
      { labelerId: 'orange', priority: 1, algorithm: 'openrank.v1' }
    ]);
    expect(out.list.map((s) => s.labelerId)).toEqual(['orange', 'apple', 'zebra']);
  });

  it('output list + entries are frozen (Phase 3.2 frozen-walk)', () => {
    const out = buildAggregatorSubscriptionList([
      { labelerId: 'openrank', priority: 1, algorithm: 'openrank.v1' }
    ]);
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out.list)).toBe(true);
    expect(Object.isFrozen(out.warnings)).toBe(true);
    expect(Object.isFrozen(out.list[0])).toBe(true);
  });
});
