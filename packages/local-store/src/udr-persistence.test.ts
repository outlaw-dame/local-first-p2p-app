import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { JsonValue, SignedEventEnvelope } from '@lfp2p/protocol';
import {
  encryptPrivatePayload,
  generatePrivatePayloadKeyMaterial,
  type PrivatePayloadAadContext
} from '@lfp2p/private-payload';
import { createLocalFirstStore } from './index.js';

const IDENTITY = 'identity:alice';
const DEVICE = 'device:alice-phone';
const KEY_ID = 'content:key:alice-udr';

let dbSeq = 0;
function freshStore() {
  dbSeq += 1;
  return createLocalFirstStore(`udr-test-${dbSeq}-${Date.now()}`);
}

let evtSeq = 0;
/** Build a real `self`-scoped udr event with a genuine encrypted payload. */
async function makeUdrEvent(
  kind: string,
  plaintext: JsonValue,
  keyMaterial: string,
  overrides: Partial<SignedEventEnvelope> = {}
): Promise<SignedEventEnvelope> {
  evtSeq += 1;
  const base = {
    version: 'lfp2p.event.v1' as const,
    eventId: overrides.eventId ?? `evt-udr-${evtSeq}`,
    kind: kind as SignedEventEnvelope['kind'],
    author: overrides.author ?? IDENTITY,
    deviceId: overrides.deviceId ?? DEVICE,
    createdAt:
      overrides.createdAt ?? `2026-07-02T00:00:${String(evtSeq % 60).padStart(2, '0')}.000Z`,
    lamport: overrides.lamport ?? evtSeq,
    privacy: 'self' as const,
    schemaVersion: 1
  };
  const context: PrivatePayloadAadContext = {
    eventId: base.eventId,
    kind: base.kind,
    author: base.author,
    deviceId: base.deviceId,
    createdAt: base.createdAt,
    privacy: 'self',
    schemaVersion: base.schemaVersion,
    lamport: base.lamport
  };
  const envelope = await encryptPrivatePayload({
    plaintext,
    context,
    keyMaterial,
    keyId: KEY_ID
  });
  return {
    ...base,
    payload: envelope as unknown as SignedEventEnvelope['payload'],
    signature: {
      algorithm: 'ed25519',
      publicKey: 'test-public-key',
      value: 'test-signature'
    }
  };
}

