import { describe, expect, it } from 'vitest';
import {
  evaluateCapabilityReliance,
  isBearcapForbiddenAction,
  type CapabilityDecision
} from '../index.js';

const NOW = '2026-06-08T12:00:00.000Z';

const allowed: CapabilityDecision = {
  status: 'allow',
  reasonCodes: ['capability.valid'],
  capabilityId: 'cap:room:1',
  invocationId: 'invoke:room:1',
  createdAt: NOW,
  expiresAt: '2026-06-09T12:00:00.000Z'
};

describe('capability reliance helper', () => {
  it('rejects credential evidence without a capability decision', () => {
    const decision = evaluateCapabilityReliance({
      credentialEvidence: [{ credentialId: 'vc:1', issuerId: 'issuer:1', claimType: 'moderator' }],
      action: 'room.moderate',
      now: NOW
    });
    expect(decision.reasonCodes).toEqual(['capability.vc-only-authority-denied']);
  });

  it('rejects missing capability decisions', () => {
    const decision = evaluateCapabilityReliance({ action: 'room.moderate', now: NOW });
    expect(decision.reasonCodes).toEqual(['capability.unverified-proof']);
  });

  it('rejects bearcap proofs for protected actions', () => {
    const decision = evaluateCapabilityReliance({
      capabilityDecision: { ...allowed, capabilityId: 'cap:label:1' },
      capabilityProofs: [{ proofId: 'proof:bearcap:1', scheme: 'bearcap' }],
      action: 'label.issue',
      now: NOW
    });
    expect(decision.reasonCodes).toEqual(['capability.bearcap-forbidden-for-action']);
  });

  it('returns allowed capability decisions unchanged', () => {
    const decision = evaluateCapabilityReliance({
      capabilityDecision: allowed,
      capabilityProofs: [{ proofId: 'proof:1', scheme: 'native-signed-event' }],
      action: 'room.moderate',
      now: NOW
    });
    expect(decision).toEqual(allowed);
  });

  it('classifies protected action prefixes', () => {
    expect(isBearcapForbiddenAction('identity.capability.grant')).toBe(true);
    expect(isBearcapForbiddenAction('label.issue')).toBe(true);
    expect(isBearcapForbiddenAction('room.moderate')).toBe(false);
  });
});
