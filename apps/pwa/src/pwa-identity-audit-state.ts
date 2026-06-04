/**
 * Phase 2.3b — Identity audit + rotation view-model helpers.
 *
 * Pure logic that the PWA's identity-audit React surface consumes.
 * No DOM, no React, no IO. The component layer only renders these
 * shapes and dispatches the documented intents.
 *
 * Discipline:
 *  - Rotation of the *controller* device key is NOT supported here.
 *    The bootstrap device's `publicKey` equals the controller key;
 *    rotating it via `identity.device.rotated` would leave the
 *    projection's `controllerPublicKey` unchanged and break every
 *    subsequent controller-signed event. That's a separate
 *    controller-supersession flow (Phase 2.3 future ADR).
 *  - Rotation of non-controller devices works end-to-end through
 *    the existing identity emit helpers.
 *  - All UI strings live in the component, not here. This module
 *    is concerned only with the *decisions* (is rotatable? what is
 *    the next epoch?) and never the UX presentation.
 */
import type { StoredIdentityControlProjection } from '@lfp2p/local-store';

/**
 * Display-grade representation of one row in the device list.
 */
export type DeviceAuditRow = Readonly<{
  deviceId: string;
  publicKey: string;
  status: 'active' | 'revoked';
  authorizedAt: string;
  revokedAt: string | undefined;
  /**
   * True when the device's `publicKey` equals the projection's
   * `controllerPublicKey`. This is the bootstrap device; rotation
   * is intentionally disabled for it.
   */
  isController: boolean;
  /**
   * True when the device is active AND not the controller. Only
   * these rows expose a rotate affordance.
   */
  isRotatable: boolean;
}>;

/**
 * Display-grade representation of one row in the capability list.
 */
export type CapabilityAuditRow = Readonly<{
  capabilityId: string;
  delegateDeviceId: string;
  scope: string;
  status: 'granted' | 'revoked';
  grantedAt: string;
  revokedAt: string | undefined;
  expiresAt: string | undefined;
  /**
   * Convenience for UI: true when the capability is granted AND
   * (no expiry OR expiry is in the future relative to `now`).
   */
  isActive: boolean;
}>;

/**
 * Display-grade representation of the current contact-card
 * publication. `undefined` when the user has never published one.
 */
export type ContactCardPublicationRow = Readonly<{
  contactCardDigest: string;
  capturedAt: string;
  publishedAt: string;
}>;

/**
 * The complete identity-audit view model.
 */
export type IdentityAuditViewModel = Readonly<{
  identityId: string;
  controllerPublicKey: string | undefined;
  epoch: number;
  devices: ReadonlyArray<DeviceAuditRow>;
  capabilities: ReadonlyArray<CapabilityAuditRow>;
  contactCardPublication: ContactCardPublicationRow | undefined;
  /**
   * The epoch a new authority-changing event MUST carry to be
   * accepted by the projection. Always `epoch + 1`. Exposed so
   * the rotation flow can compute it without re-deriving.
   */
  nextEpoch: number;
}>;

/**
 * Build the view model from a frozen `StoredIdentityControlProjection`.
 *
 * The function is total: a `projection === undefined` path returns
 * an empty view model so the UI can render gracefully during
 * bootstrap.
 */
