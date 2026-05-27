import { canonicalizeJson, type SignedEventEnvelope, unsignedProjection, validateSignedEvent } from '@lfp2p/protocol';

export type IdentityDeviceStatus = 'active' | 'revoked';

export type IdentityControlDevice = Readonly<{
  deviceId: string;
  publicKey: string;
  status: IdentityDeviceStatus;
  authorizedAt: string;
  revokedAt?: string;
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
  lastEventId?: string;
}>;

export function createEmptyIdentityControlState(): IdentityControlState {
  return {
    epoch: 0,
    devices: {},
    capabilities: {}
  };
}

export function applyIdentityControlEvent(
  state: IdentityControlState,
  event: SignedEventEnvelope
): IdentityControlState {
  validateSignedEvent(event);

  switch (event.kind) {
    case 'identity.controller.created':
      return applyControllerCreated(state, event);
    case 'identity.device.authorized':
      return applyDeviceAuthorized(state, event);
    case 'identity.device.revoked':
      return applyDeviceRevoked(state, event);
    case 'identity.capability.granted':
      return applyCapabilityGranted(state, event);
    case 'identity.capability.revoked':
      return applyCapabilityRevoked(state, event);
    default:
      return state;
  }
}

export function seedIdentityControlProjection(events: readonly SignedEventEnvelope[]): IdentityControlState {
  for (const event of events) {
    validateSignedEvent(event);
  }

  const sorted = [...events].sort((left, right) => {
    if (left.lamport !== right.lamport) return left.lamport - right.lamport;
    const createdAtOrder = Date.parse(left.createdAt) - Date.parse(right.createdAt);
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

function applyControllerCreated(state: IdentityControlState, event: SignedEventEnvelope): IdentityControlState {
  const payload = event.payload as Record<string, unknown>;
  const controllerPublicKey = requireString(payload.controllerPublicKey, 'controllerPublicKey');
  const initialDeviceId = requireString(payload.initialDeviceId, 'initialDeviceId');

  if (state.controllerPublicKey !== undefined) {
    throw new Error('identity.controller.created may only be applied once per identity control state');
  }
  if (event.signature.publicKey !== controllerPublicKey) {
    throw new Error('identity.controller.created signature.publicKey must match payload.controllerPublicKey');
  }

  return {
    ...state,
    controllerPublicKey,
    devices: {
      ...state.devices,
      [initialDeviceId]: {
        deviceId: initialDeviceId,
        publicKey: event.signature.publicKey,
        status: 'active',
        authorizedAt: event.createdAt
      }
    },
    lastEventId: event.eventId
  };
}

function applyDeviceAuthorized(state: IdentityControlState, event: SignedEventEnvelope): IdentityControlState {
  requireControllerSigner(state, event);
  const payload = event.payload as Record<string, unknown>;
  const deviceId = requireString(payload.authorizedDeviceId, 'authorizedDeviceId');
  const publicKey = requireString(payload.authorizedPublicKey, 'authorizedPublicKey');
  const epoch = requirePositiveInteger(payload.epoch, 'epoch');
  requireMonotonicEpoch(state.epoch, epoch, event.kind);

  return {
    ...state,
    epoch,
    devices: {
      ...state.devices,
      [deviceId]: {
        deviceId,
        publicKey,
        status: 'active',
        authorizedAt: event.createdAt
      }
    },
    lastEventId: event.eventId
  };
}

function applyDeviceRevoked(state: IdentityControlState, event: SignedEventEnvelope): IdentityControlState {
  requireControllerSigner(state, event);
  const payload = event.payload as Record<string, unknown>;
  const deviceId = requireString(payload.revokedDeviceId, 'revokedDeviceId');
  const epoch = requirePositiveInteger(payload.epoch, 'epoch');
  const existing = state.devices[deviceId];
  if (existing === undefined) throw new Error(`identity.device.revoked references unknown device ${deviceId}`);
  if (existing.status === 'revoked') {
    return {
      ...state,
      lastEventId: event.eventId
    };
  }
  requireMonotonicEpoch(state.epoch, epoch, event.kind);

  return {
    ...state,
    epoch,
    devices: {
      ...state.devices,
      [deviceId]: {
        ...existing,
        status: 'revoked',
        revokedAt: event.createdAt
      }
    },
    lastEventId: event.eventId
  };
}

function applyCapabilityGranted(state: IdentityControlState, event: SignedEventEnvelope): IdentityControlState {
  requireControllerSigner(state, event);
  const payload = event.payload as Record<string, unknown>;
  const capabilityId = requireString(payload.capabilityId, 'capabilityId');
  const delegateDeviceId = requireString(payload.delegateDeviceId, 'delegateDeviceId');
  const scope = requireString(payload.scope, 'scope');
  const expiresAt = requireString(payload.expiresAt, 'expiresAt');
  if (!Number.isFinite(Date.parse(expiresAt))) throw new Error('identity.capability.granted payload.expiresAt must be an ISO date string');

  return {
    ...state,
    capabilities: {
      ...state.capabilities,
      [capabilityId]: {
        capabilityId,
        delegateDeviceId,
        scope,
        expiresAt,
        status: 'granted',
        grantedAt: event.createdAt
      }
    },
    lastEventId: event.eventId
  };
}

function applyCapabilityRevoked(state: IdentityControlState, event: SignedEventEnvelope): IdentityControlState {
  requireControllerSigner(state, event);
  const payload = event.payload as Record<string, unknown>;
  const capabilityId = requireString(payload.capabilityId, 'capabilityId');
  const delegateDeviceId = requireString(payload.delegateDeviceId, 'delegateDeviceId');
  const existing = state.capabilities[capabilityId];
  if (existing === undefined) throw new Error(`identity.capability.revoked references unknown capability ${capabilityId}`);
  if (existing.delegateDeviceId !== delegateDeviceId) {
    throw new Error('identity.capability.revoked payload.delegateDeviceId does not match granted capability delegate');
  }
  if (existing.status === 'revoked') {
    return {
      ...state,
      lastEventId: event.eventId
    };
  }

  return {
    ...state,
    capabilities: {
      ...state.capabilities,
      [capabilityId]: {
        ...existing,
        status: 'revoked',
        revokedAt: event.createdAt
      }
    },
    lastEventId: event.eventId
  };
}

function requireControllerSigner(state: IdentityControlState, event: SignedEventEnvelope): void {
  const kind = event.kind;
  if (state.controllerPublicKey === undefined) {
    throw new Error(`${kind} requires identity.controller.created`);
  }
  if (event.signature.publicKey !== state.controllerPublicKey) {
    throw new Error(`${kind} must be signed by the controller public key`);
  }
}

function requireMonotonicEpoch(currentEpoch: number, nextEpoch: number, kind: string): void {
  if (nextEpoch <= currentEpoch) {
    throw new Error(`${kind} payload.epoch must be greater than current epoch`);
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a safe positive integer`);
  }
  return value;
}

function dedupeSortedEvents(events: readonly SignedEventEnvelope[]): SignedEventEnvelope[] {
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
      throw new Error(`duplicate eventId ${event.eventId} has conflicting signed event content`);
    }
  }

  return deduped;
}

function sameSignedEvent(left: SignedEventEnvelope, right: SignedEventEnvelope): boolean {
  if (left === right) return true;
  return (
    left.signature.value === right.signature.value &&
    left.signature.publicKey === right.signature.publicKey &&
    left.signature.algorithm === right.signature.algorithm &&
    canonicalizeJson(unsignedProjection(left)) === canonicalizeJson(unsignedProjection(right))
  );
}
