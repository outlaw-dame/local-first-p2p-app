import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { generateSigningKeypair, verifySignedEventEnvelope } from '@lfp2p/crypto';
import type { JsonValue, SignedEventEnvelope } from '@lfp2p/protocol';
import {
  encryptPrivatePayload,
  generatePrivatePayloadKeyMaterial,
  type PrivatePayloadAadContext
} from '@lfp2p/private-payload';
import { createLocalFirstStore } from './index.js';

const ALICE = 'identity:alice';
const BOB = 'identity:bob';
const ALICE_DEVICE = 'device:alice-1';

let dbSeq = 0;
function freshStore() {
  dbSeq += 1;
  return createLocalFirstStore(`mbx-test-${dbSeq}-${globalThis.crypto.randomUUID()}`);
}

let evtSeq = 0;
/** Build a real mailbox event with a genuine encrypted payload. */
async function makeMailboxEvent(
  kind: string,
  privacy: 'dm' | 'group' | 'self',
  plaintext: JsonValue,
  keyMaterial: string,
  overrides: Partial<SignedEventEnvelope> = {}
): Promise<SignedEventEnvelope> {
  evtSeq += 1;
  const base = {
    version: 'lfp2p.event.v1' as const,
    eventId: overrides.eventId ?? `evt-mbx-${evtSeq}`,
    kind: kind as SignedEventEnvelope['kind'],
    author: overrides.author ?? ALICE,
    deviceId: overrides.deviceId ?? ALICE_DEVICE,
    createdAt:
      overrides.createdAt ?? `2026-07-04T00:00:${String(evtSeq % 60).padStart(2, '0')}.000Z`,
    lamport: overrides.lamport ?? evtSeq,
    privacy,
    schemaVersion: 1
  };
  const context: PrivatePayloadAadContext = {
    eventId: base.eventId,
    kind: base.kind,
    author: base.author,
    deviceId: base.deviceId,
    createdAt: base.createdAt,
    privacy,
    schemaVersion: base.schemaVersion,
    lamport: base.lamport
  };
  const envelope = await encryptPrivatePayload({
    plaintext,
    context,
    keyMaterial,
    keyId: 'content:key:conv'
  });
  return {
    ...base,
    payload: envelope as unknown as SignedEventEnvelope['payload'],
    signature: { algorithm: 'ed25519', publicKey: 'pk', value: 'sig' }
  };
}

function deliveryEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    envelopeId: 'env1',
    recipientIdentityId: BOB,
    senderIdentityId: ALICE,
    contentRef: 'sha-256:abc',
    expiresAt: '2026-08-01T00:00:00.000Z',
    ...overrides
  };
}

