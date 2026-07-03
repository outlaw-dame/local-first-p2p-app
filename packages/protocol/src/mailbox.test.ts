import { describe, expect, it } from 'vitest';
import { MLS_APPLICATION_MESSAGE_ENVELOPE_VERSION } from './index.js';
import { createUnsignedEvent, isEventKind, validateUnsignedEvent } from './index.js';
import { EVENT_KIND_CONSISTENCY_CLASS } from './consistency-classes.js';
import type { EventKind, PrivacyScope } from './index.js';

type Case = { kind: EventKind; allowed: PrivacyScope[]; class: 'B' | 'D' };

const MAILBOX_CASES: Case[] = [
  { kind: 'mailbox.envelope.queued', allowed: ['dm', 'group'], class: 'D' },
  { kind: 'mailbox.envelope.delivered', allowed: ['dm', 'group'], class: 'D' },
  { kind: 'mailbox.envelope.expired', allowed: ['dm', 'group'], class: 'B' },
  { kind: 'mailbox.envelope.fetched', allowed: ['self'], class: 'D' },
  { kind: 'mailbox.receipt.issued', allowed: ['self'], class: 'D' },
  { kind: 'mailbox.ack.sent', allowed: ['dm'], class: 'D' },
  { kind: 'mailbox.checkpoint.advanced', allowed: ['self'], class: 'D' }
];

const ALL_SCOPES: PrivacyScope[] = ['device-local', 'self', 'dm', 'group', 'public'];

function envelope() {
  return {
    version: 'lfp2p.private-payload.envelope.v1',
    algorithm: 'aes-gcm-256',
    ciphertext: 'aGVsbG8',
    nonce: 'AAAAAAAAAAAAAAAA',
    keyId: 'content:key:alice'
  };
}

function mailboxEvent(kind: EventKind, privacy: PrivacyScope, payload: unknown = envelope()) {
  return createUnsignedEvent({
    eventId: `evt_${kind}_${privacy}`,
    kind,
    author: 'identity:alice',
    deviceId: 'device:alice-phone',
    createdAt: '2026-07-03T00:00:00.000Z',
    privacy,
    payload: payload as never
  });
}

describe('mailbox event kinds (Phase 5.11)', () => {
  it('registers all seven mailbox.* kinds', () => {
    for (const c of MAILBOX_CASES) expect(isEventKind(c.kind)).toBe(true);
  });

  it('accepts each kind in its allowed privacy scope(s) with an envelope', () => {
    for (const c of MAILBOX_CASES) {
      for (const scope of c.allowed) {
        expect(() => validateUnsignedEvent(mailboxEvent(c.kind, scope))).not.toThrow();
      }
    }
  });

  it('classifies each kind with the correct consistency class', () => {
    for (const c of MAILBOX_CASES) {
      expect(EVENT_KIND_CONSISTENCY_CLASS[c.kind]).toBe(c.class);
    }
  });

  it('rejects every disallowed privacy scope per kind', () => {
    for (const c of MAILBOX_CASES) {
      for (const scope of ALL_SCOPES) {
        if (c.allowed.includes(scope)) continue;
        expect(() => validateUnsignedEvent(mailboxEvent(c.kind, scope))).toThrow();
      }
    }
  });

  it('rejects a plaintext (non-envelope) payload in an allowed scope', () => {
    // dm/group/self all require a PrivatePayloadEnvelopeV1.
    expect(() =>
      validateUnsignedEvent(mailboxEvent('mailbox.envelope.queued', 'dm', { envelopeId: 'e1' }))
    ).toThrow(/must contain a private payload envelope|must contain a PrivatePayloadEnvelopeV1/);
  });

  it('rejects an MLS-shaped payload for a mailbox event', () => {
    expect(() =>
      validateUnsignedEvent(
        mailboxEvent('mailbox.envelope.queued', 'group', {
          version: MLS_APPLICATION_MESSAGE_ENVELOPE_VERSION,
          groupId: 'g1',
          epoch: 0,
          senderDeviceId: 'device:alice-phone',
          ciphertext: 'aGVsbG8'
        })
      )
    ).toThrow();
  });
});
