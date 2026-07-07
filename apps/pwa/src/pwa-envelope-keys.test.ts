import { describe, expect, it } from 'vitest';
import {
  decryptPayloadEnvelope,
  fromBase64Url,
  generateX25519Keypair,
  signingKeypairFromSeed
} from '@lfp2p/crypto';
import { createSignedEnvelopeEvent } from '@lfp2p/envelope';
import type { SignedEventEnvelope } from '@lfp2p/protocol';
import { createDeviceEnvelopeKeyResolver, deviceWrapKeys } from './pwa-envelope-keys.js';

const ALICE = 'identity:alice';
const BOB = 'identity:bob';
const BOB_DEVICE = 'device:bob-1';
const BOB_KEYREF = 'wrap-key:bob-1';
const SIGNING = signingKeypairFromSeed(new Uint8Array(32).fill(3));

async function dmEventTo(
  recipient: { identityId: string; deviceId: string; wrapPublicKey: string; wrapKeyRef: string },
  body: unknown = { text: 'hi' }
): Promise<{ event: SignedEventEnvelope; aad: string }> {
  const built = await createSignedEnvelopeEvent({
    eventId: `evt-${globalThis.crypto.randomUUID().slice(0, 8)}`,
    kind: 'mailbox.envelope.queued' as never,
    author: ALICE,
    deviceId: 'device:alice-1',
    createdAt: '2026-07-05T00:00:00.000Z',
    privacy: 'dm',
    plaintextPayload: body as never,
    recipients: [
      {
        recipientIdentityId: recipient.identityId,
        recipientDeviceId: recipient.deviceId,
        wrapPublicKey: recipient.wrapPublicKey,
        wrapKeyRef: recipient.wrapKeyRef
      }
    ],
    signingKeypair: SIGNING
  });
  return { event: built.event, aad: built.aad };
}

describe('createDeviceEnvelopeKeyResolver — end to end', () => {
  it('recovers the content key that decrypts an inbound dm event for this device', async () => {
    const bob = generateX25519Keypair();
    const { event, aad } = await dmEventTo({
      identityId: BOB,
      deviceId: BOB_DEVICE,
      wrapPublicKey: bob.publicKey,
      wrapKeyRef: BOB_KEYREF
    });

    const resolve = createDeviceEnvelopeKeyResolver(
      deviceWrapKeys({
        identityId: BOB,
        deviceId: BOB_DEVICE,
        wrapKeyRef: BOB_KEYREF,
        wrapPrivateKey: bob.privateKey
      })
    );
    const keyMaterial = resolve(event);
    expect(keyMaterial).toBeDefined();

    // Prove it actually decrypts the real ciphertext.
    const raw = fromBase64Url(keyMaterial as string);
    const cryptoKey = await globalThis.crypto.subtle.importKey(
      'raw',
      raw as Uint8Array<ArrayBuffer>,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    const plaintext = await decryptPayloadEnvelope(event.payload as never, cryptoKey, aad);
    expect(JSON.parse(plaintext)).toEqual({ text: 'hi' });
  });

  it('returns undefined for an event addressed to a different device', async () => {
    const carol = generateX25519Keypair();
    const bob = generateX25519Keypair();
    const { event } = await dmEventTo({
      identityId: 'identity:carol',
      deviceId: 'device:carol-1',
      wrapPublicKey: carol.publicKey,
      wrapKeyRef: 'wrap-key:carol-1'
    });
    const resolve = createDeviceEnvelopeKeyResolver(
      deviceWrapKeys({
        identityId: BOB,
        deviceId: BOB_DEVICE,
        wrapKeyRef: BOB_KEYREF,
        wrapPrivateKey: bob.privateKey
      })
    );
    expect(resolve(event)).toBeUndefined();
  });

  it('returns undefined when the wrap borrows this device id under another identity', async () => {
    const bob = generateX25519Keypair();
    // Envelope names BOB_DEVICE but under mallory's identity.
    const { event } = await dmEventTo({
      identityId: 'identity:mallory',
      deviceId: BOB_DEVICE,
      wrapPublicKey: bob.publicKey,
      wrapKeyRef: BOB_KEYREF
    });
    const resolve = createDeviceEnvelopeKeyResolver(
      deviceWrapKeys({
        identityId: BOB, // bound to bob
        deviceId: BOB_DEVICE,
        wrapKeyRef: BOB_KEYREF,
        wrapPrivateKey: bob.privateKey
      })
    );
    expect(resolve(event)).toBeUndefined();
  });

  it('returns undefined for events with no recipient wraps (self / cleartext / malformed)', () => {
    const bob = generateX25519Keypair();
    const resolve = createDeviceEnvelopeKeyResolver(
      deviceWrapKeys({
        identityId: BOB,
        deviceId: BOB_DEVICE,
        wrapKeyRef: BOB_KEYREF,
        wrapPrivateKey: bob.privateKey
      })
    );
    // self envelope shape (no recipientWraps)
    expect(
      resolve({ payload: { version: 'x', ciphertext: 'c', nonce: 'n', keyId: 'k' } } as never)
    ).toBeUndefined();
    // non-object payload
    expect(resolve({ payload: 'nope' } as never)).toBeUndefined();
    expect(resolve({ payload: null } as never)).toBeUndefined();
    expect(resolve({} as never)).toBeUndefined();
  });
});

describe('deviceWrapKeys / resolver input validation', () => {
  it('rejects an empty or malformed device context', () => {
    expect(() => deviceWrapKeys(null as never)).toThrow(/DeviceWrapContext/);
    expect(() =>
      deviceWrapKeys({ identityId: '', deviceId: 'd', wrapKeyRef: 'r', wrapPrivateKey: 'k' })
    ).toThrow(/identityId/);
    expect(() =>
      deviceWrapKeys({ identityId: 'i', deviceId: 'd', wrapKeyRef: 'r', wrapPrivateKey: '' })
    ).toThrow(/wrapPrivateKey/);
  });

  it('rejects an empty wrapKeys set', () => {
    expect(() => createDeviceEnvelopeKeyResolver([])).toThrow(/wrapKeys/);
  });

  it('fails fast on a malformed wrapKeys element at construction (not silently at use)', () => {
    expect(() =>
      createDeviceEnvelopeKeyResolver([
        { deviceId: 'd', wrapKeyRef: 'r', wrapPrivateKey: '' } as never
      ])
    ).toThrow(/wrapPrivateKey/);
    expect(() =>
      createDeviceEnvelopeKeyResolver([
        { deviceId: '', wrapKeyRef: 'r', wrapPrivateKey: 'k' } as never
      ])
    ).toThrow(/deviceId/);
    expect(() => createDeviceEnvelopeKeyResolver([null as never])).toThrow(/objects/);
  });
});
