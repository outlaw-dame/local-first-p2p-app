import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { signingKeypairFromSeed } from '@lfp2p/crypto';
import { generatePrivatePayloadKeyMaterial } from '@lfp2p/private-payload';
import { createLocalFirstStore } from '@lfp2p/local-store';
import {
  buildUdrViewModel,
  emitFeedSubscriptionAdded,
  emitFeedSubscriptionRemoved,
  emitMailboxBound,
  emitPartitionClaimed,
  emitPartitionReleased,
  emitSpaceJoined,
  emitSpaceLeft,
  emitSyncInterestAdded,
  emitSyncInterestRemoved,
  type UdrEmitContext
} from './pwa-udr-state.js';

const IDENTITY = 'identity:alice';
const DEVICE = 'device:alice-phone';
const KEYPAIR = signingKeypairFromSeed(new Uint8Array(32).fill(7));

let dbSeq = 0;
function ctx(): UdrEmitContext & { cleanup: () => Promise<void> } {
  dbSeq += 1;
  const store = createLocalFirstStore(`pwa-udr-${dbSeq}-${globalThis.crypto.randomUUID()}`);
  return {
    store,
    identityId: IDENTITY,
    deviceId: DEVICE,
    signingKeypair: KEYPAIR,
    keyMaterial: generatePrivatePayloadKeyMaterial(),
    keyId: 'content:key:alice-udr',
    cleanup: () => store.delete()
  };
}

describe('buildUdrViewModel', () => {
  it('returns an empty, deep-frozen view model when no row exists', async () => {
    const c = ctx();
    const vm = await buildUdrViewModel(c.store, IDENTITY);
    expect(vm.present).toBe(false);
    expect(vm.partitions).toEqual([]);
    expect(vm.mailboxId).toBeUndefined();
    expect(vm.counts).toEqual({
      partitions: 0,
      feedSubscriptions: 0,
      syncInterests: 0,
      spaces: 0
    });
    expect(Object.isFrozen(vm)).toBe(true);
    expect(Object.isFrozen(vm.partitions)).toBe(true);
    await c.cleanup();
  });

  it('rejects an empty identityId', async () => {
    const c = ctx();
    await expect(buildUdrViewModel(c.store, '')).rejects.toThrow(/identityId/);
    await c.cleanup();
  });
});

