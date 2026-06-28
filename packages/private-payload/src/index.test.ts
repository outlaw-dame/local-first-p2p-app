import { describe, expect, it } from 'vitest';
import { type PrivatePayloadEnvelopeV1 } from '@lfp2p/protocol';
import {
  PRIVATE_PAYLOAD_AAD_VERSION,
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

// The plaintext is a reputation event payload (pre-encryption). This package
// handles the encryption layer only. Wiring this into a full signed
// `reputation.*` protocol event (whose outer payload must satisfy the
// protocol validator's reputation-event shape) is a separate concern deferred
// to a future integration PR. (Codex review #103 P1)
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

  it('preserves validated string values rather than silently trimming them', async () => {
    const keyMaterial = generatePrivatePayloadKeyMaterial();
    const envelope = await encryptPrivatePayload({
      plaintext: PRIVATE_PAYLOAD,
      context: CONTEXT,
      keyMaterial,
      keyId: ' account-local-key-with-spaces '
    });

    expect(envelope.keyId).toBe(' account-local-key-with-spaces ');
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

  it('AAD format matches @lfp2p/envelope — aadVersion key, eventVersion, lamport, refs fields present', () => {
    // AES-GCM authenticates exact AAD bytes. If this package and @lfp2p/envelope produce
    // different byte sequences for the same version string, envelopes are mutually
    // undecryptable. Verify the canonical field set matches. (Codex review #103 P2)
    const aad = JSON.parse(buildPrivatePayloadAad(CONTEXT)) as Record<string, unknown>;
    expect(aad['aadVersion']).toBe(PRIVATE_PAYLOAD_AAD_VERSION);
    expect(aad['eventVersion']).toBe('lfp2p.event.v1');
    expect(aad['lamport']).toBe(0);
    expect(aad['refs']).toEqual([]);
    expect('version' in aad).toBe(false);
  });

  it('AAD lamport and refs are forwarded from context and normalized when provided', () => {
    const aad = JSON.parse(
      buildPrivatePayloadAad({
        ...CONTEXT,
        lamport: 3,
        refs: [{ sourceId: 'src-a', sequence: 1 }, { sourceId: 'src-b', hash: 'sha256:abc' }]
      })
    ) as Record<string, unknown>;
    expect(aad['lamport']).toBe(3);
    expect(aad['refs']).toEqual([
      { sourceId: 'src-a', sequence: 1 },
      { sourceId: 'src-b', hash: 'sha256:abc' }
    ]);
  });

  it('creates private payload envelopes with a valid envelope shape', async () => {
    const keyMaterial = generatePrivatePayloadKeyMaterial();
    const envelope = await encryptPrivatePayload({
      plaintext: PRIVATE_PAYLOAD,
      context: CONTEXT,
      keyMaterial,
      keyId: 'account-local-key-3'
    });

    expect(validatePrivatePayloadEnvelopeShape(envelope)).toBe(envelope);
    expect(envelope.version).toBe('lfp2p.private-payload.envelope.v1');
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

  it('rejects recipient wraps with unsupported fields (strict key check)', () => {
    // Consistent with @lfp2p/protocol's validatePrivatePayloadEnvelope — an envelope
    // with extra wrap fields passes this layer but fails at the protocol boundary.
    // Reject early to surface the error at the right layer. (Gemini review #103)
    const withExtra = {
      version: 'lfp2p.private-payload.envelope.v1',
      algorithm: 'aes-gcm-256',
      ciphertext: 'AAAA',
      nonce: 'AAAAAAAAAAAAAAAA',
      keyId: 'key-1',
      recipientWraps: [
        {
          recipientIdentityId: 'did:example:alice',
          recipientDeviceId: 'device-b',
          keyAgreement: 'x25519-v1',
          wrappedKey: 'AAAA',
          wrappingKeyRef: 'x25519:device-b',
          extraField: 'should-be-rejected'
        }
      ]
    } as unknown as PrivatePayloadEnvelopeV1;

    expect(() => validatePrivatePayloadEnvelopeShape(withExtra)).toThrow(/unsupported field: extraField/);
  });

  it('rejects public/device-local contexts for private payload AAD', () => {
    expect(() =>
      buildPrivatePayloadAad({ ...CONTEXT, privacy: 'public' as unknown as 'self' })
    ).toThrow(/context\.privacy/);
  });
});
