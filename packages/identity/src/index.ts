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
  type IdentityContactCardPublication,
  type IdentityControlCapability,
  type IdentityControlDevice,
  type IdentityControlState
} from './control-log.js';
export {
  IDENTITY_ERROR_CODES,
  IdentityError,
  identityError,
  type IdentityErrorCode
} from './errors.js';
export {
  IDENTITY_EVENT_KINDS,
  IDENTITY_EVENT_VERSION,
  assertPlainObject,
  validateIdentityEvent,
  type IdentityEventKind,
  type ValidatedIdentityEvent
} from './validation.js';

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

export type IdentityOperationAuthorizationStatus =
  | 'authorized-bootstrap'
  | 'authorized-controller-device'
  | 'authorized-capability'
  | 'blocked-mismatch'
  | 'blocked-device-missing'
  | 'blocked-device-revoked'
  | 'blocked-capability-missing'
  | 'blocked-capability-expired';

export type IdentityOperationAuthorization = Readonly<{
  authorized: boolean;
  status: IdentityOperationAuthorizationStatus;
  scope: string;
  reason: string;
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

export function authorizeIdentityOperation(input: Readonly<{
  projection: StoredIdentityControlProjection | undefined;
  deviceId: string;
  scope: string;
  verificationStatus?: IdentityVerificationStatus;
  now?: Date | string;
}>): IdentityOperationAuthorization {
  const deviceId = requireNonEmptyString(input.deviceId, 'deviceId');
  const scope = requireNonEmptyString(input.scope, 'scope');
  const verificationStatus = input.verificationStatus ?? resolveIdentityVerificationStatus({ projection: input.projection });
  if (verificationStatus === 'mismatch-detected') {
    return {
      authorized: false,
      status: 'blocked-mismatch',
      scope,
      reason: 'Controller key mismatch detected for this identity.'
    };
  }

  const projection = input.projection;
  if (projection === undefined || projection.controllerPublicKey === undefined) {
    return {
      authorized: true,
      status: 'authorized-bootstrap',
      scope,
      reason: 'Identity control projection is not available yet; allowing bootstrap path.'
    };
  }

  const device = projection.devices[deviceId];
  if (device === undefined) {
    return {
      authorized: false,
      status: 'blocked-device-missing',
      scope,
      reason: 'Current device is not present in the identity control projection.'
    };
  }
  if (device.status === 'revoked') {
    return {
      authorized: false,
      status: 'blocked-device-revoked',
      scope,
      reason: 'Current device has been revoked in the identity control projection.'
    };
  }

  const primaryDeviceId = resolvePrimaryDeviceId(projection);
  if (primaryDeviceId !== undefined && primaryDeviceId === deviceId) {
    return {
      authorized: true,
      status: 'authorized-controller-device',
      scope,
      reason: 'Current primary controller device is authorized by identity projection.'
    };
  }

  const grantedCapabilities = Object.values(projection.capabilities).filter(
    (capability) => capability.delegateDeviceId === deviceId && capability.scope === scope && capability.status === 'granted'
  );
  if (Object.keys(projection.capabilities).length === 0) {
    return {
      authorized: true,
      status: 'authorized-controller-device',
      scope,
      reason: 'Current active device is authorized by controller projection.'
    };
  }
  if (grantedCapabilities.length === 0) {
    return {
      authorized: false,
      status: 'blocked-capability-missing',
      scope,
      reason: `No granted capability authorizes scope ${scope} for this device.`
    };
  }

  const nowMillis = resolveAuthorizationNow(input.now);
  const activeCapability = grantedCapabilities.find((capability) => {
    if (capability.expiresAt === undefined) return true;
    return Date.parse(capability.expiresAt) > nowMillis;
  });
  if (activeCapability === undefined) {
    return {
      authorized: false,
      status: 'blocked-capability-expired',
      scope,
      reason: `Granted capability for scope ${scope} has expired.`
    };
  }

  return {
    authorized: true,
    status: 'authorized-capability',
    scope,
    reason: `Granted capability ${activeCapability.capabilityId} authorizes scope ${scope}.`
  };
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

function resolveAuthorizationNow(value: Date | string | undefined): number {
  if (value === undefined) return Date.now();
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('now must be a Date or ISO date string');
  return parsed;
}

function requireNonEmptyString(value: string, label: string): string {
  if (value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
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