describe('emit + view model (real encryption end-to-end)', () => {
  it('emits a space join that decrypts, projects, and surfaces in the view model', async () => {
    const c = ctx();
    // status 'applied' proves the PWA-built AAD matches the store's
    // decrypt AAD byte-for-byte — otherwise this would be 'undecryptable'.
    const res = await emitSpaceJoined({ ...c, spaceId: 'sp1' });
    expect(res.status).toBe('applied');

    const vm = await buildUdrViewModel(c.store, IDENTITY);
    expect(vm.present).toBe(true);
    expect(vm.spaces).toEqual(['sp1']);
    expect(vm.counts.spaces).toBe(1);
    await c.cleanup();
  });

  it('projects a full multi-kind UDR and reflects it in the view model', async () => {
    const c = ctx();
    await emitPartitionClaimed({ ...c, partitionId: 'p2', scope: 'private' });
    await emitPartitionClaimed({ ...c, partitionId: 'p1' });
    await emitFeedSubscriptionAdded({ ...c, feedId: 'f1', feedKind: 'following' });
    await emitSyncInterestAdded({ ...c, syncInterestId: 'si1', interest: { scope: 'all' } });
    await emitMailboxBound({ ...c, mailboxId: 'mb1' });
    await emitSpaceJoined({ ...c, spaceId: 'sp1' });

    const vm = await buildUdrViewModel(c.store, IDENTITY);
    expect(vm.partitions).toEqual(['p1', 'p2']); // canonical sorted
    expect(vm.feedSubscriptions).toEqual(['f1']);
    expect(vm.syncInterests).toEqual(['si1']);
    expect(vm.mailboxId).toBe('mb1');
    expect(vm.spaces).toEqual(['sp1']);
    expect(vm.counts).toEqual({
      partitions: 2,
      feedSubscriptions: 1,
      syncInterests: 1,
      spaces: 1
    });
    await c.cleanup();
  });

  it('release / remove / leave retract from the view model', async () => {
    const c = ctx();
    await emitPartitionClaimed({ ...c, partitionId: 'p1' });
    await emitFeedSubscriptionAdded({ ...c, feedId: 'f1' });
    await emitSyncInterestAdded({ ...c, syncInterestId: 'si1' });
    await emitSpaceJoined({ ...c, spaceId: 'sp1' });

    await emitPartitionReleased({ ...c, partitionId: 'p1' });
    await emitFeedSubscriptionRemoved({ ...c, feedId: 'f1' });
    await emitSyncInterestRemoved({ ...c, syncInterestId: 'si1' });
    await emitSpaceLeft({ ...c, spaceId: 'sp1' });

    const vm = await buildUdrViewModel(c.store, IDENTITY);
    expect(vm.partitions).toEqual([]);
    expect(vm.feedSubscriptions).toEqual([]);
    expect(vm.syncInterests).toEqual([]);
    expect(vm.spaces).toEqual([]);
    await c.cleanup();
  });

  it('is idempotent on a pinned eventId (re-emit is a skipped no-op)', async () => {
    const c = ctx();
    const first = await emitSpaceJoined({ ...c, spaceId: 'sp1', eventId: 'evt_fixed_1' });
    expect(first.status).toBe('applied');
    const second = await emitSpaceJoined({ ...c, spaceId: 'sp1', eventId: 'evt_fixed_1' });
    expect(second.status).toBe('skipped');
    const vm = await buildUdrViewModel(c.store, IDENTITY);
    expect(vm.spaces).toEqual(['sp1']);
    await c.cleanup();
  });

  it('the persisted event is authored by the emitting identity (IDOR surface)', async () => {
    const c = ctx();
    const res = await emitSpaceJoined({ ...c, spaceId: 'sp1', eventId: 'evt_author_1' });
    expect(res.status).toBe('applied');
    const stored = await c.store.getSignedEvent('evt_author_1');
    expect(stored?.author).toBe(IDENTITY);
    expect(stored?.privacy).toBe('self');
    // Payload on the wire is ciphertext, never the plaintext spaceId.
    expect(JSON.stringify(stored?.payload)).not.toContain('sp1');
    await c.cleanup();
  });

  it('survives a full rebuild from the durable log (loadUdrState)', async () => {
    const c = ctx();
    await emitPartitionClaimed({ ...c, partitionId: 'p1' });
    await emitSpaceJoined({ ...c, spaceId: 'sp1' });
    const rebuilt = await c.store.loadUdrState(IDENTITY, c.keyMaterial);
    expect([...rebuilt.partitionIds]).toEqual(['p1']);
    expect([...rebuilt.spaceIds]).toEqual(['sp1']);
    await c.cleanup();
  });
});

describe('emit input sanitation', () => {
  it('rejects empty / oversized ids before emitting', async () => {
    const c = ctx();
    await expect(emitSpaceJoined({ ...c, spaceId: '' })).rejects.toThrow(/spaceId/);
    await expect(emitPartitionClaimed({ ...c, partitionId: 'x'.repeat(513) })).rejects.toThrow(
      /partitionId/
    );
    await expect(emitMailboxBound({ ...c, mailboxId: '' })).rejects.toThrow(/mailboxId/);
    // Nothing was persisted by the rejected emits.
    const vm = await buildUdrViewModel(c.store, IDENTITY);
    expect(vm.present).toBe(false);
    await c.cleanup();
  });

  it('rejects an empty keyMaterial / keyId in the context', async () => {
    const c = ctx();
    await expect(emitSpaceJoined({ ...c, keyMaterial: '', spaceId: 'sp1' })).rejects.toThrow(
      /keyMaterial/
    );
    await expect(emitSpaceJoined({ ...c, keyId: '', spaceId: 'sp1' })).rejects.toThrow(/keyId/);
    await c.cleanup();
  });
});
