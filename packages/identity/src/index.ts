import {
  decryptKeyMaterial,
  encryptKeyMaterial,
  generateNonExtractableAesGcmKey,
  generateSigningKeypair,
  sha256Base64Url,
  type SigningKeypair
} from '@lfp2p/crypto';
import { type DexieLocalFirstStore, type StoredDeviceIdentity } from '@lfp2p/local-store';

export type LocalDeviceIdentity = Readonly<{
  identityId: string;
  deviceId: string;
  publicKey: string;
  createdAt: string;
}>;

export type LocalDeviceSession = Readonly<{
  identity: LocalDeviceIdentity;
  keypair: SigningKeypair;
}>;

export class DeviceIdentityBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceIdentityBootstrapError';
  }
}

export class DeviceIdentityManager {
  readonly #store: DexieLocalFirstStore;

  constructor(store: DexieLocalFirstStore) {
    this.#store = store;
  }

  async getOrCreatePrimaryDeviceSession(now = new Date().toISOString()): Promise<LocalDeviceSession> {
    const existing = await this.#store.getActiveDeviceIdentity();
    if (existing) {
      return this.#restoreSession(existing);
    }

    const keypair = generateSigningKeypair();
    const protectionKey = await generateNonExtractableAesGcmKey();
    const protectionKeyId = `local-protection:${globalThis.crypto.randomUUID()}`;
    const publicKeyHash = await sha256Base64Url(keypair.publicKey);
    const identityId = `identity:${publicKeyHash}`;
    const deviceId = `device:${publicKeyHash.slice(0, 32)}`;
    const encryptedPrivateKey = await encryptKeyMaterial(keypair.privateKey, protectionKey);

    await this.#store.putLocalProtectionKey({
      keyId: protectionKeyId,
      algorithm: 'aes-gcm-256',
      key: protectionKey,
      createdAt: now
    });

    await this.#store.putDeviceIdentity({
      recordType: 'local-device-identity.v1',
      identityId,
      deviceId,
      publicKey: keypair.publicKey,
      encryptedPrivateKey,
      protectionKeyId,
      status: 'active',
      createdAt: now,
      updatedAt: now
    });

    return {
      identity: {
        identityId,
        deviceId,
        publicKey: keypair.publicKey,
        createdAt: now
      },
      keypair
    };
  }

  async #restoreSession(record: StoredDeviceIdentity): Promise<LocalDeviceSession> {
    const protection = await this.#store.getLocalProtectionKey(record.protectionKeyId);
    if (!protection) {
      throw new DeviceIdentityBootstrapError(
        'Active device identity exists but its local protection key is missing'
      );
    }

    const privateKey = await decryptKeyMaterial(record.encryptedPrivateKey, protection.key);
    return {
      identity: {
        identityId: record.identityId,
        deviceId: record.deviceId,
        publicKey: record.publicKey,
        createdAt: record.createdAt
      },
      keypair: {
        publicKey: record.publicKey,
        privateKey
      }
    };
  }
}
