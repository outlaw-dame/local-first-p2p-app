import 'fake-indexeddb/auto';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { signingKeypairFromSeed, signEventEnvelope } from '@lfp2p/crypto';
import { createLocalFirstStore } from '@lfp2p/local-store';
import { createUnsignedEvent, type SignedEventEnvelope } from '@lfp2p/protocol';
import { processInboundSyncBatch, type InboundSyncRecord } from './index.js';

if (typeof globalThis.indexedDB === 'undefined') {
  Object.assign(globalThis, { indexedDB, IDBKeyRange });
}

describe('processInboundSyncBatch', () => {
  it('applies inbound signed events and advances checkpoints in order', async () => {
    const store = createLocalFirstStore(`inbound-sync-apply-${globalThis.crypto.randomUUID()}`);
    const first = makeRecord('evt_inbound_sync_001', 'cursor-1', 1);
    const second = makeRecord('evt_inbound_sync_002', 'cursor-2', 2);

    try {
      const result = await processInboundSyncBatch({
        store,
        records: [first, second],
        now: new Date('2026-05-24T00:00:00.000Z')
      });

      expect(result).toEqual({ received: 2, applied: 2, skipped: 0, rejected: 0, errors: [] });
      await expect(store.getSignedEvent('evt_inbound_sync_001')).resolves.toEqual(first.event);
      await expect(store.getSignedEvent('evt_inbound_sync_002')).resolves.toEqual(second.event);
      await expect(
        store.getSyncCheckpoint({
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice'
        })
      ).resolves.toMatchObject({ cursor: 'cursor-2', sequence: 2 });
    } finally {
      await store.delete();
    }
  });

  it('skips stale inbound records without replacing the latest checkpoint', async () => {
    const store = createLocalFirstStore(`inbound-sync-stale-${globalThis.crypto.randomUUID()}`);
    const current = makeRecord('evt_inbound_current', 'cursor-10', 10);
    const stale = makeRecord('evt_inbound_stale', 'cursor-9', 9);

    try {
      await expect(processInboundSyncBatch({ store, records: [current] })).resolves.toMatchObject({ applied: 1 });
      const result = await processInboundSyncBatch({ store, records: [stale] });

      expect(result).toEqual({ received: 1, applied: 0, skipped: 1, rejected: 0, errors: [] });
      await expect(store.getSignedEvent('evt_inbound_stale')).resolves.toBeUndefined();
      await expect(
        store.getSyncCheckpoint({
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice'
        })
      ).resolves.toMatchObject({ cursor: 'cursor-10', sequence: 10 });
    } finally {
      await store.delete();
    }
  });

  it('stops on invalid event validation without advancing past it', async () => {
    const store = createLocalFirstStore(`inbound-sync-invalid-${globalThis.crypto.randomUUID()}`);
    const first = makeRecord('evt_inbound_valid_before_invalid', 'cursor-1', 1);
    const invalid = {
      ...makeRecord('evt_inbound_invalid_payload', 'cursor-2', 2),
      event: {
        ...makeSignedEvent('evt_inbound_invalid_payload'),
        payload: []
      } as unknown as SignedEventEnvelope
    };
    const afterInvalid = makeRecord('evt_inbound_after_invalid', 'cursor-3', 3);

    try {
      const result = await processInboundSyncBatch({
        store,
        records: [first, invalid, afterInvalid],
        now: new Date('2026-05-24T00:00:00.000Z')
      });

      expect(result.received).toBe(2);
      expect(result.applied).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.rejected).toBe(1);
      expect(result.errors[0]).toMatchObject({ index: 1, eventId: 'evt_inbound_invalid_payload' });
      expect(result.errors[0]?.reason).toMatch(/signature verification failed/i);
      await expect(store.getSignedEvent('evt_inbound_after_invalid')).resolves.toBeUndefined();
      await expect(
        store.getSyncCheckpoint({
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice'
        })
      ).resolves.toMatchObject({ cursor: 'cursor-1', sequence: 1 });
    } finally {
      await store.delete();
    }
  });

  it('uses an inbound-specific fallback for non-error failures', async () => {
    const store = createLocalFirstStore(`inbound-sync-unknown-failure-${globalThis.crypto.randomUUID()}`);
    const record = makeRecord('evt_inbound_unknown_failure', 'cursor-1', 1);
    const failingStore = {
      putSignedEventWithSyncCheckpoint: async () => {
        throw undefined;
      }
    } as unknown as typeof store;

    try {
      const result = await processInboundSyncBatch({ store: failingStore, records: [record] });
      expect(result).toEqual({
        received: 1,
        applied: 0,
        skipped: 0,
        rejected: 1,
        errors: [{ index: 0, eventId: 'evt_inbound_unknown_failure', reason: 'Unknown inbound sync failure' }]
      });
    } finally {
      await store.delete();
    }
  });

  it('treats same-sequence cursor conflicts as rejection and stops processing', async () => {
    const store = createLocalFirstStore(`inbound-sync-conflict-${globalThis.crypto.randomUUID()}`);
    const first = makeRecord('evt_inbound_conflict_first', 'cursor-10-a', 10);
    const conflict = makeRecord('evt_inbound_conflict_second', 'cursor-10-b', 10);
    const afterConflict = makeRecord('evt_inbound_after_conflict', 'cursor-11', 11);

    try {
      const result = await processInboundSyncBatch({ store, records: [first, conflict, afterConflict] });

      expect(result.received).toBe(2);
      expect(result.applied).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.rejected).toBe(1);
      expect(result.errors[0]).toMatchObject({ index: 1, eventId: 'evt_inbound_conflict_second' });
      expect(result.errors[0]?.reason).toMatch(/cursor mismatch/);
      await expect(store.getSignedEvent('evt_inbound_after_conflict')).resolves.toBeUndefined();
    } finally {
      await store.delete();
    }
  });

  it('supports explicit rewind for controlled resync flows', async () => {
    const store = createLocalFirstStore(`inbound-sync-rewind-${globalThis.crypto.randomUUID()}`);
    const current = makeRecord('evt_inbound_rewind_current', 'cursor-20', 20);
    const rewind = makeRecord('evt_inbound_rewind_target', 'cursor-15', 15);

    try {
      await expect(processInboundSyncBatch({ store, records: [current] })).resolves.toMatchObject({ applied: 1 });
      await expect(processInboundSyncBatch({ store, records: [rewind], allowRewind: true })).resolves.toEqual({
        received: 1,
        applied: 1,
        skipped: 0,
        rejected: 0,
        errors: []
      });
      await expect(store.getSignedEvent('evt_inbound_rewind_target')).resolves.toEqual(rewind.event);
      await expect(
        store.getSyncCheckpoint({
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice'
        })
      ).resolves.toMatchObject({ cursor: 'cursor-15', sequence: 15 });
    } finally {
      await store.delete();
    }
  });

  it('persists identity control projection while applying identity control events', async () => {
    const store = createLocalFirstStore(`inbound-sync-identity-projection-${globalThis.crypto.randomUUID()}`);
    const controller = signingKeypairFromSeed(new Uint8Array(32).fill(21));
    const created = makeIdentityControlRecord({
      eventId: 'evt_identity_controller_created',
      sequence: 1,
      cursor: 'cursor-1',
      kind: 'identity.controller.created',
      payload: {
        controllerPublicKey: controller.publicKey,
        initialDeviceId: 'device:alice-phone'
      },
      signer: controller
    });
    const authorized = makeIdentityControlRecord({
      eventId: 'evt_identity_device_authorized',
      sequence: 2,
      cursor: 'cursor-2',
      kind: 'identity.device.authorized',
      payload: {
        authorizedDeviceId: 'device:alice-laptop',
        authorizedPublicKey: 'alice-laptop-public-key',
        epoch: 1
      },
      signer: controller
    });

    try {
      const result = await processInboundSyncBatch({
        store,
        records: [created, authorized],
        now: new Date('2026-05-24T00:00:00.000Z')
      });

      expect(result).toEqual({ received: 2, applied: 2, skipped: 0, rejected: 0, errors: [] });
      await expect(store.getSignedEvent('evt_identity_controller_created')).resolves.toEqual(created.event);
      await expect(store.getSignedEvent('evt_identity_device_authorized')).resolves.toEqual(authorized.event);
      await expect(store.getIdentityControlProjection('identity:alice')).resolves.toMatchObject({
        identityId: 'identity:alice',
        controllerPublicKey: controller.publicKey,
        epoch: 1,
        lastEventId: 'evt_identity_device_authorized'
      });
      await expect(store.getIdentityControlProjection('identity:alice')).resolves.toMatchObject({
        devices: {
          'device:alice-phone': { status: 'active' },
          'device:alice-laptop': { status: 'active' }
        }
      });
    } finally {
      await store.delete();
    }
  });

  it('rejects controller-mismatch identity events without storing event or advancing checkpoint', async () => {
    const store = createLocalFirstStore(`inbound-sync-identity-reject-${globalThis.crypto.randomUUID()}`);
    const controller = signingKeypairFromSeed(new Uint8Array(32).fill(31));
    const attacker = signingKeypairFromSeed(new Uint8Array(32).fill(32));
    const created = makeIdentityControlRecord({
      eventId: 'evt_identity_created_before_reject',
      sequence: 1,
      cursor: 'cursor-1',
      kind: 'identity.controller.created',
      payload: {
        controllerPublicKey: controller.publicKey,
        initialDeviceId: 'device:alice-phone'
      },
      signer: controller
    });
    const unauthorized = makeIdentityControlRecord({
      eventId: 'evt_identity_authorized_rejected',
      sequence: 2,
      cursor: 'cursor-2',
      kind: 'identity.device.authorized',
      payload: {
        authorizedDeviceId: 'device:alice-tablet',
        authorizedPublicKey: 'alice-tablet-public-key',
        epoch: 1
      },
      signer: attacker
    });

    try {
      await expect(processInboundSyncBatch({ store, records: [created] })).resolves.toMatchObject({ applied: 1 });
      const result = await processInboundSyncBatch({ store, records: [unauthorized] });

      expect(result.received).toBe(1);
      expect(result.applied).toBe(0);
      expect(result.rejected).toBe(1);
      expect(result.errors[0]).toMatchObject({ index: 0, eventId: 'evt_identity_authorized_rejected' });
      expect(result.errors[0]?.reason).toMatch(/must be signed by the controller public key/);
      await expect(store.getSignedEvent('evt_identity_authorized_rejected')).resolves.toBeUndefined();
      await expect(
        store.getSyncCheckpoint({
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice'
        })
      ).resolves.toMatchObject({ cursor: 'cursor-1', sequence: 1 });
      await expect(store.getIdentityControlProjection('identity:alice')).resolves.toMatchObject({
        lastEventId: 'evt_identity_created_before_reject',
        epoch: 0
      });
    } finally {
      await store.delete();
    }
  });

  it('rejects inbound events with invalid cryptographic signatures', async () => {
    const store = createLocalFirstStore(`inbound-sync-bad-signature-${globalThis.crypto.randomUUID()}`);
    const valid = makeRecord('evt_inbound_signature_valid', 'cursor-1', 1);
    const tampered = {
      ...makeRecord('evt_inbound_signature_tampered', 'cursor-2', 2),
      event: {
        ...makeSignedEvent('evt_inbound_signature_tampered'),
        payload: { body: 'tampered-after-sign' }
      }
    } as InboundSyncRecord;

    try {
      await expect(processInboundSyncBatch({ store, records: [valid] })).resolves.toMatchObject({ applied: 1 });
      const result = await processInboundSyncBatch({ store, records: [tampered] });

      expect(result.received).toBe(1);
      expect(result.applied).toBe(0);
      expect(result.rejected).toBe(1);
      expect(result.errors[0]).toMatchObject({ index: 0, eventId: 'evt_inbound_signature_tampered' });
      expect(result.errors[0]?.reason).toMatch(/signature verification failed/i);
      await expect(store.getSignedEvent('evt_inbound_signature_tampered')).resolves.toBeUndefined();
      await expect(
        store.getSyncCheckpoint({
          sourceId: 'bridge:primary',
          streamId: 'durable-stream:inbox',
          scope: 'identity:alice'
        })
      ).resolves.toMatchObject({ cursor: 'cursor-1', sequence: 1 });
    } finally {
      await store.delete();
    }
  });
});

