import { describe, expect, it } from 'vitest';
import type { ModerationEvent } from '../index.js';
import {
  applyModerationEvent,
  createEmptyModerationState,
  queueItemsForSource,
  seedModerationState
} from '../index.js';

const ADMIN = {
  version: 'lfp2p.safety-authority.v1' as const,
  authorityId: 'auth_admin_01',
  actorId: 'actor_admin',
  role: 'admin' as const,
  scope: 'community-local' as const,
  createdAt: '2026-01-01T00:00:00Z'
};

const MOD = {
  version: 'lfp2p.safety-authority.v1' as const,
  authorityId: 'auth_mod_42',
  actorId: 'actor_mod_alice',
  role: 'moderator' as const,
  scope: 'community-local' as const,
  createdAt: '2026-01-01T00:00:00Z'
};

function policy(versionNumber: number, supersedes?: number): unknown {
  const p: Record<string, unknown> = {
    version: 'lfp2p.safety-policy.v1',
    policyId: 'policy_community_rules',
    policyVersionNumber: versionNumber,
    title: 'Community Rules',
    body: 'Be excellent to each other.',
    scope: 'community-local',
    applicableActions: ['warn', 'hide', 'remove-local'],
    createdBy: ADMIN,
    createdAt: '2026-01-01T00:00:00Z'
  };
  if (supersedes !== undefined) p.supersedesPolicyVersionNumber = supersedes;
  return p;
}

function policyCreated(versionNumber = 1, evId = 'evt_pol_create'): ModerationEvent {
  return {
    version: 'lfp2p.moderation-event.v1',
    eventId: evId,
    createdAt: '2026-01-01T00:00:00Z',
    kind: 'safety.policy.created',
    policy: policy(versionNumber)
  } as unknown as ModerationEvent;
}

function policyUpdated(versionNumber: number, supersedes: number, evId: string): ModerationEvent {
  return {
    version: 'lfp2p.moderation-event.v1',
    eventId: evId,
    createdAt: '2026-02-01T00:00:00Z',
    kind: 'safety.policy.updated',
    policy: policy(versionNumber, supersedes)
  } as unknown as ModerationEvent;
}

function policyDeprecated(evId: string, replacement?: string): ModerationEvent {
  const out: Record<string, unknown> = {
    version: 'lfp2p.moderation-event.v1',
    eventId: evId,
    createdAt: '2026-06-01T00:00:00Z',
    kind: 'safety.policy.deprecated',
    policyId: 'policy_community_rules',
    deprecatedBy: ADMIN,
    deprecatedAt: '2026-06-01T00:00:00Z',
    reasonCode: 'policy.community-rule'
  };
  if (replacement !== undefined) out.replacementPolicyId = replacement;
  return out as unknown as ModerationEvent;
}

function queueCreated(queueItemId: string, sourceId: string, evId: string): ModerationEvent {
  return {
    version: 'lfp2p.moderation-event.v1',
    eventId: evId,
    createdAt: '2026-05-31T01:00:00Z',
    kind: 'moderation.queue.item.created',
    queueItemId,
    ownerAuthority: MOD,
    sourceKind: 'report',
    sourceId,
    reasonCode: 'abuse.harassment'
  } as unknown as ModerationEvent;
}

function queueAssigned(queueItemId: string, evId: string): ModerationEvent {
  return {
    version: 'lfp2p.moderation-event.v1',
    eventId: evId,
    createdAt: '2026-05-31T02:00:00Z',
    kind: 'moderation.queue.item.assigned',
    queueItemId,
    assignedTo: MOD,
    assignedAt: '2026-05-31T02:00:00Z'
  } as unknown as ModerationEvent;
}

