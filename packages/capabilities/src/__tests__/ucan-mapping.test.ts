import { describe, expect, it } from 'vitest';
import { mapUcanLikeGrantToCapabilityGrant } from '../ucan-mapping.js';

describe('ucan-like mapping contract', () => {
  it('maps a ucan-like capability into a native capability grant', () => {
    const grant = mapUcanLikeGrantToCapabilityGrant({
      capabilityId: 'cap:sync:1',
      issuer: { kind: 'controller', id: 'controller:damon' },
      audience: { kind: 'device', id: 'device:1' },
      resource: { kind: 'sync-stream', id: 'sync:main' },
      scope: { kind: 'self', id: 'self' },
      capability: { with: 'sync:main', can: 'sync.pull' },
      proofs: [{ proofId: 'ucan:proof:1' }],
      expiresAt: '2026-06-09T12:00:00.000Z',
      createdAt: '2026-06-08T12:00:00.000Z',
      nonce: 'nonce:ucan:1'
    });

    expect(grant.version).toBe('lfp2p.capability.grant.v1');
    expect(grant.actions).toEqual(['sync.pull']);
    expect(grant.proofRefs).toEqual([{ proofId: 'ucan:proof:1', scheme: 'ucan' }]);
    expect(Object.isFrozen(grant)).toBe(true);
  });

  it('fails closed through native validation for invalid actions', () => {
    expect(() => mapUcanLikeGrantToCapabilityGrant({
      capabilityId: 'cap:bad:1',
      issuer: { kind: 'controller', id: 'controller:damon' },
      audience: { kind: 'device', id: 'device:1' },
      resource: { kind: 'sync-stream', id: 'sync:main' },
      scope: { kind: 'self', id: 'self' },
      capability: { with: 'sync:main', can: 'admin.everything' as never },
      expiresAt: '2026-06-09T12:00:00.000Z',
      createdAt: '2026-06-08T12:00:00.000Z',
      nonce: 'nonce:bad:1'
    })).toThrow('CAP_INVALID_ACTION');
  });
});
