/**
 * Phase 5.11 Step 6 — mailbox delivery inbound sync dispatch.
 *
 * Covers `mailboxRouting`:
 *  - a decryptable `dm` envelope is folded into the projection (applied)
 *  - no key yet → stored `undecryptable`, self-heals on later load
 *  - IDOR: an envelope the owner is not a party to is `rejected`, and one
 *    bad envelope does not stop the batch or the checkpoint (forward
 *    progress)
 *  - idempotent re-delivery does not double-count
 *  - the `mailbox` summary is present only when the option is supplied,
 *    and non-mailbox events are ignored by the router
 */
import 'fake-indexeddb/auto';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { signingKeypairFromSeed, signEventEnvelope } from '@lfp2p/crypto';
import { createLocalFirstStore } from '@lfp2p/local-store';
import {
  encryptPrivatePayload,
  generatePrivatePayloadKeyMaterial,
  type PrivatePayloadAadContext
} from '@lfp2p/private-payload';
import { createUnsignedEvent, type JsonValue, type SignedEventEnvelope } from '@lfp2p/protocol';
import { processInboundSyncBatch, type InboundSyncRecord } from './index.js';

if (typeof globalThis.indexedDB === 'undefined') {
  Object.assign(globalThis, { indexedDB, IDBKeyRange });
}

const ALICE = 'identity:alice';
const BOB = 'identity:bob';
const MALLORY = 'identity:mallory';
const ALICE_DEVICE = 'device:alice-1';
const KEYPAIR = signingKeypairFromSeed(new Uint8Array(32).fill(42));