describe('mailbox persistence (Phase 5.11 Step 4)', () => {
  it('recipient inbox: queued → delivered → fetched projects into rows', async () => {
    const store = freshStore();
    const key = generatePrivatePayloadKeyMaterial();
    const q = await makeMailboxEvent('mailbox.envelope.queued', 'dm', deliveryEnvelope(), key);
    const d = await makeMailboxEvent(
      'mailbox.envelope.delivered',
      'dm',
      { envelopeId: 'env1', deliveredAt: 'd', providerId: 'p1' },
      key
    );
    const f = await makeMailboxEvent(
      'mailbox.envelope.fetched',
      'self',
      { envelopeId: 'env1', fetchedAt: 'f', recipientDeviceId: 'device:bob-1' },
      key
    );

    expect(
      (await store.appendMailboxEvent(q, { ownerIdentityId: BOB, keyMaterial: key })).status
    ).toBe('applied');
    expect(
      (await store.appendMailboxEvent(d, { ownerIdentityId: BOB, keyMaterial: key })).status
    ).toBe('applied');
    expect(
      (await store.appendMailboxEvent(f, { ownerIdentityId: BOB, keyMaterial: key })).status
    ).toBe('applied');

    const inbox = await store.getMailboxInbox(BOB);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.status).toBe('fetched');
    expect(inbox[0]?.entry.deliveredAt).toBe('d');
    expect(inbox[0]?.expiresAt).toBe('2026-08-01T00:00:00.000Z'); // cleartext index column
    // Recipient has no outbox row.
    expect(await store.getMailboxOutbox(BOB)).toHaveLength(0);
    await store.delete();
  });

  it('sender outbox: queued → delivered resolved by ack', async () => {
    const store = freshStore();
    const key = generatePrivatePayloadKeyMaterial();
    const q = await makeMailboxEvent('mailbox.envelope.queued', 'dm', deliveryEnvelope(), key);
    const d = await makeMailboxEvent(
      'mailbox.envelope.delivered',
      'dm',
      { envelopeId: 'env1', deliveredAt: 'd' },
      key
    );
    const a = await makeMailboxEvent(
      'mailbox.ack.sent',
      'dm',
      { envelopeId: 'env1', ackId: 'a1', ackKind: 'applied', sentAt: 't' },
      key
    );
    for (const e of [q, d, a]) {
      expect(
        (await store.appendMailboxEvent(e, { ownerIdentityId: ALICE, keyMaterial: key })).status
      ).toBe('applied');
    }
    const outbox = await store.getMailboxOutbox(ALICE);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.status).toBe('delivered');
    expect(outbox[0]?.entry.ack?.ackKind).toBe('applied');
    await store.delete();
  });

  it('is idempotent — re-appending the same event is skipped', async () => {
    const store = freshStore();
    const key = generatePrivatePayloadKeyMaterial();
    const q = await makeMailboxEvent('mailbox.envelope.queued', 'dm', deliveryEnvelope(), key);
    expect(
      (await store.appendMailboxEvent(q, { ownerIdentityId: BOB, keyMaterial: key })).status
    ).toBe('applied');
    expect(
      (await store.appendMailboxEvent(q, { ownerIdentityId: BOB, keyMaterial: key })).status
    ).toBe('skipped');
    expect(await store.getMailboxInbox(BOB)).toHaveLength(1);
    await store.delete();
  });

  it('undecryptable event stored durably, self-heals on retry / loadMailboxInboxState', async () => {
    const store = freshStore();
    const realKey = generatePrivatePayloadKeyMaterial();
    const wrongKey = generatePrivatePayloadKeyMaterial();
    const q = await makeMailboxEvent('mailbox.envelope.queued', 'dm', deliveryEnvelope(), realKey);

    const first = await store.appendMailboxEvent(q, {
      ownerIdentityId: BOB,
      keyMaterial: wrongKey
    });
    expect(first.status).toBe('undecryptable');
    expect(await store.getMailboxInbox(BOB)).toHaveLength(0);

    // Incremental self-heal with the right key.
    const healed = await store.appendMailboxEvent(q, {
      ownerIdentityId: BOB,
      keyMaterial: realKey
    });
    expect(healed.status).toBe('applied');
    expect(await store.getMailboxInbox(BOB)).toHaveLength(1);
    await store.delete();
  });

  it('loadMailboxInboxState rebuilds from the durable log, skipping undecryptable', async () => {
    const store = freshStore();
    const realKey = generatePrivatePayloadKeyMaterial();
    const wrongKey = generatePrivatePayloadKeyMaterial();
    const q = await makeMailboxEvent('mailbox.envelope.queued', 'dm', deliveryEnvelope(), realKey);
    const d = await makeMailboxEvent(
      'mailbox.envelope.delivered',
      'dm',
      { envelopeId: 'env1', deliveredAt: 'd' },
      realKey
    );

    await store.appendMailboxEvent(q, { ownerIdentityId: BOB, keyMaterial: realKey });
    // delivered arrives undecryptable (wrong key).
    expect(
      (await store.appendMailboxEvent(d, { ownerIdentityId: BOB, keyMaterial: wrongKey })).status
    ).toBe('undecryptable');
    // Inbox is still only 'queued' (delivered not projected yet).
    expect((await store.getMailboxInbox(BOB))[0]?.status).toBe('queued');

    // Full rebuild with the right key recovers the delivered transition.
    const rebuilt = await store.loadMailboxInboxState(BOB, () => realKey);
    expect(rebuilt[0]?.status).toBe('delivered');
    expect((await store.getMailboxInbox(BOB))[0]?.status).toBe('delivered');
    await store.delete();
  });

  it('rejects a non-mailbox event kind', async () => {
    const store = freshStore();
    const key = generatePrivatePayloadKeyMaterial();
    const q = await makeMailboxEvent('mailbox.envelope.queued', 'dm', deliveryEnvelope(), key);
    const notMbx = { ...q, kind: 'note.created' as SignedEventEnvelope['kind'] };
    await expect(
      store.appendMailboxEvent(notMbx, { ownerIdentityId: BOB, keyMaterial: key })
    ).rejects.toThrow(/is not a mailbox\.\* event kind/);
    await store.delete();
  });

  it('IDOR: rejects (without storing) a queued envelope the owner is not a party to', async () => {
    const store = freshStore();
    const key = generatePrivatePayloadKeyMaterial();
    // Envelope between alice→bob; mallory processes it.
    const q = await makeMailboxEvent('mailbox.envelope.queued', 'dm', deliveryEnvelope(), key);
    const res = await store.appendMailboxEvent(q, {
      ownerIdentityId: 'identity:mallory',
      keyMaterial: key
    });
    expect(res.status).toBe('rejected');
    expect(await store.getMailboxInbox('identity:mallory')).toHaveLength(0);
    expect(await store.getMailboxOutbox('identity:mallory')).toHaveLength(0);
    await store.delete();
  });

  it('rejects (without storing) a decrypted-but-invalid payload', async () => {
    const store = freshStore();
    const key = generatePrivatePayloadKeyMaterial();
    // Missing recipient/sender/contentRef — decrypts fine, fails projection.
    const bad = await makeMailboxEvent(
      'mailbox.envelope.queued',
      'dm',
      { envelopeId: 'env1' },
      key
    );
    const res = await store.appendMailboxEvent(bad, { ownerIdentityId: BOB, keyMaterial: key });
    expect(res.status).toBe('rejected');
    expect(await store.getMailboxInbox(BOB)).toHaveLength(0);
    await store.delete();
  });

  it('self-to-self envelope populates both inbox and outbox', async () => {
    const store = freshStore();
    const key = generatePrivatePayloadKeyMaterial();
    const q = await makeMailboxEvent(
      'mailbox.envelope.queued',
      'dm',
      deliveryEnvelope({ senderIdentityId: ALICE, recipientIdentityId: ALICE }),
      key
    );
    expect(
      (await store.appendMailboxEvent(q, { ownerIdentityId: ALICE, keyMaterial: key })).status
    ).toBe('applied');
    expect(await store.getMailboxInbox(ALICE)).toHaveLength(1);
    expect(await store.getMailboxOutbox(ALICE)).toHaveLength(1);
    await store.delete();
  });

  it('tracks a mailbox checkpoint', async () => {
    const store = freshStore();
    const key = generatePrivatePayloadKeyMaterial();
    const c = await makeMailboxEvent(
      'mailbox.checkpoint.advanced',
      'self',
      { mailboxId: 'mb1', checkpointId: 'c1', cursor: '42', advancedAt: 't' },
      key
    );
    expect(
      (await store.appendMailboxEvent(c, { ownerIdentityId: BOB, keyMaterial: key })).status
    ).toBe('applied');
    expect((await store.getMailboxCheckpoint('mb1'))?.cursor).toBe('42');
    await store.delete();
  });
});

