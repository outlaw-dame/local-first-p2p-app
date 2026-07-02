import { describe, expect, it } from 'vitest';
import type { CapabilityGrantV1, CapabilityAction } from '../types.js';
import {
  CapabilityDelegationGraph,
  detectDelegationCycle,
  buildCapabilityProofGraph,
  validateCapabilityRevocationRecord,
  isDelegationPathValid,
  isCapabilityAuthorized
} from '../delegation-graph.js';

const NOW = '2026-06-08T12:00:00.000Z';

function mockGrant(opts: {
  capabilityId: string;
  issuerId: string;
  audienceId: string;
  resourceId?: string;
  actions?: CapabilityAction[];
  scopeId?: string;
  expiresAt?: string;
  delegationDepth?: number;
  proofRefs?: { proofId: string; scheme: 'native-signed-event' }[];
}): CapabilityGrantV1 {
  return {
    version: 'lfp2p.capability.grant.v1',
    capabilityId: opts.capabilityId,
    issuer: { kind: 'actor', id: opts.issuerId },
    audience: { kind: 'actor', id: opts.audienceId },
    resource: { kind: 'room', id: opts.resourceId ?? 'room:1' },
    actions: opts.actions ?? ['sync.pull'],
    scope: { kind: 'room', id: opts.scopeId ?? 'room:1' },
    caveats: [],
    expiresAt: opts.expiresAt ?? '2026-06-09T00:00:00.000Z',
    delegationDepth: opts.delegationDepth ?? 2,
    nonce: `nonce:${opts.capabilityId}`,
    proofRefs: opts.proofRefs ?? [],
    createdAt: '2026-06-08T00:00:00.000Z'
  };
}

