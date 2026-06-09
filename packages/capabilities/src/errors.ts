export const CAPABILITY_ERROR_CODES = [
  'CAP_INVALID_INPUT',
  'CAP_UNKNOWN_VERSION',
  'CAP_MISSING_FIELD',
  'CAP_INVALID_ENUM',
  'CAP_INVALID_ID',
  'CAP_INVALID_TIMESTAMP',
  'CAP_INVALID_DIGEST',
  'CAP_INVALID_NUMBER',
  'CAP_INVALID_ACTION',
  'CAP_INVALID_PARTY',
  'CAP_INVALID_RESOURCE',
  'CAP_INVALID_SCOPE',
  'CAP_INVALID_CAVEAT',
  'CAP_INVALID_PROOF',
  'CAP_DUPLICATE_VALUE',
  'CAP_FORBIDDEN_KEY',
  'CAP_PRIVATE_LEAK_RISK'
] as const;

export type CapabilityErrorCode = (typeof CAPABILITY_ERROR_CODES)[number];

export class CapabilityError extends Error {
  public readonly code: CapabilityErrorCode;

  constructor(code: CapabilityErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'CapabilityError';
    this.code = code;
  }
}

export function capabilityError(code: CapabilityErrorCode, message: string): CapabilityError {
  return new CapabilityError(code, message);
}
