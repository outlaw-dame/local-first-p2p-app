import { describe, expect, it } from 'vitest';
import { evaluateTrustSafetyCap, type TrustSafetyCapInput } from '../index.js';

const NOW = '2026-06-08T12:00:00.000Z';

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
      capabilityDecision: {
        status: 'allow',
        reasonCodes: ['capability.valid'],
        capabilityId: 'cap:room:1',
        invocationId: 'invoke:room:1',
        createdAt: NOW,
        expiresAt: '2026-06-09T12:00:00.000Z'
      },
      capabilityAction: 'room.moderate',
      now: NOW
    };
    expect(evaluateTrustSafetyCap(input)).toEqual(input.capabilityDecision);
  });
});
