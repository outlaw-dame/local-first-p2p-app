import { describe, expect, it } from 'vitest';
import { createUnsignedEvent } from '@lfp2p/protocol';
import invalidSignedFixture from '../../protocol/fixtures/invalid/signed-event-envelope-crypto-invalid-signature.v1.json';
import validSignedFixture from '../../protocol/fixtures/valid/signed-event-envelope-crypto-valid.v1.json';
import {
  signDetachedJson,
  signEventEnvelope,
  signingKeypairFromSeed,
  verifyDetachedJsonSignature,
  verifySignedEventEnvelope
} from './index.js';

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

  it('treats malformed signature encodings as failed verification instead of throwing', () => {
    const event = createUnsignedEvent({
      eventId: 'evt_signed_003',
      kind: 'outbox.test.created',
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: '2026-05-22T00:00:00.000Z',
      privacy: 'device-local',
      payload: { body: 'hello' }
    });

    const signed = signEventEnvelope(event, keypair);
    const malformed = {
      ...signed,
      signature: {
        ...signed.signature,
        value: '%%%not-base64url%%%'
      }
    };

    expect(() => verifySignedEventEnvelope(malformed)).not.toThrow();
    expect(verifySignedEventEnvelope(malformed)).toBe(false);
  });

  it('signs and verifies detached canonical JSON payloads', () => {
    const payload = {
      id: 'contact:alice',
      profile: { displayName: 'Alice', websiteUrl: 'https://alice.example.test' }
    };
    const signature = signDetachedJson(payload, keypair);
    expect(verifyDetachedJsonSignature(payload, signature)).toBe(true);
    expect(
      verifyDetachedJsonSignature(
        {
          ...payload,
          profile: { ...payload.profile, displayName: 'Mallory' }
        },
        signature
      )
    ).toBe(false);
  });

  it('verifies fixture-backed signed envelopes and rejects tampered fixture signatures', () => {
    expect(verifySignedEventEnvelope(validSignedFixture)).toBe(true);
    expect(verifySignedEventEnvelope(invalidSignedFixture)).toBe(false);
  });
});