describe('UDR persistence (Phase 5.11 Step 4)', () => {
  it('appends, decrypts, and projects a udr event', async () => {
    const store = freshStore();
    const key = generatePrivatePayloadKeyMaterial();
    const event = await makeUdrEvent('udr.space.joined', { spaceId: 'sp1', joinedAt: 'x' }, key);

    const result = await store.appendUdrEvent(event, { keyMaterial: key });
    expect(result.status).toBe('applied');
    expect([...result.state.spaceIds]).toEqual(['sp1']);

    const row = await store.getUserDataRoot(IDENTITY);
    expect(row?.spaceIds).toEqual(['sp1']);
    expect(row?.appliedEventIds).toContain(event.eventId);
    await store.delete();
  });

  it('projects a multi-event UDR (partition, feed, mailbox, space)', async () => {
    const store = freshStore();
    const key = generatePrivatePayloadKeyMaterial();
    const events = [
      await makeUdrEvent(
        'udr.partition.claimed',
        { partitionId: 'p1', scope: 'private', claimedAt: 'x' },
        key
      ),
      await makeUdrEvent(
        'udr.feed-subscription.added',
        { feedId: 'f1', feedKind: 'following', addedAt: 'x' },
        key
      ),
      await makeUdrEvent('udr.mailbox.bound', { mailboxId: 'mb1', boundAt: 'x' }, key),
      await makeUdrEvent('udr.space.joined', { spaceId: 'sp1', joinedAt: 'x' }, key)
    ];
    for (const e of events) {
      expect((await store.appendUdrEvent(e, { keyMaterial: key })).status).toBe('applied');
    }
    const row = await store.getUserDataRoot(IDENTITY);
    expect(row?.partitionIds).toEqual(['p1']);
    expect(row?.feedSubscriptionIds).toEqual(['f1']);
    expect(row?.mailboxId).toBe('mb1');
    expect(row?.spaceIds).toEqual(['sp1']);
    await store.delete();
  });

  it('is idempotent — re-appending the same event is a skipped no-op', async () => {
    const store = freshStore();
    const key = generatePrivatePayloadKeyMaterial();
    const event = await makeUdrEvent('udr.space.joined', { spaceId: 'sp1', joinedAt: 'x' }, key);
    await store.appendUdrEvent(event, { keyMaterial: key });
    const second = await store.appendUdrEvent(event, { keyMaterial: key });
    expect(second.status).toBe('skipped');
    const row = await store.getUserDataRoot(IDENTITY);
    expect(row?.spaceIds).toEqual(['sp1']);
    await store.delete();
  });

  it('undecryptable event is stored durably and self-heals on retry with the key', async () => {
    const store = freshStore();
    const realKey = generatePrivatePayloadKeyMaterial();
    const wrongKey = generatePrivatePayloadKeyMaterial();
    const event = await makeUdrEvent(
      'udr.space.joined',
      { spaceId: 'sp1', joinedAt: 'x' },
      realKey
    );

    // Arrives before the key is available (decrypt with the wrong key).
    const first = await store.appendUdrEvent(event, { keyMaterial: wrongKey });
    expect(first.status).toBe('undecryptable');
    expect(await store.getUserDataRoot(IDENTITY)).toBeUndefined();
    // But the signed event is durable.
    expect(await store.getSignedEvent(event.eventId)).toBeDefined();

    // Later, with the correct key, it self-heals via incremental append…
    const healed = await store.appendUdrEvent(event, { keyMaterial: realKey });
    expect(healed.status).toBe('applied');
    expect([...healed.state.spaceIds]).toEqual(['sp1']);
    await store.delete();
  });

  it('loadUdrState rebuilds from the durable log and self-heals undecryptable events', async () => {
    const store = freshStore();
    const realKey = generatePrivatePayloadKeyMaterial();
    const wrongKey = generatePrivatePayloadKeyMaterial();
    const e1 = await makeUdrEvent(
      'udr.partition.claimed',
      { partitionId: 'p1', scope: 'private', claimedAt: 'x' },
      realKey
    );
    const e2 = await makeUdrEvent('udr.space.joined', { spaceId: 'sp1', joinedAt: 'x' }, realKey);

    await store.appendUdrEvent(e1, { keyMaterial: realKey });
    // e2 arrives undecryptable.
    expect((await store.appendUdrEvent(e2, { keyMaterial: wrongKey })).status).toBe(
      'undecryptable'
    );

    // Full rebuild with the real key recovers both.
    const rebuilt = await store.loadUdrState(IDENTITY, realKey);
    expect([...rebuilt.partitionIds]).toEqual(['p1']);
    expect([...rebuilt.spaceIds]).toEqual(['sp1']);
    const row = await store.getUserDataRoot(IDENTITY);
    expect(row?.spaceIds).toEqual(['sp1']);
    await store.delete();
  });

  it('rejects (without storing) a decrypted-but-invalid payload', async () => {
    const store = freshStore();
    const key = generatePrivatePayloadKeyMaterial();
    // Missing required spaceId — decrypts fine, fails projection validation.
    const event = await makeUdrEvent('udr.space.joined', { notSpaceId: 'x' }, key);
    const result = await store.appendUdrEvent(event, { keyMaterial: key });
    expect(result.status).toBe('rejected');
    expect(await store.getUserDataRoot(IDENTITY)).toBeUndefined();
    // Not stored — permanent garbage must not pollute the durable log.
    expect(await store.getSignedEvent(event.eventId)).toBeUndefined();
    await store.delete();
  });

  it('rejects a non-udr event kind', async () => {
    const store = freshStore();
    const key = generatePrivatePayloadKeyMaterial();
    // A structurally valid `self` event of a non-udr kind: validateSignedEvent
    // passes, then appendUdrEvent's kind guard rejects it.
    const event = await makeUdrEvent('udr.space.joined', { spaceId: 'sp1', joinedAt: 'x' }, key);
    const nonUdr = { ...event, kind: 'note.created' as SignedEventEnvelope['kind'] };
    await expect(store.appendUdrEvent(nonUdr, { keyMaterial: key })).rejects.toThrow(
      /is not a udr\.\* event kind/
    );
    await store.delete();
  });

  it('rejects when event.author does not match expectedIdentityId (IDOR guard)', async () => {
    const store = freshStore();
    const key = generatePrivatePayloadKeyMaterial();
    const event = await makeUdrEvent('udr.space.joined', { spaceId: 'sp1', joinedAt: 'x' }, key);
    await expect(
      store.appendUdrEvent(event, { keyMaterial: key, expectedIdentityId: 'identity:mallory' })
    ).rejects.toThrow(/does not match expectedIdentityId/);
    await store.delete();
  });

  it('does not project a cross-identity event that the local key cannot decrypt', async () => {
    const store = freshStore();
    const aliceKey = generatePrivatePayloadKeyMaterial();
    const malloryKey = generatePrivatePayloadKeyMaterial();
    // Mallory forges an event authored as alice, encrypted to Mallory's key.
    const forged = await makeUdrEvent(
      'udr.space.joined',
      { spaceId: 'evil', joinedAt: 'x' },
      malloryKey,
      {
        author: IDENTITY
      }
    );
    // Alice's device processes it with alice's key → cannot decrypt → no projection.
    const result = await store.appendUdrEvent(forged, { keyMaterial: aliceKey });
    expect(result.status).toBe('undecryptable');
    expect(await store.getUserDataRoot(IDENTITY)).toBeUndefined();
    await store.delete();
  });
});
