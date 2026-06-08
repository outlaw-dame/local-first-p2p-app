import { describe, expect, it } from 'vitest';
import { generateSigningKeypair, generateX25519Keypair, verifySignedEventEnvelope } from '@lfp2p/crypto';
import { buildPrivatePayloadAad, createSignedEnvelopeEvent, resolveRecipients } from '../src/index.js';

describe('createSignedEnvelopeEvent', () => {
  it('creates a signed private envelope event without plaintext payload fields', async () => {
    const signingKeypair = generateSigningKeypair();
    const recipientKeypair = generateX25519Keypair();
    const marker = 'private-body-text';
    const recipients = resolveRecipients([
      {
        identityId: 'identity:bob',
        devices: {
          laptop: {
            deviceId: 'device:bob-laptop',
            status: 'active',
            wrapPublicKey: recipientKeypair.publicKey,
            wrapKeyRef: 'wrap-key:bob-laptop'
          }
        }
      }
    ]);

    const built = await createSignedEnvelopeEvent({
      eventId: 'evt-envelope-builder-001',
      kind: 'note.created',
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: '2026-06-08T00:00:00.000Z',
      privacy: 'dm',
      plaintextPayload: { body: marker, nested: { body: marker } },
      recipients,
      signingKeypair
    });

    const serialized = JSON.stringify(built.event);
    expect(verifySignedEventEnvelope(built.event)).toBe(true);
    expect(serialized).not.toContain(marker);
    expect(built.event.payload).toMatchObject({
      version: 'lfp2p.private-payload.envelope.v1',
      algorithm: 'aes-gcm-256'
    });
    expect(built.event.payload.recipientWraps).toHaveLength(1);
  });

  it('binds AAD to stable event metadata', () => {
    const aad = buildPrivatePayloadAad({
      eventId: 'evt-aad-001',
      kind: 'note.created',
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: '2026-06-08T00:00:00.000Z',
      privacy: 'dm',
      lamport: 2,
      schemaVersion: 1
    });

    expect(aad).toContain('lfp2p.private-payload.aad.v1');
    expect(aad).toContain('evt-aad-001');
    expect(aad).toContain('device:alice-phone');
  });
});
