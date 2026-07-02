import { describe, expect, it } from 'vitest';
import { createUnsignedEvent } from '@lfp2p/protocol';
import invalidSignedFixture from '../fixtures/invalid/signed-event-envelope-crypto-invalid-signature.v1.json';
import validSignedFixture from '../fixtures/valid/signed-event-envelope-crypto-valid.v1.json';
import {
  signDetachedJson,
  signEventEnvelope,
  signingKeypairFromSeed,
  verifyDetachedJsonSignature,
  verifySignedEventEnvelope,
  encryptPayloadEnvelope,
  decryptPayloadEnvelope,
  generateNonExtractableAesGcmKey,
  generateX25519Keypair,
  x25519KeypairFromSeed,
  wrapPayloadKeyWithX25519,
  unwrapPayloadKeyWithX25519,
  toBase64Url
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

describe('private payload envelope encryption', () => {
  it('encrypts and decrypts a payload envelope with AES-GCM-256', async () => {
    const key = await generateNonExtractableAesGcmKey();
    const envelope = await encryptPayloadEnvelope(
      { body: 'hello' },
      'payload:aad',
      key,
      'content:key:test'
    );

    expect(envelope.version).toBe('lfp2p.private-payload.envelope.v1');
    expect(envelope.algorithm).toBe('aes-gcm-256');
    expect(envelope.keyId).toBe('content:key:test');
    expect(envelope.ciphertext).toBeTruthy();
    expect(envelope.nonce).toHaveLength(16);

    const plaintext = await decryptPayloadEnvelope(envelope, key, 'payload:aad');
    expect(plaintext).toBe('{"body":"hello"}');
  });

  it('rejects decrypting an envelope with the wrong key', async () => {
    const key = await generateNonExtractableAesGcmKey();
    const envelope = await encryptPayloadEnvelope(
      { body: 'hello' },
      'payload:aad',
      key,
      'content:key:test'
    );
    const wrongKey = await generateNonExtractableAesGcmKey();
    await expect(decryptPayloadEnvelope(envelope, wrongKey, 'payload:aad')).rejects.toThrow();
  });
});

describe('X25519 key wrapping', () => {
  it('generates X25519 keypair with proper encoding', () => {
    const keypair = generateX25519Keypair();
    expect(keypair.publicKey).toBeTruthy();
    expect(keypair.privateKey).toBeTruthy();
    expect(typeof keypair.publicKey).toBe('string');
    expect(typeof keypair.privateKey).toBe('string');
    expect(keypair.publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(keypair.privateKey).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates X25519 keypair from seed', () => {
    const seed = new Uint8Array(32);
    globalThis.crypto.getRandomValues(seed);
    const keypair = x25519KeypairFromSeed(seed);
    expect(keypair.publicKey).toBeTruthy();
    expect(keypair.privateKey).toBeTruthy();
  });

  it('wraps and unwraps payload key with X25519', () => {
    const recipientKeypair = generateX25519Keypair();
    const payloadKeyBase64Url = toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(32)));

    const wrappedKey = wrapPayloadKeyWithX25519(payloadKeyBase64Url, recipientKeypair.publicKey);
    expect(wrappedKey).toBeTruthy();

    const unwrappedKey = unwrapPayloadKeyWithX25519(wrappedKey, recipientKeypair.privateKey);
    expect(unwrappedKey).toBe(payloadKeyBase64Url);
  });

  it('wraps payload key with sender private key for replay protection', () => {
    const senderKeypair = generateX25519Keypair();
    const recipientKeypair = generateX25519Keypair();
    const payloadKeyBase64Url = toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(32)));

    const wrappedKey1 = wrapPayloadKeyWithX25519(
      payloadKeyBase64Url,
      recipientKeypair.publicKey,
      senderKeypair.privateKey
    );
    const wrappedKey2 = wrapPayloadKeyWithX25519(
      payloadKeyBase64Url,
      recipientKeypair.publicKey,
      senderKeypair.privateKey
    );

    expect(wrappedKey1).not.toBe(wrappedKey2);

    const unwrapped1 = unwrapPayloadKeyWithX25519(wrappedKey1, recipientKeypair.privateKey);
    const unwrapped2 = unwrapPayloadKeyWithX25519(wrappedKey2, recipientKeypair.privateKey);
    expect(unwrapped1).toBe(payloadKeyBase64Url);
    expect(unwrapped2).toBe(payloadKeyBase64Url);
  });

  it('rejects unwrapping with wrong recipient private key', () => {
    const recipientKeypair1 = generateX25519Keypair();
    const recipientKeypair2 = generateX25519Keypair();
    const payloadKeyBase64Url = toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(32)));

    const wrappedKey = wrapPayloadKeyWithX25519(payloadKeyBase64Url, recipientKeypair1.publicKey);
    expect(() => unwrapPayloadKeyWithX25519(wrappedKey, recipientKeypair2.privateKey)).toThrow();
  });

  it('rejects unwrapping corrupted wrapped key', () => {
    const recipientKeypair = generateX25519Keypair();
    const corruptedWrappedKey = toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(100)));

    expect(() =>
      unwrapPayloadKeyWithX25519(corruptedWrappedKey, recipientKeypair.privateKey)
    ).toThrow();
  });

  it('rejects wrapping with invalid recipient public key', () => {
    const payloadKeyBase64Url = toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
    const invalidPubKey = toBase64Url(new Uint8Array(20));

    expect(() => wrapPayloadKeyWithX25519(payloadKeyBase64Url, invalidPubKey)).toThrow(
      /Invalid recipient public key length/
    );
  });

  it('rejects wrapping empty payload key', () => {
    const recipientKeypair = generateX25519Keypair();
    expect(() => wrapPayloadKeyWithX25519('', recipientKeypair.publicKey)).toThrow(
      /Payload key cannot be empty/
    );
  });
});

