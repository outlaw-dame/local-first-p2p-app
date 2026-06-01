import { describe, expect, it } from 'vitest';
import { TS_ERROR_CODES, TrustSafetyError, tsError } from '../index.js';

describe('errors', () => {
  it('exports a unique stable code list', () => {
    expect(new Set(TS_ERROR_CODES).size).toBe(TS_ERROR_CODES.length);
  });

  it('tsError produces an instance of TrustSafetyError and Error with .code', () => {
    const err = tsError('TS_INVALID_INPUT', 'oops');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TrustSafetyError);
    expect(err.code).toBe('TS_INVALID_INPUT');
    expect(err.message).toMatch(/^\[TS_INVALID_INPUT\] oops$/);
    expect(err.name).toBe('TrustSafetyError');
  });
});
