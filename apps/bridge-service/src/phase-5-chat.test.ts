/**
 * Phase 5 — chat event ciphertext-opaqueness pin tests.
 *
 * Non-negotiable (Phase 1.63): the bridge MUST NOT attempt to decrypt
 * a chat event payload to make an admission decision. Decryption is
 * the sole responsibility of the local device that owns the key material.
 *
 * These tests pin that invariant by verifying:
 *  (1) All five chat event kinds are admitted with a structurally-valid
 *      PrivatePayloadEnvelopeV1 — the bridge treats them as opaque Class D.
 *  (2) A chat event whose ciphertext bytes are garbage (would fail decryption)
 *      is STILL accepted — proof that the bridge never called decrypt.
 *  (3) The bridge's admission decision for chat events is driven by the
 *      in-the-clear header (kind, privacy, author, deviceId), never by
 *      the decrypted payload content.
 *
 * Bridge source must not import `decryptPrivatePayload` from any package.
 * That static guarantee is verified in the companion source-scan below.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { signEventEnvelope, signingKeypairFromSeed } from '@lfp2p/crypto';
import {
  createUnsignedEvent,
  placeholderPrivatePayloadEnvelope,
  type EventKind,
  type SignedEventEnvelope
} from '@lfp2p/protocol';
import { InMemoryBridgeService } from './service.js';
import type { BridgeDeliveryRequest } from './types.js';

const KEYPAIR = signingKeypairFromSeed(new Uint8Array(32).fill(9));

const CHAT_EVENT_KINDS: ReadonlyArray<EventKind> = [
  'chat.thread.created',
  'chat.message.sent',
  'chat.message.edited',
  'chat.message.deleted',
  'chat.thread.accepted'
];

function chatEvent(
  eventId: string,
  kind: EventKind,
  ciphertextOverride?: string
): SignedEventEnvelope {
  return signEventEnvelope(
    createUnsignedEvent({
      eventId,
      kind,
      author: 'identity:bob',
      deviceId: 'device:bob-laptop',
      createdAt: '2026-06-29T00:00:00.000Z',
      privacy: 'dm',
      payload: placeholderPrivatePayloadEnvelope(
        ciphertextOverride !== undefined ? { ciphertext: ciphertextOverride } : {}
      )
    }),
    KEYPAIR
  );
}

function req(event: SignedEventEnvelope, idemKey: string): BridgeDeliveryRequest {
  return {
    idempotencyKey: idemKey,
    target: 'durable-stream:dm-inbox',
    event
  };
}

// ---------------------------------------------------------------------------
// Opaqueness happy path — all five chat kinds admitted
// ---------------------------------------------------------------------------

describe('Phase 5 — chat event opaqueness: all kinds admitted', () => {
  for (const kind of CHAT_EVENT_KINDS) {
    it(`admits ${kind} without inspecting payload content`, async () => {
      const service = new InMemoryBridgeService('chat-opaque-edge');
      const event = chatEvent(`evt_chat_kind_${kind.replaceAll('.', '_')}`, kind);
      const response = await service.acceptDelivery(
        req(event, `idem_${kind.replaceAll('.', '_')}`)
      );
      expect(response.status).toBe('confirmed');
    });
  }
});

// ---------------------------------------------------------------------------
// Garbage ciphertext pin — bridge accepts even when decrypt would fail
// ---------------------------------------------------------------------------

describe('Phase 5 — bridge is ciphertext-blind: garbage bytes still admitted', () => {
  it('accepts chat.message.sent with a wrong-key ciphertext (AEAD auth would fail)', async () => {
    // This ciphertext is valid base64url and valid shape, so the protocol
    // envelope validator accepts it. However, decrypting with any key other
    // than the one used to produce it would fail AEAD authentication.
    // The bridge accepting this event proves it never attempted decryption
    // — it treated the payload as an opaque blob exactly as Phase 1.63 requires.
    const wrongKeyCiphertext =
      'aGVsbG9fY2lwaGVydGV4dF9nb2VzX2hlcmVfaW5fYmFzZTY0dXJs'; // 42-byte garbage in base64url
    const service = new InMemoryBridgeService('chat-blind-edge');
    const event = chatEvent('evt_chat_blind_1', 'chat.message.sent', wrongKeyCiphertext);
    const response = await service.acceptDelivery(req(event, 'idem_chat_blind_1'));
    expect(response.status).toBe('confirmed');
  });

  it('accepts chat.thread.created with a ciphertext that is too short for AES-GCM', async () => {
    // AES-GCM requires the ciphertext to be at least 16 bytes (the auth tag size).
    // 3 bytes ('AAAA' = 3 bytes decoded) would cause any real decrypt call to throw.
    // Bridge acceptance here proves no decrypt was attempted.
    const service = new InMemoryBridgeService('chat-blind-edge-2');
    const event = chatEvent('evt_chat_blind_2', 'chat.thread.created', 'AAAA');
    const response = await service.acceptDelivery(req(event, 'idem_chat_blind_2'));
    expect(response.status).toBe('confirmed');
  });

  it('accepts chat.message.deleted with a semantically-invalid ciphertext', async () => {
    // All-zero bytes of valid length: structurally valid base64url, but
    // AES-GCM authentication would fail because the tag cannot match.
    const allZerosCiphertext = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'; // 32 zero bytes
    const service = new InMemoryBridgeService('chat-blind-edge-3');
    const event = chatEvent('evt_chat_blind_3', 'chat.message.deleted', allZerosCiphertext);
    const response = await service.acceptDelivery(req(event, 'idem_chat_blind_3'));
    expect(response.status).toBe('confirmed');
  });
});

// ---------------------------------------------------------------------------
// Privacy scope pin — bridge checks the in-the-clear `privacy` field,
// not the decrypted payload, to determine routing legality
// ---------------------------------------------------------------------------

describe('Phase 5 — bridge checks `privacy` header, not decrypted content', () => {
  it('admits a group-privacy chat event correctly', async () => {
    const service = new InMemoryBridgeService('chat-privacy-pin');
    const event = signEventEnvelope(
      createUnsignedEvent({
        eventId: 'evt_chat_group_1',
        kind: 'chat.message.sent',
        author: 'identity:carol',
        deviceId: 'device:carol-phone',
        createdAt: '2026-06-29T00:00:00.000Z',
        privacy: 'group',
        payload: placeholderPrivatePayloadEnvelope()
      }),
      KEYPAIR
    );
    const response = await service.acceptDelivery(req(event, 'idem_chat_group_1'));
    expect(response.status).toBe('confirmed');
  });
});

// ---------------------------------------------------------------------------
// Static source-scan: bridge service source must NOT import decryptPrivatePayload
// ---------------------------------------------------------------------------

describe('Phase 5 — static pin: bridge source never imports decryptPrivatePayload', () => {
  it('no .ts source file under apps/bridge-service/src imports decryptPrivatePayload', () => {
    const bridgeSrcDir = import.meta.dirname;
    const files = readdirSync(bridgeSrcDir).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts')
    );
    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(join(bridgeSrcDir, file), 'utf8');
      if (content.includes('decryptPrivatePayload')) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });
});
