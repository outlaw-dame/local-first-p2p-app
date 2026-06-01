import { describe, expect, it } from 'vitest';
import {
  PRODUCT_ROLES,
  SAFETY_AUTHORITY_SCOPES,
  validateSafetyAuthority
} from '../index.js';

const BASE = {
  version: 'lfp2p.safety-authority.v1' as const,
  authorityId: 'auth_1',
  actorId: 'actor_1',
  scope: 'device-local' as const,
  createdAt: '2026-05-31T00:00:00Z'
};

describe('validateSafetyAuthority', () => {
  it('accepts a minimal authority', () => {
    expect(() => validateSafetyAuthority(BASE)).not.toThrow();
  });

  it('rejects unknown version (fail-closed)', () => {
    expect(() =>
      validateSafetyAuthority({ ...BASE, version: 'lfp2p.safety-authority.v2' })
    ).toThrow(/TS_UNKNOWN_VERSION/);
  });

  it('rejects unknown scope', () => {
    expect(() => validateSafetyAuthority({ ...BASE, scope: 'global' })).toThrow(/TS_INVALID_ENUM/);
  });

  it('rejects unknown role', () => {
    expect(() => validateSafetyAuthority({ ...BASE, role: 'overlord' })).toThrow(/TS_INVALID_ENUM/);
  });

  it('rejects expiresAt before createdAt', () => {
    expect(() =>
      validateSafetyAuthority({
        ...BASE,
        createdAt: '2026-05-31T00:00:00Z',
        expiresAt: '2026-05-30T00:00:00Z'
      })
    ).toThrow(/TS_INVALID_TIMESTAMP/);
  });

  it('rejects oversized capabilityProofs', () => {
    const tooMany = new Array(33).fill({ proofId: 'p', scheme: 's' });
    expect(() =>
      validateSafetyAuthority({ ...BASE, capabilityProofs: tooMany })
    ).toThrow(/exceeds 32/);
  });

  it('freezes the result', () => {
    const out = validateSafetyAuthority(BASE);
    expect(Object.isFrozen(out)).toBe(true);
  });

  it('PRODUCT_ROLES and SAFETY_AUTHORITY_SCOPES are exported lists', () => {
    expect(PRODUCT_ROLES).toContain('owner');
    expect(SAFETY_AUTHORITY_SCOPES).toContain('community-local');
    expect(SAFETY_AUTHORITY_SCOPES).toContain('network-advisory');
  });
});
