import { describe, expect, it } from 'vitest';
import {
  assertBearcapUsable,
  isBearcapExpired,
  validateBearcapRef,
  type BearcapRefV1
} from '../bearcaps.js';

const NOW = '2026-06-08T12:00:00.000Z';
const FUTURE = '2026-06-09T12:00:00.000Z';
const PAST = '2026-06-07T12:00:00.000Z';

function baseRef(overrides: Partial<BearcapRefV1> = {}): BearcapRefV1 {
  return {
    version: 'lfp2p.capability.bearcap.v1',
    bearcapId: 'bearcap:pickup:1',
    purpose: 'encrypted-bundle-pickup',
    createdAt: NOW,
    expiresAt: FUTURE,
    singleUse: true,
    redactionDigest: 'sha-256:abcdefghi',
    ...overrides
  };
}

describe('bearcap metadata profile', () => {
  it('validates redacted bearcap metadata', () => {
    const ref = validateBearcapRef(baseRef());
    expect(ref.purpose).toBe('encrypted-bundle-pickup');
    expect(Object.isFrozen(ref)).toBe(true);
  });

  it('rejects secret-bearing ids', () => {
    expect(() => validateBearcapRef(baseRef({ bearcapId: 'https://example.test/token' }))).toThrow(
      'CAP_PRIVATE_LEAK_RISK'
    );
    expect(() => validateBearcapRef(baseRef({ bearcapId: 'bearcap?id=secret' }))).toThrow(
      'CAP_PRIVATE_LEAK_RISK'
    );
  });

  it('rejects disallowed purposes and invalid windows', () => {
    expect(() => validateBearcapRef({ ...baseRef(), purpose: 'identity-control' })).toThrow(
      'CAP_INVALID_ENUM'
    );
    expect(() => validateBearcapRef(baseRef({ createdAt: FUTURE, expiresAt: NOW }))).toThrow(
      'CAP_INVALID_TIMESTAMP'
    );
  });

  it('treats invalid evaluator time as expired', () => {
    expect(isBearcapExpired(validateBearcapRef(baseRef()), 'not-a-time')).toBe(true);
  });

  it('enforces single-use and max-use constraints', () => {
    expect(() => assertBearcapUsable(validateBearcapRef(baseRef()), NOW, 1)).toThrow(
      'CAP_INVALID_NUMBER'
    );
    const multiUse = validateBearcapRef(baseRef({ singleUse: false, maxUses: 2 }));
    expect(assertBearcapUsable(multiUse, NOW, 1)).toEqual(multiUse);
    expect(() => assertBearcapUsable(multiUse, NOW, 2)).toThrow('CAP_INVALID_NUMBER');
  });

  it('rejects expired metadata', () => {
    const ref = validateBearcapRef(baseRef({ createdAt: PAST, expiresAt: NOW }));
    expect(isBearcapExpired(ref, NOW)).toBe(true);
    expect(() => assertBearcapUsable(ref, NOW, 0)).toThrow('CAP_INVALID_TIMESTAMP');
  });
});
