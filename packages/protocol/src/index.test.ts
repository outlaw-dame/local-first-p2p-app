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
});
