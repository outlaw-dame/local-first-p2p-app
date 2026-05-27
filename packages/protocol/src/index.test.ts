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
