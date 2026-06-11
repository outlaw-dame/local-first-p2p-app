import { describe, expect, it } from 'vitest';
import { createEmptyTrustRegistry, getAuthorityTrust, revokeAuthorityTrust, setAuthorityTrust } from '../trust-registry.js';

const NOW = '2026-06-08T12:00:00.000Z';
const AUTHORITY = { kind: 'controller' as const, id: 'controller:root' };

describe('authority trust registry', () => {
  it('stores and reads trust state', () => {
    const registry = setAuthorityTrust(createEmptyTrustRegistry(), {
      authority: AUTHORITY,
      trustState: 'trusted',
      verificationSources: ['identity-control-log'],
      proofs: [{ proofId: 'proof:1', scheme: 'native-signed-event' }],
      updatedAt: NOW
    });
    expect(getAuthorityTrust(registry, AUTHORITY)?.trustState).toBe('trusted');
  });

  it('keeps revoked state stable', () => {
    let registry = setAuthorityTrust(createEmptyTrustRegistry(), {
      authority: AUTHORITY,
      trustState: 'trusted',
      verificationSources: [],
      proofs: [],
      updatedAt: NOW
    });
    registry = revokeAuthorityTrust(registry, AUTHORITY, NOW);
    registry = setAuthorityTrust(registry, {
      authority: AUTHORITY,
      trustState: 'trusted',
      verificationSources: [],
      proofs: [],
      updatedAt: NOW
    });
    expect(getAuthorityTrust(registry, AUTHORITY)?.trustState).toBe('revoked');
  });
});
