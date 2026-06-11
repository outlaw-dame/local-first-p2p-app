import { describe, expect, it } from 'vitest';
import {
  createEmptyProofRegistry,
  getProof,
  registerProof,
  revokeProof,
  validateCapabilityProofRecord,
  verifyProof
} from '../proof-registry.js';

const NOW = '2026-06-08T12:00:00.000Z';
const FUTURE = '2026-06-09T12:00:00.000Z';
const PAST = '2026-06-07T12:00:00.000Z';

function proof(overrides = {}) {
  return {
    proofId: 'proof:1',
    scheme: 'ucan',
    issuer: { kind: 'controller', id: 'controller:root' },
    subject: { kind: 'device', id: 'device:1' },
    issuedAt: NOW,
    expiresAt: FUTURE,
    digest: 'sha-256:abcdefghi',
    verificationState: 'unverified',
    ...overrides
  };
}

describe('capability proof registry', () => {
  it('validates and registers proof records', () => {
    const record = validateCapabilityProofRecord(proof());
    const registry = registerProof(createEmptyProofRegistry(), record);
    expect(getProof(registry, 'proof:1')).toEqual(record);
    expect(Object.isFrozen(registry)).toBe(true);
  });

  it('marks registered proof as verified before expiry', () => {
    let registry = registerProof(createEmptyProofRegistry(), proof());
    registry = verifyProof(registry, 'proof:1', NOW);
    expect(getProof(registry, 'proof:1')?.verificationState).toBe('verified');
  });

  it('marks proof as expired at or after expiry', () => {
    let registry = registerProof(createEmptyProofRegistry(), proof({ expiresAt: PAST }));
    registry = verifyProof(registry, 'proof:1', NOW);
    expect(getProof(registry, 'proof:1')?.verificationState).toBe('expired');
  });

  it('revokes proof records and preserves revoked state on re-registration', () => {
    let registry = registerProof(createEmptyProofRegistry(), proof());
    registry = revokeProof(registry, 'proof:1', NOW);
    expect(getProof(registry, 'proof:1')?.verificationState).toBe('revoked');
    registry = registerProof(registry, proof({ verificationState: 'verified' }));
    expect(getProof(registry, 'proof:1')?.verificationState).toBe('revoked');
  });

  it('rejects digest collisions for the same proof id', () => {
    const registry = registerProof(createEmptyProofRegistry(), proof());
    expect(() => registerProof(registry, proof({ digest: 'sha-256:zzzzzzzz' }))).toThrow('CAP_DUPLICATE_VALUE');
  });

  it('rejects invalid evaluator time', () => {
    const registry = registerProof(createEmptyProofRegistry(), proof());
    expect(() => verifyProof(registry, 'proof:1', 'bad-time')).toThrow('CAP_INVALID_TIMESTAMP');
  });
});
