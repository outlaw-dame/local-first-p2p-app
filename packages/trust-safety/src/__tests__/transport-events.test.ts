import { describe, expect, it } from 'vitest';
import {
  TRANSPORT_EVENT_KINDS,
  type TransportEvent,
  validateTransportEvent
} from '../index.js';

const OPERATOR = {
  version: 'lfp2p.safety-authority.v1' as const,
  authorityId: 'auth_bridge_01',
  actorId: 'actor_bridge_op',
  role: 'bridge-operator' as const,
  scope: 'bridge-local' as const,
  createdAt: '2026-05-01T00:00:00Z'
};

const DECISION = {
  version: 'lfp2p.transport-admission-decision.v1' as const,
  decisionId: 'dec_1',
  operatorAuthority: OPERATOR,
  subject: { type: 'event' as const, eventId: 'evt_offending' },
  surface: 'bridge' as const,
  action: 'accept' as const,
  reasonCode: 'policy.local-preference' as const,
  policyVersion: 'bridge.policy.v1',
  createdAt: '2026-05-31T00:00:00Z'
};

function base(kind: TransportEvent['kind']): Record<string, unknown> {
  return {
    version: 'lfp2p.transport-event.v1',
    eventId: 'evt_' + Math.random().toString(36).slice(2, 10),
    createdAt: '2026-05-31T00:00:00Z',
    kind
  };
}

describe('validateTransportEvent — kinds', () => {
  it('accepts every event kind with a valid payload', () => {
    expect(() =>
      validateTransportEvent({ ...base('transport.event.accepted'), decision: DECISION })
    ).not.toThrow();
    expect(() =>
      validateTransportEvent({ ...base('transport.event.rejected'), decision: DECISION })
    ).not.toThrow();
    expect(() =>
      validateTransportEvent({
        ...base('transport.event.quarantined'),
        decision: DECISION,
        quarantineExpiresAt: '2026-06-30T00:00:00Z'
      })
    ).not.toThrow();
    expect(() =>
      validateTransportEvent({
        ...base('transport.peer.rate_limited'),
        peerId: 'peer_1',
        operatorAuthority: OPERATOR,
        reasonCode: 'system.rate-limit',
        retryAfter: '2026-05-31T00:05:00Z'
      })
    ).not.toThrow();
    expect(() =>
      validateTransportEvent({
        ...base('transport.peer.quarantined'),
        peerId: 'peer_1',
        operatorAuthority: OPERATOR,
        reasonCode: 'security.spam',
        quarantineExpiresAt: '2026-06-07T00:00:00Z'
      })
    ).not.toThrow();
  });

  it('rejects unknown kind', () => {
    expect(() =>
      validateTransportEvent({ ...base('transport.event.deleted' as TransportEvent['kind']) })
    ).toThrow(/TS_INVALID_ENUM/);
  });

  it('rejects unknown version', () => {
    expect(() =>
      validateTransportEvent({
        ...base('transport.event.accepted'),
        version: 'lfp2p.transport-event.v2',
        decision: DECISION
      })
    ).toThrow(/TS_UNKNOWN_VERSION/);
  });

  it('rejects retryAfter before createdAt', () => {
    expect(() =>
      validateTransportEvent({
        ...base('transport.peer.rate_limited'),
        peerId: 'peer_1',
        operatorAuthority: OPERATOR,
        reasonCode: 'system.rate-limit',
        retryAfter: '2026-05-30T00:00:00Z'
      })
    ).toThrow(/TS_INVALID_TIMESTAMP/);
  });

  it('exposes 6 transport event kinds', () => {
    expect(TRANSPORT_EVENT_KINDS.length).toBe(6);
  });
});
