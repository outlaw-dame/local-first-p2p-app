import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { CapabilityProofRecord } from '@lfp2p/capabilities';
import { generateSigningKeypair, signEventEnvelope } from '@lfp2p/crypto';
import {
  createLocalFirstStore,
  type DexieLocalFirstStore,
  type MutationOutboxEntry
} from '@lfp2p/local-store';
import { createUnsignedEvent, placeholderPrivatePayloadEnvelope } from '@lfp2p/protocol';
import type { OutboxTransport } from '@lfp2p/sync-client';
import {
  manualOutboxDeliveryActionEnabled,
  runManualOutboxDelivery
} from './pwa-outbox-manual-gate.js';
import { createPwaSendBudget } from './pwa-send-budget.js';

const DEV_ENV = { DEV: true } as const;
const MANUAL_ENABLED_ENV = {
  ...DEV_ENV,
  VITE_LFP2P_MANUAL_OUTBOX_DELIVERY_ENABLED: 'true'
} as const;
const BRIDGE_ENABLED_ENV = {
  VITE_LFP2P_BRIDGE_SYNC_ENABLED: 'true',
  VITE_LFP2P_BRIDGE_ENDPOINT: 'https://bridge.example.test/events'
} as const;

describe('manualOutboxDeliveryActionEnabled', () => {
  it('requires true DEV and the explicit flag', () => {
    expect(manualOutboxDeliveryActionEnabled({ ...MANUAL_ENABLED_ENV })).toBe(true);
    expect(
      manualOutboxDeliveryActionEnabled({
        MODE: 'development',
        VITE_LFP2P_MANUAL_OUTBOX_DELIVERY_ENABLED: 'true'
      })
    ).toBe(false);
    expect(
      manualOutboxDeliveryActionEnabled({
        DEV: false,
        VITE_LFP2P_MANUAL_OUTBOX_DELIVERY_ENABLED: 'true'
      })
    ).toBe(false);
    expect(manualOutboxDeliveryActionEnabled(DEV_ENV)).toBe(false);
  });
});

