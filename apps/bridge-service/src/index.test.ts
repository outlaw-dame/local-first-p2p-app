import { describe, expect, it } from 'vitest';
import { generateSigningKeypair, signEventEnvelope } from '@lfp2p/crypto';
import { createUnsignedEvent, type PrivacyScope } from '@lfp2p/protocol';
import { InMemoryBridgeService } from './index.js';

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
