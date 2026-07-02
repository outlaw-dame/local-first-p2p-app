import { describe, expect, it } from 'vitest';
import {
  createProofRegistry,
  registerProof,
  revokeProof,
  verifyProof,
  type CapabilityProofRecord,
  type CapabilityProofVerifier
} from '@lfp2p/capabilities';
import { evaluateTrustSafetyCap, type TrustSafetyCapInput } from '../index.js';

const NOW = '2026-06-08T12:00:00.000Z';

const ALLOWED = {
  status: 'allow' as const,
  reasonCodes: ['capability.valid' as const],
  capabilityId: 'cap:room:1',
  invocationId: 'invoke:room:1',
  createdAt: NOW,
  expiresAt: '2026-06-09T12:00:00.000Z'
};

const PROOF_INPUT = {
  proofId: 'proof:native:1',
  scheme: 'native-signed-event' as const,
  issuer: { id: 'did:example:issuer', kind: 'actor' as const },
  subject: { id: 'did:example:holder', kind: 'actor' as const },
  issuedAt: '2026-06-01T00:00:00.000Z',
  expiresAt: '2030-01-01T00:00:00.000Z',
  digest: 'sha-256:00000000000000000000000000000000000000000000'
};

const VERIFY_ALL: CapabilityProofVerifier = () => 'verified';
const REJECT_ALL: CapabilityProofVerifier = () => 'invalid';

function regWithProof(): {
  registry: ReturnType<typeof createProofRegistry>;
  record: CapabilityProofRecord;
} {
  const { registry, record } = registerProof(createProofRegistry(), PROOF_INPUT);
  return { registry, record };
}

describe('trust-safety capability adapter', () => {
  it('denies credential-only authority through the shared capability reliance helper', () => {
    const decision = evaluateTrustSafetyCap({
      credentialEvidence: [{ credentialId: 'vc:1', issuerId: 'issuer:1', claimType: 'moderator' }],
      capabilityAction: 'room.moderate',
      now: NOW
    });
    expect(decision.status).toBe('deny');
    expect(decision.reasonCodes).toEqual(['capability.vc-only-authority-denied']);
    expect(decision.createdAt).toBe(NOW);
  });

  it('denies missing capability authority', () => {
    const decision = evaluateTrustSafetyCap({
      capabilityAction: 'room.moderate',
      now: NOW
    });
    expect(decision.status).toBe('deny');
    expect(decision.reasonCodes).toEqual(['capability.unverified-proof']);
  });

  it('passes allowed capability decisions through unchanged', () => {
    const input: TrustSafetyCapInput = {
      capabilityDecision: ALLOWED,
      capabilityAction: 'room.moderate',
      now: NOW
    };
    expect(evaluateTrustSafetyCap(input)).toEqual(input.capabilityDecision);
  });
});

/* -------------------------------------------------------------------------- */
/*               new proofs-state pathway (3 input shapes)                    */
/* -------------------------------------------------------------------------- */

