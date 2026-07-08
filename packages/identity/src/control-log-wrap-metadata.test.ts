import { describe, expect, it } from 'vitest';
import { type EventKind, createUnsignedEvent, type SignedEventEnvelope } from '@lfp2p/protocol';
import { applyIdentityControlEvent, seedIdentityControlProjection } from './control-log.js';
import { validateIdentityEvent } from './validation.js';

const CONTROLLER_KEY = 'controller-public-key';
const WRAP_PUBLIC_KEY = 'A'.repeat(43);
const WRAP_KEY_REF = 'wrap-key:device:laptop:abc123';

describe('identity control device wrap metadata', () => {
  it('projects wrap metadata from identity.device.authorized events', () => {
    const state = seedIdentityControlProjection([
      signedIdentityEvent(
        'identity.controller.created',
        {
          controllerPublicKey: CONTROLLER_KEY,
          initialDeviceId: 'device:primary'
        },
        1,
        'evt_controller_created'
      ),
      signedIdentityEvent(
        'identity.device.authorized',
        {
          authorizedDeviceId: 'device:laptop',
          authorizedPublicKey: 'device-laptop-public-key',
          wrapPublicKey: WRAP_PUBLIC_KEY,
          wrapKeyRef: WRAP_KEY_REF,
          epoch: 1
        },
        2,
        'evt_device_authorized_wrap'
      )
    ]);

    expect(state.devices['device:laptop']).toMatchObject({
      deviceId: 'device:laptop',
      publicKey: 'device-laptop-public-key',
      status: 'active',
      wrapPublicKey: WRAP_PUBLIC_KEY,
      wrapKeyRef: WRAP_KEY_REF
    });
  });

  it('normalizes optional wrap key refs in the projection', () => {
    const state = seedIdentityControlProjection([
      signedIdentityEvent(
        'identity.controller.created',
        {
          controllerPublicKey: CONTROLLER_KEY,
          initialDeviceId: 'device:primary'
        },
        1,
        'evt_controller_created'
      ),
      signedIdentityEvent(
        'identity.device.authorized',
        {
          authorizedDeviceId: 'device:laptop',
          authorizedPublicKey: 'device-laptop-public-key',
          wrapPublicKey: WRAP_PUBLIC_KEY,
          wrapKeyRef: `  ${WRAP_KEY_REF}  `,
          epoch: 1
        },
        2,
        'evt_device_authorized_wrap'
      )
    ]);

    expect(state.devices['device:laptop']?.wrapKeyRef).toBe(WRAP_KEY_REF);
  });

  it('keeps wrap metadata when a device is revoked', () => {
    const initial = seedIdentityControlProjection([
      signedIdentityEvent(
        'identity.controller.created',
        {
          controllerPublicKey: CONTROLLER_KEY,
          initialDeviceId: 'device:primary'
        },
        1,
        'evt_controller_created'
      ),
      signedIdentityEvent(
        'identity.device.authorized',
        {
          authorizedDeviceId: 'device:laptop',
          authorizedPublicKey: 'device-laptop-public-key',
          wrapPublicKey: WRAP_PUBLIC_KEY,
          wrapKeyRef: WRAP_KEY_REF,
          epoch: 1
        },
        2,
        'evt_device_authorized_wrap'
      )
    ]);

    const revoked = applyIdentityControlEvent(
      initial,
      signedIdentityEvent(
        'identity.device.revoked',
        {
          revokedDeviceId: 'device:laptop',
          epoch: 2
        },
        3,
        'evt_device_revoked'
      )
    );

    expect(revoked.devices['device:laptop']).toMatchObject({
      status: 'revoked',
      wrapPublicKey: WRAP_PUBLIC_KEY,
      wrapKeyRef: WRAP_KEY_REF
    });
  });

  it('rejects half-published wrap metadata before projection', () => {
    expect(() =>
      validateIdentityEvent({
        version: 'lfp2p.identity-event.v1',
        kind: 'identity.device.authorized',
        payload: {
          authorizedDeviceId: 'device:laptop',
          authorizedPublicKey: 'device-laptop-public-key',
          wrapPublicKey: WRAP_PUBLIC_KEY,
          epoch: 1
        }
      })
    ).toThrow(/wrapPublicKey and payload\.wrapKeyRef must be present together/);
  });

  it('rejects malformed wrap public keys', () => {
    expect(() =>
      validateIdentityEvent({
        version: 'lfp2p.identity-event.v1',
        kind: 'identity.device.authorized',
        payload: {
          authorizedDeviceId: 'device:laptop',
          authorizedPublicKey: 'device-laptop-public-key',
          wrapPublicKey: 'not valid base64url!',
          wrapKeyRef: WRAP_KEY_REF,
          epoch: 1
        }
      })
    ).toThrow(/payload\.wrapPublicKey must be a base64url-encoded public key/);
  });
});

function signedIdentityEvent(
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
    privacy: 'self',
    payload
  });

  return {
    ...unsigned,
    signature: {
      algorithm: 'ed25519',
      publicKey: defaultSignerFor(kind, payload),
      value: 'test-signature'
    }
  };
}

function defaultSignerFor(kind: EventKind, payload: Record<string, unknown>): string {
  if (kind === 'identity.controller.created') {
    return typeof payload.controllerPublicKey === 'string' && payload.controllerPublicKey.length > 0
      ? payload.controllerPublicKey
      : CONTROLLER_KEY;
  }
  return CONTROLLER_KEY;
}
