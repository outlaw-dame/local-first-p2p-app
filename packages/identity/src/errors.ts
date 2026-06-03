/**
 * Stable error codes for @lfp2p/identity.
 *
 * Codes are stable identifiers callers may branch on. Messages are
 * informative but may change; never branch on message text.
 *
 * Codes are prefixed `IDENTITY_` so they do not collide with
 * `@lfp2p/content-addressing` (`CA_`) or `@lfp2p/trust-safety`
 * (`TS_`) error namespaces.
 */
export const IDENTITY_ERROR_CODES = [
  'IDENTITY_INVALID_INPUT',
  'IDENTITY_UNKNOWN_VERSION',
  'IDENTITY_UNKNOWN_KIND',
  'IDENTITY_MISSING_FIELD',
  'IDENTITY_INVALID_ENUM',
  'IDENTITY_INVALID_ID',
  'IDENTITY_INVALID_TIMESTAMP',
  'IDENTITY_INVALID_NUMBER',
  'IDENTITY_INVALID_PUBLIC_KEY',
  'IDENTITY_INVALID_SCOPE',
  'IDENTITY_INVALID_DIGEST',
  'IDENTITY_FORBIDDEN_KEY',
  'IDENTITY_PAYLOAD_TOO_LARGE',
  'IDENTITY_EPOCH_NON_MONOTONIC',
  'IDENTITY_AUTHORITY_MISMATCH',
  'IDENTITY_DEVICE_NOT_FOUND',
  'IDENTITY_DEVICE_ALREADY_REVOKED',
  'IDENTITY_DEVICE_REUSE',
  'IDENTITY_DUPLICATE_CONTROLLER',
  'IDENTITY_CAPABILITY_NOT_FOUND',
  'IDENTITY_CAPABILITY_DELEGATE_MISMATCH',
  'IDENTITY_LIFECYCLE_TRANSITION'
] as const;

export type IdentityErrorCode = (typeof IDENTITY_ERROR_CODES)[number];

export class IdentityError extends Error {
  public readonly code: IdentityErrorCode;

  constructor(code: IdentityErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'IdentityError';
    this.code = code;
  }
}

export function identityError(code: IdentityErrorCode, message: string): IdentityError {
  return new IdentityError(code, message);
}
