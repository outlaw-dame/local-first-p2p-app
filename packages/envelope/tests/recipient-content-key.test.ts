/**
 * Phase 5.12 — recipient-side content-key resolver (the keystone of the
 * dm/group E2EE content-key subsystem).
 *
 * The gold-standard test is end-to-end: the sender path (`createEnvelopeEvent`)
 * produces a real envelope with recipient wraps; `resolvePayloadKeyForDevice`
 * recovers the content key; and that recovered key decrypts the sender's actual
 * ciphertext. The remaining tests pin every adversarial / edge outcome to the
 * correct coarse status.
 */
import { describe, expect, it } from 'vitest';
import {
  decryptPayloadEnvelope,
  fromBase64Url,
  generateX25519Keypair,
  toBase64Url,
  wrapPayloadKeyWithX25519
} from '@lfp2p/crypto';
import type { PrivatePayloadEnvelopeV1 } from '@lfp2p/protocol';
import {
  createEnvelopeEvent,
  resolvePayloadKeyForDevice,
  resolvePayloadKeyMaterialForDevice,
  type LocalDeviceWrapKey
} from '../src/index.js';

const ALICE = 'identity:alice';
const BOB = 'identity:bob';
const BOB_DEVICE = 'device:bob-1';
const BOB_KEYREF = 'wrap-key:bob-1';

