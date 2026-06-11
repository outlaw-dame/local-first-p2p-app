import { describe, expect, it } from 'vitest';
import { isVcBindingEligibleForAction, validateVcAuthorityBinding } from '../vc-authority-binding.js';

const NOW = '2026-06-08T12:00:00.000Z';

function binding(overrides = {}) {
  return {
    bindingId: 'binding:1',
    credential: { proofId: 'vc:1', scheme: 'vc' },
    authority: { kind: 'actor', id: 'actor:alice' },
    resource: { kind: 'community', id: 'community:1' },
    scope: { kind: 'community', id: 'community:1' },
    eligibleActions: ['community.member.remove'],
    issuedAt: NOW,
    expiresAt: '2026-06-09T12:00:00.000Z',
    ...overrides
  };
}

describe('vc authority binding', () => {
  it('validates vc authority bindings', () => {
    const result = validateVcAuthorityBinding(binding());
    expect(result.credential.scheme).toBe('vc');
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('rejects non-vc proof schemes', () => {
    expect(() => validateVcAuthorityBinding(binding({ credential: { proofId: 'proof:1', scheme: 'ucan' } }))).toThrow('CAP_INVALID_PROOF');
  });

  it('checks action eligibility without granting authority', () => {
    const result = validateVcAuthorityBinding(binding());
    expect(isVcBindingEligibleForAction(result, 'community.member.remove', NOW)).toBe(true);
    expect(isVcBindingEligibleForAction(result, 'community.role.assign', NOW)).toBe(false);
  });

  it('fails closed for expired bindings and invalid evaluator time', () => {
    const expired = validateVcAuthorityBinding(binding({ expiresAt: NOW }));
    expect(isVcBindingEligibleForAction(expired, 'community.member.remove', NOW)).toBe(false);
    expect(isVcBindingEligibleForAction(expired, 'community.member.remove', 'bad-time')).toBe(false);
  });
});
