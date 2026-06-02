import { hasControlCharacters } from '@lfp2p/content-addressing';
import { tsError } from './errors.js';

/** Plain object guard (rejects arrays, null, class instances). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw tsError('TS_INVALID_INPUT', `${label} must be a plain object`);
  }
  return value;
}

export function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw tsError('TS_INVALID_INPUT', `${label} must be a non-empty string`);
  }
  return value;
}

/** Maximum length for any free-form identifier or short string. */
export const MAX_ID_LENGTH = 512;
/** Maximum length for display names, descriptions, and longer fields. */
export const MAX_TEXT_LENGTH = 4096;

/**
 * Assert a value is a non-empty bounded string with no control characters.
 * Used for ids, reason codes, scope keys, and similar opaque short tokens.
 */
/**
 * Reserved JavaScript object property names that, if used as a record
 * key in our projection helpers, would either mutate the prototype
 * chain (`__proto__`) or shadow methods inherited from `Object.prototype`
 * (`constructor`, `prototype`, `hasOwnProperty`, etc.). We reject them
 * at the validator boundary so they cannot reach `withRecordSet`-style
 * helpers even by accident.
 *
 * Defense-in-depth: even when a forbidden key bypasses validation, the
 * projection helpers use `Object.create(null)` + `Object.defineProperty`
 * so the assignment lands as an own-property rather than mutating the
 * prototype chain.
 */
const FORBIDDEN_ID_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toString',
  'valueOf'
]);

export function isForbiddenIdKey(value: string): boolean {
  return FORBIDDEN_ID_KEYS.has(value);
}

export function assertId(value: unknown, label: string, maxLength = MAX_ID_LENGTH): string {
  const raw = assertNonEmptyString(value, label);
  if (raw.length > maxLength) {
    throw tsError('TS_INVALID_ID', `${label} length ${raw.length} exceeds ${maxLength}`);
  }
  if (hasControlCharacters(raw)) {
    throw tsError('TS_INVALID_ID', `${label} contains control characters`);
  }
  if (FORBIDDEN_ID_KEYS.has(raw)) {
    throw tsError(
      'TS_FORBIDDEN_KEY',
      `${label} cannot be a reserved JavaScript property name ("${raw}")`
    );
  }
  return raw;
}

/** Assert a value is a non-empty bounded text string with no control chars except TAB/LF. */
export function assertText(value: unknown, label: string, maxLength = MAX_TEXT_LENGTH): string {
  const raw = assertNonEmptyString(value, label);
  if (raw.length > maxLength) {
    throw tsError('TS_INVALID_INPUT', `${label} length ${raw.length} exceeds ${maxLength}`);
  }
  // Allow tab (0x09) and line feed (0x0a) in description-style text.
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a) || code === 0x7f) {
      throw tsError('TS_INVALID_INPUT', `${label} contains a forbidden control character`);
    }
  }
  return raw;
}

export function assertOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw tsError(
      'TS_INVALID_ENUM',
      `${label} must be one of ${allowed.join(', ')} (got: ${String(value)})`
    );
  }
  return value as T;
}

/**
 * Pin a `version` field to an exact stable string. Unknown versions
 * fail closed — required by the T&S event policy doctrine.
 */
export function assertExactVersion<T extends string>(
  value: unknown,
  expected: T,
  label: string
): T {
  if (value !== expected) {
    throw tsError(
      'TS_UNKNOWN_VERSION',
      `${label} expected version "${expected}", got "${String(value)}"`
    );
  }
  return expected;
}

export function assertFiniteNumberInRange(
  value: unknown,
  label: string,
  min: number,
  max: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw tsError('TS_INVALID_NUMBER', `${label} must be a finite number`);
  }
  if (value < min || value > max) {
    throw tsError(
      'TS_INVALID_NUMBER',
      `${label} value ${value} is outside [${min}, ${max}]`
    );
  }
  return value;
}

/** Earliest ISO timestamp we accept. Anything before this is treated as garbage. */
const MIN_EPOCH_MS = Date.UTC(2020, 0, 1);
/** Latest ISO timestamp we accept relative to a clock reference. */
const MAX_FUTURE_MS = 100 * 365 * 24 * 60 * 60 * 1000; // 100 years

/**
 * Parse and validate an ISO-8601 timestamp.
 *
 * Rules:
 *  - input must be a string
 *  - must parse via Date.parse to a finite number
 *  - epoch must be after MIN_EPOCH_MS
 *  - epoch must be before (now + MAX_FUTURE_MS) — caller may pass a `now`
 *    for deterministic tests
 *  - string must include a `T` and a timezone designator (`Z`, `+HH:MM`,
 *    or `-HH:MM`) — bare local times are ambiguous and rejected
 */
export function assertIso8601(
  value: unknown,
  label: string,
  now: number = Date.now()
): string {
  const raw = assertNonEmptyString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) {
    throw tsError(
      'TS_INVALID_TIMESTAMP',
      `${label} must be ISO-8601 with explicit timezone (Z or ±HH:MM)`
    );
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    throw tsError('TS_INVALID_TIMESTAMP', `${label} did not parse as a valid date`);
  }
  if (parsed < MIN_EPOCH_MS) {
    throw tsError(
      'TS_INVALID_TIMESTAMP',
      `${label}: timestamp before 2020 is rejected as garbage`
    );
  }
  if (parsed > now + MAX_FUTURE_MS) {
    throw tsError(
      'TS_INVALID_TIMESTAMP',
      `${label}: timestamp more than 100 years in the future is rejected`
    );
  }
  return raw;
}

/**
 * Assert that an ordered pair of timestamps is non-decreasing.
 * Used for createdAt <= expiresAt.
 */
export function assertNotBefore(
  earlier: string,
  later: string,
  earlierLabel: string,
  laterLabel: string
): void {
  const a = Date.parse(earlier);
  const b = Date.parse(later);
  if (Number.isFinite(a) && Number.isFinite(b) && b < a) {
    throw tsError(
      'TS_INVALID_TIMESTAMP',
      `${laterLabel} (${later}) must not be before ${earlierLabel} (${earlier})`
    );
  }
}

export function assertReadonlyArray<T>(
  value: unknown,
  label: string,
  maxLength: number,
  validate: (item: unknown, index: number) => T
): ReadonlyArray<T> {
  if (!Array.isArray(value)) {
    throw tsError('TS_INVALID_INPUT', `${label} must be an array`);
  }
  if (value.length > maxLength) {
    throw tsError(
      'TS_INVALID_INPUT',
      `${label} length ${value.length} exceeds ${maxLength}`
    );
  }
  const out: T[] = [];
  for (let i = 0; i < value.length; i += 1) {
    out.push(validate(value[i], i));
  }
  return Object.freeze(out);
}

/** Privacy scopes that are local-only and must never carry data to public flows. */
export const PRIVATE_SUBJECT_TYPES = ['blob', 'media', 'thread'] as const;