describe('recipient wraps in private payload envelope', () => {
  it('accepts valid recipient wraps in private payload envelope', async () => {
    const contentKey = await generateNonExtractableAesGcmKey();
    const recipientKeypair = generateX25519Keypair();
    const payloadKeyBase64Url = toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
    const wrappedKey = wrapPayloadKeyWithX25519(payloadKeyBase64Url, recipientKeypair.publicKey);

    const envelope = await encryptPayloadEnvelope(
      { text: 'secret message' },
      'encryption:aad',
      contentKey,
      'content:key:v1',
      [
        {
          recipientIdentityId: 'identity:alice',
          recipientDeviceId: 'device:alice-phone',
          keyAgreement: 'x25519-v1',
          wrappedKey,
          wrappingKeyRef: 'device-key:alice-phone-enc'
        }
      ]
    );

    expect(envelope.recipientWraps).toBeDefined();
    expect(envelope.recipientWraps).toHaveLength(1);
    expect(envelope.recipientWraps![0].recipientIdentityId).toBe('identity:alice');
    expect(envelope.recipientWraps![0].recipientDeviceId).toBe('device:alice-phone');
    expect(envelope.recipientWraps![0].keyAgreement).toBe('x25519-v1');
  });

  it('accepts multiple recipient wraps', async () => {
    const contentKey = await generateNonExtractableAesGcmKey();
    const payloadKeyBase64Url = toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(32)));

    const alice = generateX25519Keypair();
    const bob = generateX25519Keypair();

    const envelope = await encryptPayloadEnvelope(
      { text: 'group message' },
      undefined,
      contentKey,
      'content:key:v1',
      [
        {
          recipientIdentityId: 'identity:alice',
          recipientDeviceId: 'device:alice-phone',
          keyAgreement: 'x25519-v1',
          wrappedKey: wrapPayloadKeyWithX25519(payloadKeyBase64Url, alice.publicKey),
          wrappingKeyRef: 'device-key:alice-phone-enc'
        },
        {
          recipientIdentityId: 'identity:bob',
          recipientDeviceId: 'device:bob-desktop',
          keyAgreement: 'x25519-v1',
          wrappedKey: wrapPayloadKeyWithX25519(payloadKeyBase64Url, bob.publicKey),
          wrappingKeyRef: 'device-key:bob-desktop-enc'
        }
      ]
    );

    expect(envelope.recipientWraps).toHaveLength(2);
  });
});
