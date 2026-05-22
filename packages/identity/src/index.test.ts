import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createUnsignedEvent } from '@lfp2p/protocol';
import { signEventEnvelope, verifySignedEventEnvelope } from '@lfp2p/crypto';
import { createLocalFirstStore } from '@lfp2p/local-store';
import { DeviceIdentityBootstrapError, DeviceIdentityManager } from './index.js';

describe('DeviceIdentityManager', () => {
  it('creates and reuses a persisted primary device identity', async () => {
    const store = createLocalFirstStore(`identity-test-${globalThis.crypto.randomUUID()}`);
    const manager = new DeviceIdentityManager(store);

    const first = await manager.getOrCreatePrimaryDeviceSession('2026-05-22T00:00:00.000Z');
    const second = await manager.getOrCreatePrimaryDeviceSession('2026-05-23T00:00:00.000Z');

    expect(second.identity).toEqual(first.identity);
    expect(second.keypair.publicKey).toBe(first.keypair.publicKey);
    expect(second.keypair.privateKey).toBe(first.keypair.privateKey);

    const event = createUnsignedEvent({
      eventId: 'evt_identity_reuse',
      kind: 'outbox.test.created',
      author: second.identity.identityId,
      deviceId: second.identity.deviceId,
      createdAt: '2026-05-22T00:00:00.000Z',
      privacy: 'device-local',
      payload: { body: 'identity reuse' }
    });

    expect(verifySignedEventEnvelope(signEventEnvelope(event, second.keypair))).toBe(true);
    await store.delete();
  });

  it('deduplicates concurrent bootstrap calls in one runtime', async () => {
    const store = createLocalFirstStore(`identity-concurrent-${globalThis.crypto.randomUUID()}`);
    const manager = new DeviceIdentityManager(store);

    const sessions = await Promise.all(
      Array.from({ length: 8 }, () => manager.getOrCreatePrimaryDeviceSession('2026-05-22T00:00:00.000Z'))
    );

    const identityIds = new Set(sessions.map((session) => session.identity.identityId));
    const publicKeys = new Set(sessions.map((session) => session.keypair.publicKey));

    expect(identityIds.size).toBe(1);
    expect(publicKeys.size).toBe(1);
    expect((await store.getActiveDeviceIdentity())?.identityId).toBe(sessions[0]?.identity.identityId);
    await store.delete();
  });

  it('fails closed when the active identity cannot be restored', async () => {
    const store = createLocalFirstStore(`identity-missing-key-${globalThis.crypto.randomUUID()}`);
    await store.putDeviceIdentity({
      recordType: 'local-device-identity.v1',
      identityId: 'identity:missing-key',
      deviceId: 'device:missing-key',
      publicKey: 'public-key',
      encryptedPrivateKey: {
        algorithm: 'aes-gcm-256',
        iv: 'iv',
        ciphertext: 'ciphertext'
      },
      protectionKeyId: 'local-protection:missing',
      status: 'active',
      createdAt: '2026-05-22T00:00:00.000Z',
      updatedAt: '2026-05-22T00:00:00.000Z'
    });

    await expect(new DeviceIdentityManager(store).getOrCreatePrimaryDeviceSession()).rejects.toBeInstanceOf(
      DeviceIdentityBootstrapError
    );
    expect((await store.getActiveDeviceIdentity())?.identityId).toBe('identity:missing-key');
    await store.delete();
  });
});
