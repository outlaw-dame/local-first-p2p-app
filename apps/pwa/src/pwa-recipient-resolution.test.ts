import { describe, expect, it } from 'vitest';
import {
  resolveEnvelopeRecipientsFromIdentityProjections,
  type RecipientIdentityProjection
} from './pwa-recipient-resolution.js';

const WRAP_A = 'A'.repeat(43);
const WRAP_B = 'B'.repeat(43);
const WRAP_C = 'C'.repeat(43);

function projection(
  identityId: string,
  devices: RecipientIdentityProjection['devices'],
  controllerPublicKey = `${identityId}:controller`
): RecipientIdentityProjection {
  return {
    identityId,
    controllerPublicKey,
    epoch: 1,
    devices,
    capabilities: {},
    updatedAt: '2026-07-07T00:00:00.000Z'
  };
}

describe('resolveEnvelopeRecipientsFromIdentityProjections', () => {
  it('resolves active devices with published wrap metadata in deterministic order', () => {
    const recipients = resolveEnvelopeRecipientsFromIdentityProjections({
      projections: [
        projection('identity:bob', {
          'device:bob-phone': {
            deviceId: 'device:bob-phone',
            publicKey: 'bob-phone-signing-key',
            status: 'active',
            authorizedAt: '2026-07-07T00:00:00.000Z',
            wrapPublicKey: WRAP_B,
            wrapKeyRef: 'wrap-key:device:bob-phone'
          }
        }),
        projection('identity:alice', {
          'device:alice-laptop': {
            deviceId: 'device:alice-laptop',
            publicKey: 'alice-laptop-signing-key',
            status: 'active',
            authorizedAt: '2026-07-07T00:00:01.000Z',
            wrapPublicKey: WRAP_A,
            wrapKeyRef: 'wrap-key:device:alice-laptop'
          }
        })
      ]
    });

    expect(recipients.map((r) => `${r.recipientIdentityId}/${r.recipientDeviceId}`)).toEqual([
      'identity:alice/device:alice-laptop',
      'identity:bob/device:bob-phone'
    ]);
  });

  it('skips revoked and keyless devices', () => {
    const recipients = resolveEnvelopeRecipientsFromIdentityProjections({
      projections: [
        projection('identity:alice', {
          'device:alice-phone': {
            deviceId: 'device:alice-phone',
            publicKey: 'alice-phone-signing-key',
            status: 'active',
            authorizedAt: '2026-07-07T00:00:00.000Z',
            wrapPublicKey: WRAP_A,
            wrapKeyRef: 'wrap-key:device:alice-phone'
          },
          'device:alice-retired': {
            deviceId: 'device:alice-retired',
            publicKey: 'alice-retired-signing-key',
            status: 'revoked',
            authorizedAt: '2026-07-06T00:00:00.000Z',
            revokedAt: '2026-07-07T00:00:00.000Z',
            wrapPublicKey: WRAP_B,
            wrapKeyRef: 'wrap-key:device:alice-retired'
          },
          'device:alice-keyless': {
            deviceId: 'device:alice-keyless',
            publicKey: 'alice-keyless-signing-key',
            status: 'active',
            authorizedAt: '2026-07-07T00:00:00.000Z'
          }
        })
      ]
    });

    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toMatchObject({
      recipientIdentityId: 'identity:alice',
      recipientDeviceId: 'device:alice-phone',
      wrapPublicKey: WRAP_A,
      wrapKeyRef: 'wrap-key:device:alice-phone'
    });
  });

  it('honours the caller-selected identity allow-list', () => {
    const recipients = resolveEnvelopeRecipientsFromIdentityProjections({
      recipientIdentityIds: ['identity:bob'],
      projections: [
        projection('identity:alice', {
          'device:alice-phone': {
            deviceId: 'device:alice-phone',
            publicKey: 'alice-phone-signing-key',
            status: 'active',
            authorizedAt: '2026-07-07T00:00:00.000Z',
            wrapPublicKey: WRAP_A,
            wrapKeyRef: 'wrap-key:device:alice-phone'
          }
        }),
        projection('identity:bob', {
          'device:bob-phone': {
            deviceId: 'device:bob-phone',
            publicKey: 'bob-phone-signing-key',
            status: 'active',
            authorizedAt: '2026-07-07T00:00:00.000Z',
            wrapPublicKey: WRAP_B,
            wrapKeyRef: 'wrap-key:device:bob-phone'
          }
        })
      ]
    });

    expect(recipients.map((r) => r.recipientIdentityId)).toEqual(['identity:bob']);
  });

  it('requires controller-known projections by default', () => {
    expect(() =>
      resolveEnvelopeRecipientsFromIdentityProjections({
        projections: [
          {
            identityId: 'identity:pending',
            epoch: 0,
            devices: {
              'device:pending': {
                deviceId: 'device:pending',
                publicKey: 'pending-signing-key',
                status: 'active',
                authorizedAt: '2026-07-07T00:00:00.000Z',
                wrapPublicKey: WRAP_C,
                wrapKeyRef: 'wrap-key:device:pending'
              }
            },
            capabilities: {},
            updatedAt: '2026-07-07T00:00:00.000Z'
          }
        ]
      })
    ).toThrow(/No active recipient devices resolved/);
  });

  it('rejects duplicate identity projections before recipient construction', () => {
    expect(() =>
      resolveEnvelopeRecipientsFromIdentityProjections({
        projections: [projection('identity:alice', {}), projection('identity:alice', {})]
      })
    ).toThrow(/Duplicate recipient identity projection/);
  });
});
