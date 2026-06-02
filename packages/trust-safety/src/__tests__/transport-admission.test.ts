import { describe, expect, it } from 'vitest';
import type {
  AdmissionConfig,
  AdmissionEnvelope,
  LocalControlEvent,
  SafetyReport
} from '../index.js';
import {
  admitEnvelope,
  applyLocalControlEvent,
  createEmptyLocalControlState,
  createEmptyTransportAdmissionState
} from '../index.js';

const BRIDGE_OPERATOR_AUTHORITY = {
  version: 'lfp2p.safety-authority.v1' as const,
  authorityId: 'auth_bridge_01',
  actorId: 'actor_bridge_op',
  role: 'bridge-operator' as const,
  scope: 'bridge-local' as const,
  createdAt: '2026-05-01T00:00:00Z'
};

const BASE_CONFIG: AdmissionConfig = Object.freeze({
  surface: 'bridge',
  operatorAuthority: BRIDGE_OPERATOR_AUTHORITY,
  policyVersion: 'bridge.policy.v1'
});

function envelope(overrides: Partial<AdmissionEnvelope> = {}): AdmissionEnvelope {
  return {
    eventId: 'evt_' + Math.random().toString(36).slice(2, 10),
    idempotencyKey: 'idem_' + Math.random().toString(36).slice(2, 10),
    kind: 'note.created',
    privacy: 'public',
    producerActorId: 'actor_producer',
    peerId: 'peer_abc',
    byteSize: 4096,
    ...overrides
  };
}

const NOW = Date.parse('2026-05-31T00:00:00Z');

describe('admission engine — happy path', () => {
  it('accepts a well-formed public envelope with no penalties', () => {
    const { result } = admitEnvelope(
      createEmptyTransportAdmissionState(),
      envelope(),
      BASE_CONFIG,
      undefined,
      NOW
    );
    expect(result.admitted).toBe(true);
    expect(result.decision.action).toBe('accept');
  });
});

describe('admission engine — privacy scope', () => {
  it('rejects device-local at the bridge surface', () => {
    const { result } = admitEnvelope(
      createEmptyTransportAdmissionState(),
      envelope({ privacy: 'device-local' }),
      BASE_CONFIG,
      undefined,
      NOW
    );
    expect(result.admitted).toBe(false);
    expect(result.decision.reasonCode).toBe('system.disallowed-scope');
  });

  it('rejects self at the bridge surface', () => {
    const { result } = admitEnvelope(
      createEmptyTransportAdmissionState(),
      envelope({ privacy: 'self' }),
      BASE_CONFIG,
      undefined,
      NOW
    );
    expect(result.admitted).toBe(false);
  });
});

describe('admission engine — replay protection', () => {
  it('drops a duplicate idempotency key', () => {
    const env = envelope();
    let state = createEmptyTransportAdmissionState();
    const r1 = admitEnvelope(state, env, BASE_CONFIG, undefined, NOW);
    state = r1.nextState;
    expect(r1.result.admitted).toBe(true);
    const r2 = admitEnvelope(state, env, BASE_CONFIG, undefined, NOW + 1);
    expect(r2.result.admitted).toBe(false);
    expect(r2.result.decision.action).toBe('drop-duplicate');
    expect(r2.result.decision.reasonCode).toBe('system.replay');
  });
});

describe('admission engine — byte limits', () => {
  it('rejects oversized envelopes', () => {
    const { result } = admitEnvelope(
      createEmptyTransportAdmissionState(),
      envelope({ byteSize: 200 * 1024 * 1024 }),
      BASE_CONFIG,
      undefined,
      NOW
    );
    expect(result.admitted).toBe(false);
    expect(result.decision.reasonCode).toBe('system.malformed-object');
  });

  it('rejects compression bombs (decoded size >> declared cap)', () => {
    const { result } = admitEnvelope(
      createEmptyTransportAdmissionState(),
      envelope({ byteSize: 1024, decodedByteSize: 10 * 1024 * 1024 * 1024 }),
      BASE_CONFIG,
      undefined,
      NOW
    );
    expect(result.admitted).toBe(false);
  });
});

