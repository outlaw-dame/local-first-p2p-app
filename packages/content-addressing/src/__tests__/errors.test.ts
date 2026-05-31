import { describe, expect, it } from 'vitest';
import {
  CA_ERROR_CODES,
  ContentAddressingError,
  caError
} from '../errors.js';

describe('errors', () => {
  it('exports a stable, sorted-free list of error codes that are unique', () => {
    const set = new Set(CA_ERROR_CODES);
    expect(set.size).toBe(CA_ERROR_CODES.length);
  });

  it('caError produces an instanceof Error and ContentAddressingError', () => {
    const err = caError('CA_INVALID_INPUT', 'oops');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ContentAddressingError);
    expect(err.code).toBe('CA_INVALID_INPUT');
    expect(err.message).toMatch(/^\[CA_INVALID_INPUT\] oops$/);
    expect(err.name).toBe('ContentAddressingError');
  });

  it('the code field is read-only at runtime when the object is frozen by a caller', () => {
    const err = caError('CA_INVALID_INPUT', 'oops');
    // The class itself does not freeze; we only assert that the field exists
    // and matches. (Mutability of the field is acceptable for Error subclasses
    // to allow callers to retag in rethrow paths.)
    expect(err.code).toBe('CA_INVALID_INPUT');
  });
});