let seq = 0;
/** A real ed25519-signed mailbox event with a genuine encrypted payload. */
async function makeSignedMailboxEvent(
  kind: string,
  privacy: 'dm' | 'group' | 'self',
  plaintext: JsonValue,
  keyMaterial: string
): Promise<SignedEventEnvelope> {
  seq += 1;
  const meta = {
    eventId: `evt-mbx-sync-${seq}`,
    kind: kind as SignedEventEnvelope['kind'],
    author: ALICE,
    deviceId: ALICE_DEVICE,
    createdAt: `2026-07-04T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    lamport: 0,
    schemaVersion: 1
  };
  const context: PrivatePayloadAadContext = {
    eventId: meta.eventId,
    kind: meta.kind,
    author: meta.author,
    deviceId: meta.deviceId,
    createdAt: meta.createdAt,
    privacy,
    schemaVersion: meta.schemaVersion,
    lamport: meta.lamport
  };
  const envelope = await encryptPrivatePayload({
    plaintext,
    context,
    keyMaterial,
    keyId: 'content:key:conv'
  });
  return signEventEnvelope(
    createUnsignedEvent({
      ...meta,
      privacy,
      payload: envelope as unknown as JsonValue as Parameters<
        typeof createUnsignedEvent
      >[0]['payload']
    }),
    KEYPAIR
  );
}

function deliveryEnvelope(over: Record<string, unknown> = {}): JsonValue {
  return {
    envelopeId: 'env1',
    recipientIdentityId: BOB,
    senderIdentityId: ALICE,
    contentRef: 'sha-256:abc',
    expiresAt: '2026-08-01T00:00:00.000Z',
    ...over
  } as JsonValue;
}

let recSeq = 0;
function makeRecord(event: SignedEventEnvelope): InboundSyncRecord {
  recSeq += 1;
  return {
    sourceId: 'bridge:primary',
    streamId: 'durable-stream:inbox',
    scope: BOB,
    cursor: `cursor-${recSeq}`,
    sequence: recSeq,
    receivedAt: '2026-07-04T00:00:00.000Z',
    event
  };
}

function freshStore() {
  return createLocalFirstStore(`mbx-sync-${globalThis.crypto.randomUUID()}`);
}

describe('processInboundSyncBatch — mailbox dispatch (mailboxRouting)', () => {
  it('folds a decryptable dm envelope into the recipient projection', async () => {
    const store = freshStore();
    try {
      const key = generatePrivatePayloadKeyMaterial();
      const q = await makeSignedMailboxEvent(
        'mailbox.envelope.queued',
        'dm',
        deliveryEnvelope(),
        key
      );
      const result = await processInboundSyncBatch({
        store,
        records: [makeRecord(q)],
        mailboxRouting: { ownerIdentityId: BOB, resolveKeyMaterial: () => key }
      });
      expect(result.applied).toBe(1);
      expect(result.mailbox).toBeDefined();
      expect(result.mailbox?.applied).toBe(1);
      expect(result.mailbox?.undecryptable).toBe(0);
      expect(result.mailbox?.rejected).toBe(0);

      const inbox = await store.getMailboxInbox(BOB);
      expect(inbox).toHaveLength(1);
      expect(inbox[0]?.status).toBe('queued');
    } finally {
      await store.delete();
    }
  });

  it('stores an envelope undecryptable when no key is resolvable, then self-heals', async () => {
    const store = freshStore();
    try {
      const key = generatePrivatePayloadKeyMaterial();
      const q = await makeSignedMailboxEvent(
        'mailbox.envelope.queued',
        'dm',
        deliveryEnvelope(),
        key
      );
      const result = await processInboundSyncBatch({
        store,
        records: [makeRecord(q)],
        mailboxRouting: { ownerIdentityId: BOB, resolveKeyMaterial: () => undefined }
      });
      expect(result.applied).toBe(1); // stored in signedEvents + checkpoint advanced
      expect(result.mailbox?.applied).toBe(0);
      expect(result.mailbox?.undecryptable).toBe(1);
      expect(await store.getMailboxInbox(BOB)).toHaveLength(0);
      // Durable in the mailbox event log, ready to heal.
      expect(await store.listLocalMailboxEvents()).toHaveLength(1);

      const rebuilt = await store.loadMailboxInboxState(BOB, () => key);
      expect(rebuilt).toHaveLength(1);
      expect(rebuilt[0]?.status).toBe('queued');
    } finally {
      await store.delete();
    }
  });

  it('IDOR: rejects an envelope the owner is not a party to, without stopping the batch', async () => {
    const store = freshStore();
    try {
      const key = generatePrivatePayloadKeyMaterial();
      // Owner is MALLORY, who can decrypt (shared key) but is neither the
      // sender (ALICE) nor recipient (BOB) — must be rejected.
      const foreign = await makeSignedMailboxEvent(
        'mailbox.envelope.queued',
        'dm',
        deliveryEnvelope({ envelopeId: 'env-foreign', recipientIdentityId: BOB }),
        key
      );
      // A second envelope the owner (MALLORY) IS the recipient of.
      const mine = await makeSignedMailboxEvent(
        'mailbox.envelope.queued',
        'dm',
        deliveryEnvelope({ envelopeId: 'env-mine', recipientIdentityId: MALLORY }),
        key
      );
      const result = await processInboundSyncBatch({
        store,
        records: [makeRecord(foreign), makeRecord(mine)],
        mailboxRouting: { ownerIdentityId: MALLORY, resolveKeyMaterial: () => key }
      });

      // Both stored + checkpoint advanced; only the party-owned one projects.
      expect(result.applied).toBe(2);
      expect(result.rejected).toBe(0); // outer batch made forward progress
      expect(result.mailbox?.applied).toBe(1);
      expect(result.mailbox?.rejected).toBe(1);
      expect(result.mailbox?.errors[0]?.reason).toMatch(/recipient-mismatch|invalid payload/);
      // Privacy-safe: no raw envelope payload content leaks into the summary.
      expect(JSON.stringify(result.mailbox)).not.toContain('sha-256:');

      const inbox = await store.getMailboxInbox(MALLORY);
      expect(inbox.map((r) => r.envelopeId)).toEqual(['env-mine']);
    } finally {
      await store.delete();
    }
  });

  it('does not double-count an idempotent re-delivery', async () => {
    const store = freshStore();
    try {
      const key = generatePrivatePayloadKeyMaterial();
      const q = await makeSignedMailboxEvent(
        'mailbox.envelope.queued',
        'dm',
        deliveryEnvelope(),
        key
      );
      const routing = { ownerIdentityId: BOB, resolveKeyMaterial: () => key };

      const first = await processInboundSyncBatch({
        store,
        records: [makeRecord(q)],
        mailboxRouting: routing
      });
      expect(first.mailbox?.applied).toBe(1);

      // Same signed event re-delivered: the store dedups on eventId, and the
      // outer batch also skips the already-stored envelope.
      const second = await processInboundSyncBatch({
        store,
        records: [makeRecord(q)],
        mailboxRouting: routing
      });
      expect(second.mailbox?.applied).toBe(0);
      expect(await store.getMailboxInbox(BOB)).toHaveLength(1);
    } finally {
      await store.delete();
    }
  });

  it('omits the mailbox summary and does not project when routing is not requested', async () => {
    const store = freshStore();
    try {
      const key = generatePrivatePayloadKeyMaterial();
      const q = await makeSignedMailboxEvent(
        'mailbox.envelope.queued',
        'dm',
        deliveryEnvelope(),
        key
      );
      const result = await processInboundSyncBatch({ store, records: [makeRecord(q)] });
      expect(result.applied).toBe(1); // stored in signedEvents
      expect(result.mailbox).toBeUndefined();
      expect(await store.getMailboxInbox(BOB)).toHaveLength(0); // not projected
    } finally {
      await store.delete();
    }
  });

  it('ignores non-mailbox events in the router', async () => {
    const store = freshStore();
    try {
      const key = generatePrivatePayloadKeyMaterial();
      // A self-scoped UDR event is not a mailbox.* kind.
      const udr = await makeSignedMailboxEvent(
        'udr.space.joined',
        'self',
        { spaceId: 'sp1', joinedAt: '2026-07-04T00:00:00.000Z' },
        key
      );
      const result = await processInboundSyncBatch({
        store,
        records: [makeRecord(udr)],
        mailboxRouting: { ownerIdentityId: BOB, resolveKeyMaterial: () => key }
      });
      expect(result.mailbox?.applied).toBe(0);
      expect(result.mailbox?.undecryptable).toBe(0);
      expect(result.mailbox?.rejected).toBe(0);
    } finally {
      await store.delete();
    }
  });
});
