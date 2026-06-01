import { describe, expect, it } from 'vitest';
import type { ReportAppealEvent } from '../index.js';
import {
  applyReportAppealEvent,
  createEmptyReportsAppealsState,
  seedReportsAppealsState
} from '../index.js';

const AUTHORITY = {
  version: 'lfp2p.safety-authority.v1' as const,
  authorityId: 'auth_mod_42',
  actorId: 'actor_mod_alice',
  role: 'moderator' as const,
  scope: 'community-local' as const,
  createdAt: '2026-05-01T00:00:00Z'
};

function makeReport(reportId: string, idempotencyKey: string): Record<string, unknown> {
  return {
    version: 'lfp2p.safety-report.v1',
    reportId,
    reporter: { kind: 'actor', actor: { actorId: 'actor_damon' } },
    subject: { type: 'event', eventId: 'event_xyz' },
    targetAuthority: AUTHORITY,
    reasonCode: 'abuse.harassment',
    scope: 'community-local',
    idempotencyKey,
    createdAt: '2026-05-31T00:00:00Z',
    reporterPrivacy: 'identified-to-authority'
  };
}

function makeAppeal(appealId: string, idempotencyKey: string): Record<string, unknown> {
  return {
    version: 'lfp2p.safety-appeal.v1',
    appealId,
    appellant: { actorId: 'actor_appellant' },
    decisionId: 'decision_001',
    targetAuthority: AUTHORITY,
    reasonCode: 'context-disputed',
    idempotencyKey,
    createdAt: '2026-05-31T00:00:00Z'
  };
}

function created(reportId: string, idempotencyKey: string, eventId?: string): ReportAppealEvent {
  return {
    version: 'lfp2p.report-appeal-event.v1',
    eventId: eventId ?? `evt_rep_created_${reportId}`,
    createdAt: '2026-05-31T10:00:00Z',
    kind: 'safety.report.created',
    report: makeReport(reportId, idempotencyKey)
  } as unknown as ReportAppealEvent;
}

function ack(reportId: string, eventId?: string): ReportAppealEvent {
  return {
    version: 'lfp2p.report-appeal-event.v1',
    eventId: eventId ?? `evt_rep_ack_${reportId}`,
    createdAt: '2026-05-31T11:00:00Z',
    kind: 'safety.report.acknowledged',
    reportId,
    acknowledgedBy: AUTHORITY,
    acknowledgedAt: '2026-05-31T11:00:00Z'
  } as unknown as ReportAppealEvent;
}

function resolved(
  reportId: string,
  resolution: string = 'upheld',
  eventId?: string,
  extra: Record<string, unknown> = {}
): ReportAppealEvent {
  return {
    version: 'lfp2p.report-appeal-event.v1',
    eventId: eventId ?? `evt_rep_resolved_${reportId}`,
    createdAt: '2026-05-31T12:00:00Z',
    kind: 'safety.report.resolved',
    reportId,
    resolvedBy: AUTHORITY,
    resolvedAt: '2026-05-31T12:00:00Z',
    resolution,
    resolutionReasonCode: 'abuse.harassment',
    ...extra
  } as unknown as ReportAppealEvent;
}

describe('applyReportAppealEvent — report lifecycle', () => {
  it('inserts a fresh record on safety.report.created', () => {
    const state = applyReportAppealEvent(createEmptyReportsAppealsState(), created('r1', 'idem_1'));
    expect(state.byReportId['r1']?.status).toBe('submitted');
    expect(state.byReportIdempotencyKey['idem_1']).toBe('r1');
    expect(state.byTargetAuthority[AUTHORITY.authorityId]).toContain('r1');
  });

  it('submitted -> acknowledged transition', () => {
    let state = applyReportAppealEvent(createEmptyReportsAppealsState(), created('r1', 'idem_1'));
    state = applyReportAppealEvent(state, ack('r1'));
    expect(state.byReportId['r1']?.status).toBe('acknowledged');
    expect(state.byReportId['r1']?.acknowledgedBy).toBeDefined();
  });

  it('submitted -> resolved (skip ack) is allowed', () => {
    let state = applyReportAppealEvent(createEmptyReportsAppealsState(), created('r1', 'idem_1'));
    state = applyReportAppealEvent(state, resolved('r1'));
    expect(state.byReportId['r1']?.status).toBe('resolved');
    expect(state.byReportId['r1']?.resolution).toBe('upheld');
  });

  it('acknowledge without prior create throws TS_LIFECYCLE_TRANSITION', () => {
    expect(() =>
      applyReportAppealEvent(createEmptyReportsAppealsState(), ack('r_missing'))
    ).toThrow(/TS_LIFECYCLE_TRANSITION/);
  });

  it('acknowledge of already-acknowledged report throws TS_LIFECYCLE_TRANSITION', () => {
    let state = applyReportAppealEvent(createEmptyReportsAppealsState(), created('r1', 'idem_1'));
    state = applyReportAppealEvent(state, ack('r1', 'evt_ack_1'));
    expect(() => applyReportAppealEvent(state, ack('r1', 'evt_ack_2'))).toThrow(
      /TS_LIFECYCLE_TRANSITION/
    );
  });

  it('resolve of already-resolved report throws TS_LIFECYCLE_TRANSITION', () => {
    let state = applyReportAppealEvent(createEmptyReportsAppealsState(), created('r1', 'idem_1'));
    state = applyReportAppealEvent(state, resolved('r1', 'upheld', 'evt_r1_1'));
    expect(() =>
      applyReportAppealEvent(state, resolved('r1', 'dismissed', 'evt_r1_2'))
    ).toThrow(/already resolved/);
  });
});

