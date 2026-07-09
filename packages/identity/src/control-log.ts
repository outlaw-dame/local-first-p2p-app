import {
  canonicalizeJson,
  type SignedEventEnvelope,
  unsignedProjection,
  validateSignedEvent,
} from '@lfp2p/protocol';
import { identityError } from './errors.js';
import { validateIdentityEvent } from './validation.js';

export type IdentityDeviceStatus = 'active' | 'revoked';

export type IdentityContactCardPublication = Readonly<{
  contactCardDigest: string;
  capturedAt: string;
  publishedAt: string;
}>;

export type IdentityControlDevice = Readonly<{
  deviceId: string;
  publicKey: string;
  status: IdentityDeviceStatus;
  authorizedAt: string;
  revokedAt?: string;
  /**
   * Phase 5.12C — public X25519 wrap metadata for sender-side recipient
   * resolution. The private wrap key never appears in identity-control events
   * or projections; senders only need this public key and stable ref.
   */
  wrapPublicKey?: string;
  wrapKeyRef?: string;
}>;

export type IdentityCapabilityStatus = 'granted' | 'revoked';

export type IdentityControlCapability = Readonly<{
  capabilityId: string;
  delegateDeviceId: string;
  scope: string;
  expiresAt?: string;
  status: IdentityCapabilityStatus;
  grantedAt: string;
  revokedAt?: string;
}>;

export type IdentityControlState = Readonly<{
  controllerPublicKey?: string;
  epoch: number;
  devices: Readonly<Record<string, IdentityControlDevice>>;
  capabilities: Readonly<Record<string, IdentityControlCapability>>;
  /**
   * Most recent contact-card publication observed for this identity.
   * The projection retains only the latest publication — older ones
   * remain in the signed-event log for audit but are not surfaced as
   * "current."
   */
  contactCardPublication?: IdentityContactCardPublication;
  lastEventId?: string;
}>;

export function createEmptyIdentityControlState(): IdentityControlState {
  return Object.freeze({
    epoch: 0,
    devices: Object.freeze({}),
    capabilities: Object.freeze({}),
  });
}

/**
 * Recursively freezes the projection state's outer object plus the
 * `devices` and `capabilities` records and every record entry within.
 *
 * Rationale (hardening, Phase 3.2): without this, a consumer who held
 * a reference to the state could mutate `state.devices['device:x']`
 * to flip `status: 'revoked' -> 'active'`, or splice a fake
 * capability into `state.capabilities`, bypassing the entire
 * controller-signed authority chain. The deep-freeze walk in the
 * Phase 3.2 local-first integrity test pins this defense.
 *
 * Idempotent on already-frozen entries: re-applying does not
 * reallocate, and the function does not produce an unbounded
 * allocation cascade — each level is touched exactly once.
 */
function freezeIdentityControlState(
  state: IdentityControlState
): IdentityControlState {
  const devices: Record<string, IdentityControlDevice> = {};
  for (const k of Object.keys(state.devices)) {
    const v = state.devices[k];
    if (v === undefined) continue;
    devices[k] = Object.isFrozen(v) ? v : Object.freeze(v);
  }
  const capabilities: Record<string, IdentityControlCapability> = {};
  for (const k of Object.keys(state.capabilities)) {
    const v = state.capabilities[k];
    if (v === undefined) continue;
    capabilities[k] = Object.isFrozen(v) ? v : Object.freeze(v);
  }
  return Object.freeze({
    ...state,
    devices: Object.freeze(devices),
    capabilities: Object.freeze(capabilities),
  });
}

