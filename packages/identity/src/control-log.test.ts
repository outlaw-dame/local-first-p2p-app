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

    const state = seedIdentityControlProjection([
      capabilityGranted,
      deviceAuthorized,
      controllerCreated
    ]);

    expect(state.controllerPublicKey).toBe('controller-public-key');
    expect(state.epoch).toBe(1);
    expect(state.devices['device:primary']?.status).toBe('active');
    expect(state.devices['device:laptop']?.status).toBe('active');
    expect(state.capabilities['cap:sync:device:laptop']?.status).toBe('granted');
  });

  it('enforces monotonic epoch and known-entity revocation', () => {
    const initial = seedIdentityControlProjection([
      signedIdentityEvent(
        'identity.controller.created',
        {
          controllerPublicKey: 'controller-public-key',
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
          epoch: 2
        },
        2,
        'evt_device_authorized'
      )
    ]);

    expect(() =>
      applyIdentityControlEvent(
        initial,
        signedIdentityEvent(
          'identity.device.authorized',
          {
            authorizedDeviceId: 'device:tablet',
            authorizedPublicKey: 'device-tablet-public-key',
            epoch: 2
          },
          3,
          'evt_device_authorized_stale'
        )
      )
    ).toThrow(/payload\.epoch must be greater than current epoch/);

    expect(() =>
      applyIdentityControlEvent(
        initial,
        signedIdentityEvent(
          'identity.device.revoked',
          {
            revokedDeviceId: 'device:unknown',
            epoch: 3
          },
          3,
          'evt_device_revoked_unknown'
        )
      )
    ).toThrow(/references unknown device/);
  });

  it('rejects controller re-initialization', () => {
    const initial = seedIdentityControlProjection([
      signedIdentityEvent(
        'identity.controller.created',
        {
          controllerPublicKey: 'controller-public-key',
          initialDeviceId: 'device:primary'
        },
        1,
        'evt_controller_created'
      )
    ]);

    expect(() =>
      applyIdentityControlEvent(
        initial,
        signedIdentityEvent(
          'identity.controller.created',
          {
            controllerPublicKey: 'controller-public-key',
            initialDeviceId: 'device:secondary'
          },
          2,
          'evt_controller_reinit'
        )
      )
    ).toThrow(/may only be applied once/);
  });

  it('requires controller-created signature key to match controller public key payload', () => {
    const created = signedIdentityEvent(
      'identity.controller.created',
      {
        controllerPublicKey: 'controller-public-key',
        initialDeviceId: 'device:primary'
      },
      1,
      'evt_controller_created'
    );

    expect(() =>
      applyIdentityControlEvent(createEmptyIdentityControlState(), {
        ...created,
        signature: {
          ...created.signature,
          publicKey: 'different-controller-key'
        }
      })
    ).toThrow(/signature\.publicKey must match payload\.controllerPublicKey/);
  });

  it('requires controller signer for all post-initialization control events', () => {
    const initial = seedIdentityControlProjection([
      signedIdentityEvent(
        'identity.controller.created',
        {
          controllerPublicKey: 'controller-public-key',
          initialDeviceId: 'device:primary'
        },
        1,
        'evt_controller_created'
      )
    ]);

    expect(() =>
      applyIdentityControlEvent(initial, {
        ...signedIdentityEvent(
          'identity.device.authorized',
          {
            authorizedDeviceId: 'device:laptop',
            authorizedPublicKey: 'device-laptop-public-key',
            epoch: 1
          },
          2,
          'evt_device_authorized_bad_signer'
        ),
        signature: {
          algorithm: 'ed25519',
          publicKey: 'attacker-public-key',
          value: 'attacker-signature'
        }
      })
    ).toThrow(/must be signed by the controller public key/);
  });

  it('keeps earliest revocation timestamp when duplicate revokes are replayed', () => {
    const state = seedIdentityControlProjection([
      signedIdentityEvent(
        'identity.controller.created',
        {
          controllerPublicKey: 'controller-public-key',
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
          epoch: 1
        },
        2,
        'evt_device_authorized'
      ),
      signedIdentityEvent(
        'identity.device.revoked',
        {
          revokedDeviceId: 'device:laptop',
          epoch: 2
        },
        3,
        'evt_device_revoked_first'
      ),
      signedIdentityEvent(
        'identity.device.revoked',
        {
          revokedDeviceId: 'device:laptop',
          epoch: 3
        },
        4,
        'evt_device_revoked_duplicate'
      )
    ]);

    expect(state.devices['device:laptop']?.status).toBe('revoked');
    expect(state.devices['device:laptop']?.revokedAt).toBe('2026-05-26T00:00:03.000Z');
    expect(state.epoch).toBe(2);
    expect(state.lastEventId).toBe('evt_device_revoked_duplicate');
  });

  it('validates capability delegate id during revocation', () => {
    const initial = seedIdentityControlProjection([
      signedIdentityEvent(
        'identity.controller.created',
        {
          controllerPublicKey: 'controller-public-key',
          initialDeviceId: 'device:primary'
        },
        1,
        'evt_controller_created'
      ),
      signedIdentityEvent(
        'identity.capability.granted',
        {
          capabilityId: 'cap:sync:device:laptop',
          delegateDeviceId: 'device:laptop',
          scope: 'sync:outbox',
          expiresAt: '2026-06-01T00:00:00.000Z'
        },
        2,
        'evt_capability_granted'
      )
    ]);

    expect(() =>
      applyIdentityControlEvent(
        initial,
        signedIdentityEvent(
          'identity.capability.revoked',
          {
            capabilityId: 'cap:sync:device:laptop',
            delegateDeviceId: 'device:tablet'
          },
          3,
          'evt_capability_revoked_mismatch'
        )
      )
    ).toThrow(/does not match granted capability delegate/);
  });

  it('deduplicates identical events and rejects conflicting duplicate event ids', () => {
    const controllerCreated = signedIdentityEvent(
      'identity.controller.created',
      {
        controllerPublicKey: 'controller-public-key',
        initialDeviceId: 'device:primary'
      },
      1,
      'evt_controller_created'
    );

    const deduped = seedIdentityControlProjection([controllerCreated, controllerCreated]);
    expect(deduped.controllerPublicKey).toBe('controller-public-key');

    const conflictingDuplicate = {
      ...controllerCreated,
      payload: {
        ...controllerCreated.payload,
        initialDeviceId: 'device:other'
      }
    };

    expect(() => seedIdentityControlProjection([controllerCreated, conflictingDuplicate])).toThrow(
      /has conflicting signed event content/
    );
  });

  it('updates lastEventId for idempotent capability revocation replay', () => {
    const state = seedIdentityControlProjection([
      signedIdentityEvent(
        'identity.controller.created',
        {
          controllerPublicKey: 'controller-public-key',
          initialDeviceId: 'device:primary'
        },
        1,
        'evt_controller_created'
      ),
      signedIdentityEvent(
        'identity.capability.granted',
        {
          capabilityId: 'cap:sync:device:laptop',
          delegateDeviceId: 'device:laptop',
          scope: 'sync:outbox',
          expiresAt: '2026-06-01T00:00:00.000Z'
        },
        2,
        'evt_capability_granted'
      ),
      signedIdentityEvent(
        'identity.capability.revoked',
        {
          capabilityId: 'cap:sync:device:laptop',
          delegateDeviceId: 'device:laptop'
        },
        3,
        'evt_capability_revoked_first'
      ),
      signedIdentityEvent(
        'identity.capability.revoked',
        {
          capabilityId: 'cap:sync:device:laptop',
          delegateDeviceId: 'device:laptop'
        },
        4,
        'evt_capability_revoked_duplicate'
      )
    ]);

    expect(state.capabilities['cap:sync:device:laptop']?.status).toBe('revoked');
    expect(state.capabilities['cap:sync:device:laptop']?.revokedAt).toBe(
      '2026-05-26T00:00:03.000Z'
    );
    expect(state.lastEventId).toBe('evt_capability_revoked_duplicate');
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
  return signedEvent(
    arg1 as EventKind,
    arg2 as Record<string, unknown>,
    (arg3 as number | undefined) ?? 1,
    arg4 as string | undefined
  );
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
      publicKey: defaultSignerFor(kind, payload),
      value: 'test-signature'
    }
  };
}

function defaultSignerFor(kind: EventKind, payload: Record<string, unknown>): string {
  if (kind === 'identity.controller.created') {
    return typeof payload.controllerPublicKey === 'string' && payload.controllerPublicKey.length > 0
      ? payload.controllerPublicKey
      : 'controller-public-key';
  }
  if (kind.startsWith('identity.')) return 'controller-public-key';
  return 'test-public-key';
}
