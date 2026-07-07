import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createUnsignedEvent } from '@lfp2p/protocol';
import {
  signEventEnvelope,
  toBase64Url,
  unwrapPayloadKeyWithX25519,
  verifySignedEventEnvelope,
  wrapPayloadKeyWithX25519
} from '@lfp2p/crypto';
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

describe('DeviceIdentityManager — wrap keypair (Phase 5.12B)', () => {
  const NOW = '2026-07-05T00:00:00.000Z';

  it('provisions a wrap keypair on create and persists it encrypted at rest', async () => {
    const store = createLocalFirstStore(`identity-wrap-${globalThis.crypto.randomUUID()}`);
    const session = await new DeviceIdentityManager(store).getOrCreatePrimaryDeviceSession(NOW);

    expect(session.wrap.keyRef).toMatch(/^wrap-key:device:/);
    expect(session.wrap.keypair.publicKey.length).toBeGreaterThan(0);
    expect(session.wrap.keypair.privateKey.length).toBeGreaterThan(0);

    const record = await store.getActiveDeviceIdentity();
    expect(record?.wrapPublicKey).toBe(session.wrap.keypair.publicKey);
    expect(record?.wrapKeyRef).toBe(session.wrap.keyRef);
    expect(record?.encryptedWrapPrivateKey?.algorithm).toBe('aes-gcm-256');
    // At rest: the private key must NOT appear in cleartext anywhere in the row.
    expect(JSON.stringify(record)).not.toContain(session.wrap.keypair.privateKey);
    await store.delete();
  });

  it('the provisioned wrap keypair actually wraps and unwraps a content key', async () => {
    const store = createLocalFirstStore(`identity-wrap-rt-${globalThis.crypto.randomUUID()}`);
    const session = await new DeviceIdentityManager(store).getOrCreatePrimaryDeviceSession(NOW);

    const contentKey = toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
    const wrapped = wrapPayloadKeyWithX25519(contentKey, session.wrap.keypair.publicKey);
    const unwrapped = unwrapPayloadKeyWithX25519(wrapped, session.wrap.keypair.privateKey);
    expect(unwrapped).toBe(contentKey);
    await store.delete();
  });

  it('restores the identical wrap keypair across manager instances', async () => {
    const store = createLocalFirstStore(`identity-wrap-restore-${globalThis.crypto.randomUUID()}`);
    const first = await new DeviceIdentityManager(store).getOrCreatePrimaryDeviceSession(NOW);
    const second = await new DeviceIdentityManager(store).getOrCreatePrimaryDeviceSession(NOW);
    expect(second.wrap).toEqual(first.wrap);
    await store.delete();
  });

  it('self-heals a pre-5.12B record that has no wrap keypair, and persists the upgrade', async () => {
    const store = createLocalFirstStore(`identity-wrap-heal-${globalThis.crypto.randomUUID()}`);
    // Provision, then simulate an old record by stripping the wrap fields.
    await new DeviceIdentityManager(store).getOrCreatePrimaryDeviceSession(NOW);
    const rec = await store.getActiveDeviceIdentity();
    if (rec === undefined) throw new Error('expected a device record');
    const { wrapPublicKey, wrapKeyRef, encryptedWrapPrivateKey, ...legacy } = rec;
    void wrapPublicKey;
    void wrapKeyRef;
    void encryptedWrapPrivateKey;
    await store.putDeviceIdentity(legacy);
    expect((await store.getActiveDeviceIdentity())?.encryptedWrapPrivateKey).toBeUndefined();

    // Restore heals it.
    const healed = await new DeviceIdentityManager(store).getOrCreatePrimaryDeviceSession(NOW);
    expect(healed.wrap.keyRef).toMatch(/^wrap-key:device:/);

    const healedRecord = await store.getActiveDeviceIdentity();
    expect(healedRecord?.wrapPublicKey).toBe(healed.wrap.keypair.publicKey);
    expect(healedRecord?.wrapKeyRef).toBe(healed.wrap.keyRef);
    expect(healedRecord?.encryptedWrapPrivateKey?.algorithm).toBe('aes-gcm-256');

    // Stable and identical on a subsequent restore — the heal is one-time.
    const again = await new DeviceIdentityManager(store).getOrCreatePrimaryDeviceSession(NOW);
    expect(again.wrap).toEqual(healed.wrap);
    await store.delete();
  });

  it('concurrent heals converge on a single wrap keypair', async () => {
    const store = createLocalFirstStore(`identity-wrap-race-${globalThis.crypto.randomUUID()}`);
    await new DeviceIdentityManager(store).getOrCreatePrimaryDeviceSession(NOW);
    const rec = await store.getActiveDeviceIdentity();
    if (rec === undefined) throw new Error('expected a device record');
    const { wrapPublicKey, wrapKeyRef, encryptedWrapPrivateKey, ...legacy } = rec;
    void wrapPublicKey;
    void wrapKeyRef;
    void encryptedWrapPrivateKey;
    await store.putDeviceIdentity(legacy);

    // Separate manager instances (no shared in-flight guard) heal in parallel.
    const sessions = await Promise.all(
      Array.from({ length: 6 }, () =>
        new DeviceIdentityManager(store).getOrCreatePrimaryDeviceSession(NOW)
      )
    );
    const refs = new Set(sessions.map((s) => s.wrap.keyRef));
    const pubKeys = new Set(sessions.map((s) => s.wrap.keypair.publicKey));
    expect(refs.size).toBe(1);
    expect(pubKeys.size).toBe(1);
    expect((await store.getActiveDeviceIdentity())?.wrapKeyRef).toBe(sessions[0]?.wrap.keyRef);
    await store.delete();
  });

  it('rejects a half-populated wrap record at the store boundary', async () => {
    const store = createLocalFirstStore(`identity-wrap-partial-${globalThis.crypto.randomUUID()}`);
    await new DeviceIdentityManager(store).getOrCreatePrimaryDeviceSession(NOW);
    const rec = await store.getActiveDeviceIdentity();
    if (rec === undefined) throw new Error('expected a device record');
    await expect(store.putDeviceIdentity({ ...rec, wrapKeyRef: undefined })).rejects.toThrow(
      /wrap keypair fields must be all present or all absent/
    );
    await store.delete();
  });
});
