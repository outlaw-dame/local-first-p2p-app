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
import type {
  CapabilityProofRecord,
  CapabilityProofVerificationState,
  ProofRegistry
} from '@lfp2p/capabilities';
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
  /**
   * Step 3c — proof-registry enrichment. Present when a
   * `proofRegistry` was supplied to `buildIdentityAuditViewModel`.
   *
   * `matchedProofIds` lists every identity-control-log proof
   * record whose `subject.id` equals this row's `delegateDeviceId`.
   * Matching by `delegateDeviceId` (not `capabilityId`) is the only
   * mapping the in-memory data exposes — `CapabilityProofRecord.proofId`
   * is the granted-event id, which the projection does not carry.
   * Per-row reads are therefore *device-grain*: if a device holds
   * multiple grants, each row shows the same set.
   *
   * `verificationStates` is the parallel array of states, in the
   * same order as `matchedProofIds`. Callers can fold to worst-case
   * or render the distribution as they prefer.
   *
   * `undefined` when no registry was supplied OR when no
   * identity-control-log records match the row's delegate device.
   */
  proofState?: {
    matchedProofIds: ReadonlyArray<string>;
    verificationStates: ReadonlyArray<CapabilityProofVerificationState>;
  };
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
  options: Readonly<{
    now?: number;
    /**
     * Step 3c — first production consumer of the persisted proof
     * registry. When supplied, every capability row in the view
     * model is enriched with the verification states of every
     * identity-control-log proof whose `subject.id` equals the
     * row's `delegateDeviceId`. Omitted ⇒ no `proofState` field on
     * any row (backwards compatible).
     */
    proofRegistry?: ProofRegistry;
  }> = {}
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

  // Build a one-time device → matched-proofs index so the per-row
  // enrichment is O(rows) instead of O(rows × proofs). Empty when no
  // registry was supplied. We pass the audited identity's
  // `controllerPublicKey` so the index drops any record issued by a
  // foreign controller — `loadProofRegistry()` returns a STORE-WIDE
  // table that may include grants from contacts whose controllers
  // happen to have registered proofs for a device id that collides
  // with one of ours. Codex review on PR #100.
  const proofsByDevice = indexIdentityControlLogProofsByDevice(
    options.proofRegistry,
    controllerPublicKey
  );

  const capabilities = Object.values(projection.capabilities).map((cap) => {
    const expired = cap.expiresAt !== undefined && Date.parse(cap.expiresAt) <= now;
    const matched = proofsByDevice.get(cap.delegateDeviceId);
    const base = {
      capabilityId: cap.capabilityId,
      delegateDeviceId: cap.delegateDeviceId,
      scope: cap.scope,
      status: cap.status,
      grantedAt: cap.grantedAt,
      revokedAt: cap.revokedAt,
      expiresAt: cap.expiresAt,
      isActive: cap.status === 'granted' && !expired
    };
    if (matched === undefined) return Object.freeze(base);
    return Object.freeze({
      ...base,
      proofState: Object.freeze({
        matchedProofIds: Object.freeze(matched.map((r) => r.proofId)),
        verificationStates: Object.freeze(matched.map((r) => r.verificationState))
      })
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
 * One-pass scan of the proof registry that builds a
 * `deviceId → matching identity-control-log records` index.
 *
 * Filter rules:
 *   - `scheme === 'identity-control-log'` (the only scheme we can
 *     speak to from the identity-control projection)
 *   - `subject.kind === 'device'` (defense-in-depth against a
 *     malformed record landing in the registry)
 *   - `issuer.id === controllerPublicKey` AND
 *     `issuer.kind === 'controller'` when `controllerPublicKey` is
 *     supplied — drops grants issued by foreign controllers. The
 *     store's `loadProofRegistry()` returns a store-wide table that
 *     may include records from contacts; this filter keeps the
 *     audit view scoped to the identity that owns this projection.
 *
 * Returns an empty map when no registry is provided so callers can
 * unconditionally read `.get(deviceId)`.
 */
function indexIdentityControlLogProofsByDevice(
  registry: ProofRegistry | undefined,
  controllerPublicKey: string | undefined
): ReadonlyMap<string, ReadonlyArray<CapabilityProofRecord>> {
  if (registry === undefined) return new Map();
  const out = new Map<string, CapabilityProofRecord[]>();
  for (const record of registry.proofs.values()) {
    if (record.scheme !== 'identity-control-log') continue;
    if (record.subject.kind !== 'device') continue;
    // Foreign-controller filter. When the projection has no
    // controllerPublicKey yet (pre-bootstrap), we cannot identify
    // "our" issuer, so we drop ALL records — safer than risking a
    // cross-identity bleed in the audit display.
    if (controllerPublicKey === undefined) continue;
    if (record.issuer.kind !== 'controller') continue;
    if (record.issuer.id !== controllerPublicKey) continue;
    const list = out.get(record.subject.id);
    if (list === undefined) out.set(record.subject.id, [record]);
    else list.push(record);
  }
  return out;
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
    throw new Error(`prepareRotationIntent: ${deviceId} is not rotatable (status=${row.status})`);
  }
  if (newPublicKey === row.publicKey) {
    throw new Error('prepareRotationIntent: newPublicKey must differ from the current publicKey');
  }
  return Object.freeze({
    identityId: viewModel.identityId,
    deviceId,
    previousPublicKey: row.publicKey,
    newPublicKey,
    epoch: viewModel.nextEpoch
  });
}
