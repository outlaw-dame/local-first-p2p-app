/**
 * Stable error codes for @lfp2p/mls-provider.
 *
 * Codes are stable identifiers callers can branch on. Messages are
 * informative but may change; never branch on message text. Messages
 * must remain privacy-safe: no key material, no plaintext, no full
 * group ids, no upstream library error text (library messages may
 * describe internal state we do not control).
 */
export const MLS_ERROR_CODES = [
  'MLS_INVALID_INPUT',
  'MLS_INVALID_CONFIG',
  'MLS_UNSUPPORTED_CIPHERSUITE',
  'MLS_CREDENTIAL_INVALID',
  'MLS_UNKNOWN_GROUP',
  'MLS_GROUP_EXISTS',
  'MLS_UNKNOWN_KEY_PACKAGE',
  'MLS_MEMBER_NOT_FOUND',
  'MLS_WRONG_GROUP',
  'MLS_REMOVED_FROM_GROUP',
  'MLS_STATE_CODEC',
  'MLS_STORE_FAILURE',
  'MLS_PROVIDER_FAILURE'
] as const;

export type MlsErrorCode = (typeof MLS_ERROR_CODES)[number];

export class MlsProviderError extends Error {
  public readonly code: MlsErrorCode;

  constructor(code: MlsErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'MlsProviderError';
    this.code = code;
  }
}

export function mlsError(code: MlsErrorCode, message: string): MlsProviderError {
  return new MlsProviderError(code, message);
}
