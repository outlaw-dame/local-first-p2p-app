import { describe, expect, it } from 'vitest';
import { generateX25519Keypair } from '@lfp2p/crypto';
import {
  createEnvelopeEvent,
  resolveRecipients,
  summarizeEnvelopeEventForLog
} from '../src/index.js';

describe('summarizeEnvelopeEventForLog', () => {
  it('returns a compact summary for envelope events', async () => {
    const recipientKeypair = generateX25519Keypair();
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

    const built = await createEnvelopeEvent({
      eventId: 'evt-summary-001',
      kind: 'note.created',
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: '2026-06-08T00:00:00.000Z',
      privacy: 'dm',
      plaintextPayload: { body: 'payload-body' },
      recipients
    });

    const summary = summarizeEnvelopeEventForLog(built.event);
    expect(summary.eventId).toBe('evt-summary-001');
    expect(summary.payload).toMatchObject({
      envelope: true,
      version: 'lfp2p.private-payload.envelope.v1',
      algorithm: 'aes-gcm-256',
      recipientWrapCount: 1
    });
  });
});