describe('applyReportAppealEvent — idempotency', () => {
  it('same eventId twice is a no-op (returns same reference)', () => {
    const start = applyReportAppealEvent(
      createEmptyReportsAppealsState(),
      created('r1', 'idem_1', 'evt_x')
    );
    const again = applyReportAppealEvent(start, created('r1', 'idem_1', 'evt_x'));
    expect(again).toBe(start);
  });

  it('duplicate idempotency key on a new report is silent no-op (records eventId)', () => {
    const first = applyReportAppealEvent(
      createEmptyReportsAppealsState(),
      created('r1', 'idem_1', 'evt_1')
    );
    const second = applyReportAppealEvent(first, created('r2', 'idem_1', 'evt_2'));
    expect(second.byReportId['r2']).toBeUndefined();
    expect(second.byReportId['r1']).toBeDefined();
    expect(second.appliedEventIds.has('evt_2')).toBe(true);
  });
});

describe('applyReportAppealEvent — appeal lifecycle', () => {
  function appealCreated(appealId: string, idem: string): ReportAppealEvent {
    return {
      version: 'lfp2p.report-appeal-event.v1',
      eventId: `evt_app_${appealId}`,
      createdAt: '2026-05-31T13:00:00Z',
      kind: 'safety.appeal.created',
      appeal: makeAppeal(appealId, idem)
    } as unknown as ReportAppealEvent;
  }
  function appealResolved(appealId: string, resolution: string = 'dismissed'): ReportAppealEvent {
    return {
      version: 'lfp2p.report-appeal-event.v1',
      eventId: `evt_app_res_${appealId}_${resolution}`,
      createdAt: '2026-05-31T14:00:00Z',
      kind: 'safety.appeal.resolved',
      appealId,
      resolvedBy: AUTHORITY,
      resolvedAt: '2026-05-31T14:00:00Z',
      resolution,
      resolutionReasonCode: 'policy.community-rule',
      ...(resolution === 'overturned' ? { newDecisionId: 'decision_v2' } : {})
    } as unknown as ReportAppealEvent;
  }

  it('appeal create -> resolve happy path', () => {
    let state = applyReportAppealEvent(createEmptyReportsAppealsState(), appealCreated('a1', 'idem_a1'));
    expect(state.byAppealId['a1']?.status).toBe('submitted');
    state = applyReportAppealEvent(state, appealResolved('a1'));
    expect(state.byAppealId['a1']?.status).toBe('resolved');
  });

  it('resolve unknown appeal throws TS_LIFECYCLE_TRANSITION', () => {
    expect(() =>
      applyReportAppealEvent(createEmptyReportsAppealsState(), appealResolved('a_missing'))
    ).toThrow(/TS_LIFECYCLE_TRANSITION/);
  });

  it('resolve-twice throws TS_LIFECYCLE_TRANSITION', () => {
    let state = applyReportAppealEvent(createEmptyReportsAppealsState(), appealCreated('a1', 'idem_a1'));
    state = applyReportAppealEvent(state, appealResolved('a1', 'dismissed'));
    expect(() => applyReportAppealEvent(state, appealResolved('a1', 'overturned'))).toThrow(
      /already resolved/
    );
  });

  it('overturned appeal records the new decisionId', () => {
    let state = applyReportAppealEvent(createEmptyReportsAppealsState(), appealCreated('a1', 'idem_a1'));
    state = applyReportAppealEvent(state, appealResolved('a1', 'overturned'));
    expect(state.byAppealId['a1']?.newDecisionId).toBe('decision_v2');
  });

  it('byAppealedDecisionId indexes appeals by the decision they target', () => {
    const state = applyReportAppealEvent(
      createEmptyReportsAppealsState(),
      appealCreated('a1', 'idem_a1')
    );
    expect(state.byAppealedDecisionId['decision_001']).toContain('a1');
  });
});

describe('seedReportsAppealsState — replay equivalence', () => {
  it('replay equals step-by-step', () => {
    const events: ReportAppealEvent[] = [
      created('r1', 'idem_1'),
      ack('r1'),
      resolved('r1', 'upheld', undefined, { resolutionDecisionId: 'decision_001' })
    ];
    const seeded = seedReportsAppealsState(events);
    let stepped = createEmptyReportsAppealsState();
    for (const e of events) {
      stepped = applyReportAppealEvent(stepped, e);
    }
    expect(seeded).toEqual(stepped);
  });

  it('store-reopen rebuild from the same event log produces equal state', () => {
    const events: ReportAppealEvent[] = [
      created('r1', 'idem_1'),
      created('r2', 'idem_2'),
      ack('r1'),
      resolved('r2', 'dismissed', undefined, { resolutionReasonCode: 'quality.duplicate' })
    ];
    const first = seedReportsAppealsState(events);
    const reopened = seedReportsAppealsState(events);
    expect(reopened).toEqual(first);
  });
});
