import { describe, expect, it } from 'vitest';
import { canonicalizeJson, createUnsignedEvent, validateUnsignedEvent } from './index.js';

describe('protocol event envelopes', () => {
  it('creates a deterministic unsigned event envelope', () => {
    const event = createUnsignedEvent({
      eventId: 'evt_001',
      kind: 'outbox.test.created',
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: '2026-05-22T00:00:00.000Z',
      privacy: 'device-local',
      payload: { body: 'hello' }
    });

    expect(event.version).toBe('lfp2p.event.v1');
    expect(event.lamport).toBe(0);
    expect(event.schemaVersion).toBe(1);
  });

  it('canonicalizes object keys recursively', () => {
    expect(canonicalizeJson({ z: 1, a: { y: true, b: 'x' } })).toBe(
      '{"a":{"b":"x","y":true},"z":1}'
    );
  });

  it('rejects invalid timestamps', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_bad',
        kind: 'outbox.test.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: 'not-a-date',
        privacy: 'device-local',
        payload: {}
      })
    ).toThrow(/createdAt/);
  });

  it('rejects unsupported runtime event kinds and privacy scopes', () => {
    const event = createUnsignedEvent({
      eventId: 'evt_runtime_validation',
      kind: 'outbox.test.created',
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: '2026-05-22T00:00:00.000Z',
      privacy: 'device-local',
      payload: {}
    });

    expect(() => validateUnsignedEvent({ ...event, kind: 'evil.kind' } as never)).toThrow(
      /Unsupported event kind/
    );
    expect(() => validateUnsignedEvent({ ...event, privacy: 'secret' } as never)).toThrow(
      /Unsupported privacy scope/
    );
  });

  it('accepts a self private payload envelope for user content', () => {
    const event = createUnsignedEvent({
      eventId: 'evt_self_encrypted',
      kind: 'note.created',
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: '2026-05-22T00:00:00.000Z',
      privacy: 'self',
      payload: {
        version: 'lfp2p.private-payload.envelope.v1',
        algorithm: 'aes-gcm-256',
        ciphertext: 'aGVsbG8',
        nonce: 'AAAAAAAAAAAAAAAA',
        keyId: 'content:key:alice'
      }
    });

    expect(() => validateUnsignedEvent(event)).not.toThrow();
  });

  it('rejects plaintext dm payloads', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_dm_plaintext',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-05-22T00:00:00.000Z',
        privacy: 'dm',
        payload: { body: 'hello' }
      })
    ).toThrow(/must contain a private payload envelope/);
  });

  it('rejects public payloads containing an envelope', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_public_envelope',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-05-22T00:00:00.000Z',
        privacy: 'public',
        payload: {
          version: 'lfp2p.private-payload.envelope.v1',
          algorithm: 'aes-gcm-256',
          ciphertext: 'aGVsbG8',
          nonce: 'AAAAAAAAAAAAAAAA',
          keyId: 'content:key:alice'
        }
      })
    ).toThrow(/must not contain a private payload envelope/);
  });

  it('rejects invalid private payload envelope version', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_invalid_version',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-05-22T00:00:00.000Z',
        privacy: 'dm',
        payload: {
          version: 'lfp2p.private-payload.envelope.v2',
          algorithm: 'aes-gcm-256',
          ciphertext: 'aGVsbG8',
          nonce: 'AAAAAAAAAAAAAAAA',
          keyId: 'content:key:alice'
        }
      })
    ).toThrow(/Unsupported private payload envelope version/);
  });

  it('rejects invalid private payload envelope algorithm', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_invalid_algorithm',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-05-22T00:00:00.000Z',
        privacy: 'dm',
        payload: {
          version: 'lfp2p.private-payload.envelope.v1',
          algorithm: 'aes-gcm-128',
          ciphertext: 'aGVsbG8',
          nonce: 'AAAAAAAAAAAAAAAA',
          keyId: 'content:key:alice'
        }
      })
    ).toThrow(/Unsupported private payload envelope algorithm/);
  });

  it('rejects invalid private payload envelope nonce values', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_invalid_nonce',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-05-22T00:00:00.000Z',
        privacy: 'dm',
        payload: {
          version: 'lfp2p.private-payload.envelope.v1',
          algorithm: 'aes-gcm-256',
          ciphertext: 'aGVsbG8',
          nonce: 'AAA',
          keyId: 'content:key:alice'
        }
      })
    ).toThrow(/payload\.nonce must be base64url with no padding|payload\.nonce must decode to 12 bytes/);
  });

  it('rejects duplicate recipient device IDs in private payload envelope', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_dup_recipients',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-05-22T00:00:00.000Z',
        privacy: 'dm',
        payload: {
          version: 'lfp2p.private-payload.envelope.v1',
          algorithm: 'aes-gcm-256',
          ciphertext: 'aGVsbG8',
          nonce: 'AAAAAAAAAAAAAAAA',
          keyId: 'content:key:alice',
          recipientWraps: [
            {
              recipientIdentityId: 'identity:alice',
              recipientDeviceId: 'device:alice-phone',
              keyAgreement: 'x25519-v1',
              wrappedKey: 'aGVsbG8',
              wrappingKeyRef: 'device-key:alice-phone-enc'
            },
            {
              recipientIdentityId: 'identity:alice',
              recipientDeviceId: 'device:alice-phone',
              keyAgreement: 'x25519-v1',
              wrappedKey: 'aGVsbG8',
              wrappingKeyRef: 'device-key:alice-phone-enc'
            }
          ]
        }
      })
    ).toThrow(/duplicate.*recipientDeviceId/);
  });

  it('rejects unsupported key agreement algorithms in recipient wraps', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_bad_ka',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-05-22T00:00:00.000Z',
        privacy: 'dm',
        payload: {
          version: 'lfp2p.private-payload.envelope.v1',
          algorithm: 'aes-gcm-256',
          ciphertext: 'aGVsbG8',
          nonce: 'AAAAAAAAAAAAAAAA',
          keyId: 'content:key:alice',
          recipientWraps: [
            {
              recipientIdentityId: 'identity:alice',
              recipientDeviceId: 'device:alice-phone',
              keyAgreement: 'x25519-v2' as any,
              wrappedKey: 'aGVsbG8',
              wrappingKeyRef: 'device-key:alice-phone-enc'
            }
          ]
        }
      })
    ).toThrow(/Unsupported key agreement algorithm/);
  });

  it('rejects recipient wraps with missing required fields', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_missing_wrap_field',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-05-22T00:00:00.000Z',
        privacy: 'dm',
        payload: {
          version: 'lfp2p.private-payload.envelope.v1',
          algorithm: 'aes-gcm-256',
          ciphertext: 'aGVsbG8',
          nonce: 'AAAAAAAAAAAAAAAA',
          keyId: 'content:key:alice',
          recipientWraps: [
            {
              recipientIdentityId: 'identity:alice',
              recipientDeviceId: 'device:alice-phone',
              keyAgreement: 'x25519-v1',
              wrappedKey: 'aGVsbG8'
            }
          ]
        }
      })
    ).toThrow(/wrappingKeyRef/);
  });

  it('validates runtime source references', () => {
    const event = createUnsignedEvent({
      eventId: 'evt_refs',
      kind: 'outbox.test.created',
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: '2026-05-22T00:00:00.000Z',
      privacy: 'device-local',
      payload: {},
      refs: [{ sourceId: 'source:one', sequence: 1 }]
    });

    expect(() => validateUnsignedEvent(event)).not.toThrow();
    expect(() =>
      validateUnsignedEvent({
        ...event,
        refs: [{ sourceId: '', sequence: -1 }]
      } as never)
    ).toThrow(/ref\.sourceId|ref\.sequence/);
  });

  it('validates identity-control payload requirements', () => {
    const identityControllerCreated = createUnsignedEvent({
      eventId: 'evt_identity_controller_created',
      kind: 'identity.controller.created',
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: '2026-05-26T00:00:00.000Z',
      privacy: 'self',
      payload: {
        controllerPublicKey: 'controller-public-key',
        initialDeviceId: 'device:alice-phone'
      }
    });
    expect(() => validateUnsignedEvent(identityControllerCreated)).not.toThrow();

    expect(() =>
      validateUnsignedEvent({
        ...identityControllerCreated,
        privacy: 'device-local'
      } as never)
    ).toThrow(/must use privacy scope self/);

    expect(() =>
      validateUnsignedEvent({
        ...identityControllerCreated,
        payload: {
          ...identityControllerCreated.payload,
          controllerPublicKey: ''
        }
      } as never)
    ).toThrow(/payload\.controllerPublicKey must be a non-empty string/);
  });
});
