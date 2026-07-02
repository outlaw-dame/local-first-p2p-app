import { caError } from './errors.js';

/**
 * Recursion depth bound for canonicalization. Keeps adversarial nested
 * JSON from exhausting the stack while still allowing realistic objects.
 */
export const MAX_CANONICAL_DEPTH = 64;

/**
 * Maximum encoded byte length we allow validators to reason about for a
 * single inline value. Used as a guard, not as a hard storage limit.
 */
export const MAX_SAFE_BYTE_LENGTH = Number.MAX_SAFE_INTEGER;

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor']);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw caError('CA_INVALID_INPUT', `${label} must be a plain object`);
  }
  return value;
}

export function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw caError('CA_INVALID_INPUT', `${label} must be a non-empty string`);
  }
  return value;
}

export function assertSafeNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw caError('CA_NON_FINITE_NUMBER', `${label} must be a finite number`);
  }
  if (!Number.isSafeInteger(value)) {
    throw caError('CA_INVALID_INPUT', `${label} must be a safe integer`);
  }
  if (value < 0) {
    throw caError('CA_INVALID_INPUT', `${label} must be non-negative`);
  }
  return value;
}

export function assertForbiddenKey(key: string, label: string): void {
  if (FORBIDDEN_KEYS.has(key)) {
    throw caError(
      'CA_FORBIDDEN_KEY',
      `${label}: forbidden key "${key}" (would alter prototype chain)`
    );
  }
}

/**
 * Parse a URL, rejecting:
 *  - non-URLs
 *  - userinfo (user/password) — `https://user:pass@host`
 *  - schemes outside the allowed list
 *
 * Returning a URL object lets callers further constrain host/path.
 */
export function parseSafeUrl(value: string, allowedSchemes: readonly string[], label: string): URL {
  assertNonEmptyString(value, label);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw caError('CA_INVALID_URL', `${label} must be a valid absolute URL`);
  }
  if (url.username !== '' || url.password !== '') {
    throw caError(
      'CA_URL_CREDENTIALS_FORBIDDEN',
      `${label} must not embed userinfo (user/password) in the URL`
    );
  }
  if (!allowedSchemes.includes(url.protocol.replace(/:$/, ''))) {
    throw caError(
      'CA_INVALID_URL',
      `${label} scheme "${url.protocol.replace(/:$/, '')}" is not in allowed list ${JSON.stringify(allowedSchemes)}`
    );
  }
  return url;
}

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function assertBase64UrlNoPad(value: string, label: string): string {
  if (!BASE64URL_PATTERN.test(value)) {
    throw caError(
      'CA_INVALID_BASE64URL',
      `${label} must be base64url without padding (RFC 4648 §5)`
    );
  }
  return value;
}