function queueResolved(
  queueItemId: string,
  resolution: string,
  evId: string,
  decisionId?: string
): ModerationEvent {
  const out: Record<string, unknown> = {
    version: 'lfp2p.moderation-event.v1',
    eventId: evId,
    createdAt: '2026-05-31T03:00:00Z',
    kind: 'moderation.queue.item.resolved',
    queueItemId,
    resolvedBy: MOD,
    resolvedAt: '2026-05-31T03:00:00Z',
    resolution,
    resolutionReasonCode: 'abuse.harassment'
  };
  if (decisionId !== undefined) out.resolutionDecisionId = decisionId;
  return out as unknown as ModerationEvent;
}

function decisionRecorded(decisionId: string, evId: string, sourceQueueItemId?: string): ModerationEvent {
  const out: Record<string, unknown> = {
    version: 'lfp2p.moderation-event.v1',
    eventId: evId,
    createdAt: '2026-05-31T03:01:00Z',
    kind: 'safety.policy.decision.recorded',
    decision: {
      version: 'lfp2p.safety-policy-decision.v1',
      decisionId,
      authority: MOD,
      subject: { type: 'event', eventId: 'evt_target' },
      action: 'hide',
      scope: 'community-local',
      policyVersion: 'community.policy.v1',
      reasonCode: 'abuse.harassment',
      createdAt: '2026-05-31T03:01:00Z',
      appealable: true
    }
  };
  if (sourceQueueItemId !== undefined) out.sourceQueueItemId = sourceQueueItemId;
  return out as unknown as ModerationEvent;
}

describe('moderation runtime — policy lifecycle', () => {
  it('creates a v1 policy and tracks the active version', () => {
    const s = applyModerationEvent(createEmptyModerationState(), policyCreated());
    expect(s.activePolicyVersionByPolicyId['policy_community_rules']).toBe(1);
    expect(s.policiesByPolicyIdAndVersion['policy_community_rules::1']?.status).toBe('active');
  });

  it('rejects safety.policy.created when policyVersionNumber is not 1', () => {
    expect(() =>
      applyModerationEvent(createEmptyModerationState(), policyCreated(2))
    ).toThrow(/policyVersionNumber === 1/);
  });

  it('rejects safety.policy.created when the policyId already exists', () => {
    const s = applyModerationEvent(createEmptyModerationState(), policyCreated());
    expect(() =>
      applyModerationEvent(s, policyCreated(1, 'evt_pol_create_2'))
    ).toThrow(/already exists/);
  });

  it('updates v1 -> v2 with matching supersedes pointer', () => {
    let s = applyModerationEvent(createEmptyModerationState(), policyCreated());
    s = applyModerationEvent(s, policyUpdated(2, 1, 'evt_pol_update'));
    expect(s.activePolicyVersionByPolicyId['policy_community_rules']).toBe(2);
    expect(s.policiesByPolicyIdAndVersion['policy_community_rules::1']?.status).toBe('active');
    expect(s.policiesByPolicyIdAndVersion['policy_community_rules::2']?.status).toBe('active');
  });

  it('rejects update that skips a version', () => {
    const s = applyModerationEvent(createEmptyModerationState(), policyCreated());
    expect(() => applyModerationEvent(s, policyUpdated(3, 1, 'evt_pol_skip'))).toThrow(
      /update version must be 2/
    );
  });

  it('rejects update with mismatched supersedes pointer', () => {
    const s = applyModerationEvent(createEmptyModerationState(), policyCreated());
    expect(() => applyModerationEvent(s, policyUpdated(2, 99, 'evt_pol_bad_sup'))).toThrow(
      /supersedesPolicyVersionNumber/
    );
  });

  it('deprecation marks the latest version deprecated and clears active pointer', () => {
    let s = applyModerationEvent(createEmptyModerationState(), policyCreated());
    s = applyModerationEvent(s, policyDeprecated('evt_pol_dep'));
    expect(s.activePolicyVersionByPolicyId['policy_community_rules']).toBeUndefined();
    expect(s.policiesByPolicyIdAndVersion['policy_community_rules::1']?.status).toBe('deprecated');
  });

  it('deprecation does NOT remove past decisions made under the policy', () => {
    let s = applyModerationEvent(createEmptyModerationState(), policyCreated());
    s = applyModerationEvent(s, decisionRecorded('decision_1', 'evt_dec1'));
    s = applyModerationEvent(s, policyDeprecated('evt_pol_dep'));
    expect(s.decisionsById['decision_1']).toBeDefined();
    expect(
      s.decisionsByPolicyId['community.policy.v1']?.includes('decision_1')
    ).toBe(true);
  });

  it('rejects deprecation of unknown / already-deprecated policy', () => {
    expect(() =>
      applyModerationEvent(createEmptyModerationState(), policyDeprecated('evt_pol_dep_ghost'))
    ).toThrow(/unknown or already-deprecated/);
    let s = applyModerationEvent(createEmptyModerationState(), policyCreated());
    s = applyModerationEvent(s, policyDeprecated('evt_pol_dep_1'));
    expect(() => applyModerationEvent(s, policyDeprecated('evt_pol_dep_2'))).toThrow(
      /unknown or already-deprecated/
    );
  });
});

