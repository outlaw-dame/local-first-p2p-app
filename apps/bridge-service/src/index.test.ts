import { describe, expect, it } from 'vitest';
import { generateSigningKeypair, signEventEnvelope } from '@lfp2p/crypto';
import { createUnsignedEvent, type PrivacyScope } from '@lfp2p/protocol';
import { handleBridgeDeliveryRequest, InMemoryBridgeService } from './index.js';

describe('InMemoryBridgeService', () => {
  it('accepts valid signed bridge-safe events and deduplicates by idempotency key', () => {
    const bridge = new InMemoryBridgeService();
    const event = makeSignedEvent({ eventId: 'evt_bridge_accept', privacy: 'public' });

    const first = bridge.acceptDelivery({
      idempotencyKey: 'idem-accept',
      target: 'bridge:dev',
      event
    }, '2026-05-22T00:00:00.000Z');

    const second = bridge.acceptDelivery({
      idempotencyKey: 'idem-accept',
      target: 'bridge:dev',
      event
    }, '2026-05-22T00:01:00.000Z');

    expect(first).toMatchObject({ status: 'confirmed', duplicate: false, sequence: 1 });
    expect(second).toMatchObject({ status: 'confirmed', duplicate: true, sequence: 1 });
    expect(bridge.snapshot()).toEqual({
      role: 'stateful-edge-actor',
      authoritativeForPrivateState: false,
      acceptedCount: 1
    });
  });

  it('rejects local-only privacy scopes', () => {
    const bridge = new InMemoryBridgeService();
    const deviceLocal = bridge.acceptDelivery({
      idempotencyKey: 'idem-device-local',
      target: 'bridge:dev',
      event: makeSignedEvent({ eventId: 'evt_device_local', privacy: 'device-local' })
    });
    const selfOnly = bridge.acceptDelivery({
      idempotencyKey: 'idem-self',
      target: 'bridge:dev',
      event: makeSignedEvent({ eventId: 'evt_self', privacy: 'self' })
    });

    expect(deviceLocal).toMatchObject({ status: 'rejected' });
    expect(selfOnly).toMatchObject({ status: 'rejected' });
    expect(bridge.snapshot().acceptedCount).toBe(0);
  });

  it('detects idempotency-key conflicts', () => {
    const bridge = new InMemoryBridgeService();
    const first = makeSignedEvent({ eventId: 'evt_first', privacy: 'public' });
    const second = makeSignedEvent({ eventId: 'evt_second', privacy: 'public' });

    expect(bridge.acceptDelivery({ idempotencyKey: 'idem-conflict', target: 'bridge:dev', event: first })).toMatchObject({
      status: 'confirmed'
    });
    expect(bridge.acceptDelivery({ idempotencyKey: 'idem-conflict', target: 'bridge:dev', event: second })).toMatchObject({
      status: 'conflicted',
      existingEventId: 'evt_first'
    });
  });

  it('rejects tampered signatures', () => {
    const bridge = new InMemoryBridgeService();
    const signed = makeSignedEvent({ eventId: 'evt_tampered', privacy: 'public' });
    const tampered = {
      ...signed,
      payload: { body: 'tampered after signing' }
    };

    expect(
      bridge.acceptDelivery({
        idempotencyKey: 'idem-tampered',
        target: 'bridge:dev',
        event: tampered
      })
    ).toMatchObject({ status: 'rejected', reason: 'Event signature verification failed' });
  });
});

describe('handleBridgeDeliveryRequest', () => {
  it('maps new and duplicate accepted deliveries to HTTP responses', async () => {
    const bridge = new InMemoryBridgeService();
    const request = makeRequest('idem-http', makeSignedEvent({ eventId: 'evt_http', privacy: 'public' }));

    const first = await handleBridgeDeliveryRequest(bridge, request, '2026-05-22T00:00:00.000Z');
    const second = await handleBridgeDeliveryRequest(bridge, request, '2026-05-22T00:01:00.000Z');

    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({ status: 'confirmed', duplicate: false, sequence: 1 });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ status: 'confirmed', duplicate: true, sequence: 1 });
  });

  it('rejects malformed or inconsistent HTTP delivery requests', async () => {
    const bridge = new InMemoryBridgeService();
    const mismatched = await handleBridgeDeliveryRequest(
      bridge,
      makeRequest('idem-body', makeSignedEvent({ eventId: 'evt_http_mismatch', privacy: 'public' }), 'idem-header'),
      '2026-05-22T00:00:00.000Z'
    );
    const wrongMethod = await handleBridgeDeliveryRequest(
      bridge,
      new Request('https://bridge.test/events', { method: 'GET' }),
      '2026-05-22T00:00:00.000Z'
    );

    expect(mismatched.status).toBe(400);
    expect(await mismatched.json()).toMatchObject({ status: 'rejected', reason: 'Idempotency header does not match request body' });
    expect(wrongMethod.status).toBe(405);
  });
});

function makeRequest(idempotencyKey: string, event: ReturnType<typeof makeSignedEvent>, headerKey = idempotencyKey): Request {
  return new Request('https://bridge.test/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-lfp2p-idempotency-key': headerKey
    },
    body: JSON.stringify({
      idempotencyKey,
      target: 'bridge:dev',
      event
    })
  });
}

function makeSignedEvent(input: { eventId: string; privacy: PrivacyScope }) {
  const keypair = generateSigningKeypair();
  return signEventEnvelope(
    createUnsignedEvent({
      eventId: input.eventId,
      kind: 'outbox.test.created',
      author: `identity:${keypair.publicKey}`,
      deviceId: `device:${keypair.publicKey.slice(0, 16)}`,
      createdAt: '2026-05-22T00:00:00.000Z',
      privacy: input.privacy,
      payload: { body: input.eventId }
    }),
    keypair
  );
}
