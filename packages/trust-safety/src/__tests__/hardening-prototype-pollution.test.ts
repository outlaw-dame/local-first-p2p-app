import { describe, expect, it } from 'vitest';
import type {
  AdmissionConfig,
  AdmissionEnvelope,
  LocalControlEvent,
  ReportAppealEvent
} from '../index.js';
import {
  admitEnvelope,
  applyLocalControlEvent,
  applyReportAppealEvent,
  createEmptyLocalControlState,
  createEmptyReportsAppealsState,
  createEmptyTransportAdmissionState,
  isForbiddenIdKey,
  withFrozenBucketAppend,
  withFrozenRecordDelete,
  withFrozenRecordSet
} from '../index.js';

const FORBIDDEN: ReadonlyArray<string> = [
  '__proto__',
  'prototype',
  'constructor',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toString',
  'valueOf'
];

const PROTOTYPE_PROBE_KEY = '__lfp2p_test_canary__';

function snapshotPrototype(): unknown {
  return (Object.prototype as Record<string, unknown>)[PROTOTYPE_PROBE_KEY];
}

describe('hardening — isForbiddenIdKey', () => {
  it('flags every reserved property name', () => {
    for (const key of FORBIDDEN) {
      expect(isForbiddenIdKey(key)).toBe(true);
    }
  });

  it('does not flag normal identifiers', () => {
    for (const key of ['actor_x', 'evt_001', 'auth.policy.v1', 'idem_123']) {
      expect(isForbiddenIdKey(key)).toBe(false);
    }
  });
});

describe('hardening — defense-in-depth Record helpers', () => {
  it('withFrozenRecordSet sets the property as own without invoking the __proto__ setter', () => {
    const before = snapshotPrototype();
    const out = withFrozenRecordSet<string>({}, '__proto__', 'sentinel');
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true);
    expect(snapshotPrototype()).toBe(before);
  });

  it('withFrozenRecordSet preserves existing entries through defineProperty', () => {
    const existing: Record<string, number> = { a: 1, b: 2 };
    const out = withFrozenRecordSet(existing, 'c', 3);
    expect(out.a).toBe(1);
    expect(out.b).toBe(2);
    expect(out.c).toBe(3);
    expect(Object.isFrozen(out)).toBe(true);
  });

  it('withFrozenRecordDelete is a no-op when key is absent', () => {
    const map = Object.freeze({ a: 1 });
    expect(withFrozenRecordDelete(map, 'b')).toBe(map);
  });

  it('withFrozenBucketAppend dedupes by value', () => {
    const m1 = withFrozenBucketAppend({}, 'k', 'v1');
    const m2 = withFrozenBucketAppend(m1, 'k', 'v1');
    expect(m2).toBe(m1);
    const m3 = withFrozenBucketAppend(m2, 'k', 'v2');
    expect(m3['k']).toEqual(['v1', 'v2']);
  });

  it('Object.prototype is not polluted after a mass of Record operations', () => {
    const before = snapshotPrototype();
    let m: Readonly<Record<string, number>> = {};
    for (const key of FORBIDDEN) {
      m = withFrozenRecordSet(m, key, 42);
    }
    for (const key of FORBIDDEN) {
      m = withFrozenRecordDelete(m, key);
    }
    expect(snapshotPrototype()).toBe(before);
  });
});

describe('hardening — local-controls projection rejects forbidden ids', () => {
  it.each(FORBIDDEN)('rejects "%s" as targetActorId in safety.account.blocked', (badId) => {
    const event: LocalControlEvent = {
      version: 'lfp2p.local-control-event.v1',
      eventId: `e_${badId}`,
      createdAt: '2026-05-31T00:00:00Z',
      action: 'apply',
      kind: 'safety.account.blocked',
      targetActorId: badId
    };
    expect(() => applyLocalControlEvent(createEmptyLocalControlState(), event)).toThrow(
      /TS_FORBIDDEN_KEY/
    );
  });
});

describe('hardening — reports-appeals projection rejects forbidden ids', () => {
  function makeReport(reportId: string, idempotencyKey: string): Record<string, unknown> {
    return {
      version: 'lfp2p.safety-report.v1',
      reportId,
      reporter: { kind: 'actor', actor: { actorId: 'actor_damon' } },
      subject: { type: 'event', eventId: 'evt_x' },
      targetAuthority: {
        version: 'lfp2p.safety-authority.v1',
        authorityId: 'auth_mod_42',
        actorId: 'actor_mod_alice',
        role: 'moderator',
        scope: 'community-local',
        createdAt: '2026-05-01T00:00:00Z'
      },
      reasonCode: 'abuse.harassment',
      scope: 'community-local',
      idempotencyKey,
      createdAt: '2026-05-31T00:00:00Z',
      reporterPrivacy: 'identified-to-authority'
    };
  }

  it.each(FORBIDDEN)('rejects "%s" as reportId via safety.report.created', (badId) => {
    const event: ReportAppealEvent = {
      version: 'lfp2p.report-appeal-event.v1',
      eventId: `e_${badId}`,
      createdAt: '2026-05-31T00:00:00Z',
      kind: 'safety.report.created',
      report: makeReport(badId, `idem_${badId}`)
    } as unknown as ReportAppealEvent;
    expect(() => applyReportAppealEvent(createEmptyReportsAppealsState(), event)).toThrow(
      /TS_FORBIDDEN_KEY/
    );
  });
});

describe('hardening — transport-admission rejects forbidden peer/event ids', () => {
  const BRIDGE_OPERATOR_AUTHORITY = {
    version: 'lfp2p.safety-authority.v1' as const,
    authorityId: 'auth_bridge_01',
    actorId: 'actor_bridge_op',
    role: 'bridge-operator' as const,
    scope: 'bridge-local' as const,
    createdAt: '2026-05-01T00:00:00Z'
  };

  const BASE_CONFIG: AdmissionConfig = {
    surface: 'bridge',
    operatorAuthority: BRIDGE_OPERATOR_AUTHORITY,
    policyVersion: 'bridge.policy.v1'
  };

  function envelope(overrides: Partial<AdmissionEnvelope> = {}): AdmissionEnvelope {
    return {
      eventId: 'evt_ok',
      idempotencyKey: 'idem_ok',
      kind: 'note.created',
      privacy: 'public',
      producerActorId: 'actor_producer',
      peerId: 'peer_ok',
      byteSize: 1024,
      ...overrides
    };
  }

  it('admitting a peer whose id is "__proto__" throws TS_FORBIDDEN_KEY without polluting Object.prototype', () => {
    const before = snapshotPrototype();
    expect(() =>
      admitEnvelope(
        createEmptyTransportAdmissionState(),
        envelope({ peerId: '__proto__' }),
        BASE_CONFIG,
        undefined,
        Date.parse('2026-05-31T00:00:00Z')
      )
    ).toThrow(/TS_FORBIDDEN_KEY/);
    expect(snapshotPrototype()).toBe(before);
  });

  it('the defense-in-depth helper accepts a forbidden key without prototype mutation if validation was bypassed', () => {
    // This exercises the projection helper directly (the path a future
    // refactor might accidentally call without going through assertId).
    const before = snapshotPrototype();
    const out = withFrozenRecordSet<number>({}, '__proto__', 42);
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true);
    expect(snapshotPrototype()).toBe(before);
  });
});
