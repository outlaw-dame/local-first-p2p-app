import { describe, expect, it } from 'vitest';
import { validateSafetyAppeal } from '../index.js';

const AUTHORITY = {
  version: 'lfp2p.safety-authority.v1' as const,
  authorityId: 'auth_admin_01',
  actorId: 'actor_admin',
  role: 'admin' as const,
  scope: 'community-local' as const,
  createdAt: '2026-01-01T00:00:00Z'
};

const APPEAL_BASE = {
  version: 'lfp2p.safety-appeal.v1' as const,
  appealId: 'appeal_1',
  appellant: { actorId: 'actor_appellant' },
  decisionId: 'decision_42',
  targetAuthority: AUTHORITY,
  reasonCode: 'context-disputed',
  idempotencyKey: 'idem_1',
  createdAt: '2026-05-31T00:00:00Z'
};

describe('validateSafetyAppeal', () => {
  it('accepts a minimal appeal', () => {
    expect(() => validateSafetyAppeal(APPEAL_BASE)).not.toThrow();
  });

  it('rejects missing decisionId', () => {
    const rest: Partial<typeof APPEAL_BASE> = { ...APPEAL_BASE };
    delete rest.decisionId;
    expect(() => validateSafetyAppeal(rest)).toThrow();
  });

  it('rejects empty appellant.actorId', () => {
    expect(() => validateSafetyAppeal({ ...APPEAL_BASE, appellant: { actorId: '' } })).toThrow();
  });

  it('rejects missing idempotencyKey', () => {
    const rest: Partial<typeof APPEAL_BASE> = { ...APPEAL_BASE };
    delete rest.idempotencyKey;
    expect(() => validateSafetyAppeal(rest)).toThrow();
  });
});