function makeRecord(eventId: string, cursor: string, sequence: number): InboundSyncRecord {
  return {
    sourceId: 'bridge:primary',
    streamId: 'durable-stream:inbox',
    scope: 'identity:alice',
    cursor,
    sequence,
    receivedAt: '2026-05-24T00:00:00.000Z',
    event: makeSignedEvent(eventId)
  };
}

function makeSignedEvent(eventId: string): SignedEventEnvelope {
  const keypair = signingKeypairFromSeed(new Uint8Array(32).fill(12));
  return signEventEnvelope(
    createUnsignedEvent({
      eventId,
      kind: 'outbox.test.created',
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: '2026-05-24T00:00:00.000Z',
      privacy: 'dm',
      payload: { body: eventId }
    }),
    keypair
  );
}

function makeIdentityControlRecord(input: {
  eventId: string;
  sequence: number;
  cursor: string;
  kind:
    | 'identity.controller.created'
    | 'identity.device.authorized'
    | 'identity.device.revoked'
    | 'identity.capability.granted'
    | 'identity.capability.revoked';
  payload: Record<string, unknown>;
  signer: { publicKey: string; privateKey: CryptoKey };
}): InboundSyncRecord {
  return {
    sourceId: 'bridge:primary',
    streamId: 'durable-stream:inbox',
    scope: 'identity:alice',
    cursor: input.cursor,
    sequence: input.sequence,
    receivedAt: '2026-05-24T00:00:00.000Z',
    event: signEventEnvelope(
      createUnsignedEvent({
        eventId: input.eventId,
        kind: input.kind,
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-05-24T00:00:00.000Z',
        privacy: 'self',
        payload: input.payload
      }),
      input.signer
    )
  };
}
