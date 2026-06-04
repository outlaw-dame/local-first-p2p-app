import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { signingKeypairFromSeed } from '@lfp2p/crypto';
import { createLocalFirstStore } from '@lfp2p/local-store';
import {
  contactCardDigestRef,
  emitContactCardPublishedEvent,
  emitDeviceRotatedEvent,
  identityProjectionUpdate
} from './pwa-identity-emit.js';

const CONTROLLER = signingKeypairFromSeed(new Uint8Array(32).fill(41));
const NEW_KEY = signingKeypairFromSeed(new Uint8Array(32).fill(42));
const ACTOR = 'identity:alice';
const DEVICE = 'device:alice-phone';

/**
 * Phase 2.2 — PWA emit-helper tests.
 *
 * Exercises the publication audit path and the rotation helper end
 * to end through the locally-emitted append. These tests guard
 * three things in particular:
 *   1. The digest of the serialized contact card is the
 *      `sha-256:<base64url>` form the protocol validator expects.
 *   2. The store-level append round-trips and the projection's
 *      `contactCardPublication` field is populated.
 *   3. Rotation emits a valid `identity.device.rotated` event that
 *      lands a new `publicKey` on the projection.
 */

async function bootstrap(): Promise<{
  store: ReturnType<typeof createLocalFirstStore>;
  cleanup: () => Promise<void>;
}> {
  const store = createLocalFirstStore(`pwa-emit-${globalThis.crypto.randomUUID()}`);
  // Seed the controller so a subsequent contact-card / rotation
  // event passes the projection's controller-signer check.
  const { signEventEnvelope } = await import('@lfp2p/crypto');
  const { createUnsignedEvent } = await import('@lfp2p/protocol');
  const ctl = signEventEnvelope(
    createUnsignedEvent({
      eventId: 'evt_emit_ctl',
      kind: 'identity.controller.created',
      author: ACTOR,
      deviceId: DEVICE,
      createdAt: '2026-06-03T00:00:00.000Z',
      privacy: 'self',
      payload: {
        controllerPublicKey: CONTROLLER.publicKey,
        initialDeviceId: DEVICE
      }
    }),
    CONTROLLER
  );
  await store.appendLocalIdentityEvent(ctl, identityProjectionUpdate);
  return {
    store,
    cleanup: async () => {
      await store.delete();
    }
  };
}

describe('Phase 2.2 — contactCardDigestRef', () => {
  it('returns a sha-256:<base64url> form matching the validator pattern', async () => {
    const ref = await contactCardDigestRef('hello world');
    expect(ref).toMatch(/^sha-256:[A-Za-z0-9_-]+$/);
  });

  it('is deterministic per input', async () => {
    expect(await contactCardDigestRef('abc')).toBe(await contactCardDigestRef('abc'));
  });

  it('differs for different inputs', async () => {
    expect(await contactCardDigestRef('a')).not.toEqual(
      await contactCardDigestRef('b')
    );
  });
});

describe('Phase 2.2 — emitContactCardPublishedEvent', () => {
  it('round-trips the publication onto the projection snapshot', async () => {
    const { store, cleanup } = await bootstrap();
    try {
      const serialized = '{"contactCard":"example payload"}';
      const result = await emitContactCardPublishedEvent({
        store,
        identityId: ACTOR,
        deviceId: DEVICE,
        controllerKeypair: CONTROLLER,
        serializedContactCard: serialized,
        capturedAt: '2026-06-03T00:01:00.000Z',
        eventId: 'evt_emit_cc_1'
      });
      const expectedDigest = await contactCardDigestRef(serialized);
      expect(result.contactCardPublication?.contactCardDigest).toBe(expectedDigest);
      expect(result.contactCardPublication?.capturedAt).toBe(
        '2026-06-03T00:01:00.000Z'
      );
      // Confirm the signed event landed.
      await expect(store.getSignedEvent('evt_emit_cc_1')).resolves.toBeDefined();
    } finally {
      await cleanup();
    }
  });

  it('rejects an empty serialized card', async () => {
    const { store, cleanup } = await bootstrap();
    try {
      await expect(
        emitContactCardPublishedEvent({
          store,
          identityId: ACTOR,
          deviceId: DEVICE,
          controllerKeypair: CONTROLLER,
          serializedContactCard: ''
        })
      ).rejects.toThrow(/serializedContactCard is empty/);
    } finally {
      await cleanup();
    }
  });

  it('is idempotent on a re-emit of the same eventId', async () => {
    const { store, cleanup } = await bootstrap();
    try {
      const args = {
        store,
        identityId: ACTOR,
        deviceId: DEVICE,
        controllerKeypair: CONTROLLER,
        serializedContactCard: 'card body',
        capturedAt: '2026-06-03T00:01:00.000Z',
        eventId: 'evt_emit_cc_dup'
      } as const;
      const first = await emitContactCardPublishedEvent(args);
      const second = await emitContactCardPublishedEvent(args);
      expect(second).toEqual(first);
    } finally {
      await cleanup();
    }
  });
});

describe('Phase 2.2 — emitDeviceRotatedEvent', () => {
  it('rotates the public key on the projection and bumps the epoch', async () => {
    const { store, cleanup } = await bootstrap();
    try {
      const result = await emitDeviceRotatedEvent({
        store,
        identityId: ACTOR,
        deviceIdToRotate: DEVICE,
        previousPublicKey: CONTROLLER.publicKey,
        newPublicKey: NEW_KEY.publicKey,
        epoch: 1,
        controllerKeypair: CONTROLLER,
        signingDeviceId: DEVICE,
        eventId: 'evt_emit_rot_1',
        createdAt: '2026-06-03T00:01:00.000Z'
      });
      expect(result.devices[DEVICE]?.publicKey).toBe(NEW_KEY.publicKey);
      expect(result.epoch).toBe(1);
    } finally {
      await cleanup();
    }
  });

  it('rejects a stale-epoch rotation via the projection lifecycle check', async () => {
    const { store, cleanup } = await bootstrap();
    try {
      // Bump the epoch by an authorized rotate first.
      await emitDeviceRotatedEvent({
        store,
        identityId: ACTOR,
        deviceIdToRotate: DEVICE,
        previousPublicKey: CONTROLLER.publicKey,
        newPublicKey: NEW_KEY.publicKey,
        epoch: 2,
        controllerKeypair: CONTROLLER,
        signingDeviceId: DEVICE,
        eventId: 'evt_emit_rot_2',
        createdAt: '2026-06-03T00:01:00.000Z'
      });
      // Now a stale-epoch rotate must be rejected.
      await expect(
        emitDeviceRotatedEvent({
          store,
          identityId: ACTOR,
          deviceIdToRotate: DEVICE,
          previousPublicKey: NEW_KEY.publicKey,
          newPublicKey: CONTROLLER.publicKey,
          epoch: 2, // not greater than 2
          controllerKeypair: CONTROLLER,
          signingDeviceId: DEVICE,
          eventId: 'evt_emit_rot_stale',
          createdAt: '2026-06-03T00:02:00.000Z'
        })
      ).rejects.toThrow();
    } finally {
      await cleanup();
    }
  });
});
