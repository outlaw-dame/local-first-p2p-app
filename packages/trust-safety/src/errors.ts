/**
 * Stable error codes for @lfp2p/trust-safety.
 *
 * Codes are stable identifiers callers may branch on. Messages are
 * informative but may change; never branch on message text.
 *
 * Codes are prefixed `TS_` so they do not collide with content-addressing
 * (`CA_`) or any future package's namespace.
 */
export const TS_ERROR_CODES = [
  'TS_INVALID_INPUT',
  'TS_UNKNOWN_VERSION',
  'TS_MISSING_FIELD',
  'TS_INVALID_ENUM',
  'TS_INVALID_ID',
  'TS_INVALID_TIMESTAMP',
  'TS_INVALID_DURATION',
  'TS_INVALID_NUMBER',
  'TS_INVALID_SUBJECT',
  'TS_INVALID_OBJECT_REF',
  'TS_INVALID_AUTHORITY',
  'TS_INVALID_SCOPE',
  'TS_INVALID_ACTION',
  'TS_INVALID_LABEL',
  'TS_INVALID_LABELER',
  'TS_INVALID_REPORT',
  'TS_INVALID_APPEAL',
  'TS_INVALID_DECISION',
  'TS_INVALID_ADMISSION',
  'TS_INVALID_CURATION',
  'TS_INVALID_ANNOTATION',
  'TS_INVALID_CAPABILITY_PROOF',
  'TS_INVALID_CREDENTIAL_REF',
  'TS_PRIVATE_LEAK',
  'TS_ACTION_SCOPE_MISMATCH',
  'TS_CURATION_MASQUERADE',
  'TS_HARD_SAFETY_DOWNGRADE',
  'TS_DUPLICATE_KEY',
  'TS_FORBIDDEN_KEY',
  'TS_LIFECYCLE_TRANSITION'
] as const;

export type TSErrorCode = (typeof TS_ERROR_CODES)[number];

export class TrustSafetyError extends Error {
  public readonly code: TSErrorCode;

  constructor(code: TSErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'TrustSafetyError';
    this.code = code;
  }
}

export function tsError(code: TSErrorCode, message: string): TrustSafetyError {
  return new TrustSafetyError(code, message);
}
