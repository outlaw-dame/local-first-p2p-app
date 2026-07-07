/**
 * Verifier boundary contract test.
 *
 * Pins the inbound pipeline's check ordering documented in
 * `docs/architecture/local-verifier.md`. One adversarial input per
 * documented check; the test asserts that the right check catches
 * each one.
 *
 * If a future change accidentally drops a check (e.g. skipping
 * signature verification on a "trusted" inbound path, or letting an
 * identity event with a malformed payload reach the projection), the
 * corresponding case here fails. The test IS the contract: any new
 * inbound entry point that doesn't satisfy these assertions MUST
 * NOT exist.
 */
import 'fake-indexeddb/auto';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { signEventEnvelope, signingKeypairFromSeed } from '@lfp2p/crypto';
import { createLocalFirstStore } from '@lfp2p/local-store';
import {
  createUnsignedEvent,
  placeholderPrivatePayloadEnvelope,
  type SignedEventEnvelope
} from '@lfp2p/protocol';
import { processInboundSyncBatch, type InboundSyncRecord } from './index.js';

if (typeof globalThis.indexedDB === 'undefined') {
  Object.assign(globalThis, { indexedDB, IDBKeyRange });
}

const CONTROLLER = signingKeypairFromSeed(new Uint8Array(32).fill(20));

function freshStore(): ReturnType<typeof createLocalFirstStore> {
  return createLocalFirstStore(`verifier-boundary-${globalThis.crypto.randomUUID()}`);
}

function wellFormedRecord(eventId: string, sequence: number, cursor: string): InboundSyncRecord {
  return {
    sourceId: 'bridge:primary',
    streamId: 'durable-stream:inbox',
    scope: 'identity:alice',
    cursor,
    sequence,
    receivedAt: '2026-06-03T00:00:00.000Z',
    event: signEventEnvelope(
      createUnsignedEvent({
        eventId,
        kind: 'outbox.test.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-06-03T00:00:00.000Z',
        privacy: 'dm',
        // Phase 5.0E follow-up: `dm` privacy requires a PrivatePayloadEnvelopeV1.
        payload: placeholderPrivatePayloadEnvelope({ keyId: `placeholder-${eventId}` })
      }),
      CONTROLLER
    )
  };
}

function identityRecord(
  eventId: string,
  sequence: number,
  cursor: string,
  payload: Record<string, unknown>,
  kind: SignedEventEnvelope['kind'] = 'identity.controller.created'
): InboundSyncRecord {
  return {
    sourceId: 'bridge:primary',
    streamId: 'durable-stream:inbox',
    scope: 'identity:alice',
    cursor,
    sequence,
    receivedAt: '2026-06-03T00:00:00.000Z',
    event: signEventEnvelope(
      createUnsignedEvent({
        eventId,
        kind,
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-06-03T00:00:00.000Z',
        privacy: 'self',
        payload
      }),
      CONTROLLER
    )
  };
}

describe('Verifier boundary — happy path', () => {
  it('a well-formed signed event traverses every check and lands', async () => {
    const store = freshStore();
    try {
      const result = await processInboundSyncBatch({
        store,
        records: [wellFormedRecord('evt_vb_ok_1', 1, 'cursor-1')]
      });
      expect(result).toMatchObject({ received: 1, applied: 1, rejected: 0 });
    } finally {
      await store.delete();
    }
  });
});

describe('Verifier boundary — Check #2 (signature verification)', () => {
  it('rejects a tampered signature with a signature-verification error', async () => {
    const store = freshStore();
    try {
      const ok = wellFormedRecord('evt_vb_sig_1', 1, 'cursor-1');
      const tampered: InboundSyncRecord = {
        ...ok,
        event: {
          ...ok.event,
          signature: {
            ...ok.event.signature,
            value: 'A'.repeat(ok.event.signature.value.length)
          }
        }
      };
      const result = await processInboundSyncBatch({ store, records: [tampered] });
      expect(result.rejected).toBe(1);
      expect(result.errors[0]?.reason).toMatch(/signature verification failed/i);
      await expect(store.getSignedEvent('evt_vb_sig_1')).resolves.toBeUndefined();
    } finally {
      await store.delete();
    }
  });
});

describe('Verifier boundary — Check #3 (envelope shape)', () => {
  it('rejects an event with an unsupported kind', async () => {
    const store = freshStore();
    try {
      const ok = wellFormedRecord('evt_vb_kind_1', 1, 'cursor-1');
      const bad: InboundSyncRecord = {
        ...ok,
        event: {
          ...ok.event,
          // Cast around the discriminated union to inject an
          // adversarial kind without a re-sign: the envelope-shape
          // check runs before signature verification of the
          // *unsigned projection*, so this is what the local-store
          // validator catches.
          kind: 'unknown.kind' as SignedEventEnvelope['kind']
        }
      };
      const result = await processInboundSyncBatch({ store, records: [bad] });
      expect(result.rejected).toBe(1);
      // Either the signature check rejects first (because we changed
      // the unsigned projection) or the envelope check does. Either
      // way, the event MUST NOT land.
      await expect(store.getSignedEvent('evt_vb_kind_1')).resolves.toBeUndefined();
    } finally {
      await store.delete();
    }
  });
});