describe('moderation runtime — queue lifecycle', () => {
  it('open -> assigned -> resolved happy path', () => {
    let s = createEmptyModerationState();
    s = applyModerationEvent(s, queueCreated('q1', 'report_1', 'evt_q_create'));
    expect(s.queueItemsById['q1']?.status).toBe('open');
    expect(s.queueIdsByStatus.open).toContain('q1');
    s = applyModerationEvent(s, queueAssigned('q1', 'evt_q_assign'));
    expect(s.queueItemsById['q1']?.status).toBe('assigned');
    expect(s.queueIdsByStatus.assigned).toContain('q1');
    expect(s.queueIdsByStatus.open).not.toContain('q1');
    expect(s.queueIdsByAssignee[MOD.authorityId]).toContain('q1');
    s = applyModerationEvent(s, queueResolved('q1', 'acted', 'evt_q_resolve'));
    expect(s.queueItemsById['q1']?.status).toBe('resolved');
    expect(s.queueIdsByStatus.assigned).not.toContain('q1');
    expect(s.queueIdsByStatus.resolved).toContain('q1');
    // Assignee bucket is cleared on resolve.
    expect(s.queueIdsByAssignee[MOD.authorityId]?.includes('q1')).toBe(false);
  });

  it('open -> resolved (skip assignment) for clear-cut cases', () => {
    let s = applyModerationEvent(createEmptyModerationState(), queueCreated('q1', 'report_1', 'e1'));
    s = applyModerationEvent(s, queueResolved('q1', 'duplicate', 'e2'));
    expect(s.queueItemsById['q1']?.status).toBe('resolved');
  });

  it('rejects assigning an unknown / resolved / already-assigned item', () => {
    expect(() =>
      applyModerationEvent(createEmptyModerationState(), queueAssigned('ghost', 'e'))
    ).toThrow(/unknown queue item/);
    let s = applyModerationEvent(createEmptyModerationState(), queueCreated('q1', 'r1', 'e1'));
    s = applyModerationEvent(s, queueAssigned('q1', 'e2'));
    expect(() => applyModerationEvent(s, queueAssigned('q1', 'e3'))).toThrow(
      /already assigned/
    );
    s = applyModerationEvent(s, queueResolved('q1', 'acted', 'e4'));
    expect(() => applyModerationEvent(s, queueAssigned('q1', 'e5'))).toThrow(/already resolved/);
  });

  it('rejects resolving an unknown / already-resolved item', () => {
    expect(() =>
      applyModerationEvent(createEmptyModerationState(), queueResolved('ghost', 'acted', 'e'))
    ).toThrow(/unknown queue item/);
    let s = applyModerationEvent(createEmptyModerationState(), queueCreated('q1', 'r1', 'e1'));
    s = applyModerationEvent(s, queueResolved('q1', 'acted', 'e2'));
    expect(() => applyModerationEvent(s, queueResolved('q1', 'dismissed', 'e3'))).toThrow(
      /already resolved/
    );
  });

  it('rejects creating a queue item under an existing id', () => {
    const s = applyModerationEvent(createEmptyModerationState(), queueCreated('q1', 'r1', 'e1'));
    expect(() => applyModerationEvent(s, queueCreated('q1', 'r1', 'e2'))).toThrow(
      /already exists/
    );
  });
});

