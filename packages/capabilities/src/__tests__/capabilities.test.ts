import { describe, expect, it } from 'vitest';
import {
  applyCapabilityGrant,
  applyCapabilityInvocationRecord,
  applyCapabilityRevocation,
  createEmptyCapabilityProjection,
  evaluateCapabilityInvocation,
  hasInvocationReplay,
  isCapabilityRevoked,
  validateCapabilityGrant,
  validateCapabilityInvocation,
  validateCapabilityRevocation,
  type CapabilityGrantV1,
  type CapabilityInvocationV1,
  type CapabilityRevocationV1
} from '../index.js';

const NOW = '2026-06-08T12:00:00.000Z';
const FUTURE = '2026-06-09T12:00:00.000Z';
const PAST = '2026-06-07T12:00:00.000Z';

function baseGrant(overrides: Partial<CapabilityGrantV1> = {}): CapabilityGrantV1 {
  return {
    version: 'lfp2p.capability.grant.v1',
    capabilityId: 'cap:moderate-room:1',
    issuer: { kind: 'controller', id: 'controller:damon' },
    audience: { kind: 'device', id: 'device:moderator-1' },
    resource: { kind: 'room', id: 'room:local-first' },
    actions: ['room.moderate'],
    scope: { kind: 'room', id: 'room:local-first' },
    caveats: [],
    expiresAt: FUTURE,
    delegationDepth: 0,
    nonce: 'nonce:grant:1',
    proofRefs: [{ proofId: 'proof:controller:1', scheme: 'native-signed-event' }],
    createdAt: NOW,
    ...overrides
  };
}

function baseInvocation(overrides: Partial<CapabilityInvocationV1> = {}): CapabilityInvocationV1 {
  return {
    version: 'lfp2p.capability.invocation.v1',
    invocationId: 'invoke:moderate-room:1',
    capabilityId: 'cap:moderate-room:1',
    invoker: { kind: 'device', id: 'device:moderator-1' },
    device: { kind: 'device', id: 'device:moderator-1' },
    resource: { kind: 'room', id: 'room:local-first' },
    action: 'room.moderate',
    scope: { kind: 'room', id: 'room:local-first' },
    argumentsDigest: 'sha-256:abcdefghi',
    nonce: 'nonce:invoke:1',
    createdAt: NOW,
    proofRefs: [{ proofId: 'proof:controller:1', scheme: 'native-signed-event' }],
    ...overrides
  };
}

function baseRevocation(overrides: Partial<CapabilityRevocationV1> = {}): CapabilityRevocationV1 {
  return {
    version: 'lfp2p.capability.revocation.v1',
    revocationId: 'revoke:moderate-room:1',
    capabilityId: 'cap:moderate-room:1',
    issuer: { kind: 'controller', id: 'controller:damon' },
    reasonCode: 'policy-change',
    createdAt: NOW,
    proofRefs: [{ proofId: 'proof:controller:2', scheme: 'native-signed-event' }],
    ...overrides
  };
}

describe('@lfp2p/capabilities validation', () => {
  it('validates and deep-freezes a grant', () => {
    const grant = validateCapabilityGrant(baseGrant());
    expect(grant.capabilityId).toBe('cap:moderate-room:1');
    expect(Object.isFrozen(grant)).toBe(true);
    expect(Object.isFrozen(grant.issuer)).toBe(true);
    expect(Object.isFrozen(grant.actions)).toBe(true);
  });

  it('validates and deep-freezes invocation and revocation objects', () => {
    const invocation = validateCapabilityInvocation(baseInvocation());
    const revocation = validateCapabilityRevocation(baseRevocation());
    expect(Object.isFrozen(invocation)).toBe(true);
    expect(Object.isFrozen(revocation)).toBe(true);
  });

  it('rejects unknown versions', () => {
    expect(() => validateCapabilityGrant({ ...baseGrant(), version: 'lfp2p.capability.grant.v2' })).toThrow('CAP_UNKNOWN_VERSION');
  });

  it('rejects duplicate and wildcard actions', () => {
    expect(() => validateCapabilityGrant({ ...baseGrant(), actions: ['room.moderate', 'room.moderate'] })).toThrow('CAP_DUPLICATE_VALUE');
    expect(() => validateCapabilityGrant({ ...baseGrant(), actions: ['*'] })).toThrow('CAP_INVALID_ACTION');
  });

  it('rejects invalid time windows', () => {
    expect(() => validateCapabilityGrant({ ...baseGrant(), notBefore: FUTURE, expiresAt: NOW })).toThrow('CAP_INVALID_TIMESTAMP');
    expect(() => validateCapabilityInvocation({ ...baseInvocation(), expiresAt: PAST })).toThrow('CAP_INVALID_TIMESTAMP');
  });

  it('rejects prototype-pollution keys and values', () => {
    expect(() => validateCapabilityGrant({ ...baseGrant(), capabilityId: '__proto__' })).toThrow('CAP_FORBIDDEN_KEY');
    expect(() => validateCapabilityGrant({ ...baseGrant(), caveats: [{ kind: 'resource-is', value: { constructor: 'x' } }] })).toThrow('CAP_FORBIDDEN_KEY');
  });
});

