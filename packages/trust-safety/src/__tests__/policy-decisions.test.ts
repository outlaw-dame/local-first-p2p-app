import { describe, expect, it } from 'vitest';
import { validateSafetyPolicyDecision } from '../index.js';

const MOD_AUTHORITY = {
  version: 'lfp2p.safety-authority.v1' as const,
  authorityId: 'auth_mod_42',
  actorId: 'actor_mod_alice',
  role: 'moderator' as const,
  scope: 'community-local' as const,
  createdAt: '2026-05-01T00:00:00Z'
};

const BRIDGE_AUTHORITY = {
  ...MOD_AUTHORITY,
  authorityId: 'auth_bridge_01',
  actorId: 'actor_bridge',
  role: 'bridge-operator' as const,
  scope: 'bridge-local' as const
};

const VALID_DIGEST = {
  algorithm: 'sha-256' as const,
  digest: '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU'
};

const PRIVATE_BLOB_SUBJECT = {
  type: 'blob' as const,
  blockRef: {
    type: 'block-ref' as const,
    source: { kind: 'digest' as const, digest: VALID_DIGEST },
    byteLength: 1024,
    privacy: 'private' as const,
    encryption: { scheme: 'xchacha20-poly1305' as const, keyRef: VALID_DIGEST }
  }
};

const DECISION_BASE = {
  version: 'lfp2p.safety-policy-decision.v1' as const,
  decisionId: 'decision_1',
  authority: MOD_AUTHORITY,
  subject: { type: 'event' as const, eventId: 'evt_x' },
  action: 'hide' as const,
  scope: 'community-local' as const,
  policyVersion: 'community.policy.v1',
  reasonCode: 'abuse.harassment' as const,
  createdAt: '2026-05-31T00:00:00Z',
  appealable: true
};

describe('validateSafetyPolicyDecision', () => {
  it('accepts a minimal decision', () => {
    expect(() => validateSafetyPolicyDecision(DECISION_BASE)).not.toThrow();
  });

  it('rejects reject-transport at community-local scope', () => {
    expect(() =>
      validateSafetyPolicyDecision({ ...DECISION_BASE, action: 'reject-transport' })
    ).toThrow(/TS_ACTION_SCOPE_MISMATCH/);
  });

  it('accepts reject-transport at bridge-local scope', () => {
    expect(() =>
      validateSafetyPolicyDecision({
        ...DECISION_BASE,
        authority: BRIDGE_AUTHORITY,
        action: 'reject-transport',
        scope: 'bridge-local'
      })
    ).not.toThrow();
  });

  it('rejects curation action at bridge-local scope', () => {
    expect(() =>
      validateSafetyPolicyDecision({
        ...DECISION_BASE,
        authority: BRIDGE_AUTHORITY,
        action: 'downrank',
        scope: 'bridge-local'
      })
    ).toThrow(/TS_ACTION_SCOPE_MISMATCH/);
  });

  it('rejects private subject at network-advisory scope (privacy leak)', () => {
    expect(() =>
      validateSafetyPolicyDecision({
        ...DECISION_BASE,
        subject: PRIVATE_BLOB_SUBJECT,
        scope: 'network-advisory'
      })
    ).toThrow(/TS_PRIVATE_LEAK/);
  });

  it('rejects unknown action', () => {
    expect(() =>
      validateSafetyPolicyDecision({ ...DECISION_BASE, action: 'make-disappear' })
    ).toThrow(/TS_INVALID_ENUM/);
  });

  it('rejects appealable=non-boolean', () => {
    expect(() => validateSafetyPolicyDecision({ ...DECISION_BASE, appealable: 'yes' })).toThrow(
      /TS_INVALID_DECISION/
    );
  });
});