describe('moderation runtime — decision recording', () => {
  it('records a decision and indexes it by subject + policyVersion', () => {
    const s = applyModerationEvent(createEmptyModerationState(), decisionRecorded('dec_1', 'e1'));
    expect(s.decisionsById['dec_1']).toBeDefined();
    expect(s.decisionsBySubjectKey['event|evt_target']).toContain('dec_1');
    expect(s.decisionsByPolicyId['community.policy.v1']).toContain('dec_1');
  });

  it('duplicate decisionId is silent no-op', () => {
    let s = applyModerationEvent(createEmptyModerationState(), decisionRecorded('dec_1', 'e1'));
    s = applyModerationEvent(s, decisionRecorded('dec_1', 'e2'));
    expect(Object.keys(s.decisionsById)).toEqual(['dec_1']);
    expect(s.appliedEventIds.has('e2')).toBe(true);
  });

  it('queue resolution can cite the decision and the cross-reference works', () => {
    let s = createEmptyModerationState();
    s = applyModerationEvent(s, queueCreated('q1', 'report_1', 'e1'));
    s = applyModerationEvent(s, queueAssigned('q1', 'e2'));
    s = applyModerationEvent(s, queueResolved('q1', 'acted', 'e3', 'dec_1'));
    s = applyModerationEvent(s, decisionRecorded('dec_1', 'e4', 'q1'));
    expect(s.queueItemsById['q1']?.resolutionDecisionId).toBe('dec_1');
    expect(s.decisionsById['dec_1']?.sourceQueueItemId).toBe('q1');
  });
});

describe('moderation runtime — cross-reference (Phase 1.63 integration)', () => {
  it('queueItemsForSource returns items spawned from a given reportId', () => {
    let s = applyModerationEvent(createEmptyModerationState(), queueCreated('q1', 'report_42', 'e1'));
    s = applyModerationEvent(s, queueCreated('q2', 'report_42', 'e2'));
    s = applyModerationEvent(s, queueCreated('q3', 'report_99', 'e3'));
    expect(queueItemsForSource(s, 'report', 'report_42').slice().sort()).toEqual(['q1', 'q2']);
    expect(queueItemsForSource(s, 'report', 'report_99')).toEqual(['q3']);
    expect(queueItemsForSource(s, 'report', 'never')).toEqual([]);
  });
});

describe('moderation runtime — replay and idempotency', () => {
  it('seedModerationState replay equals step-by-step', () => {
    const events: ModerationEvent[] = [
      policyCreated(),
      policyUpdated(2, 1, 'evt_upd'),
      queueCreated('q1', 'report_1', 'evt_q1'),
      queueAssigned('q1', 'evt_a1'),
      queueResolved('q1', 'acted', 'evt_r1', 'dec_1'),
      decisionRecorded('dec_1', 'evt_d1', 'q1'),
      policyDeprecated('evt_dep')
    ];
    const seeded = seedModerationState(events);
    let stepped = createEmptyModerationState();
    for (const e of events) stepped = applyModerationEvent(stepped, e);
    expect(seeded).toEqual(stepped);
  });

  it('same eventId twice returns the same reference', () => {
    const ev = policyCreated();
    const s1 = applyModerationEvent(createEmptyModerationState(), ev);
    const s2 = applyModerationEvent(s1, ev);
    expect(s2).toBe(s1);
  });
});
