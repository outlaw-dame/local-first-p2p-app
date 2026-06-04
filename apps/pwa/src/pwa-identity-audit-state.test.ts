import { describe, expect, it } from 'vitest';
import type { StoredIdentityControlProjection } from '@lfp2p/local-store';
import {
  buildIdentityAuditViewModel,
  prepareRotationIntent,
  shortPublicKeyFingerprint
} from './pwa-identity-audit-state.js';

const CONTROLLER_KEY = 'Ed25519_Controller_AAAAAAAAAAAAAAAAAAAAAAAAA';
const DEVICE_2_KEY = 'Ed25519_Device2___BBBBBBBBBBBBBBBBBBBBBBBBB';
const DEVICE_2_NEW_KEY = 'Ed25519_Device2New_CCCCCCCCCCCCCCCCCCCCCCCCC';
const REVOKED_KEY = 'Ed25519_Revoked___DDDDDDDDDDDDDDDDDDDDDDDDDD';

function makeProjection(): StoredIdentityControlProjection {
  return {
    identityId: 'identity:alice',
    controllerPublicKey: CONTROLLER_KEY,
    epoch: 3,
    devices: {
      'device:alice-phone': {
        deviceId: 'device:alice-phone',
        publicKey: CONTROLLER_KEY,
        status: 'active',
        authorizedAt: '2026-06-01T00:00:00Z'
      },
      'device:alice-laptop': {
        deviceId: 'device:alice-laptop',
        publicKey: DEVICE_2_KEY,
        status: 'active',
        authorizedAt: '2026-06-02T00:00:00Z'
      },
      'device:alice-old-tablet': {
        deviceId: 'device:alice-old-tablet',
        publicKey: REVOKED_KEY,
        status: 'revoked',
        authorizedAt: '2026-05-01T00:00:00Z',
        revokedAt: '2026-06-02T00:00:00Z'
      }
    },
    capabilities: {
      cap_outbox_001: {
        capabilityId: 'cap_outbox_001',
        delegateDeviceId: 'device:alice-laptop',
        scope: 'outbox.send',
        status: 'granted',
        grantedAt: '2026-06-02T00:00:00Z',
        expiresAt: '2027-01-01T00:00:00Z'
      },
      cap_old_expired: {
        capabilityId: 'cap_old_expired',
        delegateDeviceId: 'device:alice-old-tablet',
        scope: 'outbox.send',
        status: 'granted',
        grantedAt: '2026-04-01T00:00:00Z',
        expiresAt: '2026-05-01T00:00:00Z'
      },
      cap_revoked_001: {
        capabilityId: 'cap_revoked_001',
        delegateDeviceId: 'device:alice-old-tablet',
        scope: 'outbox.send',
        status: 'revoked',
        grantedAt: '2026-04-01T00:00:00Z',
        revokedAt: '2026-06-02T00:00:00Z'
      }
    },
    contactCardPublication: {
      contactCardDigest:
        'sha-256:AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555FFFF6666GGGG7777HHHH8888',
      capturedAt: '2026-06-02T00:00:00Z',
      publishedAt: '2026-06-02T00:00:00Z'
    },
    lastEventId: 'evt_last',
    updatedAt: '2026-06-03T00:00:00Z'
  };
}

