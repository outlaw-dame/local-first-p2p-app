import {
  decryptKeyMaterial,
  encryptKeyMaterial,
  generateNonExtractableAesGcmKey,
  generateSigningKeypair,
  sha256Base64Url,
  type SigningKeypair
} from '@lfp2p/crypto';
import {
  type DexieLocalFirstStore,
  type IdentityVerificationStatus,
  type StoredDeviceIdentity,
  type StoredIdentityControlProjection
} from '@lfp2p/local-store';
export {
  applyIdentityControlEvent,
  createEmptyIdentityControlState,
  seedIdentityControlProjection,
  type IdentityControlCapability,
  type IdentityControlDevice,
  type IdentityControlState
} from './control-log.js';

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

export type IdentityTrustSnapshot = Readonly<{
  controllerPublicKey?: string;
  primaryDeviceId?: string;
  shortFingerprint?: string;
  verificationStatus: IdentityVerificationStatus;
}>;

export class DeviceIdentityBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceIdentityBootstrapError';
  }
}

export async function buildIdentityTrustSnapshot(input: Readonly<{
  projection: StoredIdentityControlProjection | undefined;
  expectedControllerPublicKey?: string;
}>): Promise<IdentityTrustSnapshot> {
  const projection = input.projection;
  if (projection === undefined || projection.controllerPublicKey === undefined) {
    return { verificationStatus: 'unknown' };
  }

  const primaryDeviceId = resolvePrimaryDeviceId(projection);
  const verificationStatus = resolveIdentityVerificationStatus({
    projection,
    ...(input.expectedControllerPublicKey === undefined
      ? {}
      : { expectedControllerPublicKey: input.expectedControllerPublicKey })
  });

  return {
    controllerPublicKey: projection.controllerPublicKey,
    ...(primaryDeviceId === undefined ? {} : { primaryDeviceId }),
    shortFingerprint: await createShortFingerprint(projection.controllerPublicKey),
    verificationStatus
  };
}

export function resolveIdentityVerificationStatus(input: Readonly<{
  projection: StoredIdentityControlProjection | undefined;
  expectedControllerPublicKey?: string;
}>): IdentityVerificationStatus {
  const projection = input.projection;
  if (projection === undefined || projection.controllerPublicKey === undefined) return 'unknown';
  if (
    input.expectedControllerPublicKey !== undefined &&
    input.expectedControllerPublicKey.trim().length > 0 &&
    input.expectedControllerPublicKey !== projection.controllerPublicKey
  ) {
    return 'mismatch-detected';
  }
  const hasRevokedDevice = Object.values(projection.devices).some((device) => device.status === 'revoked');
  if (hasRevokedDevice) return 'revoked-device-seen';
  return 'controller-known';
}

function resolvePrimaryDeviceId(projection: StoredIdentityControlProjection): string | undefined {
  const activeDevices = Object.values(projection.devices)
    .filter((device) => device.status === 'active')
    .sort((left, right) => {
      const timeDelta = Date.parse(left.authorizedAt) - Date.parse(right.authorizedAt);
      if (timeDelta !== 0) return timeDelta;
      return left.deviceId.localeCompare(right.deviceId);
    });
  return activeDevices[0]?.deviceId;
}

async function createShortFingerprint(value: string): Promise<string> {
  const digest = await sha256Base64Url(value);
  const short = digest.slice(0, 16);
  return `${short.slice(0, 4)}-${short.slice(4, 8)}-${short.slice(8, 12)}-${short.slice(12, 16)}`;
}

type PreparedDeviceSession = Readonly<{
  session: LocalDeviceSession;
  record: StoredDeviceIdentity;
  protectionKey: CryptoKey;
}>;

type CommitPreparedSessionResult =
  | Readonly<{ kind: 'created'; session: LocalDeviceSession }>
  | Readonly<{ kind: 'existing'; record: StoredDeviceIdentity }>;

export class DeviceIdentityManager {
  readonly #store: DexieLocalFirstStore;
  #bootstrapInFlight: Promise<LocalDeviceSession> | null = null;

  constructor(store: DexieLocalFirstStore) {
    this.#store = store;
  }

  async getOrCreatePrimaryDeviceSession(now = new Date().toISOString()): Promise<LocalDeviceSession> {
    this.#bootstrapInFlight ??= this.#getOrCreatePrimaryDeviceSession(now).finally(() => {
      this.#bootstrapInFlight = null;
    });
    return this.#bootstrapInFlight;
  }

  async #getOrCreatePrimaryDeviceSession(now: string): Promise<LocalDeviceSession> {
    const existing = await this.#store.getActiveDeviceIdentity();
    if (existing) return this.#restoreSession(existing);

    const prepared = await this.#prepareNewSession(now);
    const committed = await this.#store.transaction(
      'rw',
      ['deviceIdentities', 'localProtectionKeys'],
      async (): Promise<CommitPreparedSessionResult> => {
        const active = await this.#store.getActiveDeviceIdentity();
        if (active) return { kind: 'existing', record: active };

        await this.#store.putLocalProtectionKey({
          keyId: prepared.record.protectionKeyId,
          algorithm: 'aes-gcm-256',
          key: prepared.protectionKey,
          createdAt: now
        });
        await this.#store.putDeviceIdentity(prepared.record);
        return { kind: 'created', session: prepared.session };
      }
    );

    return committed.kind === 'created' ? committed.session : this.#restoreSession(committed.record);
  }

  async #prepareNewSession(now: string): Promise<PreparedDeviceSession> {
    const keypair = generateSigningKeypair();
    const protectionKey = await generateNonExtractableAesGcmKey();
    const protectionKeyId = `local-protection:${globalThis.crypto.randomUUID()}`;
    const publicKeyHash = await sha256Base64Url(keypair.publicKey);
    const identityId = `identity:${publicKeyHash}`;
    const deviceId = `device:${publicKeyHash.slice(0, 32)}`;
    const encryptedPrivateKey = await encryptKeyMaterial(keypair.privateKey, protectionKey);

    const identity: LocalDeviceIdentity = {
      identityId,
      deviceId,
      publicKey: keypair.publicKey,
      createdAt: now
    };

    return {
      session: { identity, keypair },
      protectionKey,
      record: {
        recordType: 'local-device-identity.v1',
        identityId,
        deviceId,
        publicKey: keypair.publicKey,
        encryptedPrivateKey,
        protectionKeyId,
        status: 'active',
        createdAt: now,
        updatedAt: now
      }
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
