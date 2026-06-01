import { describe, expect, it } from 'vitest';
import { validateTransportAdmissionDecision } from '../index.js';

const BRIDGE_AUTHORITY = {
  version: 'lfp2p.safety-authority.v1' as const,
  authorityId: 'auth_bridge_01',
  actorId: 'actor_bridge',
  role: 'bridge-operator' as const,
  scope: 'bridge-local' as const,
  createdAt: '2026-01-01T00:00:00Z'
};

const MOD_AUTHORITY = {
  ...BRIDGE_AUTHORITY,
  authorityId: 'auth_mod_42',
  actorId: 'actor_mod_alice',
  role: 'moderator' as const,
  scope: 'community-local' as const
};

const ADMISSION_BASE = {
  version: 'lfp2p.transport-admission-decision.v1' as const,
  decisionId: 'tx_1',
  operatorAuthority: BRIDGE_AUTHORITY,
  subject: { type: 'event' as const, eventId: 'evt_x' },
  surface: 'bridge' as const,
  action: 'accept' as const,
  reasonCode: 'policy.local-preference' as const,
  policyVersion: 'bridge.policy.v1',
  createdAt: '2026-05-31T00:00:00Z'
};

describe('validateTransportAdmissionDecision', () => {
  it('accepts a minimal admission decision', () => {
    expect(() => validateTransportAdmissionDecision(ADMISSION_BASE)).not.toThrow();
  });

  it('rejects non-operator authority', () => {
    expect(() =>
      validateTransportAdmissionDecision({
        ...ADMISSION_BASE,
        operatorAuthority: MOD_AUTHORITY
      })
    ).toThrow(/TS_INVALID_ADMISSION/);
  });

  it('rejects surface/scope mismatch (relay surface from bridge operator)', () => {
    expect(() =>
      validateTransportAdmissionDecision({
        ...ADMISSION_BASE,
        surface: 'relay'
      })
    ).toThrow(/TS_INVALID_ADMISSION/);
  });

  it('rejects unknown action', () => {
    expect(() =>
      validateTransportAdmissionDecision({ ...ADMISSION_BASE, action: 'escalate' })
    ).toThrow(/TS_INVALID_ENUM/);
  });
});