function freshContentKey(): string {
  return toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

/** Build an inbound envelope whose content key is wrapped to `recipientPub`. */
function envelopeWrappedTo(
  contentKey: string,
  recipientPub: string,
  over: Partial<{
    recipientIdentityId: string;
    recipientDeviceId: string;
    keyAgreement: string;
    wrappingKeyRef: string;
    wrappedKey: string;
  }> = {}
): PrivatePayloadEnvelopeV1 {
  const wrap = {
    recipientIdentityId: over.recipientIdentityId ?? BOB,
    recipientDeviceId: over.recipientDeviceId ?? BOB_DEVICE,
    keyAgreement: over.keyAgreement ?? 'x25519-v1',
    wrappedKey: over.wrappedKey ?? wrapPayloadKeyWithX25519(contentKey, recipientPub),
    wrappingKeyRef: over.wrappingKeyRef ?? BOB_KEYREF
  };
  return {
    version: 'lfp2p.private-payload.v1',
    algorithm: 'aes-gcm-256',
    ciphertext: 'AAAA',
    nonce: toBase64Url(new Uint8Array(12)),
    keyId: 'payload-key:test',
    recipientWraps: [wrap]
  } as unknown as PrivatePayloadEnvelopeV1;
}

function bobKey(
  pair: { privateKey: string },
  over: Partial<LocalDeviceWrapKey> = {}
): LocalDeviceWrapKey {
  return {
    deviceId: over.deviceId ?? BOB_DEVICE,
    wrapKeyRef: over.wrapKeyRef ?? BOB_KEYREF,
    wrapPrivateKey: over.wrapPrivateKey ?? pair.privateKey,
    ...(over.identityId !== undefined ? { identityId: over.identityId } : {})
  };
}

describe('resolvePayloadKeyForDevice — end-to-end with the sender path', () => {
  it('recovers the content key that decrypts the sender ciphertext', async () => {
    const bob = generateX25519Keypair();
    const built = await createEnvelopeEvent({
      eventId: 'evt-1',
      kind: 'mailbox.envelope.queued' as never,
      author: ALICE,
      deviceId: 'device:alice-1',
      createdAt: '2026-07-05T00:00:00.000Z',
      privacy: 'dm',
      plaintextPayload: { body: 'hello bob' },
      recipients: [
        {
          recipientIdentityId: BOB,
          recipientDeviceId: BOB_DEVICE,
          wrapPublicKey: bob.publicKey,
          wrapKeyRef: BOB_KEYREF
        }
      ]
    });
    const envelope = built.event.payload as unknown as PrivatePayloadEnvelopeV1;

    const result = resolvePayloadKeyForDevice(envelope, [bobKey(bob)]);
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') throw new Error('unreachable');

    // The recovered key must actually decrypt the sender's real ciphertext.
    const raw = fromBase64Url(result.keyMaterial);
    const cryptoKey = await globalThis.crypto.subtle.importKey(
      'raw',
      raw as Uint8Array<ArrayBuffer>,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    const plaintext = await decryptPayloadEnvelope(envelope, cryptoKey, built.aad);
    expect(JSON.parse(plaintext)).toEqual({ body: 'hello bob' });
  });
});

describe('resolvePayloadKeyForDevice — round trip and statuses', () => {
  it('resolved: returns exactly the content key that was wrapped', () => {
    const bob = generateX25519Keypair();
    const contentKey = freshContentKey();
    const result = resolvePayloadKeyForDevice(envelopeWrappedTo(contentKey, bob.publicKey), [
      bobKey(bob)
    ]);
    expect(result).toEqual({ status: 'resolved', keyMaterial: contentKey });
  });

  it('the convenience wrapper returns the key or undefined', () => {
    const bob = generateX25519Keypair();
    const contentKey = freshContentKey();
    expect(
      resolvePayloadKeyMaterialForDevice(envelopeWrappedTo(contentKey, bob.publicKey), [
        bobKey(bob)
      ])
    ).toBe(contentKey);
    // Not a recipient → undefined (self-heal).
    const other = generateX25519Keypair();
    expect(
      resolvePayloadKeyMaterialForDevice(envelopeWrappedTo(contentKey, other.publicKey), [
        bobKey(bob)
      ])
    ).toBeUndefined();
  });

  it('no-wrap: envelope carries no recipientWraps field (e.g. a self envelope)', () => {
    const bob = generateX25519Keypair();
    const envelope = {
      version: 'lfp2p.private-payload.v1',
      algorithm: 'aes-gcm-256',
      ciphertext: 'AAAA',
      nonce: toBase64Url(new Uint8Array(12)),
      keyId: 'k'
    } as unknown as PrivatePayloadEnvelopeV1;
    expect(resolvePayloadKeyForDevice(envelope, [bobKey(bob)])).toEqual({ status: 'no-wrap' });
  });

  it('no-wrap: the only wrap targets a different device', () => {
    const bob = generateX25519Keypair();
    const contentKey = freshContentKey();
    const envelope = envelopeWrappedTo(contentKey, bob.publicKey, {
      recipientDeviceId: 'device:someone-else'
    });
    expect(resolvePayloadKeyForDevice(envelope, [bobKey(bob)])).toEqual({ status: 'no-wrap' });
  });

  it('no-wrap: a wrap borrows this deviceId under a different identity (binding enforced)', () => {
    const bob = generateX25519Keypair();
    const contentKey = freshContentKey();
    // Wrap names BOB_DEVICE but claims it belongs to mallory.
    const envelope = envelopeWrappedTo(contentKey, bob.publicKey, {
      recipientIdentityId: 'identity:mallory'
    });
    // Local key is bound to BOB → the misattributed wrap is not honoured.
    expect(resolvePayloadKeyForDevice(envelope, [bobKey(bob, { identityId: BOB })])).toEqual({
      status: 'no-wrap'
    });
    // Without identity binding, the device-id match alone still resolves.
    expect(resolvePayloadKeyForDevice(envelope, [bobKey(bob)]).status).toBe('resolved');
  });

  it('no-key: wrap targets this device but names a wrappingKeyRef we do not hold', () => {
    const bob = generateX25519Keypair();
    const contentKey = freshContentKey();
    const envelope = envelopeWrappedTo(contentKey, bob.publicKey, {
      wrappingKeyRef: 'wrap-key:rotated-away'
    });
    expect(resolvePayloadKeyForDevice(envelope, [bobKey(bob)])).toEqual({ status: 'no-key' });
  });

  it('rotation: selects the local key whose wrapKeyRef matches the wrap', () => {
    const oldPair = generateX25519Keypair();
    const newPair = generateX25519Keypair();
    const contentKey = freshContentKey();
    // Wrapped to the NEW key.
    const envelope = envelopeWrappedTo(contentKey, newPair.publicKey, {
      wrappingKeyRef: 'wrap-key:new'
    });
    const keys: LocalDeviceWrapKey[] = [
      bobKey(oldPair, { wrapKeyRef: 'wrap-key:old' }),
      bobKey(newPair, { wrapKeyRef: 'wrap-key:new' })
    ];
    expect(resolvePayloadKeyForDevice(envelope, keys)).toEqual({
      status: 'resolved',
      keyMaterial: contentKey
    });
  });

  it('unwrap-failed: the wrapped key was tampered with', () => {
    const bob = generateX25519Keypair();
    const contentKey = freshContentKey();
    const good = wrapPayloadKeyWithX25519(contentKey, bob.publicKey);
    // Flip the final base64url char to corrupt the ciphertext/tag.
    const tampered = good.slice(0, -1) + (good.endsWith('A') ? 'B' : 'A');
    const envelope = envelopeWrappedTo(contentKey, bob.publicKey, { wrappedKey: tampered });
    expect(resolvePayloadKeyForDevice(envelope, [bobKey(bob)])).toEqual({
      status: 'unwrap-failed'
    });
  });

  it('unwrap-failed: correct device/keyRef but the wrong private key', () => {
    const bob = generateX25519Keypair();
    const attacker = generateX25519Keypair();
    const contentKey = freshContentKey();
    const envelope = envelopeWrappedTo(contentKey, bob.publicKey);
    // Local key claims to be bob's but holds the attacker's private key.
    expect(
      resolvePayloadKeyForDevice(envelope, [bobKey(bob, { wrapPrivateKey: attacker.privateKey })])
    ).toEqual({ status: 'unwrap-failed' });
  });

  it('unwrap-failed: unsupported key-agreement algorithm on our wrap', () => {
    const bob = generateX25519Keypair();
    const contentKey = freshContentKey();
    const envelope = envelopeWrappedTo(contentKey, bob.publicKey, { keyAgreement: 'rsa-oaep' });
    expect(resolvePayloadKeyForDevice(envelope, [bobKey(bob)])).toEqual({
      status: 'unwrap-failed'
    });
  });

  it('unwrap-failed: recovered key is not a valid 32-byte AES key (short-key injection)', () => {
    const bob = generateX25519Keypair();
    // Wrap a 16-byte "key" — cryptographically valid box, wrong content-key size.
    const shortKey = toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(16)));
    const envelope = envelopeWrappedTo(shortKey, bob.publicKey);
    expect(resolvePayloadKeyForDevice(envelope, [bobKey(bob)])).toEqual({
      status: 'unwrap-failed'
    });
  });

  it('unwrap-failed: an empty or non-array recipientWraps is malformed', () => {
    const bob = generateX25519Keypair();
    const base = {
      version: 'lfp2p.private-payload.v1',
      algorithm: 'aes-gcm-256',
      ciphertext: 'AAAA',
      nonce: toBase64Url(new Uint8Array(12)),
      keyId: 'k'
    };
    expect(
      resolvePayloadKeyForDevice(
        { ...base, recipientWraps: [] } as unknown as PrivatePayloadEnvelopeV1,
        [bobKey(bob)]
      )
    ).toEqual({ status: 'unwrap-failed' });
  });

  it('a malformed sibling wrap does not poison a valid wrap for us', () => {
    const bob = generateX25519Keypair();
    const contentKey = freshContentKey();
    const goodWrap = {
      recipientIdentityId: BOB,
      recipientDeviceId: BOB_DEVICE,
      keyAgreement: 'x25519-v1',
      wrappedKey: wrapPayloadKeyWithX25519(contentKey, bob.publicKey),
      wrappingKeyRef: BOB_KEYREF
    };
    const envelope = {
      version: 'lfp2p.private-payload.v1',
      algorithm: 'aes-gcm-256',
      ciphertext: 'AAAA',
      nonce: toBase64Url(new Uint8Array(12)),
      keyId: 'k',
      recipientWraps: [null, { garbage: true }, goodWrap]
    } as unknown as PrivatePayloadEnvelopeV1;
    expect(resolvePayloadKeyForDevice(envelope, [bobKey(bob)])).toEqual({
      status: 'resolved',
      keyMaterial: contentKey
    });
  });

  it('unwrap-failed: recipientWraps exceeds the scan cap', () => {
    const bob = generateX25519Keypair();
    const contentKey = freshContentKey();
    const wrap = {
      recipientIdentityId: 'identity:x',
      recipientDeviceId: 'device:x',
      keyAgreement: 'x25519-v1',
      wrappedKey: wrapPayloadKeyWithX25519(contentKey, bob.publicKey),
      wrappingKeyRef: 'r'
    };
    const envelope = {
      version: 'lfp2p.private-payload.v1',
      algorithm: 'aes-gcm-256',
      ciphertext: 'AAAA',
      nonce: toBase64Url(new Uint8Array(12)),
      keyId: 'k',
      recipientWraps: new Array(4097).fill(wrap)
    } as unknown as PrivatePayloadEnvelopeV1;
    expect(resolvePayloadKeyForDevice(envelope, [bobKey(bob)])).toEqual({
      status: 'unwrap-failed'
    });
  });

  it('rejects an empty or malformed localWrapKeys set (programming error)', () => {
    const bob = generateX25519Keypair();
    const contentKey = freshContentKey();
    const envelope = envelopeWrappedTo(contentKey, bob.publicKey);
    expect(() => resolvePayloadKeyForDevice(envelope, [])).toThrow(/localWrapKeys/);
    expect(() =>
      resolvePayloadKeyForDevice(envelope, [{ deviceId: '', wrapKeyRef: 'r', wrapPrivateKey: 'k' }])
    ).toThrow(/deviceId/);
  });
});