export function applyIdentityControlEvent(
  state: IdentityControlState,
  event: SignedEventEnvelope
): IdentityControlState {
  validateSignedEvent(event);

  // Belt-and-suspenders: re-run the pure shape validator on identity
  // events so a payload that slipped past the envelope layer can
  // never poison the projection. Non-identity kinds bypass this
  // narrow validator (the projection ignores them anyway).
  if (typeof event.kind === 'string' && event.kind.startsWith('identity.')) {
    validateIdentityEvent({
      version: 'lfp2p.identity-event.v1',
      kind: event.kind,
      payload: event.payload,
    });
  }

  switch (event.kind) {
    case 'identity.controller.created':
      return applyControllerCreated(state, event);
    case 'identity.device.authorized':
      return applyDeviceAuthorized(state, event);
    case 'identity.device.revoked':
      return applyDeviceRevoked(state, event);
    case 'identity.device.rotated':
      return applyDeviceRotated(state, event);
    case 'identity.capability.granted':
      return applyCapabilityGranted(state, event);
    case 'identity.capability.revoked':
      return applyCapabilityRevoked(state, event);
    case 'identity.contact-card.published':
      return applyContactCardPublished(state, event);
    default:
      return state;
  }
}

export function seedIdentityControlProjection(
  events: readonly SignedEventEnvelope[]
): IdentityControlState {
  for (const event of events) {
    validateSignedEvent(event);
  }

  const sorted = [...events].sort((left, right) => {
    if (left.lamport !== right.lamport) return left.lamport - right.lamport;
    const createdAtOrder =
      Date.parse(left.createdAt) - Date.parse(right.createdAt);
    if (createdAtOrder !== 0) return createdAtOrder;
    return left.eventId.localeCompare(right.eventId);
  });
  const deduped = dedupeSortedEvents(sorted);

  let state = createEmptyIdentityControlState();
  for (const event of deduped) {
    state = applyIdentityControlEvent(state, event);
  }
  return state;
}

function applyControllerCreated(
  state: IdentityControlState,
  event: SignedEventEnvelope
): IdentityControlState {
  const payload = event.payload as Record<string, unknown>;
  const controllerPublicKey = requireString(
    payload.controllerPublicKey,
    'controllerPublicKey'
  );
  const initialDeviceId = requireString(
    payload.initialDeviceId,
    'initialDeviceId'
  );

  if (state.controllerPublicKey !== undefined) {
    throw new Error(
      'identity.controller.created may only be applied once per identity control state'
    );
  }
  if (event.signature.publicKey !== controllerPublicKey) {
    throw new Error(
      'identity.controller.created signature.publicKey must match payload.controllerPublicKey'
    );
  }

  return freezeIdentityControlState({
    ...state,
    controllerPublicKey,
    devices: {
      ...state.devices,
      [initialDeviceId]: {
        deviceId: initialDeviceId,
        publicKey: event.signature.publicKey,
        status: 'active',
        authorizedAt: event.createdAt,
      },
    },
    lastEventId: event.eventId,
  });
}

function applyDeviceAuthorized(
  state: IdentityControlState,
  event: SignedEventEnvelope
): IdentityControlState {
  requireControllerSigner(state, event);
  const payload = event.payload as Record<string, unknown>;
  const deviceId = requireString(
    payload.authorizedDeviceId,
    'authorizedDeviceId'
  );
  const publicKey = requireString(
    payload.authorizedPublicKey,
    'authorizedPublicKey'
  );
  const epoch = requirePositiveInteger(payload.epoch, 'epoch');
  const wrapPublicKey = optionalString(
    payload.wrapPublicKey,
    'wrapPublicKey'
  );
  const wrapKeyRef = optionalString(payload.wrapKeyRef, 'wrapKeyRef');
  if ((wrapPublicKey === undefined) !== (wrapKeyRef === undefined)) {
    throw new Error(
      'identity.device.authorized wrapPublicKey and wrapKeyRef must be present together'
    );
  }
  requireMonotonicEpoch(state.epoch, epoch, event.kind);

  return freezeIdentityControlState({
    ...state,
    epoch,
    devices: {
      ...state.devices,
      [deviceId]: {
        deviceId,
        publicKey,
        status: 'active',
        authorizedAt: event.createdAt,
        ...(wrapPublicKey === undefined ? {} : { wrapPublicKey }),
        ...(wrapKeyRef === undefined ? {} : { wrapKeyRef }),
      },
    },
    lastEventId: event.eventId,
  });
}

