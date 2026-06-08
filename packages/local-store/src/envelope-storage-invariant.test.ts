import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { generateSigningKeypair, generateX25519Keypair } from '@lfp2p/crypto';
import { createSignedEnvelopeEvent, resolveRecipients, summarizeEnvelopeEventForLog } from '@lfp2p/envelope';
import { createLocalFirstStore } from './index.js';

describe('DexieLocalFirstStore envelope invariants', () => {
  it('stores restricted-scope events using envelope payload shape only', async () => {
    const store = createLocalFirstStore(`envelope-store-${globalThis.crypto.randomUUID()}`);
    const signingKeypair = generateSigningKeypair();
    const recipientKeypair = generateX25519Keypair();
    const marker = 'opaque-fixture-marker';
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

    try {
      const built = await createSignedEnvelopeEvent({
        eventId: 'evt-local-store-envelope-001',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-06-08T00:00:00.000Z',
        privacy: 'dm',
        plaintextPayload: { note: marker, nested: { note: marker } },
        recipients,
        signingKeypair
      });

      await store.putSignedEvent(built.event);
      const stored = await store.getSignedEvent('evt-local-store-envelope-001');
      const storedJson = JSON.stringify(stored);
      const summaryJson = JSON.stringify(summarizeEnvelopeEventForLog(built.event));

      expect(stored?.payload).toMatchObject({
        version: 'lfp2p.private-payload.envelope.v1',
        algorithm: 'aes-gcm-256'
      });
      expect(storedJson).not.toContain(marker);
      expect(summaryJson).not.toContain(marker);
      expect(summaryJson).toContain('recipientWrapCount');
    } finally {
      await store.delete();
    }
  });
});