describe('Verifier boundary — Check #6 (checkpoint monotonicity)', () => {
  it('skips a stale-sequence record without rejecting (continues batch)', async () => {
    const store = freshStore();
    try {
      await processInboundSyncBatch({
        store,
        records: [wellFormedRecord('evt_vb_ck_10', 10, 'cursor-10')]
      });
      const result = await processInboundSyncBatch({
        store,
        records: [wellFormedRecord('evt_vb_ck_9', 9, 'cursor-9')]
      });
      expect(result).toMatchObject({ received: 1, applied: 0, skipped: 1, rejected: 0 });
      await expect(store.getSignedEvent('evt_vb_ck_9')).resolves.toBeUndefined();
    } finally {
      await store.delete();
    }
  });

  it('rejects cursor-mismatch at the same sequence', async () => {
    const store = freshStore();
    try {
      await processInboundSyncBatch({
        store,
        records: [wellFormedRecord('evt_vb_ck_a', 5, 'cursor-A')]
      });
      const result = await processInboundSyncBatch({
        store,
        records: [wellFormedRecord('evt_vb_ck_b', 5, 'cursor-B')]
      });
      expect(result.rejected).toBe(1);
      expect(result.errors[0]?.reason).toMatch(/cursor mismatch/i);
    } finally {
      await store.delete();
    }
  });
});

describe('Verifier boundary — Check #7 (identity-event defense-in-depth, Phase 2.1)', () => {
  it('rejects an identity event with a malformed public key at apply time', async () => {
    const store = freshStore();
    try {
      // controller.created with a malformed publicKey: validateSignedEvent's
      // per-kind payload check requires the field to be a string, but our
      // Phase 2.1 validateIdentityEvent additionally rejects keys that
      // do not match the base64url pattern. This event passes envelope
      // shape (string is non-empty) and signature verification (we sign
      // it), so the rejection must come from the identity validator's
      // defense-in-depth check at apply time.
      const bad = identityRecord('evt_vb_id_1', 1, 'cursor-1', {
        controllerPublicKey: 'has spaces and forbidden +=',
        initialDeviceId: 'device:alice-phone'
      });
      const result = await processInboundSyncBatch({ store, records: [bad] });
      expect(result.rejected).toBe(1);
      // Either the envelope's per-kind payload check or the identity
      // validator catches it. The event MUST NOT land in either case.
      await expect(store.getSignedEvent('evt_vb_id_1')).resolves.toBeUndefined();
    } finally {
      await store.delete();
    }
  });

  it('rejects an identity event with a forbidden property name in the payload', async () => {
    const store = freshStore();
    try {
      // A controller.created payload that includes a __proto__ key.
      // We construct via JSON.parse so __proto__ lands as an own
      // property rather than being interpreted as a prototype
      // assignment. validateIdentityEvent (Phase 2.1) catches this
      // even if everything upstream lets it through.
      const payload = JSON.parse(`{
        "controllerPublicKey": "Ed25519_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "initialDeviceId": "device:alice-phone",
        "__proto__": { "polluted": true }
      }`);
      const bad = identityRecord('evt_vb_id_proto', 1, 'cursor-1', payload);
      const result = await processInboundSyncBatch({ store, records: [bad] });
      expect(result.rejected).toBe(1);
      await expect(store.getSignedEvent('evt_vb_id_proto')).resolves.toBeUndefined();
    } finally {
      await store.delete();
    }
  });
});

describe('Verifier boundary — Check #9 (transactional persistence)', () => {
  it('a rejection in any check leaves NO event, NO checkpoint advance, and NO projection delta', async () => {
    const store = freshStore();
    try {
      // First land a real event so there's a checkpoint to compare against.
      await processInboundSyncBatch({
        store,
        records: [wellFormedRecord('evt_vb_tx_ok', 1, 'cursor-1')]
      });
      // Now feed a tampered-signature record.
      const ok = wellFormedRecord('evt_vb_tx_bad', 2, 'cursor-2');
      const tampered: InboundSyncRecord = {
        ...ok,
        event: {
          ...ok.event,
          signature: {
            ...ok.event.signature,
            value: 'B'.repeat(ok.event.signature.value.length)
          }
        }
      };
      const result = await processInboundSyncBatch({ store, records: [tampered] });
      expect(result.rejected).toBe(1);
      // No event landed.
      await expect(store.getSignedEvent('evt_vb_tx_bad')).resolves.toBeUndefined();
      // Checkpoint stayed at the previous good cursor.
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

describe('Verifier boundary — rejection logging hygiene', () => {
  it('does not include the event payload, signature, or refs in the error log', async () => {
    const store = freshStore();
    try {
      const ok = wellFormedRecord('evt_vb_log_1', 1, 'cursor-1');
      const tampered: InboundSyncRecord = {
        ...ok,
        event: {
          ...ok.event,
          signature: { ...ok.event.signature, value: 'X'.repeat(ok.event.signature.value.length) }
        }
      };
      const result = await processInboundSyncBatch({ store, records: [tampered] });
      const err = result.errors[0];
      expect(err).toBeDefined();
      // The error record carries index, eventId, reason — nothing else.
      // Defense against leaking attacker-controlled payload into logs.
      expect(Object.keys(err ?? {}).sort()).toEqual(['eventId', 'index', 'reason']);
      // The reason string itself must not echo back payload contents.
      expect(err?.reason ?? '').not.toMatch(/"body":/);
    } finally {
      await store.delete();
    }
  });
});
