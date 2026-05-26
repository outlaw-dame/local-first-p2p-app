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
});
