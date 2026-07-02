import { describe, expect, it } from 'vitest';
import { MLS_APPLICATION_MESSAGE_ENVELOPE_VERSION } from './index.js';
import { createUnsignedEvent, isEventKind, validateUnsignedEvent } from './index.js';
import { EVENT_KIND_CONSISTENCY_CLASS } from './consistency-classes.js';
import type { EventKind } from './index.js';

const UDR_KINDS: EventKind[] = [
  'udr.partition.claimed',
  'udr.partition.released',
  'udr.feed-subscription.added',
  'udr.feed-subscription.removed',
  'udr.sync-interest.added',
  'udr.sync-interest.removed',
  'udr.mailbox.bound',
  'udr.space.joined',
  'udr.space.left'
];

function validEnvelope() {
  return {
    version: 'lfp2p.private-payload.envelope.v1',
    algorithm: 'aes-gcm-256',
    ciphertext: 'aGVsbG8',
    nonce: 'AAAAAAAAAAAAAAAA',
    keyId: 'content:key:alice'
  };
}

function udrEvent(kind: EventKind, overrides: Record<string, unknown> = {}) {
  return createUnsignedEvent({
    eventId: `evt_${kind}`,
    kind,
    author: 'identity:alice',
    deviceId: 'device:alice-phone',
    createdAt: '2026-07-02T00:00:00.000Z',
    privacy: 'self',
    payload: validEnvelope(),
    ...overrides
  });
}

describe('UDR event kinds (Phase 5.11)', () => {
  it('registers all nine udr.* kinds', () => {
    for (const kind of UDR_KINDS) {
      expect(isEventKind(kind)).toBe(true);
    }
  });

  it('accepts self-scoped udr events carrying a PrivatePayloadEnvelopeV1', () => {
    for (const kind of UDR_KINDS) {
      expect(() => validateUnsignedEvent(udrEvent(kind))).not.toThrow();
    }
  });

  it('classifies every udr.* kind as Class B (append-only lifecycle)', () => {
    for (const kind of UDR_KINDS) {
      expect(EVENT_KIND_CONSISTENCY_CLASS[kind]).toBe('B');
    }
  });

  it('rejects udr events that are not self-scoped', () => {
    for (const privacy of ['device-local', 'dm', 'group', 'public'] as const) {
      expect(() => validateUnsignedEvent(udrEvent('udr.space.joined', { privacy }))).toThrow(
        /must use privacy scope self|must not contain|must contain a private payload/
      );
    }
  });

  it('rejects self-scoped udr events with a plaintext (non-envelope) payload', () => {
    expect(() =>
      validateUnsignedEvent(udrEvent('udr.partition.claimed', { payload: { partitionId: 'p1' } }))
    ).toThrow(/must contain a PrivatePayloadEnvelopeV1/);
  });

  it('rejects an MLS-shaped payload for a udr event (fail fast at admission)', () => {
    expect(() =>
      validateUnsignedEvent(
        udrEvent('udr.mailbox.bound', {
          payload: {
            version: MLS_APPLICATION_MESSAGE_ENVELOPE_VERSION,
            groupId: 'g1',
            epoch: 0,
            senderDeviceId: 'device:alice-phone',
            ciphertext: 'aGVsbG8'
          }
        })
      )
    ).toThrow();
  });
});