export function buildIdentityAuditViewModel(
  projection: StoredIdentityControlProjection | undefined,
  options: Readonly<{ now?: number }> = {}
): IdentityAuditViewModel {
  if (projection === undefined) {
    return Object.freeze({
      identityId: '',
      controllerPublicKey: undefined,
      epoch: 0,
      devices: Object.freeze([] as DeviceAuditRow[]),
      capabilities: Object.freeze([] as CapabilityAuditRow[]),
      contactCardPublication: undefined,
      nextEpoch: 1
    });
  }
  const now = options.now ?? Date.now();
  const controllerPublicKey = projection.controllerPublicKey;
  const devices = Object.values(projection.devices).map((device) => {
    const isController =
      controllerPublicKey !== undefined && device.publicKey === controllerPublicKey;
    const isRotatable = device.status === 'active' && !isController;
    return Object.freeze({
      deviceId: device.deviceId,
      publicKey: device.publicKey,
      status: device.status,
      authorizedAt: device.authorizedAt,
      revokedAt: device.revokedAt,
      isController,
      isRotatable
    });
  });
  // Stable order: controller first, then active by authorizedAt,
  // then revoked at the end.
  devices.sort((a, b) => {
    if (a.isController !== b.isController) return a.isController ? -1 : 1;
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return a.authorizedAt.localeCompare(b.authorizedAt);
  });

  const capabilities = Object.values(projection.capabilities).map((cap) => {
    const expired =
      cap.expiresAt !== undefined && Date.parse(cap.expiresAt) <= now;
    return Object.freeze({
      capabilityId: cap.capabilityId,
      delegateDeviceId: cap.delegateDeviceId,
      scope: cap.scope,
      status: cap.status,
      grantedAt: cap.grantedAt,
      revokedAt: cap.revokedAt,
      expiresAt: cap.expiresAt,
      isActive: cap.status === 'granted' && !expired
    });
  });
  capabilities.sort((a, b) => a.capabilityId.localeCompare(b.capabilityId));

  const contactCardPublication =
    projection.contactCardPublication === undefined
      ? undefined
      : Object.freeze({
          contactCardDigest: projection.contactCardPublication.contactCardDigest,
          capturedAt: projection.contactCardPublication.capturedAt,
          publishedAt: projection.contactCardPublication.publishedAt
        });

  return Object.freeze({
    identityId: projection.identityId,
    controllerPublicKey,
    epoch: projection.epoch,
    devices: Object.freeze(devices),
    capabilities: Object.freeze(capabilities),
    contactCardPublication,
    nextEpoch: projection.epoch + 1
  });
}

/**
 * Build a short, human-readable fingerprint of a public key for
 * display in confirmation dialogs. Returns the first 8 + "…" + last
 * 8 characters. Pure function; intended for UI confirmations only,
 * never for any trust decision.
 */
export function shortPublicKeyFingerprint(publicKey: string): string {
  if (publicKey.length <= 17) return publicKey;
  return `${publicKey.slice(0, 8)}…${publicKey.slice(-8)}`;
}

/**
 * Rotation intent shape that the UI confirmation dialog displays.
 * Pure-logic precondition check: returns the intent or throws a
 * descriptive Error explaining why the rotation is rejected.
 *
 * The store-level `appendLocalIdentityEvent` and the projection's
 * `applyDeviceRotated` both perform the real enforcement (epoch
 * monotonicity, previousPublicKey match, lifecycle status). This
 * helper exists so the UI can refuse to even SHOW a rotation
 * dialog for a non-rotatable row, and so the test can pin the
 * precondition behavior without spinning up a Dexie store.
 */
export type RotationIntent = Readonly<{
  identityId: string;
  deviceId: string;
  previousPublicKey: string;
  newPublicKey: string;
  epoch: number;
}>;

export function prepareRotationIntent(
  viewModel: IdentityAuditViewModel,
  deviceId: string,
  newPublicKey: string
): RotationIntent {
  const row = viewModel.devices.find((d) => d.deviceId === deviceId);
  if (row === undefined) {
    throw new Error(`prepareRotationIntent: device ${deviceId} not found`);
  }
  if (row.isController) {
    throw new Error(
      `prepareRotationIntent: ${deviceId} is the controller device; controller-key supersession is a separate (deferred) flow`
    );
  }
  if (!row.isRotatable) {
    throw new Error(
      `prepareRotationIntent: ${deviceId} is not rotatable (status=${row.status})`
    );
  }
  if (newPublicKey === row.publicKey) {
    throw new Error(
      'prepareRotationIntent: newPublicKey must differ from the current publicKey'
    );
  }
  return Object.freeze({
    identityId: viewModel.identityId,
    deviceId,
    previousPublicKey: row.publicKey,
    newPublicKey,
    epoch: viewModel.nextEpoch
  });
}
