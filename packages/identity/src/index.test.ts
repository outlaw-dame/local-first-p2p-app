import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createUnsignedEvent } from '@lfp2p/protocol';
import { signEventEnvelope, verifySignedEventEnvelope } from '@lfp2p/crypto';
import { createLocalFirstStore } from '@lfp2p/local-store';
import {
  authorizeIdentityOperation,
  buildIdentityTrustSnapshot,
  DeviceIdentityBootstrapError,
  DeviceIdentityManager,
  resolveIdentityVerificationStatus
} from './index.js';

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
      Array.from({ length: 8 }, () =>
        manager.getOrCreatePrimaryDeviceSession('2026-05-22T00:00:00.000Z')
      )
    );

    const identityIds = new Set(sessions.map((session) => session.identity.identityId));
    const publicKeys = new Set(sessions.map((session) => session.keypair.publicKey));

    expect(identityIds.size).toBe(1);
    expect(publicKeys.size).toBe(1);
    expect((await store.getActiveDeviceIdentity())?.identityId).toBe(
      sessions[0]?.identity.identityId
    );
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

    await expect(
      new DeviceIdentityManager(store).getOrCreatePrimaryDeviceSession()
    ).rejects.toBeInstanceOf(DeviceIdentityBootstrapError);
    expect((await store.getActiveDeviceIdentity())?.identityId).toBe('identity:missing-key');
    await store.delete();
  });
});

