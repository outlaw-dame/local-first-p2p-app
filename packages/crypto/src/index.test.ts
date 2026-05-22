import { describe, expect, it } from 'vitest';
import { createUnsignedEvent } from '@lfp2p/protocol';
import { signEventEnvelope, signingKeypairFromSeed, verifySignedEventEnvelope } from './index.js';

describe('event signing', () => {
  const keypair = signingKeypairFromSeed(new Uint8Array(32).fill(7));

  it('signs and verifies a protocol event', () => {
    const event = createUnsignedEvent({
      eventId: 'evt_signed_001',
      kind: 'outbox.test.created',
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: '2026-05-22T00:00:00.000Z',
      privacy: 'device-local',
      payload: { body: 'hello' }
    });

    const signed = signEventEnvelope(event, keypair);
    expect(verifySignedEventEnvelope(signed)).toBe(true);
  });

  it('rejects tampered payloads', () => {
    const event = createUnsignedEvent({
      eventId: 'evt_signed_002',
      kind: 'outbox.test.created',
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: '2026-05-22T00:00:00.000Z',
      privacy: 'device-local',
      payload: { body: 'hello' }
    });

    const signed = signEventEnvelope(event, keypair);
    const tampered = { ...signed, payload: { body: 'changed' } };
    expect(verifySignedEventEnvelope(tampered)).toBe(false);
  });
});
