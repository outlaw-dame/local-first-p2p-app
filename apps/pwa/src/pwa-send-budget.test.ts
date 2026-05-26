import { describe, expect, it } from 'vitest';
import { createPwaSendBudget } from './pwa-send-budget.js';

describe('PwaSendBudget', () => {
  it('accepts a simple reservation', () => {
    const budget = createPwaSendBudget({ minIntervalMs: 0 });
    expect(budget.reserve({ now: new Date('2026-05-26T00:00:00.000Z'), entries: 1 }).status).toBe('accepted');
  });
});