describe('Phase 2.3b — buildIdentityAuditViewModel', () => {
  it('returns an empty model when projection is undefined', () => {
    const vm = buildIdentityAuditViewModel(undefined);
    expect(vm.identityId).toBe('');
    expect(vm.controllerPublicKey).toBeUndefined();
    expect(vm.devices).toEqual([]);
    expect(vm.capabilities).toEqual([]);
    expect(vm.contactCardPublication).toBeUndefined();
    expect(vm.epoch).toBe(0);
    expect(vm.nextEpoch).toBe(1);
  });

  it('exposes nextEpoch = epoch + 1 so the rotation flow does not re-derive', () => {
    const vm = buildIdentityAuditViewModel(makeProjection());
    expect(vm.epoch).toBe(3);
    expect(vm.nextEpoch).toBe(4);
  });

  it('marks the controller device with isController=true and isRotatable=false', () => {
    const vm = buildIdentityAuditViewModel(makeProjection());
    const controller = vm.devices.find((d) => d.deviceId === 'device:alice-phone');
    expect(controller?.isController).toBe(true);
    expect(controller?.isRotatable).toBe(false);
  });

  it('marks a non-controller active device as isRotatable=true', () => {
    const vm = buildIdentityAuditViewModel(makeProjection());
    const secondary = vm.devices.find((d) => d.deviceId === 'device:alice-laptop');
    expect(secondary?.isController).toBe(false);
    expect(secondary?.isRotatable).toBe(true);
  });

  it('marks a revoked device as not rotatable', () => {
    const vm = buildIdentityAuditViewModel(makeProjection());
    const revoked = vm.devices.find((d) => d.deviceId === 'device:alice-old-tablet');
    expect(revoked?.isRotatable).toBe(false);
    expect(revoked?.revokedAt).toBe('2026-06-02T00:00:00Z');
  });

  it('orders devices: controller first, then active by authorizedAt, then revoked last', () => {
    const vm = buildIdentityAuditViewModel(makeProjection());
    expect(vm.devices.map((d) => d.deviceId)).toEqual([
      'device:alice-phone', // controller
      'device:alice-laptop', // active non-controller
      'device:alice-old-tablet' // revoked
    ]);
  });

  it('reports capabilities as active only when granted AND not expired', () => {
    const now = Date.parse('2026-06-03T00:00:00Z');
    const vm = buildIdentityAuditViewModel(makeProjection(), { now });
    const live = vm.capabilities.find((c) => c.capabilityId === 'cap_outbox_001');
    const expired = vm.capabilities.find((c) => c.capabilityId === 'cap_old_expired');
    const revoked = vm.capabilities.find((c) => c.capabilityId === 'cap_revoked_001');
    expect(live?.isActive).toBe(true);
    expect(expired?.isActive).toBe(false);
    expect(revoked?.isActive).toBe(false);
  });

  it('treats capabilities without expiresAt as active when granted', () => {
    const projection = makeProjection();
    const augmented: StoredIdentityControlProjection = {
      ...projection,
      capabilities: {
        ...projection.capabilities,
        cap_no_expiry: {
          capabilityId: 'cap_no_expiry',
          delegateDeviceId: 'device:alice-laptop',
          scope: 'outbox.send',
          status: 'granted',
          grantedAt: '2026-06-02T00:00:00Z'
        }
      }
    };
    const vm = buildIdentityAuditViewModel(augmented);
    const row = vm.capabilities.find((c) => c.capabilityId === 'cap_no_expiry');
    expect(row?.isActive).toBe(true);
  });

  it('exposes contact-card publication when present', () => {
    const vm = buildIdentityAuditViewModel(makeProjection());
    expect(vm.contactCardPublication?.contactCardDigest).toMatch(/^sha-256:/);
  });

  it('omits contact-card publication when absent', () => {
    const projection = makeProjection();
    const { contactCardPublication: _omit, ...rest } = projection;
    void _omit;
    const vm = buildIdentityAuditViewModel(rest);
    expect(vm.contactCardPublication).toBeUndefined();
  });
});

describe('Phase 2.3b — shortPublicKeyFingerprint', () => {
  it('returns the input unchanged when shorter than the truncation threshold', () => {
    expect(shortPublicKeyFingerprint('short')).toBe('short');
  });

  it('truncates with an ellipsis for normal-length keys', () => {
    const out = shortPublicKeyFingerprint(CONTROLLER_KEY);
    expect(out.includes('…')).toBe(true);
    expect(out.length).toBeLessThan(CONTROLLER_KEY.length);
  });
});

describe('Phase 2.3b — prepareRotationIntent', () => {
  it('produces an intent with epoch = nextEpoch and the stored previousPublicKey', () => {
    const vm = buildIdentityAuditViewModel(makeProjection());
    const intent = prepareRotationIntent(vm, 'device:alice-laptop', DEVICE_2_NEW_KEY);
    expect(intent).toEqual({
      identityId: 'identity:alice',
      deviceId: 'device:alice-laptop',
      previousPublicKey: DEVICE_2_KEY,
      newPublicKey: DEVICE_2_NEW_KEY,
      epoch: 4
    });
  });

  it('refuses rotation of the controller device', () => {
    const vm = buildIdentityAuditViewModel(makeProjection());
    expect(() =>
      prepareRotationIntent(vm, 'device:alice-phone', 'Ed25519_NewControllerKey')
    ).toThrow(/controller device.*supersession.*deferred/);
  });

  it('refuses rotation of a revoked device', () => {
    const vm = buildIdentityAuditViewModel(makeProjection());
    expect(() =>
      prepareRotationIntent(vm, 'device:alice-old-tablet', DEVICE_2_NEW_KEY)
    ).toThrow(/not rotatable/);
  });

  it('refuses rotation when newPublicKey equals the current key', () => {
    const vm = buildIdentityAuditViewModel(makeProjection());
    expect(() =>
      prepareRotationIntent(vm, 'device:alice-laptop', DEVICE_2_KEY)
    ).toThrow(/must differ/);
  });

  it('refuses rotation of an unknown device', () => {
    const vm = buildIdentityAuditViewModel(makeProjection());
    expect(() =>
      prepareRotationIntent(vm, 'device:unknown', DEVICE_2_NEW_KEY)
    ).toThrow(/not found/);
  });
});