describe('identity trust snapshot helpers', () => {
  it('returns unknown when controller data is missing', () => {
    expect(resolveIdentityVerificationStatus({ projection: undefined })).toBe('unknown');
    expect(
      resolveIdentityVerificationStatus({
        projection: {
          identityId: 'identity:alice',
          epoch: 0,
          devices: {},
          capabilities: {},
          updatedAt: '2026-05-22T00:00:00.000Z'
        }
      })
    ).toBe('unknown');
  });

  it('derives mismatch and revoked states in priority order', () => {
    const projection = {
      identityId: 'identity:alice',
      controllerPublicKey: 'controller-public-key',
      epoch: 2,
      devices: {
        'device:alice-phone': {
          deviceId: 'device:alice-phone',
          publicKey: 'alice-phone-key',
          status: 'active' as const,
          authorizedAt: '2026-05-22T00:00:00.000Z'
        },
        'device:alice-laptop': {
          deviceId: 'device:alice-laptop',
          publicKey: 'alice-laptop-key',
          status: 'revoked' as const,
          authorizedAt: '2026-05-22T00:00:01.000Z',
          revokedAt: '2026-05-22T00:00:02.000Z'
        }
      },
      capabilities: {},
      updatedAt: '2026-05-22T00:00:03.000Z'
    };

    expect(resolveIdentityVerificationStatus({ projection })).toBe('revoked-device-seen');
    expect(
      resolveIdentityVerificationStatus({
        projection,
        expectedControllerPublicKey: 'different-controller-key'
      })
    ).toBe('mismatch-detected');
  });

  it('builds short fingerprint and primary device from active devices', async () => {
    const projection = {
      identityId: 'identity:alice',
      controllerPublicKey: 'controller-public-key',
      epoch: 1,
      devices: {
        'device:alice-laptop': {
          deviceId: 'device:alice-laptop',
          publicKey: 'alice-laptop-key',
          status: 'active' as const,
          authorizedAt: '2026-05-22T00:00:02.000Z'
        },
        'device:alice-phone': {
          deviceId: 'device:alice-phone',
          publicKey: 'alice-phone-key',
          status: 'active' as const,
          authorizedAt: '2026-05-22T00:00:01.000Z'
        }
      },
      capabilities: {},
      updatedAt: '2026-05-22T00:00:03.000Z'
    };

    const snapshot = await buildIdentityTrustSnapshot({ projection });
    expect(snapshot).toMatchObject({
      verificationStatus: 'controller-known',
      primaryDeviceId: 'device:alice-phone',
      controllerPublicKey: 'controller-public-key'
    });
    expect(snapshot.shortFingerprint).toMatch(
      /^[a-zA-Z0-9_-]{4}-[a-zA-Z0-9_-]{4}-[a-zA-Z0-9_-]{4}-[a-zA-Z0-9_-]{4}$/
    );
  });

  it('authorizes bootstrap path and blocks mismatch before capability checks', () => {
    expect(
      authorizeIdentityOperation({
        projection: undefined,
        deviceId: 'device:alice-phone',
        scope: 'sync:outbox'
      })
    ).toMatchObject({ authorized: true, status: 'authorized-bootstrap' });

    expect(
      authorizeIdentityOperation({
        projection: {
          identityId: 'identity:alice',
          controllerPublicKey: 'controller-public-key',
          epoch: 1,
          devices: {
            'device:alice-phone': {
              deviceId: 'device:alice-phone',
              publicKey: 'alice-phone-key',
              status: 'active',
              authorizedAt: '2026-05-22T00:00:00.000Z'
            }
          },
          capabilities: {},
          updatedAt: '2026-05-22T00:00:00.000Z'
        },
        deviceId: 'device:alice-phone',
        scope: 'sync:outbox',
        verificationStatus: 'mismatch-detected'
      })
    ).toMatchObject({ authorized: false, status: 'blocked-mismatch' });
  });

  it('enforces device presence, revocation, and capability expiry', () => {
    const projection = {
      identityId: 'identity:alice',
      controllerPublicKey: 'controller-public-key',
      epoch: 2,
      devices: {
        'device:alice-phone': {
          deviceId: 'device:alice-phone',
          publicKey: 'alice-phone-key',
          status: 'active' as const,
          authorizedAt: '2026-05-22T00:00:00.000Z'
        },
        'device:alice-tablet': {
          deviceId: 'device:alice-tablet',
          publicKey: 'alice-tablet-key',
          status: 'active' as const,
          authorizedAt: '2026-05-22T00:00:10.000Z'
        },
        'device:alice-laptop': {
          deviceId: 'device:alice-laptop',
          publicKey: 'alice-laptop-key',
          status: 'revoked' as const,
          authorizedAt: '2026-05-22T00:00:01.000Z',
          revokedAt: '2026-05-22T00:00:02.000Z'
        }
      },
      capabilities: {
        'cap:expired': {
          capabilityId: 'cap:expired',
          delegateDeviceId: 'device:alice-tablet',
          scope: 'sync:outbox',
          expiresAt: '2026-05-22T00:00:03.000Z',
          status: 'granted' as const,
          grantedAt: '2026-05-22T00:00:00.000Z'
        }
      },
      updatedAt: '2026-05-22T00:00:00.000Z'
    };

    expect(
      authorizeIdentityOperation({ projection, deviceId: 'device:missing', scope: 'sync:outbox' })
    ).toMatchObject({ authorized: false, status: 'blocked-device-missing' });
    expect(
      authorizeIdentityOperation({
        projection,
        deviceId: 'device:alice-laptop',
        scope: 'sync:outbox'
      })
    ).toMatchObject({ authorized: false, status: 'blocked-device-revoked' });
    expect(
      authorizeIdentityOperation({
        projection,
        deviceId: 'device:alice-tablet',
        scope: 'sync:outbox',
        now: '2026-05-22T00:00:05.000Z'
      })
    ).toMatchObject({ authorized: false, status: 'blocked-capability-expired' });
  });

  it('authorizes active devices directly during transition and by capability when present', () => {
    const noCapabilityProjection = {
      identityId: 'identity:alice',
      controllerPublicKey: 'controller-public-key',
      epoch: 1,
      devices: {
        'device:alice-phone': {
          deviceId: 'device:alice-phone',
          publicKey: 'alice-phone-key',
          status: 'active' as const,
          authorizedAt: '2026-05-22T00:00:00.000Z'
        }
      },
      capabilities: {},
      updatedAt: '2026-05-22T00:00:00.000Z'
    };
    expect(
      authorizeIdentityOperation({
        projection: noCapabilityProjection,
        deviceId: 'device:alice-phone',
        scope: 'sync:outbox'
      })
    ).toMatchObject({ authorized: true, status: 'authorized-controller-device' });

    const delegatedProjection = {
      ...noCapabilityProjection,
      capabilities: {
        'cap:sync:outbox:tablet': {
          capabilityId: 'cap:sync:outbox:tablet',
          delegateDeviceId: 'device:alice-tablet',
          scope: 'sync:outbox',
          status: 'granted' as const,
          grantedAt: '2026-05-22T00:00:00.000Z'
        }
      }
    };
    expect(
      authorizeIdentityOperation({
        projection: delegatedProjection,
        deviceId: 'device:alice-phone',
        scope: 'sync:outbox'
      })
    ).toMatchObject({ authorized: true, status: 'authorized-controller-device' });

    const capabilityProjection = {
      ...noCapabilityProjection,
      devices: {
        ...noCapabilityProjection.devices,
        'device:alice-tablet': {
          deviceId: 'device:alice-tablet',
          publicKey: 'alice-tablet-key',
          status: 'active' as const,
          authorizedAt: '2026-05-22T00:00:10.000Z'
        }
      },
      capabilities: {
        'cap:sync:outbox': {
          capabilityId: 'cap:sync:outbox',
          delegateDeviceId: 'device:alice-tablet',
          scope: 'sync:outbox',
          expiresAt: '2026-05-22T01:00:00.000Z',
          status: 'granted' as const,
          grantedAt: '2026-05-22T00:00:00.000Z'
        }
      }
    };
    expect(
      authorizeIdentityOperation({
        projection: capabilityProjection,
        deviceId: 'device:alice-tablet',
        scope: 'sync:outbox',
        now: '2026-05-22T00:30:00.000Z'
      })
    ).toMatchObject({ authorized: true, status: 'authorized-capability' });
    expect(
      authorizeIdentityOperation({
        projection: capabilityProjection,
        deviceId: 'device:alice-tablet',
        scope: 'sync:inbox',
        now: '2026-05-22T00:30:00.000Z'
      })
    ).toMatchObject({ authorized: false, status: 'blocked-capability-missing' });
  });
});
