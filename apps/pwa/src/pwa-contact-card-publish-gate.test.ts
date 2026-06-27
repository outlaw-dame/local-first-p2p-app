import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { CapabilityProofRecord } from '@lfp2p/capabilities';
import { generateSigningKeypair, signingKeypairFromSeed, signEventEnvelope } from '@lfp2p/crypto';
import { createLocalFirstStore, type DexieLocalFirstStore } from '@lfp2p/local-store';
import { createUnsignedEvent } from '@lfp2p/protocol';
import { identityProjectionUpdate } from './pwa-identity-emit.js';
import { gatedEmitContactCardPublished } from './pwa-contact-card-publish-gate.js';

/* -------------------------------------------------------------------------- */
/*  Shared fixtures                                                            */
/* -------------------------------------------------------------------------- */

const LOCAL_DEVICE_ID = 'device:alice-laptop';
const CONTROLLER_PK = 'Ed25519_Controller_AAAAAAAAAAAAAAAAAAAAAAAA';
const CONTACT_CARD_SCOPE = 'identity.contact-card.publish';
const CONTROLLER_KEYPAIR = signingKeypairFromSeed(new Uint8Array(32).fill(77));
const ACTOR_ID = `identity:${CONTROLLER_KEYPAIR.publicKey}`;

function capabilityProofRecord(
  proofId: string,
  overrides: Partial<CapabilityProofRecord> = {}
): CapabilityProofRecord {
  return {
    proofId,
    scheme: 'identity-control-log',
    issuer: { id: CONTROLLER_PK, kind: 'controller' },
    subject: { id: LOCAL_DEVICE_ID, kind: 'device' },
    issuedAt: '2026-05-25T00:00:00.000Z',
    expiresAt: '2030-01-01T00:00:00.000Z',
    digest: `sha-256:${proofId.padEnd(43, 'A')}`,
    verificationState: 'unverified',
    ...overrides
  };
}

function freshStore(label: string): DexieLocalFirstStore {
  return createLocalFirstStore(`cc-publish-gate-${label}-${globalThis.crypto.randomUUID()}`);
}

async function seedGrantedEvent(
  store: DexieLocalFirstStore,
  eventId: string,
  options: { scope?: string; expiresAt?: string } = {}
): Promise<void> {
  const scope = options.scope ?? CONTACT_CARD_SCOPE;
  const expiresAt = options.expiresAt ?? '2030-01-01T00:00:00.000Z';
  const keypair = generateSigningKeypair();
  const event = signEventEnvelope(
    createUnsignedEvent({
      eventId,
      kind: 'identity.capability.granted',
      author: `identity:${keypair.publicKey}`,
      deviceId: `device:${keypair.publicKey.slice(0, 16)}`,
      createdAt: '2026-05-25T00:00:00.000Z',
      privacy: 'self',
      payload: {
        capabilityId: `cap_${eventId}`,
        delegateDeviceId: LOCAL_DEVICE_ID,
        scope,
        expiresAt
      }
    }),
    keypair
  );
  await store.putSignedEvent(event);
}

/**
 * Seed a `identity.controller.created` event so the projection
 * passes the controller-signer check required before
 * `identity.contact-card.published` can be applied.
 */
async function bootstrapController(store: DexieLocalFirstStore): Promise<void> {
  const ctl = signEventEnvelope(
    createUnsignedEvent({
      eventId: 'evt_cc_gate_ctl',
      kind: 'identity.controller.created',
      author: ACTOR_ID,
      deviceId: LOCAL_DEVICE_ID,
      createdAt: '2026-05-24T00:00:00.000Z',
      privacy: 'self',
      payload: {
        controllerPublicKey: CONTROLLER_KEYPAIR.publicKey,
        initialDeviceId: LOCAL_DEVICE_ID
      }
    }),
    CONTROLLER_KEYPAIR
  );
  await store.appendLocalIdentityEvent(ctl, identityProjectionUpdate);
}

function baseEmitInput(store: DexieLocalFirstStore) {
  return {
    store,
    identityId: ACTOR_ID,
    deviceId: LOCAL_DEVICE_ID,
    controllerKeypair: CONTROLLER_KEYPAIR,
    serializedContactCard: JSON.stringify({
      version: 'lfp2p.contact-card.v1',
      identityId: ACTOR_ID,
      exportedAt: '2026-05-25T00:00:00.000Z'
    })
  };
}

/* -------------------------------------------------------------------------- */
/*  Gate tests                                                                 */
/* -------------------------------------------------------------------------- */