function applyDeviceRevoked(
  state: IdentityControlState,
  event: SignedEventEnvelope
): IdentityControlState {
  requireControllerSigner(state, event);
  const payload = event.payload as Record<string, unknown>;
  const deviceId = requireString(payload.revokedDeviceId, 'revokedDeviceId');
  const epoch = requirePositiveInteger(payload.epoch, 'epoch');
  const existing = state.devices[deviceId];
  if (existing === undefined)
    throw new Error(
      `identity.device.revoked references unknown device ${deviceId}`
    );
  if (existing.status === 'revoked') {
    return freezeIdentityControlState({
      ...state,
      lastEventId: event.eventId,
    });
  }
  requireMonotonicEpoch(state.epoch, epoch, event.kind);

  return freezeIdentityControlState({
    ...state,
    epoch,
    devices: {
      ...state.devices,
      [deviceId]: {
        ...existing,
        status: 'revoked',
        revokedAt: event.createdAt,
      },
    },
    lastEventId: event.eventId,
  });
}

function applyCapabilityGranted(
  state: IdentityControlState,
  event: SignedEventEnvelope
): IdentityControlState {
  requireControllerSigner(state, event);
  const payload = event.payload as Record<string, unknown>;
  const capabilityId = requireString(payload.capabilityId, 'capabilityId');
  const delegateDeviceId = requireString(
    payload.delegateDeviceId,
    'delegateDeviceId'
  );
  const scope = requireString(payload.scope, 'scope');
  const expiresAt = requireString(payload.expiresAt, 'expiresAt');
  if (!Number.isFinite(Date.parse(expiresAt)))
    throw new Error(
      'identity.capability.granted payload.expiresAt must be an ISO date string'
    );

  return freezeIdentityControlState({
    ...state,
    capabilities: {
      ...state.capabilities,
      [capabilityId]: {
        capabilityId,
        delegateDeviceId,
        scope,
        expiresAt,
        status: 'granted',
        grantedAt: event.createdAt,
      },
    },
    lastEventId: event.eventId,
  });
}

function applyCapabilityRevoked(
  state: IdentityControlState,
  event: SignedEventEnvelope
): IdentityControlState {
  requireControllerSigner(state, event);
  const payload = event.payload as Record<string, unknown>;
  const capabilityId = requireString(payload.capabilityId, 'capabilityId');
  const delegateDeviceId = requireString(
    payload.delegateDeviceId,
    'delegateDeviceId'
  );
  const existing = state.capabilities[capabilityId];
  if (existing === undefined)
    throw new Error(
      `identity.capability.revoked references unknown capability ${capabilityId}`
    );
  if (existing.delegateDeviceId !== delegateDeviceId) {
    throw new Error(
      'identity.capability.revoked payload.delegateDeviceId does not match granted capability delegate'
    );
  }
  if (existing.status === 'revoked') {
    return freezeIdentityControlState({
      ...state,
      lastEventId: event.eventId,
    });
  }

  return freezeIdentityControlState({
    ...state,
    capabilities: {
      ...state.capabilities,
      [capabilityId]: {
        ...existing,
        status: 'revoked',
        revokedAt: event.createdAt,
      },
    },
    lastEventId: event.eventId,
  });
}