describe('admission engine — kind allowlist', () => {
  it('rejects an envelope of a disallowed kind', () => {
    const config: AdmissionConfig = {
      ...BASE_CONFIG,
      allowedKinds: new Set(['note.created'])
    };
    const { result } = admitEnvelope(
      createEmptyTransportAdmissionState(),
      envelope({ kind: 'experimental.kind' }),
      config,
      undefined,
      NOW
    );
    expect(result.admitted).toBe(false);
  });
});

describe('admission engine — rate limiting', () => {
  it('after exhausting the bucket, returns rate-limit decisions', () => {
    let state = createEmptyTransportAdmissionState();
    const config: AdmissionConfig = {
      ...BASE_CONFIG,
      rateLimit: {
        capacity: 2,
        refillRatePerSecond: 0.001,
        baseBackoffMs: 1_000,
        maxBackoffMs: 60_000
      }
    };
    for (let i = 0; i < 2; i += 1) {
      const r = admitEnvelope(state, envelope(), config, undefined, NOW + i);
      state = r.nextState;
      expect(r.result.admitted).toBe(true);
    }
    const r3 = admitEnvelope(state, envelope(), config, undefined, NOW + 2);
    expect(r3.result.admitted).toBe(false);
    expect(r3.result.decision.action).toBe('rate-limit');
    expect(r3.result.decision.reasonCode).toBe('system.rate-limit');
  });
});

describe('admission engine — Phase 1.62 user-block integration', () => {
  it('rejects envelopes from blocked producers when a recipient context is supplied', () => {
    const blockEvent: LocalControlEvent = {
      version: 'lfp2p.local-control-event.v1',
      eventId: 'evt_block',
      createdAt: '2026-05-01T00:00:00Z',
      action: 'apply',
      kind: 'safety.account.blocked',
      targetActorId: 'actor_producer'
    };
    const localState = applyLocalControlEvent(createEmptyLocalControlState(), blockEvent);
    const { result } = admitEnvelope(
      createEmptyTransportAdmissionState(),
      envelope({ producerActorId: 'actor_producer' }),
      BASE_CONFIG,
      {
        recipientUserLocalControlState: localState,
        recipientUserId: 'user_recipient'
      },
      NOW
    );
    expect(result.admitted).toBe(false);
    expect(result.decision.reasonCode).toBe('policy.local-preference');
  });

  it('expired blocks do not reject', () => {
    const blockEvent: LocalControlEvent = {
      version: 'lfp2p.local-control-event.v1',
      eventId: 'evt_block_old',
      createdAt: '2026-04-01T00:00:00Z',
      action: 'apply',
      kind: 'safety.account.blocked',
      targetActorId: 'actor_producer',
      expiresAt: '2026-04-15T00:00:00Z'
    };
    const localState = applyLocalControlEvent(createEmptyLocalControlState(), blockEvent);
    const { result } = admitEnvelope(
      createEmptyTransportAdmissionState(),
      envelope({ producerActorId: 'actor_producer' }),
      BASE_CONFIG,
      {
        recipientUserLocalControlState: localState,
        recipientUserId: 'user_recipient'
      },
      NOW
    );
    expect(result.admitted).toBe(true);
  });
});