describe('@lfp2p/capabilities evaluation', () => {
  it('allows a matching grant and invocation with verified proof and trusted issuer', () => {
    const decision = evaluateCapabilityInvocation({
      grant: baseGrant(),
      invocation: baseInvocation(),
      now: NOW,
      verifiedProofIds: new Set(['proof:controller:1']),
      trustedIssuerIds: new Set(['controller:damon']),
      authorityContext: 'moderation'
    });
    expect(decision.status).toBe('allow');
    expect(decision.reasonCodes).toEqual(['capability.valid']);
  });

  it('denies expired, revoked, wrong audience, and replayed invocations', () => {
    expect(evaluateCapabilityInvocation({ grant: baseGrant({ expiresAt: PAST }), invocation: baseInvocation(), now: NOW, authorityContext: 'moderation' }).reasonCodes).toContain('capability.expired');
    expect(evaluateCapabilityInvocation({ grant: baseGrant(), invocation: baseInvocation(), revocations: [baseRevocation()], now: NOW, authorityContext: 'moderation' }).reasonCodes).toContain('capability.revoked');
    expect(evaluateCapabilityInvocation({ grant: baseGrant(), invocation: baseInvocation({ invoker: { kind: 'device', id: 'device:other' } }), now: NOW, authorityContext: 'moderation' }).reasonCodes).toContain('capability.wrong-audience');
    expect(evaluateCapabilityInvocation({ grant: baseGrant(), invocation: baseInvocation(), now: NOW, replayedInvocationIds: new Set(['invoke:moderate-room:1']), authorityContext: 'moderation' }).reasonCodes).toContain('capability.replayed-invocation');
  });

  it('denies untrusted issuers and unverified proofs', () => {
    const untrusted = evaluateCapabilityInvocation({
      grant: baseGrant(),
      invocation: baseInvocation(),
      now: NOW,
      trustedIssuerIds: new Set(['controller:someone-else']),
      authorityContext: 'moderation'
    });
    expect(untrusted.reasonCodes).toContain('capability.untrusted-issuer');

    const unverified = evaluateCapabilityInvocation({
      grant: baseGrant(),
      invocation: baseInvocation(),
      now: NOW,
      verifiedProofIds: new Set(['proof:other']),
      authorityContext: 'moderation'
    });
    expect(unverified.reasonCodes).toContain('capability.unverified-proof');
  });

  it('denies unsatisfied caveats', () => {
    const decision = evaluateCapabilityInvocation({
      grant: baseGrant({ caveats: [{ kind: 'resource-is', value: 'room:other' }] }),
      invocation: baseInvocation(),
      now: NOW,
      authorityContext: 'moderation'
    });
    expect(decision.reasonCodes).toContain('capability.unsatisfied-caveat');
  });
});

describe('@lfp2p/capabilities projection', () => {
  it('records grants, invocations, and revocation tombstones', () => {
    let projection = createEmptyCapabilityProjection();
    projection = applyCapabilityGrant(projection, baseGrant());
    expect(projection.grants['cap:moderate-room:1']?.state).toBe('active');

    projection = applyCapabilityInvocationRecord(projection, baseInvocation());
    expect(hasInvocationReplay(projection, 'invoke:moderate-room:1')).toBe(true);

    projection = applyCapabilityRevocation(projection, baseRevocation());
    expect(isCapabilityRevoked(projection, 'cap:moderate-room:1')).toBe(true);
    expect(projection.grants['cap:moderate-room:1']?.revocationIds).toEqual(['revoke:moderate-room:1']);
  });

  it('prevents out-of-order revocation resurrection', () => {
    let projection = createEmptyCapabilityProjection();
    projection = applyCapabilityRevocation(projection, baseRevocation());
    expect(isCapabilityRevoked(projection, 'cap:moderate-room:1')).toBe(true);

    projection = applyCapabilityGrant(projection, baseGrant());
    expect(projection.grants['cap:moderate-room:1']?.state).toBe('revoked');
    expect(isCapabilityRevoked(projection, 'cap:moderate-room:1')).toBe(true);
  });
});
