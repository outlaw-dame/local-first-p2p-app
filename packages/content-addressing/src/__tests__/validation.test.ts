import { describe, expect, it } from 'vitest';
import {
  assertForbiddenKey,
  assertNonEmptyString,
  assertPlainObject,
  assertSafeNonNegativeInteger,
  isPlainObject,
  parseSafeUrl
} from '../validation.js';

describe('isPlainObject / assertPlainObject', () => {
  it('accepts plain objects', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
  });

  it('rejects arrays, null, primitives, class instances', () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(1)).toBe(false);
    expect(isPlainObject('x')).toBe(false);
    class Foo {}
    expect(isPlainObject(new Foo())).toBe(false);
  });

  it('assertPlainObject throws CA_INVALID_INPUT on bad input', () => {
    expect(() => assertPlainObject([], 'X')).toThrow(/CA_INVALID_INPUT/);
    expect(() => assertPlainObject(null, 'X')).toThrow(/CA_INVALID_INPUT/);
  });
});

describe('assertNonEmptyString', () => {
  it('accepts non-empty strings', () => {
    expect(assertNonEmptyString('x', 'X')).toBe('x');
  });
  it('rejects empty, number, undefined, null', () => {
    expect(() => assertNonEmptyString('', 'X')).toThrow(/CA_INVALID_INPUT/);
    expect(() => assertNonEmptyString(0, 'X')).toThrow(/CA_INVALID_INPUT/);
    expect(() => assertNonEmptyString(undefined, 'X')).toThrow(/CA_INVALID_INPUT/);
    expect(() => assertNonEmptyString(null, 'X')).toThrow(/CA_INVALID_INPUT/);
  });
});

describe('assertSafeNonNegativeInteger', () => {
  it('accepts 0 and positive safe integers', () => {
    expect(assertSafeNonNegativeInteger(0, 'X')).toBe(0);
    expect(assertSafeNonNegativeInteger(42, 'X')).toBe(42);
    expect(
      assertSafeNonNegativeInteger(Number.MAX_SAFE_INTEGER, 'X')
    ).toBe(Number.MAX_SAFE_INTEGER);
  });
  it('rejects negative, fractional, non-finite, non-numbers', () => {
    expect(() => assertSafeNonNegativeInteger(-1, 'X')).toThrow();
    expect(() => assertSafeNonNegativeInteger(1.5, 'X')).toThrow();
    expect(() => assertSafeNonNegativeInteger(Infinity, 'X')).toThrow(/CA_NON_FINITE_NUMBER/);
    expect(() => assertSafeNonNegativeInteger(NaN, 'X')).toThrow(/CA_NON_FINITE_NUMBER/);
    expect(() =>
      assertSafeNonNegativeInteger(Number.MAX_SAFE_INTEGER + 2, 'X')
    ).toThrow();
    expect(() => assertSafeNonNegativeInteger('1', 'X')).toThrow();
  });
});

describe('assertForbiddenKey', () => {
  it('rejects __proto__, prototype, constructor', () => {
    expect(() => assertForbiddenKey('__proto__', 'X')).toThrow(/CA_FORBIDDEN_KEY/);
    expect(() => assertForbiddenKey('prototype', 'X')).toThrow(/CA_FORBIDDEN_KEY/);
    expect(() => assertForbiddenKey('constructor', 'X')).toThrow(/CA_FORBIDDEN_KEY/);
  });
  it('accepts every other key', () => {
    expect(() => assertForbiddenKey('a', 'X')).not.toThrow();
    expect(() => assertForbiddenKey('hasOwnProperty', 'X')).not.toThrow();
  });
});

describe('parseSafeUrl', () => {
  it('accepts https URLs', () => {
    const u = parseSafeUrl('https://example.com/x', ['https'], 'X');
    expect(u.protocol).toBe('https:');
    expect(u.host).toBe('example.com');
  });

  it('rejects URLs with embedded user/password', () => {
    expect(() =>
      parseSafeUrl('https://user:pass@example.com/x', ['https'], 'X')
    ).toThrow(/CA_URL_CREDENTIALS_FORBIDDEN/);
    expect(() =>
      parseSafeUrl('https://user@example.com/x', ['https'], 'X')
    ).toThrow(/CA_URL_CREDENTIALS_FORBIDDEN/);
  });

  it('rejects schemes outside the allowlist', () => {
    expect(() => parseSafeUrl('http://example.com/', ['https'], 'X')).toThrow(/CA_INVALID_URL/);
    expect(() =>
      parseSafeUrl('javascript:alert(1)', ['https'], 'X')
    ).toThrow(/CA_INVALID_URL/);
    expect(() => parseSafeUrl('ftp://example.com/', ['https'], 'X')).toThrow(/CA_INVALID_URL/);
  });

  it('rejects non-URL strings', () => {
    expect(() => parseSafeUrl('not a url', ['https'], 'X')).toThrow(/CA_INVALID_URL/);
    expect(() => parseSafeUrl('', ['https'], 'X')).toThrow();
  });
});
