import { describe, expect, it } from 'vitest';
import {
  createUnsignedEvent,
  type JsonObject,
  type PrivatePayloadEnvelopeV1
} from '@lfp2p/protocol';
import {
  buildPrivatePayloadAad,
  decryptPrivatePayload,
  encryptPrivatePayload,
  generatePrivatePayloadKeyMaterial,
  validatePrivatePayloadEnvelopeShape,
  type PrivatePayloadAadContext
} from './index.js';

const CONTEXT: PrivatePayloadAadContext = {
  eventId: 'evt-private-1',
  kind: 'reputation.observation.recorded',
  author: 'did:example:alice',
  deviceId: 'device-a',
  createdAt: '2026-06-25T00:00:00.000Z',
  privacy: 'self',
  schemaVersion: 1
};

const PRIVATE_PAYLOAD = Object.freeze({
  version: 'lfp2p.reputation-event.v1',
  eventId: CONTEXT.eventId,
  kind: CONTEXT.kind,
  createdAt: CONTEXT.createdAt,
  subjectId: 'did:example:bob',
  score: 1
});

describe('@lfp2p/private-payload', () => {
  it('encrypts and decrypts JSON while keeping plaintext out of the envelope', async () => {
    const keyMaterial = generatePrivatePayloadKeyMaterial();
    const envelope = await encryptPrivatePayload({
      plaintext: PRIVATE_PAYLOAD,
      context: CONTEXT,
      keyMaterial,
      keyId: 'account-local-key-1'
    });

    expect(envelope.version).toBe('lfp2p.private-payload.envelope.v1');
    expect(envelope.algorithm).toBe('aes-gcm-256');
    expect(JSON.stringify(envelope)).not.toContain('did:example:bob');
    expect(JSON.stringify(envelope)).not.toContain('score');

    const decrypted = await decryptPrivatePayload({ envelope, context: CONTEXT, keyMaterial });
    expect(decrypted).toEqual(PRIVATE_PAYLOAD);
  });

  it('binds ciphertext to canonical event metadata through AAD', async () => {
    const keyMaterial = generatePrivatePayloadKeyMaterial();
    const envelope = await encryptPrivatePayload({
      plaintext: PRIVATE_PAYLOAD,
      context: CONTEXT,
      keyMaterial,
      keyId: 'account-local-key-2'
    });

    await expect(
      decryptPrivatePayload({
        envelope,
        keyMaterial,
        context: { ...CONTEXT, eventId: 'evt-swapped' }
      })
    ).rejects.toThrow();
  });

  it('produces deterministic AAD for equivalent context objects', () => {
    expect(buildPrivatePayloadAad({ ...CONTEXT })).toBe(buildPrivatePayloadAad(CONTEXT));
  });

  it('creates protocol-valid account-local reputation envelopes for self privacy', async () => {
    const keyMaterial = generatePrivatePayloadKeyMaterial();
    const payload = await encryptPrivatePayload({
      plaintext: PRIVATE_PAYLOAD,
      context: CONTEXT,
      keyMaterial,
      keyId: 'account-local-key-3'
    });

    const event = createUnsignedEvent({
      eventId: CONTEXT.eventId,
      kind: CONTEXT.kind,
      author: CONTEXT.author,
      deviceId: CONTEXT.deviceId,
      createdAt: CONTEXT.createdAt,
      privacy: CONTEXT.privacy,
      schemaVersion: CONTEXT.schemaVersion,
      payload: payload as unknown as JsonObject
    });

    expect(event.payload.version).toBe('lfp2p.private-payload.envelope.v1');
  });

  it('rejects malformed metadata and duplicate recipient wraps', () => {
    const malformed = {
      version: 'lfp2p.private-payload.envelope.v1',
      algorithm: 'aes-gcm-256',
      ciphertext: 'AAAA',
      nonce: 'AAAAAAAAAAAAAAAA',
      keyId: 'key-1',
      recipientWraps: [
        {
          recipientIdentityId: 'did:example:alice',
          recipientDeviceId: 'device-a',
          keyAgreement: 'x25519-v1',
          wrappedKey: 'AAAA',
          wrappingKeyRef: 'x25519:device-a'
        },
        {
          recipientIdentityId: 'did:example:alice',
          recipientDeviceId: 'device-a',
          keyAgreement: 'x25519-v1',
          wrappedKey: 'AAAA',
          wrappingKeyRef: 'x25519:device-a'
        }
      ]
    } satisfies PrivatePayloadEnvelopeV1;

    expect(() => validatePrivatePayloadEnvelopeShape(malformed)).toThrow(/duplicate recipientDeviceId/);
  });

  it('rejects public/device-local contexts for private payload AAD', () => {
    expect(() =>
      buildPrivatePayloadAad({ ...CONTEXT, privacy: 'public' as unknown as 'self' })
    ).toThrow(/context\.privacy/);
  });
});