describe('mailbox expiry sweep (Phase 5.11 Step 5)', () => {
  const NOW = '2026-07-04T12:00:00.000Z';
  const PAST = '2026-07-01T00:00:00.000Z';
  const FUTURE = '2026-08-01T00:00:00.000Z';
  const keypair = generateSigningKeypair();

  function sweepOptions(owner: string, key: string, overrides: Record<string, unknown> = {}) {
    return {
      ownerIdentityId: owner,
      deviceId: 'device:sweeper-1',
      signingKeypair: keypair,
      resolveEnvelopeKey: () => ({
        keyMaterial: key,
        keyId: 'content:key:conv',
        privacy: 'dm' as const
      }),
      now: NOW,
      ...overrides
    };
  }

  it('marks queued envelopes past expiresAt expired; leaves future ones alone', async () => {
    const store = freshStore();
    const key = generatePrivatePayloadKeyMaterial();
    const q1 = await makeMailboxEvent(
      'mailbox.envelope.queued',
      'dm',
      deliveryEnvelope({ envelopeId: 'env-past', expiresAt: PAST }),
      key
    );
    const q2 = await makeMailboxEvent(
      'mailbox.envelope.queued',
      'dm',
      deliveryEnvelope({ envelopeId: 'env-future', expiresAt: FUTURE }),
      key
    );
    await store.appendMailboxEvent(q1, { ownerIdentityId: BOB, keyMaterial: key });
    await store.appendMailboxEvent(q2, { ownerIdentityId: BOB, keyMaterial: key });

    const result = await store.sweepExpiredMailboxEnvelopes(sweepOptions(BOB, key));
    expect(result.expired).toEqual(['env-past']);
    expect(result.skipped).toEqual([]);

    const inbox = await store.getMailboxInbox(BOB);
    const past = inbox.find((r) => r.envelopeId === 'env-past');
    const future = inbox.find((r) => r.envelopeId === 'env-future');
    expect(past?.status).toBe('expired');
    expect(past?.entry.expiredAt).toBe(NOW);
    expect(past?.entry.expiredReason).toBe('ttl');
    expect(future?.status).toBe('queued');

    // The emitted event is durably logged and genuinely signed.
    const events = await store.listLocalMailboxEvents();
    const expiredEvents = events.filter((e) => e.kind === 'mailbox.envelope.expired');
    expect(expiredEvents).toHaveLength(1);
    expect(verifySignedEventEnvelope(expiredEvents[0]!)).toBe(true);
    await store.delete();
  });

  it('sweeps the sender outbox side for delivered envelopes', async () => {
    const store = freshStore();
    const key = generatePrivatePayloadKeyMaterial();
    const q = await makeMailboxEvent(
      'mailbox.envelope.queued',
      'dm',
      deliveryEnvelope({ envelopeId: 'env-out', expiresAt: PAST }),
      key
    );
    const d = await makeMailboxEvent(
      'mailbox.envelope.delivered',
      'dm',
      { envelopeId: 'env-out', deliveredAt: 'd', providerId: 'p1' },
      key
    );
    await store.appendMailboxEvent(q, { ownerIdentityId: ALICE, keyMaterial: key });
    await store.appendMailboxEvent(d, { ownerIdentityId: ALICE, keyMaterial: key });

    const result = await store.sweepExpiredMailboxEnvelopes(sweepOptions(ALICE, key));
    expect(result.expired).toEqual(['env-out']);
    const outbox = await store.getMailboxOutbox(ALICE);
    expect(outbox[0]?.status).toBe('expired');
    expect(outbox[0]?.entry.expiredReason).toBe('ttl');
    await store.delete();
  });

  it('does not sweep fetched envelopes (content already retrieved)', async () => {
    const store = freshStore();
    const key = generatePrivatePayloadKeyMaterial();
    const q = await makeMailboxEvent(
      'mailbox.envelope.queued',
      'dm',
      deliveryEnvelope({ envelopeId: 'env-f', expiresAt: PAST }),
      key
    );
    const f = await makeMailboxEvent(
      'mailbox.envelope.fetched',
      'self',
      { envelopeId: 'env-f', fetchedAt: 'f', recipientDeviceId: 'device:bob-1' },
      key
    );
    await store.appendMailboxEvent(q, { ownerIdentityId: BOB, keyMaterial: key });
    await store.appendMailboxEvent(f, { ownerIdentityId: BOB, keyMaterial: key });

    const result = await store.sweepExpiredMailboxEnvelopes(sweepOptions(BOB, key));
    expect(result.expired).toEqual([]);
    expect((await store.getMailboxInbox(BOB))[0]?.status).toBe('fetched');
    await store.delete();
  });

  it('treats expiresAt exactly equal to now as expired', async () => {
    const store = freshStore();
    const key = generatePrivatePayloadKeyMaterial();
    const q = await makeMailboxEvent(
      'mailbox.envelope.queued',
      'dm',
      deliveryEnvelope({ envelopeId: 'env-edge', expiresAt: NOW }),
      key
    );
    await store.appendMailboxEvent(q, { ownerIdentityId: BOB, keyMaterial: key });
    const result = await store.sweepExpiredMailboxEnvelopes(sweepOptions(BOB, key));
    expect(result.expired).toEqual(['env-edge']);
    await store.delete();
  });

  it('is idempotent: a second sweep emits nothing', async () => {
    const store = freshStore();
    const key = generatePrivatePayloadKeyMaterial();
    const q = await makeMailboxEvent(
      'mailbox.envelope.queued',
      'dm',
      deliveryEnvelope({ envelopeId: 'env-i', expiresAt: PAST }),
      key
    );
    await store.appendMailboxEvent(q, { ownerIdentityId: BOB, keyMaterial: key });

    expect((await store.sweepExpiredMailboxEnvelopes(sweepOptions(BOB, key))).expired).toEqual([
      'env-i'
    ]);
    const logCount = (await store.listLocalMailboxEvents()).length;

    const second = await store.sweepExpiredMailboxEnvelopes(sweepOptions(BOB, key));
    expect(second.expired).toEqual([]);
    expect(second.skipped).toEqual([]);
    expect((await store.listLocalMailboxEvents()).length).toBe(logCount);
    await store.delete();
  });

  it('skips envelopes whose key cannot be resolved, then sweeps them once it can', async () => {
    const store = freshStore();
    const key = generatePrivatePayloadKeyMaterial();
    const q = await makeMailboxEvent(
      'mailbox.envelope.queued',
      'dm',
      deliveryEnvelope({ envelopeId: 'env-k', expiresAt: PAST }),
      key
    );
    await store.appendMailboxEvent(q, { ownerIdentityId: BOB, keyMaterial: key });

    const noKey = await store.sweepExpiredMailboxEnvelopes(
      sweepOptions(BOB, key, { resolveEnvelopeKey: () => undefined })
    );
    expect(noKey.expired).toEqual([]);
    expect(noKey.skipped).toEqual(['env-k']);
    expect((await store.getMailboxInbox(BOB))[0]?.status).toBe('queued');

    const retry = await store.sweepExpiredMailboxEnvelopes(sweepOptions(BOB, key));
    expect(retry.expired).toEqual(['env-k']);
    expect((await store.getMailboxInbox(BOB))[0]?.status).toBe('expired');
    await store.delete();
  });

  it('replay from the event log reproduces the swept (expired) state', async () => {
    const store = freshStore();
    const key = generatePrivatePayloadKeyMaterial();
    const q = await makeMailboxEvent(
      'mailbox.envelope.queued',
      'dm',
      deliveryEnvelope({ envelopeId: 'env-r', expiresAt: PAST }),
      key
    );
    await store.appendMailboxEvent(q, { ownerIdentityId: BOB, keyMaterial: key });
    await store.sweepExpiredMailboxEnvelopes(sweepOptions(BOB, key));

    // Full rebuild from the durable log — the sweep's emitted event
    // must fold back in, not just the mutated row.
    const rows = await store.loadMailboxInboxState(BOB, () => key);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entry.status).toBe('expired');
    expect(rows[0]?.entry.expiredReason).toBe('ttl');
    await store.delete();
  });

  it('expires both sides of a self-to-self envelope with one event', async () => {
    const store = freshStore();
    const key = generatePrivatePayloadKeyMaterial();
    const q = await makeMailboxEvent(
      'mailbox.envelope.queued',
      'dm',
      deliveryEnvelope({
        envelopeId: 'env-s',
        senderIdentityId: ALICE,
        recipientIdentityId: ALICE,
        expiresAt: PAST
      }),
      key
    );
    await store.appendMailboxEvent(q, { ownerIdentityId: ALICE, keyMaterial: key });

    const result = await store.sweepExpiredMailboxEnvelopes(sweepOptions(ALICE, key));
    expect(result.expired).toEqual(['env-s']);
    expect((await store.getMailboxInbox(ALICE))[0]?.status).toBe('expired');
    expect((await store.getMailboxOutbox(ALICE))[0]?.status).toBe('expired');
    await store.delete();
  });
});
