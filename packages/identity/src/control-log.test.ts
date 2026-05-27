import { describe, expect, it } from 'vitest';
import { type EventKind, createUnsignedEvent, type SignedEventEnvelope } from '@lfp2p/protocol';
import {
  applyIdentityControlEvent,
  createEmptyIdentityControlState,
  seedIdentityControlProjection
} from './control-log.js';

describe('identity control projection seed', () => {
  it('builds projection from ordered identity-control events', () => {
    const controllerCreated = signedIdentityEvent(
      'evt_controller_created',
      'identity.controller.created',
      {
        controllerPublicKey: 'controller-public-key',
        initialDeviceId: 'device:primary'
      },
      1
    );
    const deviceAuthorized = signedIdentityEvent(
      'evt_device_authorized',
      'identity.device.authorized',
      {
        authorizedDeviceId: 'device:laptop',
        authorizedPublicKey: 'device-laptop-public-key',
        epoch: 1
      },
      2
    );
    const capabilityGranted = signedIdentityEvent(
      'evt_capability_granted',
      'identity.capability.granted',
      {
        capabilityId: 'cap:sync:device:laptop',
        delegateDeviceId: 'device:laptop',
        scope: 'sync:outbox',
        expiresAt: '2026-06-01T00:00:00.000Z'
      },
      3
    );

    const state = seedIdentityControlProjection([capabilityGranted, deviceAuthorized, controllerCreated]);

    expect(state.controllerPublicKey).toBe('controller-public-key');
    expect(state.epoch).toBe(1);
    expect(state.devices['device:primary']?.status).toBe('active');
    expect(state.devices['device:laptop']?.status).toBe('active');
    expect(state.capabilities['cap:sync:device:laptop']?.status).toBe('granted');
  });

  it('enforces monotonic epoch and known-entity revocation', () => {
    const initial = seedIdentityControlProjection([
      signedIdentityEvent('identity.controller.created', {
        controllerPublicKey: 'controller-public-key',
        initialDeviceId: 'device:primary'
      }, 1, 'evt_controller_created'),
      signedIdentityEvent('identity.device.authorized', {
        authorizedDeviceId: 'device:laptop',
        authorizedPublicKey: 'device-laptop-public-key',
        epoch: 2
      }, 2, 'evt_device_authorized')
    ]);

    expect(() =>
      applyIdentityControlEvent(
        initial,
        signedIdentityEvent('identity.device.authorized', {
          authorizedDeviceId: 'device:tablet',
          authorizedPublicKey: 'device-tablet-public-key',
          epoch: 2
        }, 3, 'evt_device_authorized_stale')
      )
    ).toThrow(/payload\.epoch must be greater than current epoch/);

    expect(() =>
      applyIdentityControlEvent(
        initial,
        signedIdentityEvent('identity.device.revoked', {
          revokedDeviceId: 'device:unknown',
          epoch: 3
        }, 3, 'evt_device_revoked_unknown')
      )
    ).toThrow(/references unknown device/);
  });

  it('ignores non-identity events for projection seed', () => {
    const baseline = createEmptyIdentityControlState();
    const state = applyIdentityControlEvent(
      baseline,
      signedEvent('outbox.test.created', {
        body: 'noop for control projection'
      })
    );
    expect(state).toEqual(baseline);
  });
});

function signedIdentityEvent(
  eventId: string,
  kind: EventKind,
  payload: Record<string, unknown>,
  lamport = 1
): SignedEventEnvelope;
function signedIdentityEvent(
  kind: EventKind,
  payload: Record<string, unknown>,
  lamport?: number,
  eventId?: string
): SignedEventEnvelope;
function signedIdentityEvent(
  arg1: string,
  arg2: EventKind | Record<string, unknown>,
  arg3?: Record<string, unknown> | number,
  arg4?: number | string
): SignedEventEnvelope {
  if (typeof arg2 === 'string') {
    return signedEvent(arg2, arg3 as Record<string, unknown>, arg4 as number, arg1);
  }
  return signedEvent(arg1 as EventKind, arg2 as Record<string, unknown>, (arg3 as number | undefined) ?? 1, arg4 as string | undefined);
}

function signedEvent(
  kind: EventKind,
  payload: Record<string, unknown>,
  lamport = 1,
  eventId = `evt_${kind}_${lamport}`
): SignedEventEnvelope {
  const unsigned = createUnsignedEvent({
    eventId,
    kind,
    author: 'identity:test-account',
    deviceId: 'device:test-primary',
    createdAt: `2026-05-26T00:00:0${lamport}.000Z`,
    lamport,
    privacy: kind.startsWith('identity.') ? 'self' : 'device-local',
    payload
  });

  return {
    ...unsigned,
    signature: {
      algorithm: 'ed25519',
      publicKey: 'test-public-key',
      value: 'test-signature'
    }
  };
}
