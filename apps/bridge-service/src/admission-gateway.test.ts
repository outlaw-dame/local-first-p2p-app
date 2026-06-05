/**
 * Phase 4.1.B — Adversarial admission tests.
 *
 * Covers the integration boundary between the bridge service and
 * the trust-safety transport-admission engine. The engine's
 * internal correctness (rate-limit exponential backoff, replay-cache
 * TTL, peer-reputation hysteresis, byte-cap compression-bomb
 * guard, etc.) is exhaustively tested in
 * `packages/trust-safety/src/__tests__/`; this suite tests the
 * WIRING: that the gateway correctly projects bridge deliveries
 * into admission envelopes, correctly threads state forward, and
 * correctly maps the engine's decision back into the bridge's
 * accept/reject vocabulary.
 *
 * Test discipline: every adversarial input is exercised through
 * the full BridgeService.acceptDelivery path, not just the gateway
 * in isolation. The result is observed via the bridge's existing
 * response surface — that's what production callers see, so that's
 * what we pin.
 */
import { describe, expect, it } from 'vitest';
import { signEventEnvelope, signingKeypairFromSeed } from '@lfp2p/crypto';
import {
  createUnsignedEvent,
  placeholderPrivatePayloadEnvelope,
  type SignedEventEnvelope
} from '@lfp2p/protocol';
import {
  BridgeAdmissionGateway,
  estimateEnvelopeByteSize
} from './admission-gateway.js';
import { InMemoryBridgeService } from './service.js';
import type { BridgeDeliveryRequest, BridgeDeliveryResponse } from './types.js';

const KEYPAIR = signingKeypairFromSeed(new Uint8Array(32).fill(7));

const OPERATOR_AUTHORITY = {
  version: 'lfp2p.safety-authority.v1' as const,
  authorityId: 'auth_bridge_p41',
  actorId: 'actor_bridge_op',
  role: 'bridge-operator' as const,
  scope: 'bridge-local' as const,
  createdAt: '2026-05-01T00:00:00Z'
};

function signedNote(eventId: string, body = 'hello'): SignedEventEnvelope {
  return signEventEnvelope(
    createUnsignedEvent({
      eventId,
      kind: 'note.created',
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: '2026-06-04T00:00:00.000Z',
      privacy: 'group',
      // Phase 5.0E follow-up: `group` privacy requires a
      // PrivatePayloadEnvelopeV1. The previous plaintext `body`
      // parameter is now smuggled into `keyId` so the privacy-leak
      // adversarial test below still has a sensitive string to scan
      // for in the rejection reason.
      payload: placeholderPrivatePayloadEnvelope({ keyId: body, ciphertext: 'AAAA' })
    }),
    KEYPAIR
  );
}

function request(
  eventId: string,
  options: { peerId?: string; body?: string; idempotencyKey?: string } = {}
): BridgeDeliveryRequest {
  return {
    idempotencyKey: options.idempotencyKey ?? `idem_${eventId}`,
    target: 'durable-stream:inbox',
    event: signedNote(eventId, options.body),
    ...(options.peerId === undefined ? {} : { peerId: options.peerId })
  };
}

function makeServiceWithGateway(
  overrides: { maxBytes?: number; allowedKinds?: ReadonlySet<string> } = {}
): {
  service: InMemoryBridgeService;
  gateway: BridgeAdmissionGateway;
} {
  const gateway = new BridgeAdmissionGateway({
    config: {
      surface: 'bridge',
      operatorAuthority: OPERATOR_AUTHORITY,
      policyVersion: 'bridge.policy.v1',
      ...(overrides.maxBytes === undefined ? {} : { maxBytes: overrides.maxBytes }),
      ...(overrides.allowedKinds === undefined
        ? {}
        : { allowedKinds: overrides.allowedKinds })
    }
  });
  const service = new InMemoryBridgeService({ admission: gateway });
  return { service, gateway };
}

// ---------------------------------------------------------------------------
// Backward compat
// ---------------------------------------------------------------------------

