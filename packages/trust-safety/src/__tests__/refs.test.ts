import { describe, expect, it } from 'vitest';
import {
  validateActorRef,
  validateCapabilityProofRef,
  validateCredentialRef,
  validateReporterRef
} from '../index.js';

describe('validateActorRef', () => {
  it('accepts minimal shape', () => {
    expect(validateActorRef({ actorId: 'a1' })).toEqual({ actorId: 'a1' });
  });
  it('rejects missing actorId', () => {
    expect(() => validateActorRef({})).toThrow();
  });
});

describe('validateReporterRef', () => {
  it('accepts actor variant', () => {
    const r = validateReporterRef({ kind: 'actor', actor: { actorId: 'a1' } });
    expect(r.kind).toBe('actor');
  });
  it('accepts community variant', () => {
    const r = validateReporterRef({ kind: 'community', communityId: 'c1' });
    expect(r.kind).toBe('community');
  });
  it('accepts pseudonym variant', () => {
    const r = validateReporterRef({ kind: 'pseudonym', pseudonymId: 'p1' });
    expect(r.kind).toBe('pseudonym');
  });
  it('rejects unknown kind', () => {
    expect(() => validateReporterRef({ kind: 'alien', actor: { actorId: 'a1' } })).toThrow(
      /TS_INVALID_ENUM/
    );
  });
});

describe('validateCapabilityProofRef', () => {
  it('accepts shape with id + scheme', () => {
    const r = validateCapabilityProofRef({ proofId: 'p1', scheme: 'ucan:v0.10' });
    expect(r.proofId).toBe('p1');
  });
  it('rejects empty proofId', () => {
    expect(() => validateCapabilityProofRef({ proofId: '', scheme: 'x' })).toThrow();
  });
});

describe('validateCredentialRef', () => {
  it('accepts shape with id, issuer, claim type', () => {
    const r = validateCredentialRef({
      credentialId: 'cred1',
      issuerId: 'iss1',
      claimType: 'device-attestation'
    });
    expect(r.claimType).toBe('device-attestation');
  });
});