describe('delegation graph runtime', () => {
  it('validates a valid delegation chain: A -> B -> C', () => {
    const grantA = mockGrant({
      capabilityId: 'cap:A',
      issuerId: 'actor:root',
      audienceId: 'actor:A',
      expiresAt: '2026-06-10T00:00:00.000Z',
      delegationDepth: 3
    });

    const grantB = mockGrant({
      capabilityId: 'cap:B',
      issuerId: 'actor:A',
      audienceId: 'actor:B',
      proofRefs: [{ proofId: 'cap:A', scheme: 'native-signed-event' }],
      expiresAt: '2026-06-09T12:00:00.000Z',
      delegationDepth: 2
    });

    const grantC = mockGrant({
      capabilityId: 'cap:C',
      issuerId: 'actor:B',
      audienceId: 'actor:C',
      proofRefs: [{ proofId: 'cap:B', scheme: 'native-signed-event' }],
      expiresAt: '2026-06-09T00:00:00.000Z',
      delegationDepth: 1
    });

    const graph = new CapabilityDelegationGraph([grantA, grantB, grantC]);

    expect(detectDelegationCycle(graph)).toBe(false);

    const paths = buildCapabilityProofGraph(graph, 'cap:C');
    expect(paths).toHaveLength(1);
    expect(paths[0]?.grants.map((g) => g.capabilityId)).toEqual(['cap:A', 'cap:B', 'cap:C']);

    expect(paths[0]).toBeDefined();
    expect(isDelegationPathValid(graph, paths[0]!, NOW)).toBe(true);
    expect(isCapabilityAuthorized(graph, 'cap:C', NOW)).toBe(true);
  });

  it('fails scope escalation: read -> write', () => {
    const grantA = mockGrant({
      capabilityId: 'cap:A',
      issuerId: 'actor:root',
      audienceId: 'actor:A',
      scopeId: 'room:read-only'
    });

    const grantB = mockGrant({
      capabilityId: 'cap:B',
      issuerId: 'actor:A',
      audienceId: 'actor:B',
      proofRefs: [{ proofId: 'cap:A', scheme: 'native-signed-event' }],
      scopeId: 'room:write'
    });

    const graph = new CapabilityDelegationGraph([grantA, grantB]);
    expect(isCapabilityAuthorized(graph, 'cap:B', NOW)).toBe(false);
  });

  it('fails action escalation: sync.pull -> sync.push', () => {
    const grantA = mockGrant({
      capabilityId: 'cap:A',
      issuerId: 'actor:root',
      audienceId: 'actor:A',
      actions: ['sync.pull']
    });

    const grantB = mockGrant({
      capabilityId: 'cap:B',
      issuerId: 'actor:A',
      audienceId: 'actor:B',
      proofRefs: [{ proofId: 'cap:A', scheme: 'native-signed-event' }],
      actions: ['sync.push']
    });

    const graph = new CapabilityDelegationGraph([grantA, grantB]);
    expect(isCapabilityAuthorized(graph, 'cap:B', NOW)).toBe(false);
  });

  it('fails expiry extension', () => {
    const grantA = mockGrant({
      capabilityId: 'cap:A',
      issuerId: 'actor:root',
      audienceId: 'actor:A',
      expiresAt: '2026-06-09T00:00:00.000Z'
    });

    const grantB = mockGrant({
      capabilityId: 'cap:B',
      issuerId: 'actor:A',
      audienceId: 'actor:B',
      proofRefs: [{ proofId: 'cap:A', scheme: 'native-signed-event' }],
      expiresAt: '2026-06-10T00:00:00.000Z'
    });

    const graph = new CapabilityDelegationGraph([grantA, grantB]);
    expect(isCapabilityAuthorized(graph, 'cap:B', NOW)).toBe(false);
  });

  it('fails when delegationDepth increases', () => {
    const grantA = mockGrant({
      capabilityId: 'cap:A',
      issuerId: 'actor:root',
      audienceId: 'actor:A',
      delegationDepth: 1
    });

    const grantB = mockGrant({
      capabilityId: 'cap:B',
      issuerId: 'actor:A',
      audienceId: 'actor:B',
      proofRefs: [{ proofId: 'cap:A', scheme: 'native-signed-event' }],
      delegationDepth: 2
    });

    const graph = new CapabilityDelegationGraph([grantA, grantB]);
    expect(isCapabilityAuthorized(graph, 'cap:B', NOW)).toBe(false);
  });

  it('detects and fails cycle: A -> B -> C -> A', () => {
    const grantA = mockGrant({
      capabilityId: 'cap:A',
      issuerId: 'actor:C',
      audienceId: 'actor:A',
      proofRefs: [{ proofId: 'cap:C', scheme: 'native-signed-event' }]
    });

    const grantB = mockGrant({
      capabilityId: 'cap:B',
      issuerId: 'actor:A',
      audienceId: 'actor:B',
      proofRefs: [{ proofId: 'cap:A', scheme: 'native-signed-event' }]
    });

    const grantC = mockGrant({
      capabilityId: 'cap:C',
      issuerId: 'actor:B',
      audienceId: 'actor:C',
      proofRefs: [{ proofId: 'cap:B', scheme: 'native-signed-event' }]
    });

    const graph = new CapabilityDelegationGraph([grantA, grantB, grantC]);
    expect(detectDelegationCycle(graph)).toBe(true);
    expect(isCapabilityAuthorized(graph, 'cap:C', NOW)).toBe(false);
  });

  it('handles root revocation: revoking root grant invalidates all descendants', () => {
    const grantA = mockGrant({
      capabilityId: 'cap:A',
      issuerId: 'actor:root',
      audienceId: 'actor:A',
      delegationDepth: 2
    });

    const grantB = mockGrant({
      capabilityId: 'cap:B',
      issuerId: 'actor:A',
      audienceId: 'actor:B',
      proofRefs: [{ proofId: 'cap:A', scheme: 'native-signed-event' }],
      delegationDepth: 1
    });

    const graph = new CapabilityDelegationGraph([grantA, grantB]);

    expect(isCapabilityAuthorized(graph, 'cap:B', NOW)).toBe(true);

    const revocation = validateCapabilityRevocationRecord({
      capabilityId: 'cap:A',
      revokedAt: '2026-06-08T10:00:00.000Z',
      revokedBy: 'actor:root',
      reason: 'Key compromised'
    });
    graph.addRevocation(revocation);

    expect(isCapabilityAuthorized(graph, 'cap:B', NOW)).toBe(false);
  });

  it('handles intermediate revocation: revoking intermediate grant invalidates descendants but not ancestors', () => {
    const grantA = mockGrant({
      capabilityId: 'cap:A',
      issuerId: 'actor:root',
      audienceId: 'actor:A',
      delegationDepth: 3
    });

    const grantB = mockGrant({
      capabilityId: 'cap:B',
      issuerId: 'actor:A',
      audienceId: 'actor:B',
      proofRefs: [{ proofId: 'cap:A', scheme: 'native-signed-event' }],
      delegationDepth: 2
    });

    const grantC = mockGrant({
      capabilityId: 'cap:C',
      issuerId: 'actor:B',
      audienceId: 'actor:C',
      proofRefs: [{ proofId: 'cap:B', scheme: 'native-signed-event' }],
      delegationDepth: 1
    });

    const graph = new CapabilityDelegationGraph([grantA, grantB, grantC]);

    expect(isCapabilityAuthorized(graph, 'cap:A', NOW)).toBe(true);
    expect(isCapabilityAuthorized(graph, 'cap:B', NOW)).toBe(true);
    expect(isCapabilityAuthorized(graph, 'cap:C', NOW)).toBe(true);

    const revocationB = validateCapabilityRevocationRecord({
      capabilityId: 'cap:B',
      revokedAt: '2026-06-08T10:00:00.000Z',
      revokedBy: 'actor:A',
      reason: 'Intermediate delegation revoked'
    });
    graph.addRevocation(revocationB);

    expect(isCapabilityAuthorized(graph, 'cap:A', NOW)).toBe(true);
    expect(isCapabilityAuthorized(graph, 'cap:B', NOW)).toBe(false);
    expect(isCapabilityAuthorized(graph, 'cap:C', NOW)).toBe(false);
  });

  it('fails evaluation on invalid evaluator time parameter', () => {
    const grant = mockGrant({
      capabilityId: 'cap:A',
      issuerId: 'actor:root',
      audienceId: 'actor:A',
      expiresAt: '2026-06-09T00:00:00.000Z'
    });
    const graph = new CapabilityDelegationGraph([grant]);

    expect(isCapabilityAuthorized(graph, 'cap:A', 'invalid-date-string')).toBe(false);
  });

  it('fails when parent delegationDepth is 0', () => {
    const grantA = mockGrant({
      capabilityId: 'cap:A',
      issuerId: 'actor:root',
      audienceId: 'actor:A',
      delegationDepth: 0
    });
    const grantB = mockGrant({
      capabilityId: 'cap:B',
      issuerId: 'actor:A',
      audienceId: 'actor:B',
      proofRefs: [{ proofId: 'cap:A', scheme: 'native-signed-event' }],
      delegationDepth: 0
    });
    const graph = new CapabilityDelegationGraph([grantA, grantB]);
    expect(isCapabilityAuthorized(graph, 'cap:B', NOW)).toBe(false);
  });

  it('fails when child delegationDepth is equal to parent delegationDepth', () => {
    const grantA = mockGrant({
      capabilityId: 'cap:A',
      issuerId: 'actor:root',
      audienceId: 'actor:A',
      delegationDepth: 2
    });
    const grantB = mockGrant({
      capabilityId: 'cap:B',
      issuerId: 'actor:A',
      audienceId: 'actor:B',
      proofRefs: [{ proofId: 'cap:A', scheme: 'native-signed-event' }],
      delegationDepth: 2
    });
    const graph = new CapabilityDelegationGraph([grantA, grantB]);
    expect(isCapabilityAuthorized(graph, 'cap:B', NOW)).toBe(false);
  });

  it('fails notBefore escalation: parent has notBefore but child does not', () => {
    const grantA = {
      ...mockGrant({
        capabilityId: 'cap:A',
        issuerId: 'actor:root',
        audienceId: 'actor:A'
      }),
      notBefore: '2026-06-08T10:00:00.000Z'
    };
    const grantB = mockGrant({
      capabilityId: 'cap:B',
      issuerId: 'actor:A',
      audienceId: 'actor:B',
      proofRefs: [{ proofId: 'cap:A', scheme: 'native-signed-event' }]
    });
    const graph = new CapabilityDelegationGraph([grantA, grantB]);
    expect(isCapabilityAuthorized(graph, 'cap:B', NOW)).toBe(false);
  });

  it('fails notBefore escalation: child has earlier notBefore than parent', () => {
    const grantA = {
      ...mockGrant({
        capabilityId: 'cap:A',
        issuerId: 'actor:root',
        audienceId: 'actor:A'
      }),
      notBefore: '2026-06-08T10:00:00.000Z'
    };
    const grantB = {
      ...mockGrant({
        capabilityId: 'cap:B',
        issuerId: 'actor:A',
        audienceId: 'actor:B',
        proofRefs: [{ proofId: 'cap:A', scheme: 'native-signed-event' }]
      }),
      notBefore: '2026-06-08T09:00:00.000Z'
    };
    const graph = new CapabilityDelegationGraph([grantA, grantB]);
    expect(isCapabilityAuthorized(graph, 'cap:B', NOW)).toBe(false);
  });

  it('ignores revocation record issued by unauthorized actor', () => {
    const grantA = mockGrant({
      capabilityId: 'cap:A',
      issuerId: 'actor:root',
      audienceId: 'actor:A'
    });
    const graph = new CapabilityDelegationGraph([grantA]);

    expect(isCapabilityAuthorized(graph, 'cap:A', NOW)).toBe(true);

    const revocation = validateCapabilityRevocationRecord({
      capabilityId: 'cap:A',
      revokedAt: '2026-06-08T10:00:00.000Z',
      revokedBy: 'actor:attacker',
      reason: 'Malicious revocation attempt'
    });
    graph.addRevocation(revocation);

    expect(isCapabilityAuthorized(graph, 'cap:A', NOW)).toBe(true);
  });

  it('fails authorization if path contains outstanding proofRefs that are not in the graph', () => {
    const grantB = mockGrant({
      capabilityId: 'cap:B',
      issuerId: 'actor:A',
      audienceId: 'actor:B',
      proofRefs: [{ proofId: 'cap:A', scheme: 'native-signed-event' }]
    });

    const graph = new CapabilityDelegationGraph([grantB]);

    expect(isCapabilityAuthorized(graph, 'cap:B', NOW)).toBe(false);
  });

  it('does not allow unauthorized revocation to overwrite/bypass an authorized revocation', () => {
    const grantA = mockGrant({
      capabilityId: 'cap:A',
      issuerId: 'actor:root',
      audienceId: 'actor:A'
    });
    const graph = new CapabilityDelegationGraph([grantA]);

    const authorizedRevocation = validateCapabilityRevocationRecord({
      capabilityId: 'cap:A',
      revokedAt: '2026-06-08T10:00:00.000Z',
      revokedBy: 'actor:root',
      reason: 'Key compromised'
    });
    graph.addRevocation(authorizedRevocation);
    expect(isCapabilityAuthorized(graph, 'cap:A', NOW)).toBe(false);

    const unauthorizedRevocation = validateCapabilityRevocationRecord({
      capabilityId: 'cap:A',
      revokedAt: '2026-06-08T10:00:00.000Z',
      revokedBy: 'actor:attacker',
      reason: 'Malicious overwrite'
    });
    graph.addRevocation(unauthorizedRevocation);

    expect(isCapabilityAuthorized(graph, 'cap:A', NOW)).toBe(false);
  });
});
