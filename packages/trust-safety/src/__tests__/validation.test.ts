import { describe, expect, it } from 'vitest';
import {
  assertExactVersion,
  assertFiniteNumberInRange,
  assertId,
  assertIso8601,
  assertNonEmptyString,
  assertNotBefore,
  assertOneOf,
  assertPlainObject,
  assertReadonlyArray,
  assertText
} from '../index.js';

describe('assertPlainObject', () => {
  it('accepts plain objects and Object.create(null) objects', () => {
    expect(() => assertPlainObject({}, 'X')).not.toThrow();
    expect(() => assertPlainObject(Object.create(null), 'X')).not.toThrow();
  });
  it('rejects arrays, null, primitives, class instances', () => {
    expect(() => assertPlainObject([], 'X')).toThrow(/TS_INVALID_INPUT/);
    expect(() => assertPlainObject(null, 'X')).toThrow();
    expect(() => assertPlainObject(0, 'X')).toThrow();
    class Foo {}
    expect(() => assertPlainObject(new Foo(), 'X')).toThrow();
  });
});

describe('assertNonEmptyString / assertId', () => {
  it('rejects empty and non-string', () => {
    expect(() => assertNonEmptyString('', 'X')).toThrow();
    expect(() => assertNonEmptyString(undefined, 'X')).toThrow();
  });
  it('assertId rejects oversized inputs', () => {
    const big = 'a'.repeat(513);
    expect(() => assertId(big, 'X')).toThrow(/TS_INVALID_ID/);
  });
});

describe('assertOneOf', () => {
  it('returns the value when it is in the allowlist', () => {
    expect(assertOneOf('a', ['a', 'b'] as const, 'X')).toBe('a');
  });
  it('rejects unknown values', () => {
    expect(() => assertOneOf('z', ['a', 'b'] as const, 'X')).toThrow(/TS_INVALID_ENUM/);
  });
});

describe('assertExactVersion', () => {
  it('accepts the exact pinned version', () => {
    expect(assertExactVersion('v1', 'v1', 'X')).toBe('v1');
  });
  it('rejects anything else with TS_UNKNOWN_VERSION', () => {
    expect(() => assertExactVersion('v2', 'v1', 'X')).toThrow(/TS_UNKNOWN_VERSION/);
  });
});

describe('assertFiniteNumberInRange', () => {
  it('accepts numbers inside [min, max]', () => {
    expect(assertFiniteNumberInRange(0.5, 'X', 0, 1)).toBe(0.5);
    expect(assertFiniteNumberInRange(0, 'X', 0, 1)).toBe(0);
    expect(assertFiniteNumberInRange(1, 'X', 0, 1)).toBe(1);
  });
  it('rejects out-of-range and non-finite', () => {
    expect(() => assertFiniteNumberInRange(1.5, 'X', 0, 1)).toThrow();
    expect(() => assertFiniteNumberInRange(-0.001, 'X', 0, 1)).toThrow();
    expect(() => assertFiniteNumberInRange(Number.NaN, 'X', 0, 1)).toThrow(/TS_INVALID_NUMBER/);
    expect(() => assertFiniteNumberInRange(Infinity, 'X', 0, 1)).toThrow();
  });
});

describe('assertIso8601', () => {
  it('accepts ISO timestamps with Z or ±HH:MM', () => {
    const now = Date.UTC(2026, 0, 1);
    expect(assertIso8601('2026-01-01T00:00:00Z', 'X', now)).toBe('2026-01-01T00:00:00Z');
    expect(assertIso8601('2026-01-01T00:00:00+09:00', 'X', now)).toBe(
      '2026-01-01T00:00:00+09:00'
    );
  });
  it('rejects bare local times (no timezone)', () => {
    expect(() => assertIso8601('2026-01-01T00:00:00', 'X')).toThrow(/TS_INVALID_TIMESTAMP/);
  });
  it('rejects timestamps before 2020', () => {
    expect(() => assertIso8601('2019-12-31T23:59:59Z', 'X')).toThrow(/before 2020/);
  });
  it('rejects timestamps absurdly in the future', () => {
    expect(() =>
      assertIso8601('2300-01-01T00:00:00Z', 'X', Date.UTC(2026, 0, 1))
    ).toThrow(/future/);
  });
  it('rejects non-ISO strings', () => {
    expect(() => assertIso8601('yesterday', 'X')).toThrow(/TS_INVALID_TIMESTAMP/);
  });
});

describe('assertNotBefore', () => {
  it('accepts equal and ascending timestamps', () => {
    expect(() => assertNotBefore('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'a', 'b')).not.toThrow();
    expect(() => assertNotBefore('2026-01-01T00:00:00Z', '2026-12-31T00:00:00Z', 'a', 'b')).not.toThrow();
  });
  it('rejects descending pairs', () => {
    expect(() => assertNotBefore('2026-12-31T00:00:00Z', '2026-01-01T00:00:00Z', 'a', 'b')).toThrow(
      /TS_INVALID_TIMESTAMP/
    );
  });
});

describe('assertReadonlyArray', () => {
  it('rejects non-arrays', () => {
    expect(() => assertReadonlyArray('not array', 'X', 10, (x) => x)).toThrow(/TS_INVALID_INPUT/);
  });
  it('rejects arrays past the cap', () => {
    expect(() => assertReadonlyArray([1, 2, 3], 'X', 2, (x) => x)).toThrow(/exceeds 2/);
  });
  it('runs the per-item validator', () => {
    expect(() =>
      assertReadonlyArray(['ok', ''], 'X', 10, (item, i) =>
        assertNonEmptyString(item, `X[${i}]`)
      )
    ).toThrow();
  });
});

describe('assertText', () => {
  it('accepts tab and LF inside text', () => {
    expect(assertText('line1\nline2\ttab', 'X')).toContain('\n');
  });
  it('rejects other control characters', () => {
    expect(() => assertText('bad\x01char', 'X')).toThrow(/forbidden control/);
  });
});
