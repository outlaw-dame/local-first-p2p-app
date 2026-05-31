/**
 * Stable error codes for @lfp2p/content-addressing.
 *
 * Codes are stable identifiers callers can branch on. Messages are
 * informative but may change; never branch on message text.
 */
export const CA_ERROR_CODES = [
  'CA_INVALID_INPUT',
  'CA_INVALID_DIGEST',
  'CA_UNSUPPORTED_ALGORITHM',
  'CA_INVALID_BASE64URL',
  'CA_WRONG_DIGEST_LENGTH',
  'CA_INVALID_CID',
  'CA_UNSUPPORTED_CID_VERSION',
  'CA_UNSUPPORTED_CODEC',
  'CA_CID_IS_URL',
  'CA_INVALID_URL',
  'CA_URL_CREDENTIALS_FORBIDDEN',
  'CA_INVALID_LOCATION_KIND',
  'CA_INVALID_PRIORITY',
  'CA_INVALID_EXPIRY',
  'CA_INVALID_BYTE_LENGTH',
  'CA_MISSING_ENCRYPTION_DESCRIPTOR',
  'CA_INVALID_ENCRYPTION_DESCRIPTOR',
  'CA_INVALID_COMPRESSION_DESCRIPTOR',
  'CA_UNSAFE_COMPRESSION',
  'CA_UNSAFE_DICTIONARY_REF',
  'CA_INVALID_OBJECT_REF',
  'CA_INVALID_BUNDLE_REF',
  'CA_EMPTY_ROOTS',
  'CA_FORBIDDEN_KEY',
  'CA_RECURSION_LIMIT',
  'CA_NON_FINITE_NUMBER',
  'CA_UNDEFINED_VALUE',
  'CA_UNSUPPORTED_JSON_TYPE',
  'CA_MIXED_PRIVACY_HINT'
] as const;

export type CAErrorCode = (typeof CA_ERROR_CODES)[number];

export class ContentAddressingError extends Error {
  public readonly code: CAErrorCode;

  constructor(code: CAErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'ContentAddressingError';
    this.code = code;
  }
}

export function caError(code: CAErrorCode, message: string): ContentAddressingError {
  return new ContentAddressingError(code, message);
}
