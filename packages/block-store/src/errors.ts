/**
 * Stable error codes for @lfp2p/block-store.
 *
 * Codes are stable identifiers callers can branch on. Messages are
 * informative but may change; never branch on message text. Messages
 * must remain privacy-safe: redacted refs only, no URLs, no full
 * digests, no key material, no upstream exception text.
 */
export const BS_ERROR_CODES = [
  'BS_INVALID_INPUT',
  'BS_INVALID_CONFIG',
  'BS_BYTE_CAP_EXCEEDED',
  'BS_DECODED_SIZE_EXCEEDED',
  'BS_LENGTH_MISMATCH',
  'BS_DIGEST_MISMATCH',
  'BS_VERIFICATION_UNSUPPORTED',
  'BS_DECODE_UNSUPPORTED',
  'BS_DECODE_FAILED',
  'BS_BLOCK_UNAVAILABLE',
  'BS_ABORTED'
] as const;

export type BSErrorCode = (typeof BS_ERROR_CODES)[number];

export class BlockStoreError extends Error {
  public readonly code: BSErrorCode;

  constructor(code: BSErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'BlockStoreError';
    this.code = code;
  }
}

export function bsError(code: BSErrorCode, message: string): BlockStoreError {
  return new BlockStoreError(code, message);
}
