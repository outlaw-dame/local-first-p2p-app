import { describe, expect, it } from 'vitest';
import { createPwaSendBudget, formatPwaSendBudgetDecision } from './pwa-send-budget.js';

describe('PwaSendBudget', () => {
  it('accepts reservations inside the configured window', () => {
    const budget = createPwaSendBudget({ windowMs: 10_000, maxRuns: 2, maxEntries: 3, minIntervalMs: 0 });

    const first = budget.reserve({ now: new Date('2026-05-26T00:00:00.000Z'), entries: 1 });
    const second = budget.reserve({ now: new Date('2026-05-26T00:00:01.000Z'), entries: 2 });

    expect(first).toEqual({ status: 'accepted', remainingRuns: 1, remainingEntries: 2 });
    expect(second).toEqual({ status: 'accepted', remainingRuns: 0, remainingEntries: 0 });
    expect(budget.snapshot(new Date('2026-05-26T00:00:02.000Z'))).toMatchObject({ runs: 2, entries: 3 });
  });

  it('returns a retry delay for minimum interval and window exhaustion', () => {
    const intervalBudget = createPwaSendBudget({ windowMs: 10_000, maxRuns: 3, maxEntries: 3, minIntervalMs: 1_000 });
    const runBudget = createPwaSendBudget({ windowMs: 10_000, maxRuns: 1, maxEntries: 10, minIntervalMs: 0 });

    expect(intervalBudget.reserve({ now: new Date('2026-05-26T00:00:00.000Z'), entries: 1 }).status).toBe('accepted');
    const intervalDecision = intervalBudget.reserve({ now: new Date('2026-05-26T00:00:00.250Z'), entries: 1 });
    expect(intervalDecision).toEqual({
      status: 'deferred',
      reason: 'minimum-interval',
      retryAfterMs: 750,
      message: 'Send budget minimum interval is active.'
    });
    expect(formatPwaSendBudgetDecision(intervalDecision)).toBe('Send budget minimum interval is active. Retry after 750ms.');

    expect(runBudget.reserve({ now: new Date('2026-05-26T00:00:00.000Z'), entries: 1 }).status).toBe('accepted');
    expect(runBudget.reserve({ now: new Date('2026-05-26T00:00:01.000Z'), entries: 1 })).toMatchObject({
      status: 'deferred',
      reason: 'window-limit',
      retryAfterMs: 9_000
    });
  });

  it('resets after the configured window and after clock rollback', () => {
    const budget = createPwaSendBudget({ windowMs: 1_000, maxRuns: 1, maxEntries: 1, minIntervalMs: 0 });

    expect(budget.reserve({ now: new Date('2026-05-26T00:00:01.000Z'), entries: 1 }).status).toBe('accepted');
    expect(budget.reserve({ now: new Date('2026-05-26T00:00:02.000Z'), entries: 1 }).status).toBe('accepted');
    expect(budget.reserve({ now: new Date('2026-05-25T23:59:59.000Z'), entries: 1 }).status).toBe('accepted');
    expect(budget.snapshot(new Date('2026-05-25T23:59:59.000Z'))).toMatchObject({ runs: 1, entries: 1 });
  });

  it('rejects invalid configuration and reservation inputs', () => {
    expect(() => createPwaSendBudget({ windowMs: 0 })).toThrow('send budget windowMs must be a positive safe integer.');
    expect(() => createPwaSendBudget({ minIntervalMs: -1 })).toThrow('send budget minIntervalMs must be a non-negative safe integer.');
    const budget = createPwaSendBudget({ maxEntries: 2 });
    expect(() => budget.reserve({ now: new Date('invalid'), entries: 1 })).toThrow('send budget now must be a valid Date.');
    expect(() => budget.reserve({ now: new Date('2026-05-26T00:00:00.000Z'), entries: 0 })).toThrow(
      'send budget entries must be a positive safe integer.'
    );
    expect(() => budget.reserve({ now: new Date('2026-05-26T00:00:00.000Z'), entries: 3 })).toThrow(
      'send budget entries must not exceed the configured maxEntries value of 2.'
    );
  });

  it('supports refunding unused reservations safely', () => {
    const budget = createPwaSendBudget({ windowMs: 10_000, maxRuns: 2, maxEntries: 4, minIntervalMs: 0 });

    expect(budget.reserve({ now: new Date('2026-05-26T00:00:00.000Z'), entries: 3 }).status).toBe('accepted');
    budget.refund({ entries: 2 });
    expect(budget.snapshot(new Date('2026-05-26T00:00:00.500Z'))).toMatchObject({ runs: 1, entries: 1 });

    budget.refund({ runs: 1, entries: 1 });
    expect(budget.snapshot(new Date('2026-05-26T00:00:01.000Z'))).toMatchObject({ runs: 0, entries: 0 });

    expect(() => budget.refund({ runs: 1 })).toThrow('send budget refund.runs exceeds current reserved runs.');
    expect(() => budget.refund({ entries: 1 })).toThrow('send budget refund.entries exceeds current reserved entries.');
  });
});