describe('gatedEmitContactCardPublished — capability-proof gate', () => {
  it('denies when the device has NO identity-control-log proof registered (fail-closed)', async () => {
    const store = freshStore('no-proof');
    try {
      const result = await gatedEmitContactCardPublished({
        ...baseEmitInput(store),
        capabilityGate: { localDeviceId: LOCAL_DEVICE_ID }
      });
      expect(result).toMatchObject({ status: 'blocked', reason: 'capability-proof-denied' });
      if (result.status === 'blocked') expect(result.message).toMatch(/no identity-control-log proof registered/i);
    } finally {
      await store.delete();
    }
  });

  it('denies when the registered proof is "unverified" (registry default before verifyProof runs)', async () => {
    const store = freshStore('unverified');
    try {
      await seedGrantedEvent(store, 'evt_cc_unverified');
      await store.putCapabilityProofRecord(capabilityProofRecord('evt_cc_unverified'));
      const result = await gatedEmitContactCardPublished({
        ...baseEmitInput(store),
        capabilityGate: { localDeviceId: LOCAL_DEVICE_ID }
      });
      expect(result).toMatchObject({ status: 'blocked', reason: 'capability-proof-denied' });
      if (result.status === 'blocked') expect(result.message).toMatch(/capability\.unverified-proof/);
    } finally {
      await store.delete();
    }
  });

  it('denies when the proof is revoked (worst-case fold wins)', async () => {
    const store = freshStore('revoked');
    try {
      await seedGrantedEvent(store, 'evt_cc_revoked');
      await store.putCapabilityProofRecord(
        capabilityProofRecord('evt_cc_revoked', {
          revokedAt: '2026-05-26T00:00:00.000Z',
          verificationState: 'revoked'
        })
      );
      const result = await gatedEmitContactCardPublished({
        ...baseEmitInput(store),
        capabilityGate: { localDeviceId: LOCAL_DEVICE_ID }
      });
      expect(result).toMatchObject({ status: 'blocked', reason: 'capability-proof-denied' });
      if (result.status === 'blocked') expect(result.message).toMatch(/capability\.revoked/);
    } finally {
      await store.delete();
    }
  });

  it('emits when the device holds a verified identity-control-log proof with the right scope', async () => {
    const store = freshStore('verified');
    try {
      await bootstrapController(store);
      await seedGrantedEvent(store, 'evt_cc_verified');
      await store.putCapabilityProofRecord(
        capabilityProofRecord('evt_cc_verified', { verificationState: 'verified' })
      );
      const result = await gatedEmitContactCardPublished({
        ...baseEmitInput(store),
        capabilityGate: { localDeviceId: LOCAL_DEVICE_ID, now: '2026-05-25T00:00:00.000Z' }
      });
      expect(result).toMatchObject({ status: 'emitted' });
      if (result.status === 'emitted') {
        expect(result.projection.contactCardPublication).toBeDefined();
      }
    } finally {
      await store.delete();
    }
  });

  it('omitting capabilityGate emits without consulting the registry (back-compat)', async () => {
    // No gate → no registry lookup, no deny. The emit goes through
    // as long as the identity is bootstrapped (no proof required).
    const store = freshStore('opt-out');
    try {
      await bootstrapController(store);
      const result = await gatedEmitContactCardPublished({
        ...baseEmitInput(store)
        // capabilityGate intentionally absent
      });
      expect(result).toMatchObject({ status: 'emitted' });
    } finally {
      await store.delete();
    }
  });

  it('SECURITY: a proof registered for a DIFFERENT device does not unlock this device', async () => {
    const store = freshStore('foreign-device');
    try {
      await store.putCapabilityProofRecord(
        capabilityProofRecord('evt_cc_other_device', {
          subject: { id: 'device:alice-phone', kind: 'device' },
          verificationState: 'verified'
        })
      );
      const result = await gatedEmitContactCardPublished({
        ...baseEmitInput(store),
        capabilityGate: { localDeviceId: LOCAL_DEVICE_ID }
      });
      expect(result).toMatchObject({ status: 'blocked', reason: 'capability-proof-denied' });
      if (result.status === 'blocked') expect(result.message).toMatch(/no identity-control-log proof registered/i);
    } finally {
      await store.delete();
    }
  });

  it('SECURITY (scope binding): denies when the controller granted a DIFFERENT scope (outbox.send)', async () => {
    // A verified controller grant for outbox.send must NOT authorize
    // contact-card publication — the caller must hold a proof that
    // explicitly names identity.contact-card.publish.
    const store = freshStore('scope-mismatch');
    try {
      await seedGrantedEvent(store, 'evt_cc_wrong_scope', { scope: 'outbox.send' });
      await store.putCapabilityProofRecord(
        capabilityProofRecord('evt_cc_wrong_scope', { verificationState: 'verified' })
      );
      const result = await gatedEmitContactCardPublished({
        ...baseEmitInput(store),
        capabilityGate: { localDeviceId: LOCAL_DEVICE_ID }
      });
      expect(result).toMatchObject({ status: 'blocked', reason: 'capability-proof-denied' });
      if (result.status === 'blocked') expect(result.message).toMatch(/identity\.contact-card\.publish/);
    } finally {
      await store.delete();
    }
  });

  it('SECURITY (expiry refresh): denies a verified proof whose expiresAt has lapsed in wall-clock time', async () => {
    const store = freshStore('expired');
    try {
      await seedGrantedEvent(store, 'evt_cc_expired');
      await store.putCapabilityProofRecord(
        capabilityProofRecord('evt_cc_expired', {
          verificationState: 'verified',
          issuedAt: '2024-01-01T00:00:00.000Z',
          expiresAt: '2025-01-01T00:00:00.000Z'
        })
      );
      const result = await gatedEmitContactCardPublished({
        ...baseEmitInput(store),
        capabilityGate: { localDeviceId: LOCAL_DEVICE_ID, now: '2026-05-25T00:00:00.000Z' }
      });
      expect(result).toMatchObject({ status: 'blocked', reason: 'capability-proof-denied' });
      if (result.status === 'blocked') expect(result.message).toMatch(/expired/);
    } finally {
      await store.delete();
    }
  });

  it('SECURITY (shape guard): denies fail-closed when loadProofRegistry returns an invalid shape', async () => {
    const realStore = freshStore('invalid-registry-shape');
    try {
      const brokenStore = new Proxy(realStore, {
        get(target, prop, receiver) {
          if (prop === 'loadProofRegistry') {
            return async () => undefined as never;
          }
          return Reflect.get(target, prop, receiver);
        }
      });
      const result = await gatedEmitContactCardPublished({
        ...baseEmitInput(brokenStore as DexieLocalFirstStore),
        capabilityGate: { localDeviceId: LOCAL_DEVICE_ID }
      });
      expect(result).toMatchObject({ status: 'blocked', reason: 'capability-proof-denied' });
      if (result.status === 'blocked') expect(result.message).toMatch(/invalid shape/i);
    } finally {
      await realStore.delete();
    }
  });
});