describe('runManualOutboxDelivery', () => {
  it('is unavailable outside dev mode', async () => {
    let factoryCalls = 0;
    const result = await runManualOutboxDelivery({
      store: fakeStore(),
      env: { MODE: 'development', VITE_LFP2P_MANUAL_OUTBOX_DELIVERY_ENABLED: 'true' },
      createTransport: () => {
        factoryCalls += 1;
        throw new Error('unexpected factory call');
      }
    });

    expect(result).toMatchObject({ status: 'disabled', reason: 'not-dev-mode' });
    expect(factoryCalls).toBe(0);
  });

  it('is off by default in dev mode', async () => {
    let factoryCalls = 0;
    const result = await runManualOutboxDelivery({
      store: fakeStore(),
      env: DEV_ENV,
      createTransport: () => {
        factoryCalls += 1;
        throw new Error('unexpected factory call');
      }
    });

    expect(result).toMatchObject({ status: 'disabled', reason: 'manual-delivery-disabled' });
    expect(factoryCalls).toBe(0);
  });

  it('blocks unavailable bridge states using the resolved env', async () => {
    const disabledBridge = await runManualOutboxDelivery({
      store: fakeStore(),
      env: MANUAL_ENABLED_ENV
    });
    const invalidBridge = await runManualOutboxDelivery({
      store: fakeStore(),
      env: { ...MANUAL_ENABLED_ENV, VITE_LFP2P_BRIDGE_SYNC_ENABLED: 'true' }
    });
    const missingFetch = await runManualOutboxDelivery({
      store: fakeStore(),
      env: { ...MANUAL_ENABLED_ENV, ...BRIDGE_ENABLED_ENV },
      fetch: null
    });

    expect(disabledBridge).toMatchObject({ status: 'blocked', reason: 'bridge-config-disabled' });
    expect(invalidBridge).toMatchObject({ status: 'blocked', reason: 'bridge-config-invalid' });
    expect(missingFetch).toMatchObject({ status: 'blocked', reason: 'fetch-unavailable' });
  });

  it('blocks manual delivery explicitly while offline', async () => {
    const result = await runManualOutboxDelivery({
      store: fakeStore(),
      env: { ...MANUAL_ENABLED_ENV, ...BRIDGE_ENABLED_ENV },
      onlineSource: { navigator: { onLine: false } }
    });

    expect(result).toMatchObject({ status: 'blocked', reason: 'offline' });
  });

  it('blocks manual delivery when identity authorization denies the action', async () => {
    const result = await runManualOutboxDelivery({
      store: fakeStore(),
      env: { ...MANUAL_ENABLED_ENV, ...BRIDGE_ENABLED_ENV },
      authorization: {
        authorized: false,
        reason: 'Current device is not authorized for sync:outbox.'
      }
    });

    expect(result).toMatchObject({ status: 'blocked', reason: 'identity-authorization-denied' });
    expect(result.message).toMatch(/not authorized for sync:outbox/i);
  });

  it('rejects unsafe batch sizes', async () => {
    await expect(
      runManualOutboxDelivery({ store: fakeStore(), env: MANUAL_ENABLED_ENV, batchSize: 0 })
    ).rejects.toThrow(
      'manual outbox delivery batchSize must be a positive safe integer no greater than 5.'
    );
    await expect(
      runManualOutboxDelivery({ store: fakeStore(), env: MANUAL_ENABLED_ENV, batchSize: 6 })
    ).rejects.toThrow(
      'manual outbox delivery batchSize must be a positive safe integer no greater than 5.'
    );
  });

  it('runs one explicit enabled batch', async () => {
    const store = createLocalFirstStore(`manual-outbox-delivery-${globalThis.crypto.randomUUID()}`);
    try {
      const entry = await seedOutboxEntry(store, 'evt_manual_outbox_delivery');
      const sent: string[] = [];
      const transport: OutboxTransport = {
        async send(input) {
          sent.push(input.entry.idempotencyKey);
          expect(input.event.eventId).toBe('evt_manual_outbox_delivery');
          return { status: 'confirmed', sequence: 1 };
        }
      };

      const result = await runManualOutboxDelivery({
        store,
        env: { ...MANUAL_ENABLED_ENV, ...BRIDGE_ENABLED_ENV },
        createTransport: () => transport,
        now: new Date('2026-05-25T00:00:00.000Z'),
        batchSize: 1,
        sendBudget: createPwaSendBudget({ minIntervalMs: 0 })
      });

      expect(result).toMatchObject({ status: 'delivered', batchSize: 1 });
      if (result.status !== 'delivered') throw new Error('Expected delivered result');
      expect(result.result).toEqual({
        attempted: 1,
        confirmed: 1,
        conflicted: 0,
        retried: 0,
        failed: 0,
        skipped: 0
      });
      expect(sent).toEqual([entry.idempotencyKey]);
      expect((await store.getOutboxEntry(entry.idempotencyKey))?.status).toBe('confirmed');
    } finally {
      await store.delete();
    }
  });

  it('refunds send budget reservations when no outbox attempts are made', async () => {
    const store = createLocalFirstStore(
      `manual-outbox-delivery-refund-${globalThis.crypto.randomUUID()}`
    );
    const sendBudget = createPwaSendBudget({ maxRuns: 1, maxEntries: 1, minIntervalMs: 0 });

    try {
      const first = await runManualOutboxDelivery({
        store,
        env: { ...MANUAL_ENABLED_ENV, ...BRIDGE_ENABLED_ENV },
        createTransport: () => ({
          async send() {
            throw new Error('unexpected send call');
          }
        }),
        now: new Date('2026-05-25T00:00:00.000Z'),
        batchSize: 1,
        sendBudget
      });

      expect(first).toMatchObject({ status: 'delivered', batchSize: 1 });
      if (first.status !== 'delivered') throw new Error('Expected delivered result');
      expect(first.result).toEqual({
        attempted: 0,
        confirmed: 0,
        conflicted: 0,
        retried: 0,
        failed: 0,
        skipped: 0
      });

      const second = await runManualOutboxDelivery({
        store,
        env: { ...MANUAL_ENABLED_ENV, ...BRIDGE_ENABLED_ENV },
        createTransport: () => ({
          async send() {
            throw new Error('unexpected send call');
          }
        }),
        now: new Date('2026-05-25T00:00:00.100Z'),
        batchSize: 1,
        sendBudget
      });

      expect(second).toMatchObject({ status: 'delivered', batchSize: 1 });
      if (second.status !== 'delivered') throw new Error('Expected delivered result');
      expect(second.result).toEqual({
        attempted: 0,
        confirmed: 0,
        conflicted: 0,
        retried: 0,
        failed: 0,
        skipped: 0
      });
    } finally {
      await store.delete();
    }
  });
});

function fakeStore(): DexieLocalFirstStore {
  return {} as DexieLocalFirstStore;
}

/* -------------------------------------------------------------------------- */
/*       capability-gate enforcement (first production enforcement consumer)  */
/* -------------------------------------------------------------------------- */