describe('trust-safety capability adapter: proofs-state pathway', () => {
  it('pre-computed proofsState === "verified" lets an allow pass through', () => {
    const decision = evaluateTrustSafetyCap({
      capabilityDecision: ALLOWED,
      capabilityAction: 'room.moderate',
      now: NOW,
      proofsState: 'verified'
    });
    expect(decision.status).toBe('allow');
  });

  it('pre-computed proofsState === "unverified" denies with capability.unverified-proof', () => {
    const decision = evaluateTrustSafetyCap({
      capabilityDecision: ALLOWED,
      capabilityAction: 'room.moderate',
      now: NOW,
      proofsState: 'unverified'
    });
    expect(decision.status).toBe('deny');
    expect(decision.reasonCodes).toEqual(['capability.unverified-proof']);
  });

  it('pre-computed proofsState === "revoked" denies with capability.revoked', () => {
    const decision = evaluateTrustSafetyCap({
      capabilityDecision: ALLOWED,
      capabilityAction: 'room.moderate',
      now: NOW,
      proofsState: 'revoked'
    });
    expect(decision.reasonCodes).toEqual(['capability.revoked']);
  });

  it('pre-computed proofsState === "possession-confirmed" denies (bearer auth cannot establish authority)', () => {
    const decision = evaluateTrustSafetyCap({
      capabilityDecision: ALLOWED,
      capabilityAction: 'room.moderate',
      now: NOW,
      proofsState: 'possession-confirmed'
    });
    expect(decision.status).toBe('deny');
    expect(decision.reasonCodes).toEqual(['capability.unverified-proof']);
  });

  it('proofRegistry + capabilityProofs folds to "verified" via summarizeProofStates', () => {
    let { registry } = regWithProof();
    registry = verifyProof(registry, 'proof:native:1', { now: NOW, verifier: VERIFY_ALL }).registry;
    const decision = evaluateTrustSafetyCap({
      capabilityDecision: ALLOWED,
      capabilityAction: 'room.moderate',
      now: NOW,
      proofRegistry: registry,
      capabilityProofs: [{ proofId: 'proof:native:1', scheme: 'native-signed-event' }]
    });
    expect(decision.status).toBe('allow');
  });

  it('proofRegistry + capabilityProofs folds to "invalid" → deny', () => {
    let { registry } = regWithProof();
    registry = verifyProof(registry, 'proof:native:1', { now: NOW, verifier: REJECT_ALL }).registry;
    const decision = evaluateTrustSafetyCap({
      capabilityDecision: ALLOWED,
      capabilityAction: 'room.moderate',
      now: NOW,
      proofRegistry: registry,
      capabilityProofs: [{ proofId: 'proof:native:1', scheme: 'native-signed-event' }]
    });
    expect(decision.status).toBe('deny');
    expect(decision.reasonCodes).toEqual(['capability.unverified-proof']);
  });

  it('proofRegistry + capabilityProofs folds revocation through → deny with capability.revoked', () => {
    let { registry } = regWithProof();
    registry = revokeProof(registry, 'proof:native:1', { revokedAt: NOW }).registry;
    const decision = evaluateTrustSafetyCap({
      capabilityDecision: ALLOWED,
      capabilityAction: 'room.moderate',
      now: NOW,
      proofRegistry: registry,
      capabilityProofs: [{ proofId: 'proof:native:1', scheme: 'native-signed-event' }]
    });
    expect(decision.reasonCodes).toEqual(['capability.revoked']);
  });

  it('omitting both proofsState and (registry, refs) preserves pre-registry behaviour', () => {
    // No proof-state pathway supplied → the gate behaves as before.
    const decision = evaluateTrustSafetyCap({
      capabilityDecision: ALLOWED,
      capabilityAction: 'room.moderate',
      now: NOW
    });
    expect(decision).toEqual(ALLOWED);
  });

  it('proofRegistry alone (no capabilityProofs) is ignored — no fold computed', () => {
    const { registry } = regWithProof();
    const decision = evaluateTrustSafetyCap({
      capabilityDecision: ALLOWED,
      capabilityAction: 'room.moderate',
      now: NOW,
      proofRegistry: registry
    });
    expect(decision).toEqual(ALLOWED);
  });

  it('capabilityProofs alone (no registry) fails CLOSED with capability.unverified-proof (gemini #92)', () => {
    // Security regression test: a caller who names proofs to verify
    // but supplies no registry has signaled gate intent without the
    // means to satisfy it. Must NOT silently drop the assertion.
    const decision = evaluateTrustSafetyCap({
      capabilityDecision: ALLOWED,
      capabilityAction: 'room.moderate',
      now: NOW,
      capabilityProofs: [{ proofId: 'proof:native:1', scheme: 'native-signed-event' }]
    });
    expect(decision.status).toBe('deny');
    expect(decision.reasonCodes).toEqual(['capability.unverified-proof']);
  });

  it('an empty capabilityProofs array (no registry) preserves pre-registry behaviour', () => {
    // Empty array is a positive assertion of "no proofs to verify on
    // this decision" — distinct from missing-registry-with-refs.
    const decision = evaluateTrustSafetyCap({
      capabilityDecision: ALLOWED,
      capabilityAction: 'room.moderate',
      now: NOW,
      capabilityProofs: []
    });
    expect(decision).toEqual(ALLOWED);
  });

  it('explicit proofsState wins when both pathways are supplied', () => {
    let { registry } = regWithProof();
    registry = verifyProof(registry, 'proof:native:1', { now: NOW, verifier: VERIFY_ALL }).registry;
    // Registry would fold to 'verified', but caller asserts 'invalid'
    // — the explicit override wins (e.g., audit-row snapshot).
    const decision = evaluateTrustSafetyCap({
      capabilityDecision: ALLOWED,
      capabilityAction: 'room.moderate',
      now: NOW,
      proofRegistry: registry,
      capabilityProofs: [{ proofId: 'proof:native:1', scheme: 'native-signed-event' }],
      proofsState: 'invalid'
    });
    expect(decision.status).toBe('deny');
  });
});
