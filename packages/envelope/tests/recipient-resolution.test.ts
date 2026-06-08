import { describe, expect, it } from 'vitest';
import { generateX25519Keypair } from '@lfp2p/crypto';
import { resolveRecipients } from '../src/index.js';

describe('resolveRecipients', () => {
  it('returns active recipients and skips revoked devices', () => {
    const active = generateX25519Keypair();
    const revoked = generateX25519Keypair();

    const recipients = resolveRecipients([
      {
        identityId: 'identity:alice',
        devices: {
          phone: {
            deviceId: 'device:alice-phone',
            status: 'active',
            wrapPublicKey: active.publicKey,
            wrapKeyRef: 'wrap-key:alice-phone'
          },
          old: {
            deviceId: 'device:alice-old',
            status: 'revoked',
            wrapPublicKey: revoked.publicKey,
            wrapKeyRef: 'wrap-key:alice-old'
          }
        }
      }
    ]);

    expect(recipients).toHaveLength(1);
    expect(recipients[0]?.recipientDeviceId).toBe('device:alice-phone');
  });

  it('rejects active devices without wrapping key metadata', () => {
    expect(() =>
      resolveRecipients([
        {
          identityId: 'identity:alice',
          devices: {
            phone: {
              deviceId: 'device:alice-phone',
              status: 'active'
            }
          }
        }
      ])
    ).toThrow(/wrapPublicKey/);
  });
});