const LOCAL_DEVICE_ID = 'device:alice-laptop';
const CONTROLLER_PK = 'Ed25519_Controller_AAAAAAAAAAAAAAAAAAAAAAAA';

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
  return createLocalFirstStore(`manual-outbox-cap-gate-${label}-${globalThis.crypto.randomUUID()}`);
}

const OUTBOX_SCOPE = 'outbox.send';

async function seedGrantedEvent(
  store: DexieLocalFirstStore,
  eventId: string,
  options: { scope?: string; expiresAt?: string } = {}
): Promise<void> {
  const scope = options.scope ?? OUTBOX_SCOPE;
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

describe('runManualOutboxDelivery — capability-proof gate (first enforcement consumer)', () => {
  it('denies when the device has NO identity-control-log proof registered (fail-closed)', async () => {
    const store = freshStore('no-proof');
    try {
      const result = await runManualOutboxDelivery({
        store,
        env: { ...MANUAL_ENABLED_ENV, ...BRIDGE_ENABLED_ENV },
        createTransport: () => ({
          async send() {
            throw new Error('unexpected send call — gate should have blocked');
          }
        }),
        sendBudget: createPwaSendBudget({ minIntervalMs: 0 }),
        capabilityGate: { localDeviceId: LOCAL_DEVICE_ID }
      });
      expect(result).toMatchObject({ status: 'blocked', reason: 'capability-proof-denied' });
      expect(result.message).toMatch(/no identity-control-log proof registered/i);
    } finally {
      await store.delete();
    }
  });

  it('denies when the registered proof is "unverified" (registry default before verifyProof runs)', async () => {
    const store = freshStore('unverified');
    try {
      await seedGrantedEvent(store, 'evt_grant_unverified');
      await store.putCapabilityProofRecord(capabilityProofRecord('evt_grant_unverified'));
      const result = await runManualOutboxDelivery({
        store,
        env: { ...MANUAL_ENABLED_ENV, ...BRIDGE_ENABLED_ENV },
        createTransport: () => ({
          async send() {
            throw new Error('unexpected send call — gate should have blocked');
          }
        }),
        sendBudget: createPwaSendBudget({ minIntervalMs: 0 }),
        capabilityGate: { localDeviceId: LOCAL_DEVICE_ID }
      });
      expect(result).toMatchObject({ status: 'blocked', reason: 'capability-proof-denied' });
      expect(result.message).toMatch(/capability\.unverified-proof/);
    } finally {
      await store.delete();
    }
  });

  it('denies when the proof is revoked (worst-case fold wins)', async () => {
    const store = freshStore('revoked');
    try {
      await seedGrantedEvent(store, 'evt_grant_revoked');
      await store.putCapabilityProofRecord(
        capabilityProofRecord('evt_grant_revoked', {
          revokedAt: '2026-05-26T00:00:00.000Z',
          verificationState: 'revoked'
        })
      );
      const result = await runManualOutboxDelivery({
        store,
        env: { ...MANUAL_ENABLED_ENV, ...BRIDGE_ENABLED_ENV },
        createTransport: () => ({
          async send() {
            throw new Error('unexpected send call — revoked proof must not deliver');
          }
        }),
        sendBudget: createPwaSendBudget({ minIntervalMs: 0 }),
        capabilityGate: { localDeviceId: LOCAL_DEVICE_ID }
      });
      expect(result).toMatchObject({ status: 'blocked', reason: 'capability-proof-denied' });
      expect(result.message).toMatch(/capability\.revoked/);
    } finally {
      await store.delete();
    }
  });

  it('allows delivery when the device holds a verified identity-control-log proof', async () => {
    const store = freshStore('verified');
    try {
      const entry = await seedOutboxEntry(store, 'evt_outbox_capgated_ok');
      await seedGrantedEvent(store, 'evt_grant_verified');
      await store.putCapabilityProofRecord(
        capabilityProofRecord('evt_grant_verified', { verificationState: 'verified' })
      );
      const sent: string[] = [];
      const transport: OutboxTransport = {
        async send(input) {
          sent.push(input.entry.idempotencyKey);
          return { status: 'confirmed', sequence: 1 };
        }
      };
      const result = await runManualOutboxDelivery({
        store,
        env: { ...MANUAL_ENABLED_ENV, ...BRIDGE_ENABLED_ENV },
        createTransport: () => transport,
        now: new Date('2026-05-25T00:00:00.000Z'),
        batchSize: 1,
        sendBudget: createPwaSendBudget({ minIntervalMs: 0 }),
        capabilityGate: { localDeviceId: LOCAL_DEVICE_ID }
      });
      expect(result).toMatchObject({ status: 'delivered', batchSize: 1 });
      expect(sent).toEqual([entry.idempotencyKey]);
    } finally {
      await store.delete();
    }
  });

  it('omitting capabilityGate preserves pre-enforcement behaviour exactly', async () => {
    // No gate supplied → no registry lookup, no deny. Identical to
    // every existing test that ran before this PR landed.
    const store = freshStore('opt-out');
    try {
      const entry = await seedOutboxEntry(store, 'evt_outbox_opt_out');
      const transport: OutboxTransport = {
        async send() {
          return { status: 'confirmed', sequence: 1 };
        }
      };
      const result = await runManualOutboxDelivery({
        store,
        env: { ...MANUAL_ENABLED_ENV, ...BRIDGE_ENABLED_ENV },
        createTransport: () => transport,
        now: new Date('2026-05-25T00:00:00.000Z'),
        batchSize: 1,
        sendBudget: createPwaSendBudget({ minIntervalMs: 0 })
      });
      expect(result).toMatchObject({ status: 'delivered', batchSize: 1 });
      expect((await store.getOutboxEntry(entry.idempotencyKey))?.status).toBe('confirmed');
    } finally {
      await store.delete();
    }
  });

  it('SECURITY: a proof registered for a DIFFERENT device does not unlock this device', async () => {
    // The registry has a fully-verified record, but its subject.id
    // belongs to another device. The gate must NOT borrow that
    // verdict to unlock the current device's send.
    const store = freshStore('foreign-device');
    try {
      await store.putCapabilityProofRecord(
        capabilityProofRecord('evt_grant_other_device', {
          subject: { id: 'device:alice-phone', kind: 'device' },
          verificationState: 'verified'
        })
      );
      const result = await runManualOutboxDelivery({
        store,
        env: { ...MANUAL_ENABLED_ENV, ...BRIDGE_ENABLED_ENV },
        createTransport: () => ({
          async send() {
            throw new Error('unexpected send call — foreign-device proof must not authorize');
          }
        }),
        sendBudget: createPwaSendBudget({ minIntervalMs: 0 }),
        capabilityGate: { localDeviceId: LOCAL_DEVICE_ID }
      });
      expect(result).toMatchObject({ status: 'blocked', reason: 'capability-proof-denied' });
      expect(result.message).toMatch(/no identity-control-log proof registered/i);
    } finally {
      await store.delete();
    }
  });

  it('SECURITY (codex #101): denies when the controller granted a DIFFERENT scope', async () => {
    // The device has a verified controller grant — but its scope is
    // for contact-card publication, not outbox.send. A verified
    // proof must NOT authorize an action the controller did not
    // explicitly grant.
    const store = freshStore('scope-mismatch');
    try {
      await seedGrantedEvent(store, 'evt_grant_wrong_scope', {
        scope: 'identity.contact-card.publish'
      });
      await store.putCapabilityProofRecord(
        capabilityProofRecord('evt_grant_wrong_scope', { verificationState: 'verified' })
      );
      const result = await runManualOutboxDelivery({
        store,
        env: { ...MANUAL_ENABLED_ENV, ...BRIDGE_ENABLED_ENV },
        createTransport: () => ({
          async send() {
            throw new Error('unexpected send call — wrong-scope grant must not authorize');
          }
        }),
        sendBudget: createPwaSendBudget({ minIntervalMs: 0 }),
        capabilityGate: { localDeviceId: LOCAL_DEVICE_ID }
      });
      expect(result).toMatchObject({ status: 'blocked', reason: 'capability-proof-denied' });
      expect(result.message).toMatch(/scope outbox\.send/);
    } finally {
      await store.delete();
    }
  });

  it('SECURITY (codex #101): denies a verified proof whose expiresAt has lapsed in wall-clock time', async () => {
    // summarizeProofStates does NOT compare expiresAt to now — a
    // stale cached "verified" state would fold through. The gate's
    // inline expiry filter must drop it.
    const store = freshStore('expired');
    try {
      await seedGrantedEvent(store, 'evt_grant_expired');
      await store.putCapabilityProofRecord(
        capabilityProofRecord('evt_grant_expired', {
          verificationState: 'verified',
          // issuedAt MUST be before expiresAt per the registry's
          // cross-field invariant.
          issuedAt: '2024-01-01T00:00:00.000Z',
          expiresAt: '2025-01-01T00:00:00.000Z'
        })
      );
      const result = await runManualOutboxDelivery({
        store,
        env: { ...MANUAL_ENABLED_ENV, ...BRIDGE_ENABLED_ENV },
        createTransport: () => ({
          async send() {
            throw new Error('unexpected send call — expired proof must not authorize');
          }
        }),
        sendBudget: createPwaSendBudget({ minIntervalMs: 0 }),
        capabilityGate: { localDeviceId: LOCAL_DEVICE_ID, now: '2026-05-25T00:00:00.000Z' }
      });
      expect(result).toMatchObject({ status: 'blocked', reason: 'capability-proof-denied' });
      expect(result.message).toMatch(/expired/);
    } finally {
      await store.delete();
    }
  });

  it('SECURITY (gemini #101): denies fail-closed when loadProofRegistry returns an invalid shape', async () => {
    // Defense-in-depth regression: if a future bug returns a
    // malformed registry (here: `undefined`), the gate must
    // surface a deny rather than propagate a TypeError out of
    // the dispatcher as an unhandled rejection.
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
      const result = await runManualOutboxDelivery({
        store: brokenStore as DexieLocalFirstStore,
        env: { ...MANUAL_ENABLED_ENV, ...BRIDGE_ENABLED_ENV },
        createTransport: () => ({
          async send() {
            throw new Error('unexpected send call — fail-closed must deny');
          }
        }),
        sendBudget: createPwaSendBudget({ minIntervalMs: 0 }),
        capabilityGate: { localDeviceId: LOCAL_DEVICE_ID }
      });
      expect(result).toMatchObject({ status: 'blocked', reason: 'capability-proof-denied' });
      expect(result.message).toMatch(/invalid shape/i);
    } finally {
      await realStore.delete();
    }
  });

  it('refunds the send budget on capability-proof denial (no spurious budget burn)', async () => {
    // The budget reservation runs BEFORE the cap gate; a denial
    // must refund it so the user can retry after granting the
    // capability without waiting out the budget interval.
    const store = freshStore('budget-refund');
    const sendBudget = createPwaSendBudget({ maxRuns: 1, maxEntries: 1, minIntervalMs: 0 });
    try {
      const first = await runManualOutboxDelivery({
        store,
        env: { ...MANUAL_ENABLED_ENV, ...BRIDGE_ENABLED_ENV },
        createTransport: () => ({
          async send() {
            throw new Error('unexpected send call');
          }
        }),
        sendBudget,
        capabilityGate: { localDeviceId: LOCAL_DEVICE_ID }
      });
      expect(first).toMatchObject({ status: 'blocked', reason: 'capability-proof-denied' });

      // Second attempt should NOT be blocked by the send budget —
      // the first attempt's reservation must have been refunded.
      const second = await runManualOutboxDelivery({
        store,
        env: { ...MANUAL_ENABLED_ENV, ...BRIDGE_ENABLED_ENV },
        createTransport: () => ({
          async send() {
            throw new Error('unexpected send call');
          }
        }),
        sendBudget,
        capabilityGate: { localDeviceId: LOCAL_DEVICE_ID }
      });
      expect(second).toMatchObject({ status: 'blocked', reason: 'capability-proof-denied' });
      // If the budget had NOT been refunded, the second attempt
      // would have surfaced reason: 'send-budget-paused'.
    } finally {
      await store.delete();
    }
  });
});

async function seedOutboxEntry(
  store: DexieLocalFirstStore,
  eventId: string
): Promise<MutationOutboxEntry> {
  const event = makeSignedEvent(eventId);
  await store.putSignedEvent(event);
  const now = '2026-05-25T00:00:00.000Z';
  const entry: MutationOutboxEntry = {
    idempotencyKey: `idem_${eventId}`,
    eventId,
    target: 'bridge:development',
    status: 'pending',
    retryCount: 0,
    nextRetryAt: now,
    createdAt: now,
    updatedAt: now
  };
  await store.enqueueOutbox(entry);
  return entry;
}

function makeSignedEvent(eventId: string) {
  const keypair = generateSigningKeypair();
  return signEventEnvelope(
    createUnsignedEvent({
      eventId,
      kind: 'outbox.test.created',
      author: `identity:${keypair.publicKey}`,
      deviceId: `device:${keypair.publicKey.slice(0, 16)}`,
      createdAt: '2026-05-25T00:00:00.000Z',
      privacy: 'dm',
      // Phase 5.0E follow-up: `dm` privacy requires a PrivatePayloadEnvelopeV1.
      payload: placeholderPrivatePayloadEnvelope({ keyId: `placeholder-${eventId}` })
    }),
    keypair
  );
}