function applyDeviceRotated(
  state: IdentityControlState,
  event: SignedEventEnvelope
): IdentityControlState {
  requireControllerSigner(state, event);
  const payload = event.payload as Record<string, unknown>;
  const deviceId = requireString(payload.deviceId, 'deviceId');
  const previousPublicKey = requireString(
    payload.previousPublicKey,
    'previousPublicKey'
  );
  const newPublicKey = requireString(payload.newPublicKey, 'newPublicKey');
  const epoch = requirePositiveInteger(payload.epoch, 'epoch');
  const existing = state.devices[deviceId];
  if (existing === undefined) {
    throw identityError(
      'IDENTITY_DEVICE_NOT_FOUND',
      `identity.device.rotated references unknown device ${deviceId}`
    );
  }
  if (existing.status !== 'active') {
    throw identityError(
      'IDENTITY_LIFECYCLE_TRANSITION',
      `identity.device.rotated cannot rotate a ${existing.status} device`
    );
  }
  if (existing.publicKey !== previousPublicKey) {
    throw identityError(
      'IDENTITY_AUTHORITY_MISMATCH',
      'identity.device.rotated payload.previousPublicKey does not match the stored key'
    );
  }
  if (previousPublicKey === newPublicKey) {
    throw identityError(
      'IDENTITY_DEVICE_REUSE',
      'identity.device.rotated payload.newPublicKey must differ from previousPublicKey'
    );
  }
  requireMonotonicEpoch(state.epoch, epoch, event.kind);

  return freezeIdentityControlState({
    ...state,
    epoch,
    devices: {
      ...state.devices,
      [deviceId]: {
        ...existing,
        publicKey: newPublicKey,
        authorizedAt: event.createdAt,
      },
    },
    lastEventId: event.eventId,
  });
}

function applyContactCardPublished(
  state: IdentityControlState,
  event: SignedEventEnvelope
): IdentityControlState {
  requireControllerSigner(state, event);
  const payload = event.payload as Record<string, unknown>;
  const contactCardDigest = requireString(
    payload.contactCardDigest,
    'contactCardDigest'
  );
  const capturedAt = requireString(payload.capturedAt, 'capturedAt');
  if (!Number.isFinite(Date.parse(capturedAt))) {
    throw identityError(
      'IDENTITY_INVALID_TIMESTAMP',
      'identity.contact-card.published payload.capturedAt must be an ISO date string'
    );
  }

  return freezeIdentityControlState({
    ...state,
    contactCardPublication: Object.freeze({
      contactCardDigest,
      capturedAt,
      publishedAt: event.createdAt,
    }),
    lastEventId: event.eventId,
  });
}

function requireControllerSigner(
  state: IdentityControlState,
  event: SignedEventEnvelope
): void {
  const kind = event.kind;
  if (state.controllerPublicKey === undefined) {
    throw new Error(`${kind} requires identity.controller.created`);
  }
  if (event.signature.publicKey !== state.controllerPublicKey) {
    throw new Error(
      `${kind} must be signed by the controller public key`
    );
  }
}

function requireMonotonicEpoch(
  currentEpoch: number,
  nextEpoch: number,
  kind: string
): void {
  if (nextEpoch <= currentEpoch) {
    throw new Error(
      `${kind} payload.epoch must be greater than current epoch`
    );
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, field).trim();
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new Error(`${field} must be a safe positive integer`);
  }
  return value;
}

function dedupeSortedEvents(
  events: readonly SignedEventEnvelope[]
): SignedEventEnvelope[] {
  const deduped: SignedEventEnvelope[] = [];
  const seenByEventId = new Map<string, SignedEventEnvelope>();

  for (const event of events) {
    const existing = seenByEventId.get(event.eventId);
    if (existing === undefined) {
      seenByEventId.set(event.eventId, event);
      deduped.push(event);
      continue;
    }
    if (!sameSignedEvent(existing, event)) {
      throw new Error(
        `duplicate eventId ${event.eventId} has conflicting signed event content`
      );
    }
  }

  return deduped;
}

function sameSignedEvent(
  left: SignedEventEnvelope,
  right: SignedEventEnvelope
): boolean {
  if (left === right) return true;
  return (
    left.signature.value === right.signature.value &&
    left.signature.publicKey === right.signature.publicKey &&
    left.signature.algorithm === right.signature.algorithm &&
    canonicalizeJson(unsignedProjection(left)) ===
      canonicalizeJson(unsignedProjection(right))
  );
}