describe('admission engine — Phase 1.63 report-forwarding integration', () => {
  const PRIVATE_BLOB_REPORT: SafetyReport = {
    version: 'lfp2p.safety-report.v1',
    reportId: 'r_priv',
    reporter: { kind: 'actor', actor: { actorId: 'actor_damon' } },
    subject: {
      type: 'blob',
      blockRef: {
        type: 'block-ref',
        source: {
          kind: 'digest',
          digest: {
            algorithm: 'sha-256',
            digest: '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU'
          }
        },
        byteLength: 1024,
        offset: 0,
        privacy: 'private',
        encryption: {
          scheme: 'xchacha20-poly1305',
          keyRef: {
            algorithm: 'sha-256',
            digest: 'ypeBEsobvcr6wjGzmiPcTaeG7_gUfE5yuYB3ha_uSLs'
          }
        }
      }
    },
    targetAuthority: BRIDGE_OPERATOR_AUTHORITY,
    reasonCode: 'media-safety.violent-imagery',
    scope: 'community-local',
    idempotencyKey: 'idem_priv',
    createdAt: '2026-05-31T00:00:00Z',
    reporterPrivacy: 'pseudonymous-to-authority'
  };

  it('forwards a private-subject report when evidence is properly encrypted', () => {
    const { result } = admitEnvelope(
      createEmptyTransportAdmissionState(),
      envelope({
        kind: 'safety.report.created',
        privacy: 'dm',
        embeddedReport: PRIVATE_BLOB_REPORT
      }),
      BASE_CONFIG,
      undefined,
      NOW
    );
    expect(result.admitted).toBe(true);
  });

  it('refuses to forward a report whose evidence would leak private content', () => {
    const unsafe: SafetyReport = {
      ...PRIVATE_BLOB_REPORT,
      evidenceRefs: [
        {
          type: 'object-ref',
          kind: 'media',
          block: {
            type: 'block-ref',
            source: {
              kind: 'content-link',
              link: {
                type: 'content-link',
                cid: 'bafkreih2akiscaiv2qtnfwa6vlsa3o5pwf3jmkcswxlha6m4q34cqyvcaa',
                codec: 'raw'
              }
            },
            byteLength: 1024,
            offset: 0,
            privacy: 'public'
          }
        }
      ]
    };
    const { result } = admitEnvelope(
      createEmptyTransportAdmissionState(),
      envelope({
        kind: 'safety.report.created',
        privacy: 'dm',
        embeddedReport: unsafe
      }),
      BASE_CONFIG,
      undefined,
      NOW
    );
    expect(result.admitted).toBe(false);
    expect(result.decision.reasonCode).toBe('system.malformed-object');
  });
});

describe('admission engine — audit log redaction', () => {
  it('records the operator authority and surface but never the envelope body', () => {
    const { nextState } = admitEnvelope(
      createEmptyTransportAdmissionState(),
      envelope({ subjectRefDisplay: 'event:abcdef' }),
      BASE_CONFIG,
      undefined,
      NOW
    );
    expect(nextState.auditLog.entries.length).toBe(1);
    const entry = nextState.auditLog.entries[0]!;
    expect(entry.operatorAuthorityId).toBe(BRIDGE_OPERATOR_AUTHORITY.authorityId);
    expect(entry.surface).toBe('bridge');
    expect(entry.action).toBe('accept');
    // Timestamps in whole seconds (no millisecond fingerprint).
    expect(entry.ts).toBe(Math.floor(NOW / 1000));
  });
});

describe('admission engine — peer reputation', () => {
  it('a successful admit produces a positive reputation delta', () => {
    const { nextState } = admitEnvelope(
      createEmptyTransportAdmissionState(),
      envelope(),
      BASE_CONFIG,
      undefined,
      NOW
    );
    const rep = nextState.peerReputation['peer_abc'];
    expect(rep).toBeDefined();
    expect(rep!.score).toBeGreaterThan(0);
  });

  it('a disallowed-scope rejection penalizes reputation', () => {
    const { nextState } = admitEnvelope(
      createEmptyTransportAdmissionState(),
      envelope({ privacy: 'device-local' }),
      BASE_CONFIG,
      undefined,
      NOW
    );
    const rep = nextState.peerReputation['peer_abc'];
    expect(rep!.score).toBeLessThan(0);
  });
});