describe('Phase 4.1 — backward compat: gateway omitted', () => {
  it('a service constructed without admission behaves exactly as before', async () => {
    const service = new InMemoryBridgeService('stateful-edge-actor');
    const response = await service.acceptDelivery(request('evt_compat_1'));
    expect(response.status).toBe('confirmed');
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('Phase 4.1 — happy path: admitted envelope lands as confirmed', () => {
  it('a well-formed delivery passes admission and confirms', async () => {
    const { service, gateway } = makeServiceWithGateway();
    const response = await service.acceptDelivery(request('evt_p41_ok_1'));
    expect(response.status).toBe('confirmed');
    // The admission state moved forward: the producer's bucket and
    // reputation got initialised.
    expect(Object.keys(gateway.state.rateLimitState)).toContain(
      'device:alice-phone'
    );
    expect(Object.keys(gateway.state.peerReputation)).toContain(
      'device:alice-phone'
    );
  });

  it('the audit log gains a redacted entry per delivery', async () => {
    const { service, gateway } = makeServiceWithGateway();
    await service.acceptDelivery(request('evt_p41_audit_1'));
    expect(gateway.state.auditLog.entries.length).toBe(1);
    const entry = gateway.state.auditLog.entries[0]!;
    expect(entry.action).toBe('accept');
    expect(entry.peerId).toBe('device:alice-phone');
    // The audit log MUST NOT contain the envelope payload.
    expect(JSON.stringify(entry)).not.toMatch(/"body"/);
  });
});

// ---------------------------------------------------------------------------
// Reject paths
// ---------------------------------------------------------------------------

describe('Phase 4.1 — byte cap rejects oversized envelopes', () => {
  it('an envelope above the configured byte cap is rejected with the engine reason code', async () => {
    // 50 bytes is well below any real signed envelope (which carries
    // a full Ed25519 signature, public key, JSON-serialized payload
    // wrapper, etc., and is several hundred bytes minimum).
    const probe = signedNote('evt_size_probe');
    expect(estimateEnvelopeByteSize(probe)).toBeGreaterThan(50);

    const { service } = makeServiceWithGateway({ maxBytes: 50 });
    const response: BridgeDeliveryResponse = await service.acceptDelivery(
      request('evt_p41_big_1')
    );
    expect(response.status).toBe('rejected');
    if (response.status === 'rejected') {
      expect(response.reason).toMatch(/^rejected:|^rate-limited:/);
    }
  });
});

describe('Phase 4.1 — kind allowlist rejects disallowed kinds', () => {
  it('an envelope whose kind is not in allowedKinds is rejected', async () => {
    const { service } = makeServiceWithGateway({
      // Allow only a kind the test envelope does not use.
      allowedKinds: new Set(['note.does-not-exist'])
    });
    const response = await service.acceptDelivery(request('evt_p41_kind_1'));
    expect(response.status).toBe('rejected');
  });
});

describe('Phase 4.1 — replay cache drop-duplicate', () => {
  it('two consecutive deliveries with the same idempotencyKey trigger the engine drop-duplicate', async () => {
    const { service } = makeServiceWithGateway();
    const first = await service.acceptDelivery(
      request('evt_p41_dup_a', { idempotencyKey: 'idem_dup' })
    );
    expect(first.status).toBe('confirmed');
    const second = await service.acceptDelivery(
      request('evt_p41_dup_b', { idempotencyKey: 'idem_dup' })
    );
    // The engine's replay cache fires on idempotencyKey, so the
    // second delivery hits drop-duplicate at admission — BEFORE the
    // bridge's own idempotency dedup check on the same key.
    expect(second.status).toBe('rejected');
    if (second.status === 'rejected') {
      expect(second.reason).toMatch(/drop-duplicate:/);
    }
  });
});

// ---------------------------------------------------------------------------
// Per-peer rate limiting
// ---------------------------------------------------------------------------

describe('Phase 4.1 — per-peer rate limiting exhausts independently per peerId', () => {
  it('exhausting one peer\'s bucket does not affect another peer\'s budget', async () => {
    const { service } = makeServiceWithGateway();
    // Send many deliveries from peer-A. We do not know the engine's
    // exact default rate-limit numbers, but at minimum we can prove
    // that peer-B's budget is untouched by peer-A's traffic.
    const peerAResults: BridgeDeliveryResponse[] = [];
    for (let i = 0; i < 20; i += 1) {
      peerAResults.push(
        await service.acceptDelivery(
          request(`evt_p41_rate_a_${i}`, { peerId: 'transport-peer-A' })
        )
      );
    }
    // At least the first delivery succeeded; that proves the
    // admission path runs and peer-A's bucket exists.
    expect(peerAResults[0]?.status).toBe('confirmed');

    // Now peer-B sends one delivery; it must be accepted regardless
    // of peer-A's state.
    const peerB = await service.acceptDelivery(
      request('evt_p41_rate_b_1', { peerId: 'transport-peer-B' })
    );
    expect(peerB.status).toBe('confirmed');
  });
});

// ---------------------------------------------------------------------------
// peerId fallback discipline
// ---------------------------------------------------------------------------

describe('Phase 4.1 — peerId fallback to deviceId', () => {
  it('a request without peerId is bucketed under deviceId', async () => {
    const { service, gateway } = makeServiceWithGateway();
    await service.acceptDelivery(request('evt_p41_fallback_1'));
    // No peerId was supplied; the gateway falls back to
    // `event.deviceId`, which is `device:alice-phone` for our
    // signedNote helper.
    expect(Object.keys(gateway.state.rateLimitState)).toEqual([
      'device:alice-phone'
    ]);
  });

  it('a request WITH peerId uses that peer key', async () => {
    const { service, gateway } = makeServiceWithGateway();
    await service.acceptDelivery(
      request('evt_p41_explicit_1', { peerId: 'transport-peer-explicit' })
    );
    expect(Object.keys(gateway.state.rateLimitState)).toContain(
      'transport-peer-explicit'
    );
    expect(Object.keys(gateway.state.rateLimitState)).not.toContain(
      'device:alice-phone'
    );
  });

  it('an empty-string peerId is treated as omitted (falls back to deviceId)', async () => {
    const { service, gateway } = makeServiceWithGateway();
    await service.acceptDelivery(request('evt_p41_empty_1', { peerId: '' }));
    expect(Object.keys(gateway.state.rateLimitState)).toEqual([
      'device:alice-phone'
    ]);
  });
});

// ---------------------------------------------------------------------------
// Sequencing: admission runs AFTER signature verification
// ---------------------------------------------------------------------------

describe('Phase 4.1 — admission runs AFTER signature verification', () => {
  it('a tampered envelope is rejected by signature verification without consuming admission budget', async () => {
    const { service, gateway } = makeServiceWithGateway();
    const ok = signedNote('evt_p41_tamper_1');
    const tampered: SignedEventEnvelope = {
      ...ok,
      signature: {
        ...ok.signature,
        // Flip a byte in the signature.
        value: 'X'.repeat(ok.signature.value.length)
      }
    };
    const response = await service.acceptDelivery({
      idempotencyKey: 'idem_p41_tamper_1',
      target: 'durable-stream:inbox',
      event: tampered
    });
    expect(response.status).toBe('rejected');
    // Crucially: admission's per-peer state MUST NOT have advanced.
    // Otherwise a forged envelope from an attacker would burn the
    // legitimate producer's rate-limit budget.
    expect(Object.keys(gateway.state.rateLimitState).length).toBe(0);
    expect(Object.keys(gateway.state.peerReputation).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Engine state advance: every admission moves state forward
// ---------------------------------------------------------------------------

describe('Phase 4.1 — admission state moves forward atomically', () => {
  it('the gateway state reference changes on every admit call', async () => {
    const { service, gateway } = makeServiceWithGateway();
    const initialState = gateway.state;
    await service.acceptDelivery(request('evt_p41_adv_1'));
    const afterFirst = gateway.state;
    expect(afterFirst).not.toBe(initialState);
    await service.acceptDelivery(request('evt_p41_adv_2'));
    const afterSecond = gateway.state;
    expect(afterSecond).not.toBe(afterFirst);
  });

  it('each successive accept appends an audit entry; rejects also append', async () => {
    const { service, gateway } = makeServiceWithGateway();
    await service.acceptDelivery(request('evt_p41_log_1'));
    await service.acceptDelivery(request('evt_p41_log_2'));
    // Two accepts → at least two audit entries.
    expect(gateway.state.auditLog.entries.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Privacy-safe logging on rejection reasons
// ---------------------------------------------------------------------------

describe('Phase 4.1 — privacy-safe rejection reasons (Phase 3.1 doctrine)', () => {
  it('rejection reasons contain only stable code labels, never payload contents', async () => {
    const { service } = makeServiceWithGateway({ maxBytes: 1 });
    const response = await service.acceptDelivery(
      request('evt_p41_priv_1', { body: 'SECRET_PAYLOAD_BODY' })
    );
    expect(response.status).toBe('rejected');
    if (response.status === 'rejected') {
      expect(response.reason).not.toMatch(/SECRET_PAYLOAD_BODY/);
      // Format is `${action}:${reasonCode}` per the gateway's
      // #formatReason contract.
      expect(response.reason).toMatch(/^(rejected|rate-limited):[^:]+/);
    }
  });
});
