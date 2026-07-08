import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { signingKeypairFromSeed, type SigningKeypair } from '@lfp2p/crypto';
import type { LocalDeviceSession } from '@lfp2p/identity';
import { createLocalFirstStore } from '@lfp2p/local-store';
import { createUnsignedEvent } from '@lfp2p/protocol';
import { signEventEnvelope } from '@lfp2p/crypto';
import { identityProjectionUpdate } from './pwa-identity-emit.js';
import { ensurePwaLocalWrapMetadataPublished } from './pwa-wrap-metadata-bootstrap.js';

const ACTOR = 'identity:alice';
const DEVICE = 'device:alice-phone';
const CONTROLLER = signingKeypairFromSeed(new Uint8Array(32).fill(51));
const OTHER_CONTROLLER = signingKeypairFromSeed(new Uint8Array(32).fill(52));
const WRAP_PUBLIC_KEY = 'A'.repeat(43);
const WRAP_PRIVATE_KEY = 'B'.repeat(43);
const WRAP_KEY_REF = 'wrap-key:device:alice-phone:bootstrap';
const CREATED_AT = '2026-07-08T12:00:00.000Z';

let dbSeq = 0;

function store() {
  dbSeq += 1;
  return createLocalFirstStore(
    `pwa-wrap-bootstrap-${dbSeq}-${globalThis.crypto.randomUUID()}`
  );
}

function localSession(keypair: SigningKeypair = CONTROLLER): LocalDeviceSession {
  return {
    identity: {
      identityId: ACTOR,
      deviceId: DEVICE,
      publicKey: keypair.publicKey,
      createdAt: CREATED_AT
    },
    keypair,
    wrap: {
      keyRef: WRAP_KEY_REF,
      keypair: {
        publicKey: WRAP_PUBLIC_KEY,
        privateKey: WRAP_PRIVATE_KEY
      }
    }
  };
}

async function seedControllerProjection(
  testStore: ReturnType<typeof createLocalFirstStore>,
  keypair: SigningKeypair = CONTROLLER
) {
  const event = signEventEnvelope(
    createUnsignedEvent({
      eventId: `evt_controller_${globalThis.crypto.randomUUID()}`,
      kind: 'identity.controller.created',
      author: ACTOR,
      deviceId: DEVICE,
      createdAt: CREATED_AT,
      privacy: 'self',
      payload: {
        controllerPublicKey: keypair.publicKey,
        initialDeviceId: DEVICE
      }
    }),
    keypair
  );
  return testStore.appendLocalIdentityEvent(event, identityProjectionUpdate);
}

describe('ensurePwaLocalWrapMetadataPublished', () => {
  it('defers until the identity projection is controller-known', async () => {
    const testStore = store();
    try {
      const result = await ensurePwaLocalWrapMetadataPublished({
        store: testStore,
        session: localSession(),
        projection: undefined
      });

      expect(result.status).toBe('not-ready');
      expect(result.projection).toBeUndefined();
      expect(await testStore.getIdentityControlProjection(ACTOR)).toBeUndefined();
    } finally {
      await testStore.delete();
    }
  });

  it('publishes missing local device wrap metadata once projection is ready', async () => {
    const testStore = store();
    try {
      const projection = await seedControllerProjection(testStore);
      expect(projection.devices[DEVICE]?.wrapPublicKey).toBeUndefined();

      const result = await ensurePwaLocalWrapMetadataPublished({
        store: testStore,
        session: localSession(),
        projection
      });

      expect(result.status).toBe('published');
      expect(result.projection?.devices[DEVICE]).toMatchObject({
        deviceId: DEVICE,
        publicKey: CONTROLLER.publicKey,
        status: 'active',
        wrapPublicKey: WRAP_PUBLIC_KEY,
        wrapKeyRef: WRAP_KEY_REF
      });
    } finally {
      await testStore.delete();
    }
  });

  it('does not emit another event when metadata is already current', async () => {
    const testStore = store();
    try {
      const projection = await seedControllerProjection(testStore);
      const first = await ensurePwaLocalWrapMetadataPublished({
        store: testStore,
        session: localSession(),
        projection
      });
      const second = await ensurePwaLocalWrapMetadataPublished({
        store: testStore,
        session: localSession(),
        projection: first.projection
      });

      expect(first.status).toBe('published');
      expect(second.status).toBe('already-published');
      expect(second.projection?.epoch).toBe(first.projection?.epoch);
    } finally {
      await testStore.delete();
    }
  });

  it('surfaces publication failures without throwing or widening trust', async () => {
    const testStore = store();
    try {
      const projection = await seedControllerProjection(testStore, OTHER_CONTROLLER);
      const result = await ensurePwaLocalWrapMetadataPublished({
        store: testStore,
        session: localSession(),
        projection
      });

      expect(result.status).toBe('failed');
      expect(result.projection).toBe(projection);
      expect(result.message).toMatch(/controllerKeypair does not match/);
      expect(result.projection?.devices[DEVICE]?.wrapPublicKey).toBeUndefined();
    } finally {
      await testStore.delete();
    }
  });
});
