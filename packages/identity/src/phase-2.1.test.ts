/**
 * Phase 2.1 — Identity protocol core (validator + new event kinds).
 *
 * Mirrors the Phase 1.61 trust-safety pattern: the pure validator is
 * tested independently of the projection, and every adversarial
 * shape is rejected with a stable IDENTITY_* error code.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  IDENTITY_ERROR_CODES,
  IDENTITY_EVENT_KINDS,
  IDENTITY_EVENT_VERSION,
  IdentityError,
  applyIdentityControlEvent,
  createEmptyIdentityControlState,
  validateIdentityEvent,
  type ValidatedIdentityEvent
} from './index.js';
import { signEventEnvelope, signingKeypairFromSeed } from '@lfp2p/crypto';
import { createUnsignedEvent } from '@lfp2p/protocol';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(HERE, '..', 'fixtures');

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function listFixtures(subdir: 'valid' | 'invalid'): string[] {
  const dir = join(FIXTURES_ROOT, subdir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

describe('Phase 2.1 — public surface', () => {
  it('IDENTITY_EVENT_KINDS pins the canonical 7-kind list', () => {
    expect(IDENTITY_EVENT_KINDS).toEqual([
      'identity.controller.created',
      'identity.device.authorized',
      'identity.device.revoked',
      'identity.device.rotated',
      'identity.capability.granted',
      'identity.capability.revoked',
      'identity.contact-card.published'
    ]);
  });

  it('IDENTITY_EVENT_VERSION pins the v1 wire id', () => {
    expect(IDENTITY_EVENT_VERSION).toBe('lfp2p.identity-event.v1');
  });

  it('IDENTITY_ERROR_CODES exposes the IDENTITY_* error code namespace', () => {
    for (const code of IDENTITY_ERROR_CODES) {
      expect(code.startsWith('IDENTITY_')).toBe(true);
    }
    expect(IDENTITY_ERROR_CODES).toContain('IDENTITY_INVALID_PUBLIC_KEY');
    expect(IDENTITY_ERROR_CODES).toContain('IDENTITY_FORBIDDEN_KEY');
    expect(IDENTITY_ERROR_CODES).toContain('IDENTITY_DEVICE_REUSE');
    expect(IDENTITY_ERROR_CODES).toContain('IDENTITY_AUTHORITY_MISMATCH');
  });
});

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

describe('Phase 2.1 — validateIdentityEvent', () => {
  it('rejects a non-object', () => {
    expect(() => validateIdentityEvent('hello')).toThrow(/IDENTITY_INVALID_INPUT/);
  });

  it('rejects unknown version', () => {
    expect(() =>
      validateIdentityEvent({
        version: 'lfp2p.identity-event.v2',
        kind: 'identity.controller.created',
        payload: { controllerPublicKey: 'k', initialDeviceId: 'd' }
      })
    ).toThrow(/IDENTITY_UNKNOWN_VERSION/);
  });

  it('rejects unknown kind', () => {
    expect(() =>
      validateIdentityEvent({
        version: 'lfp2p.identity-event.v1',
        kind: 'identity.account.transferred',
        payload: {}
      })
    ).toThrow(/IDENTITY_UNKNOWN_KIND/);
  });

  it('rejects forbidden property names in the payload (prototype-pollution defense)', () => {
    // Construct via JSON.parse so `__proto__` lands as an own
    // property rather than being interpreted as a prototype
    // assignment by the JS object literal grammar — this is the
    // adversarial-input form the parser would actually deliver.
    const value = JSON.parse(`{
      "version": "lfp2p.identity-event.v1",
      "kind": "identity.device.authorized",
      "payload": {
        "authorizedDeviceId": "d",
        "authorizedPublicKey": "Ed25519_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "epoch": 2,
        "__proto__": { "polluted": true }
      }
    }`);
    expect(() => validateIdentityEvent(value)).toThrow(/IDENTITY_FORBIDDEN_KEY/);
  });

  it('rejects forbidden property names as ids', () => {
    expect(() =>
      validateIdentityEvent({
        version: 'lfp2p.identity-event.v1',
        kind: 'identity.device.authorized',
        payload: {
          authorizedDeviceId: 'constructor',
          authorizedPublicKey: 'Ed25519_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          epoch: 2
        }
      })
    ).toThrow(/IDENTITY_FORBIDDEN_KEY/);
  });

  it('rejects malformed public keys', () => {
    expect(() =>
      validateIdentityEvent({
        version: 'lfp2p.identity-event.v1',
        kind: 'identity.controller.created',
        payload: {
          controllerPublicKey: 'has spaces and +=',
          initialDeviceId: 'device:x'
        }
      })
    ).toThrow(/IDENTITY_INVALID_PUBLIC_KEY/);
  });

  it('rejects non-positive epoch', () => {
    expect(() =>
      validateIdentityEvent({
        version: 'lfp2p.identity-event.v1',
        kind: 'identity.device.authorized',
        payload: {
          authorizedDeviceId: 'device:x',
          authorizedPublicKey: 'Ed25519_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          epoch: 0
        }
      })
    ).toThrow(/IDENTITY_INVALID_NUMBER/);
  });

  it('rejects non-integer epoch', () => {
    expect(() =>
      validateIdentityEvent({
        version: 'lfp2p.identity-event.v1',
        kind: 'identity.device.authorized',
        payload: {
          authorizedDeviceId: 'device:x',
          authorizedPublicKey: 'Ed25519_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          epoch: 1.5
        }
      })
    ).toThrow(/IDENTITY_INVALID_NUMBER/);
  });

  it('rejects oversized payloads', () => {
    expect(() =>
      validateIdentityEvent({
        version: 'lfp2p.identity-event.v1',
        kind: 'identity.capability.granted',
        payload: {
          capabilityId: 'c',
          delegateDeviceId: 'd',
          scope: 'x'.repeat(255),
          expiresAt: '2027-01-01T00:00:00Z',
          padding: 'A'.repeat(17 * 1024)
        }
      })
    ).toThrow(/IDENTITY_PAYLOAD_TOO_LARGE/);
  });

  it('accepts a well-formed controller.created event and freezes the result', () => {
    const e = validateIdentityEvent({
      version: 'lfp2p.identity-event.v1',
      kind: 'identity.controller.created',
      payload: {
        controllerPublicKey: 'Ed25519_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        initialDeviceId: 'device:alice-phone'
      }
    });
    expect(Object.isFrozen(e)).toBe(true);
    expect(Object.isFrozen(e.payload)).toBe(true);
    expect(e.kind).toBe('identity.controller.created');
  });

  it('rejects identity.device.rotated with previousPublicKey === newPublicKey', () => {
    expect(() =>
      validateIdentityEvent({
        version: 'lfp2p.identity-event.v1',
        kind: 'identity.device.rotated',
        payload: {
          deviceId: 'device:x',
          previousPublicKey: 'Ed25519_SAME_AAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          newPublicKey: 'Ed25519_SAME_AAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          epoch: 2
        }
      })
    ).toThrow(/IDENTITY_DEVICE_REUSE/);
  });

  it('accepts identity.contact-card.published with a well-formed digest', () => {
    const e = validateIdentityEvent({
      version: 'lfp2p.identity-event.v1',
      kind: 'identity.contact-card.published',
      payload: {
        contactCardDigest:
          'sha-256:AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555FFFF6666GGGG7777HHHH8888',
        capturedAt: '2026-06-02T00:00:00Z'
      }
    });
    expect(e.kind).toBe('identity.contact-card.published');
  });

  it('rejects contact-card published with a malformed digest', () => {
    expect(() =>
      validateIdentityEvent({
        version: 'lfp2p.identity-event.v1',
        kind: 'identity.contact-card.published',
        payload: {
          contactCardDigest: 'md5:abc',
          capturedAt: '2026-06-02T00:00:00Z'
        }
      })
    ).toThrow(/IDENTITY_INVALID_DIGEST/);
  });

  it('every IdentityError exposes a stable code', () => {
    try {
      validateIdentityEvent({});
    } catch (err) {
      expect(err).toBeInstanceOf(IdentityError);
      expect((err as IdentityError).code).toMatch(/^IDENTITY_/);
    }
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe('Phase 2.1 — fixtures', () => {
  const valid = listFixtures('valid');
  const invalid = listFixtures('invalid');

  it('valid/ contains one fixture per documented kind', () => {
    expect(valid).toContain('controller-created.json');
    expect(valid).toContain('device-authorized.json');
    expect(valid).toContain('device-revoked.json');
    expect(valid).toContain('device-rotated.json');
    expect(valid).toContain('capability-granted.json');
    expect(valid).toContain('capability-revoked.json');
    expect(valid).toContain('contact-card-published.json');
  });

  it.each(valid)('valid: %s passes validateIdentityEvent', (name) => {
    const value = readJson(join(FIXTURES_ROOT, 'valid', name));
    expect(() => validateIdentityEvent(value)).not.toThrow();
  });

  it.each(invalid)('invalid: %s is rejected with an IdentityError', (name) => {
    const value = readJson(join(FIXTURES_ROOT, 'invalid', name));
    let thrown: unknown;
    try {
      validateIdentityEvent(value);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(IdentityError);
    expect((thrown as IdentityError).code).toMatch(/^IDENTITY_/);
  });
});

// ---------------------------------------------------------------------------
// Projection lifecycle for the two new kinds
// ---------------------------------------------------------------------------

const CONTROLLER_KEYPAIR = signingKeypairFromSeed(new Uint8Array(32).fill(7));
const SECONDARY_KEYPAIR = signingKeypairFromSeed(new Uint8Array(32).fill(11));

function signed(input: {
  eventId: string;
  kind: ValidatedIdentityEvent['kind'];
  payload: Record<string, unknown>;
  createdAt?: string;
  keypair?: typeof CONTROLLER_KEYPAIR;
}): ReturnType<typeof signEventEnvelope> {
  const keypair = input.keypair ?? CONTROLLER_KEYPAIR;
  return signEventEnvelope(
    createUnsignedEvent({
      eventId: input.eventId,
      kind: input.kind,
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: input.createdAt ?? '2026-06-02T00:00:00.000Z',
      privacy: 'self',
      payload: input.payload
    }),
    keypair
  );
}

describe('Phase 2.1 — identity.device.rotated projection', () => {
  function bootstrap(): ReturnType<typeof createEmptyIdentityControlState> {
    let state = createEmptyIdentityControlState();
    state = applyIdentityControlEvent(
      state,
      signed({
        eventId: 'evt_ctl_1',
        kind: 'identity.controller.created',
        payload: {
          controllerPublicKey: CONTROLLER_KEYPAIR.publicKey,
          initialDeviceId: 'device:alice-phone'
        }
      })
    );
    return state;
  }

  it('rotates the public key for the same deviceId', () => {
    let state = bootstrap();
    state = applyIdentityControlEvent(
      state,
      signed({
        eventId: 'evt_rot_1',
        kind: 'identity.device.rotated',
        payload: {
          deviceId: 'device:alice-phone',
          previousPublicKey: CONTROLLER_KEYPAIR.publicKey,
          newPublicKey: SECONDARY_KEYPAIR.publicKey,
          epoch: 2
        }
      })
    );
    expect(state.devices['device:alice-phone']?.publicKey).toBe(
      SECONDARY_KEYPAIR.publicKey
    );
    expect(state.devices['device:alice-phone']?.status).toBe('active');
    expect(state.epoch).toBe(2);
  });

  it('rejects rotation of an unknown device', () => {
    const state = bootstrap();
    expect(() =>
      applyIdentityControlEvent(
        state,
        signed({
          eventId: 'evt_rot_2',
          kind: 'identity.device.rotated',
          payload: {
            deviceId: 'device:not-there',
            previousPublicKey: CONTROLLER_KEYPAIR.publicKey,
            newPublicKey: SECONDARY_KEYPAIR.publicKey,
            epoch: 2
          }
        })
      )
    ).toThrow(/IDENTITY_DEVICE_NOT_FOUND/);
  });

  it('rejects rotation when previousPublicKey does not match the stored key', () => {
    const state = bootstrap();
    expect(() =>
      applyIdentityControlEvent(
        state,
        signed({
          eventId: 'evt_rot_3',
          kind: 'identity.device.rotated',
          payload: {
            deviceId: 'device:alice-phone',
            previousPublicKey: 'Ed25519_NOT_THE_STORED_KEY_AAAAAAAAAAAAAA',
            newPublicKey: SECONDARY_KEYPAIR.publicKey,
            epoch: 2
          }
        })
      )
    ).toThrow(/IDENTITY_AUTHORITY_MISMATCH/);
  });

  it('rejects rotation of a revoked device', () => {
    let state = bootstrap();
    state = applyIdentityControlEvent(
      state,
      signed({
        eventId: 'evt_rev_1',
        kind: 'identity.device.revoked',
        payload: { revokedDeviceId: 'device:alice-phone', epoch: 2 }
      })
    );
    expect(() =>
      applyIdentityControlEvent(
        state,
        signed({
          eventId: 'evt_rot_4',
          kind: 'identity.device.rotated',
          payload: {
            deviceId: 'device:alice-phone',
            previousPublicKey: CONTROLLER_KEYPAIR.publicKey,
            newPublicKey: SECONDARY_KEYPAIR.publicKey,
            epoch: 3
          }
        })
      )
    ).toThrow(/IDENTITY_LIFECYCLE_TRANSITION/);
  });

  it('rejects rotation with non-monotonic epoch', () => {
    let state = bootstrap();
    state = applyIdentityControlEvent(
      state,
      signed({
        eventId: 'evt_a',
        kind: 'identity.device.authorized',
        payload: {
          authorizedDeviceId: 'device:alice-laptop',
          authorizedPublicKey: SECONDARY_KEYPAIR.publicKey,
          epoch: 5
        }
      })
    );
    expect(() =>
      applyIdentityControlEvent(
        state,
        signed({
          eventId: 'evt_rot_old',
          kind: 'identity.device.rotated',
          payload: {
            deviceId: 'device:alice-phone',
            previousPublicKey: CONTROLLER_KEYPAIR.publicKey,
            newPublicKey: SECONDARY_KEYPAIR.publicKey,
            epoch: 4
          }
        })
      )
    ).toThrow(/IDENTITY_EPOCH_NON_MONOTONIC|epoch must be greater/);
  });
});

describe('Phase 2.1 — identity.contact-card.published projection', () => {
  function bootstrap(): ReturnType<typeof createEmptyIdentityControlState> {
    let state = createEmptyIdentityControlState();
    state = applyIdentityControlEvent(
      state,
      signed({
        eventId: 'evt_ctl_1',
        kind: 'identity.controller.created',
        payload: {
          controllerPublicKey: CONTROLLER_KEYPAIR.publicKey,
          initialDeviceId: 'device:alice-phone'
        }
      })
    );
    return state;
  }

  it('records the most recent publication', () => {
    let state = bootstrap();
    state = applyIdentityControlEvent(
      state,
      signed({
        eventId: 'evt_pub_1',
        kind: 'identity.contact-card.published',
        payload: {
          contactCardDigest:
            'sha-256:AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555FFFF6666GGGG7777HHHH8888',
          capturedAt: '2026-06-02T00:00:00Z'
        }
      })
    );
    expect(state.contactCardPublication?.contactCardDigest).toBe(
      'sha-256:AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555FFFF6666GGGG7777HHHH8888'
    );
    expect(state.contactCardPublication?.capturedAt).toBe('2026-06-02T00:00:00Z');
  });

  it('replaces an earlier publication with a newer one', () => {
    let state = bootstrap();
    state = applyIdentityControlEvent(
      state,
      signed({
        eventId: 'evt_pub_a',
        kind: 'identity.contact-card.published',
        payload: {
          contactCardDigest:
            'sha-256:AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555FFFF6666GGGG7777HHHH8888',
          capturedAt: '2026-06-01T00:00:00Z'
        }
      })
    );
    state = applyIdentityControlEvent(
      state,
      signed({
        eventId: 'evt_pub_b',
        kind: 'identity.contact-card.published',
        payload: {
          contactCardDigest:
            'sha-256:BBBB1111CCCC2222DDDD3333EEEE4444FFFF5555AAAA6666BBBB7777CCCC8888',
          capturedAt: '2026-06-02T00:00:00Z'
        }
      })
    );
    expect(state.contactCardPublication?.contactCardDigest.startsWith('sha-256:BBBB')).toBe(true);
  });

  it('requires the controller signer (a non-controller key is rejected)', () => {
    const state = bootstrap();
    expect(() =>
      applyIdentityControlEvent(
        state,
        signed({
          eventId: 'evt_pub_bad',
          kind: 'identity.contact-card.published',
          payload: {
            contactCardDigest:
              'sha-256:AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555FFFF6666GGGG7777HHHH8888',
            capturedAt: '2026-06-02T00:00:00Z'
          },
          keypair: SECONDARY_KEYPAIR
        })
      )
    ).toThrow(/must be signed by the controller public key/);
  });
});
