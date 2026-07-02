import { describe, expect, it } from 'vitest';
import {
  decodeIdentityBinding,
  encodeIdentityBinding,
  InMemoryMlsStateStore,
  MlsProviderError,
  PINNED_CIPHERSUITE,
  TsMlsProvider
} from '../index.js';
import type { MlsIdentityBinding, MlsStateStore } from '../index.js';
import { decodePrivateKeyPackage, encodePrivateKeyPackage } from '../private-key-package-codec.js';

const alice: MlsIdentityBinding = {
  controllerId: 'controller-alice',
  deviceId: 'device-alice-1',
  signingKeyRef: 'sha-256:alice-signing-key'
};
const bob: MlsIdentityBinding = {
  controllerId: 'controller-bob',
  deviceId: 'device-bob-1',
  signingKeyRef: 'sha-256:bob-signing-key'
};
const carol: MlsIdentityBinding = {
  controllerId: 'controller-carol',
  deviceId: 'device-carol-1',
  signingKeyRef: 'sha-256:carol-signing-key'
};

function makeProvider(identity: MlsIdentityBinding, store?: MlsStateStore): TsMlsProvider {
  return new TsMlsProvider({ identity, store: store ?? new InMemoryMlsStateStore() });
}

function groupIdOf(name: string): Uint8Array {
  return new TextEncoder().encode(name);
}

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<MlsProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(MlsProviderError);
    const mpe = error as MlsProviderError;
    expect(mpe.code).toBe(code);
    return mpe;
  }
  throw new Error(`expected rejection with ${code}`);
}

/** Create a two-member group: alice creates, bob joins via welcome. */
async function twoMemberGroup(): Promise<{
  aliceProvider: TsMlsProvider;
  bobProvider: TsMlsProvider;
  groupId: Uint8Array;
}> {
  const aliceProvider = makeProvider(alice);
  const bobProvider = makeProvider(bob);
  const groupId = groupIdOf(`group-${Math.random().toString(36).slice(2)}`);

  await aliceProvider.createGroup(groupId);
  const bobKp = await bobProvider.generateKeyPackage();
  const commit = await aliceProvider.addMembers(groupId, [bobKp.keyPackageWire]);
  if (commit.welcomeWire === undefined) throw new Error('expected a welcome');
  await bobProvider.joinFromWelcome(commit.welcomeWire, bobKp.keyPackageWire);
  return { aliceProvider, bobProvider, groupId };
}

// ---------------------------------------------------------------------------
// identity binding
// ---------------------------------------------------------------------------

describe('identity binding codec', () => {
  it('round-trips and is deterministic', () => {
    const encoded = encodeIdentityBinding(alice);
    expect(encodeIdentityBinding(alice)).toEqual(encoded);
    expect(decodeIdentityBinding(encoded)).toEqual(alice);
  });

  it('fails closed on malformed, oversized, or tampered payloads', () => {
    const encoder = new TextEncoder();
    const cases = [
      encoder.encode('not json'),
      encoder.encode('[]'),
      encoder.encode('{"v":"lfp2p.mls-credential.v1"}'),
      encoder.encode('{"v":"wrong.version","controllerId":"a","deviceId":"b","signingKeyRef":"c"}'),
      encoder.encode(
        '{"v":"lfp2p.mls-credential.v1","controllerId":"a","deviceId":"b","signingKeyRef":"c","extra":"x"}'
      ),
      encoder.encode(
        `{"v":"lfp2p.mls-credential.v1","controllerId":"${'x'.repeat(300)}","deviceId":"b","signingKeyRef":"c"}`
      ),
      new Uint8Array(0),
      new Uint8Array(2048).fill(0x7b)
    ];
    for (const bytes of cases) {
      expect(() => decodeIdentityBinding(bytes)).toThrow(MlsProviderError);
    }
  });

  it('rejects prototype-pollution shaped identities at validation', () => {
    expect(() =>
      encodeIdentityBinding({ controllerId: '', deviceId: 'd', signingKeyRef: 'k' })
    ).toThrow(MlsProviderError);
    expect(
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new TsMlsProvider({ identity: null as any, store: new InMemoryMlsStateStore() })
    ).toThrow(MlsProviderError);
  });
});

// ---------------------------------------------------------------------------
// private key package codec
// ---------------------------------------------------------------------------

describe('private key package codec', () => {
  it('round-trips', () => {
    const pkg = {
      initPrivateKey: new Uint8Array([1, 2, 3]),
      hpkePrivateKey: new Uint8Array([4, 5]),
      signaturePrivateKey: new Uint8Array([6, 7, 8, 9])
    };
    expect(decodePrivateKeyPackage(encodePrivateKeyPackage(pkg))).toEqual(pkg);
  });

  it('rejects truncation, trailing bytes, bad versions, and hostile lengths', () => {
    const encoded = encodePrivateKeyPackage({
      initPrivateKey: new Uint8Array([1]),
      hpkePrivateKey: new Uint8Array([2]),
      signaturePrivateKey: new Uint8Array([3])
    });
    expect(() => decodePrivateKeyPackage(encoded.slice(0, encoded.length - 1))).toThrow(
      MlsProviderError
    );
    const trailing = new Uint8Array(encoded.length + 1);
    trailing.set(encoded);
    expect(() => decodePrivateKeyPackage(trailing)).toThrow(MlsProviderError);
    const badVersion = encoded.slice();
    badVersion[0] = 9;
    expect(() => decodePrivateKeyPackage(badVersion)).toThrow(MlsProviderError);
    const hostileLength = encoded.slice();
    hostileLength[1] = 0xff;
    hostileLength[2] = 0xff;
    hostileLength[3] = 0xff;
    hostileLength[4] = 0xff;
    expect(() => decodePrivateKeyPackage(hostileLength)).toThrow(MlsProviderError);
  });
});

// ---------------------------------------------------------------------------
// provider construction
// ---------------------------------------------------------------------------

describe('TsMlsProvider construction', () => {
  it('rejects any non-pinned ciphersuite (no downgrade path)', () => {
    expect(
      () =>
        new TsMlsProvider({
          identity: alice,
          store: new InMemoryMlsStateStore(),
          ciphersuite: 'MLS_128_DHKEMP256_AES128GCM_SHA256_P256'
        })
    ).toThrow(MlsProviderError);
    expect(
      () =>
        new TsMlsProvider({
          identity: alice,
          store: new InMemoryMlsStateStore(),
          ciphersuite: PINNED_CIPHERSUITE
        })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// group lifecycle (real crypto end to end)
// ---------------------------------------------------------------------------

describe('group lifecycle', () => {
  it('creates a group, adds a member, exchanges messages both ways', async () => {
    const { aliceProvider, bobProvider, groupId } = await twoMemberGroup();

    const aliceCheckpoint = await aliceProvider.exportCheckpoint(groupId);
    const bobCheckpoint = await bobProvider.exportCheckpoint(groupId);
    expect(aliceCheckpoint.epoch).toBe(1);
    expect(bobCheckpoint.epoch).toBe(1);
    expect(aliceCheckpoint.memberCount).toBe(2);
    // Membership digest is deterministic across members.
    expect(aliceCheckpoint.membershipDigest).toEqual(bobCheckpoint.membershipDigest);

    const toBob = await aliceProvider.encryptApplicationMessage(
      groupId,
      new TextEncoder().encode('hello bob')
    );
    const received = await bobProvider.processMessage(groupId, toBob.messageWire);
    if (received.kind !== 'application') throw new Error('expected application message');
    expect(text(received.plaintext)).toBe('hello bob');

    const toAlice = await bobProvider.encryptApplicationMessage(
      groupId,
      new TextEncoder().encode('hi alice')
    );
    const received2 = await aliceProvider.processMessage(groupId, toAlice.messageWire);
    if (received2.kind !== 'application') throw new Error('expected application message');
    expect(text(received2.plaintext)).toBe('hi alice');
  });

  it('the wire never contains plaintext', async () => {
    const { aliceProvider, groupId } = await twoMemberGroup();
    const secret = 'extremely secret plaintext payload';
    const { messageWire } = await aliceProvider.encryptApplicationMessage(
      groupId,
      new TextEncoder().encode(secret)
    );
    expect(text(messageWire)).not.toContain(secret);
  });

  it('rejects duplicate group creation and unknown groups', async () => {
    const provider = makeProvider(alice);
    const groupId = groupIdOf('dup-group');
    await provider.createGroup(groupId);
    await expectCode(provider.createGroup(groupId), 'MLS_GROUP_EXISTS');
    await expectCode(provider.exportCheckpoint(groupIdOf('never-created')), 'MLS_UNKNOWN_GROUP');
  });

  it('lists members with resolved identity bindings', async () => {
    const { aliceProvider, groupId } = await twoMemberGroup();
    const members = await aliceProvider.listMembers(groupId);
    const controllerIds = members.map((m) => m.controllerId).sort();
    expect(controllerIds).toEqual(['controller-alice', 'controller-bob']);
  });

  it('removes a member; the removed device cannot decrypt or send afterwards', async () => {
    const { aliceProvider, bobProvider, groupId } = await twoMemberGroup();

    const removal = await aliceProvider.removeMember(groupId, bob);
    expect(removal.checkpoint.memberCount).toBe(1);
    expect(removal.checkpoint.epoch).toBe(2);

    // Bob processes the commit that removes him.
    const result = await bobProvider.processMessage(groupId, removal.commitWire);
    if (result.kind !== 'handshake') throw new Error('expected handshake');
    expect(result.checkpoint.active).toBe('removedFromGroup');

    // Bob can no longer send.
    await expectCode(
      bobProvider.encryptApplicationMessage(groupId, new TextEncoder().encode('ghost')),
      'MLS_REMOVED_FROM_GROUP'
    );

    // Once removed, the provider fails closed on ALL further message
    // processing for the group — it never decrypts for a group the
    // device no longer belongs to.
    const postRemoval = await aliceProvider.encryptApplicationMessage(
      groupId,
      new TextEncoder().encode('bob cannot read this')
    );
    await expectCode(
      bobProvider.processMessage(groupId, postRemoval.messageWire),
      'MLS_REMOVED_FROM_GROUP'
    );
  });

  it('removeMember refuses self-removal and unknown members', async () => {
    const { aliceProvider, groupId } = await twoMemberGroup();
    await expectCode(aliceProvider.removeMember(groupId, alice), 'MLS_INVALID_INPUT');
    await expectCode(aliceProvider.removeMember(groupId, carol), 'MLS_MEMBER_NOT_FOUND');
  });

  it('rotateOwnLeaf advances the epoch and keeps messaging working', async () => {
    const { aliceProvider, bobProvider, groupId } = await twoMemberGroup();
    const rotation = await aliceProvider.rotateOwnLeaf(groupId);
    expect(rotation.checkpoint.epoch).toBe(2);
    expect(rotation.welcomeWire).toBeUndefined();

    const processed = await bobProvider.processMessage(groupId, rotation.commitWire);
    if (processed.kind !== 'handshake') throw new Error('expected handshake');
    expect(processed.checkpoint.epoch).toBe(2);

    const message = await aliceProvider.encryptApplicationMessage(
      groupId,
      new TextEncoder().encode('post-rotation')
    );
    const received = await bobProvider.processMessage(groupId, message.messageWire);
    if (received.kind !== 'application') throw new Error('expected application message');
    expect(text(received.plaintext)).toBe('post-rotation');
  });

  it('supports three members with converging membership digests', async () => {
    const { aliceProvider, bobProvider, groupId } = await twoMemberGroup();
    const carolProvider = makeProvider(carol);
    const carolKp = await carolProvider.generateKeyPackage();
    const commit = await aliceProvider.addMembers(groupId, [carolKp.keyPackageWire]);
    if (commit.welcomeWire === undefined) throw new Error('expected welcome');

    await bobProvider.processMessage(groupId, commit.commitWire);
    await carolProvider.joinFromWelcome(commit.welcomeWire, carolKp.keyPackageWire);

    const [a, b, c] = await Promise.all([
      aliceProvider.exportCheckpoint(groupId),
      bobProvider.exportCheckpoint(groupId),
      carolProvider.exportCheckpoint(groupId)
    ]);
    expect(a.memberCount).toBe(3);
    expect(a.membershipDigest).toEqual(b.membershipDigest);
    expect(b.membershipDigest).toEqual(c.membershipDigest);

    // Carol can message everyone.
    const fromCarol = await carolProvider.encryptApplicationMessage(
      groupId,
      new TextEncoder().encode('hi from carol')
    );
    const atAlice = await aliceProvider.processMessage(groupId, fromCarol.messageWire);
    const atBob = await bobProvider.processMessage(groupId, fromCarol.messageWire);
    if (atAlice.kind !== 'application' || atBob.kind !== 'application') {
      throw new Error('expected application messages');
    }
    expect(text(atAlice.plaintext)).toBe('hi from carol');
    expect(text(atBob.plaintext)).toBe('hi from carol');
  });
});

// ---------------------------------------------------------------------------
// adversarial and safety behavior
// ---------------------------------------------------------------------------

describe('adversarial behavior', () => {
  it('consume-once: a welcome cannot be joined twice with the same key package', async () => {
    const aliceProvider = makeProvider(alice);
    const bobProvider = makeProvider(bob);
    const groupId = groupIdOf('consume-once');
    await aliceProvider.createGroup(groupId);
    const bobKp = await bobProvider.generateKeyPackage();
    const commit = await aliceProvider.addMembers(groupId, [bobKp.keyPackageWire]);
    if (commit.welcomeWire === undefined) throw new Error('expected welcome');
    await bobProvider.joinFromWelcome(commit.welcomeWire, bobKp.keyPackageWire);
    // Replay of the same welcome: private half is gone.
    await expectCode(
      bobProvider.joinFromWelcome(commit.welcomeWire, bobKp.keyPackageWire),
      'MLS_UNKNOWN_KEY_PACKAGE'
    );
  });

  it('consume-once holds under CONCURRENT duplicate welcome deliveries', async () => {
    const aliceProvider = makeProvider(alice);
    const bobProvider = makeProvider(bob);
    const groupId = groupIdOf('consume-once-concurrent');
    await aliceProvider.createGroup(groupId);
    const bobKp = await bobProvider.generateKeyPackage();
    const commit = await aliceProvider.addMembers(groupId, [bobKp.keyPackageWire]);
    if (commit.welcomeWire === undefined) throw new Error('expected welcome');

    // Two concurrent joins for the SAME welcome/key package. The
    // per-KeyPackage lock must let exactly one succeed and the other
    // fail closed — never both race through joinGroup/saveState.
    const results = await Promise.allSettled([
      bobProvider.joinFromWelcome(commit.welcomeWire, bobKp.keyPackageWire),
      bobProvider.joinFromWelcome(commit.welcomeWire, bobKp.keyPackageWire)
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as MlsProviderError;
    expect(reason).toBeInstanceOf(MlsProviderError);
    expect(reason.code).toBe('MLS_UNKNOWN_KEY_PACKAGE');
  });

  it('rejects a welcome for a key package generated by someone else', async () => {
    const aliceProvider = makeProvider(alice);
    const bobProvider = makeProvider(bob);
    const carolProvider = makeProvider(carol);
    const groupId = groupIdOf('foreign-kp');
    await aliceProvider.createGroup(groupId);
    const bobKp = await bobProvider.generateKeyPackage();
    const commit = await aliceProvider.addMembers(groupId, [bobKp.keyPackageWire]);
    if (commit.welcomeWire === undefined) throw new Error('expected welcome');
    // Carol intercepts the welcome but has no private half for bob's kp.
    await expectCode(
      carolProvider.joinFromWelcome(commit.welcomeWire, bobKp.keyPackageWire),
      'MLS_UNKNOWN_KEY_PACKAGE'
    );
  });

  it('rejects messages addressed to a different group', async () => {
    const { aliceProvider, bobProvider, groupId } = await twoMemberGroup();
    const other = groupIdOf('other-group');
    await bobProvider.createGroup(other);
    const message = await aliceProvider.encryptApplicationMessage(
      groupId,
      new TextEncoder().encode('routed wrong')
    );
    await expectCode(bobProvider.processMessage(other, message.messageWire), 'MLS_WRONG_GROUP');
  });

  it('rejects malformed and truncated wire input without corrupting state', async () => {
    const { aliceProvider, bobProvider, groupId } = await twoMemberGroup();
    await expectCode(bobProvider.processMessage(groupId, new Uint8Array(0)), 'MLS_INVALID_INPUT');
    await expectCode(
      bobProvider.processMessage(groupId, new Uint8Array([0xff, 0xff, 0xff])),
      'MLS_INVALID_INPUT'
    );
    const valid = await aliceProvider.encryptApplicationMessage(
      groupId,
      new TextEncoder().encode('still works')
    );
    const trailing = new Uint8Array(valid.messageWire.byteLength + 4);
    trailing.set(valid.messageWire);
    await expectCode(bobProvider.processMessage(groupId, trailing), 'MLS_INVALID_INPUT');
    // After all the garbage, the real message still decrypts.
    const received = await bobProvider.processMessage(groupId, valid.messageWire);
    if (received.kind !== 'application') throw new Error('expected application message');
    expect(text(received.plaintext)).toBe('still works');
  });

  it('rejects key packages with foreign credential encodings', async () => {
    const { aliceProvider, groupId } = await twoMemberGroup();
    // A key package whose credential is not an lfp2p binding must be
    // rejected before it ever reaches a commit.
    const forged = new Uint8Array([0, 1, 0, 5, 1, 2, 3, 4, 5]);
    await expectCode(aliceProvider.addMembers(groupId, [forged]), 'MLS_INVALID_INPUT');
  });

  it('replayed commits fail without corrupting local state', async () => {
    const { aliceProvider, bobProvider, groupId } = await twoMemberGroup();
    const rotation = await aliceProvider.rotateOwnLeaf(groupId);
    await bobProvider.processMessage(groupId, rotation.commitWire);
    // Replay the same commit: stale epoch, rejected safely.
    await expect(bobProvider.processMessage(groupId, rotation.commitWire)).rejects.toThrow(
      MlsProviderError
    );
    // State intact: messaging still works.
    const message = await aliceProvider.encryptApplicationMessage(
      groupId,
      new TextEncoder().encode('replay survived')
    );
    const received = await bobProvider.processMessage(groupId, message.messageWire);
    if (received.kind !== 'application') throw new Error('expected application message');
    expect(text(received.plaintext)).toBe('replay survived');
  });

  it('enforces input bounds (group id, plaintext size, adds per commit)', async () => {
    const provider = makeProvider(alice);
    await expectCode(provider.createGroup(new Uint8Array(0)), 'MLS_INVALID_INPUT');
    await expectCode(provider.createGroup(new Uint8Array(300)), 'MLS_INVALID_INPUT');

    const groupId = groupIdOf('bounds');
    await provider.createGroup(groupId);
    await expectCode(
      provider.encryptApplicationMessage(groupId, new Uint8Array(0)),
      'MLS_INVALID_INPUT'
    );
    await expectCode(
      provider.encryptApplicationMessage(groupId, new Uint8Array(1024 * 1024 + 1)),
      'MLS_INVALID_INPUT'
    );
    await expectCode(provider.addMembers(groupId, []), 'MLS_INVALID_INPUT');
  });

  it('never leaks upstream library error text', async () => {
    const { bobProvider, groupId } = await twoMemberGroup();
    const junk = new Uint8Array(64).fill(7);
    try {
      await bobProvider.processMessage(groupId, junk);
      throw new Error('expected rejection');
    } catch (error) {
      const message = (error as Error).message;
      // Provider messages are stable tokens, not library internals.
      expect(message).toMatch(/\[MLS_/);
    }
  });
});

// ---------------------------------------------------------------------------
// persistence and concurrency
// ---------------------------------------------------------------------------

describe('persistence and concurrency', () => {
  it('state survives a provider restart via the injected store', async () => {
    const aliceStore = new InMemoryMlsStateStore();
    const bobStore = new InMemoryMlsStateStore();
    const aliceProvider = makeProvider(alice, aliceStore);
    const bobProvider = makeProvider(bob, bobStore);
    const groupId = groupIdOf('persistent-group');

    await aliceProvider.createGroup(groupId);
    const bobKp = await bobProvider.generateKeyPackage();
    const commit = await aliceProvider.addMembers(groupId, [bobKp.keyPackageWire]);
    if (commit.welcomeWire === undefined) throw new Error('expected welcome');
    await bobProvider.joinFromWelcome(commit.welcomeWire, bobKp.keyPackageWire);

    // "Restart" both sides: fresh provider instances over the same stores.
    const aliceRestarted = makeProvider(alice, aliceStore);
    const bobRestarted = makeProvider(bob, bobStore);

    const message = await aliceRestarted.encryptApplicationMessage(
      groupId,
      new TextEncoder().encode('after restart')
    );
    const received = await bobRestarted.processMessage(groupId, message.messageWire);
    if (received.kind !== 'application') throw new Error('expected application message');
    expect(text(received.plaintext)).toBe('after restart');
    const checkpoint = await bobRestarted.exportCheckpoint(groupId);
    expect(checkpoint.epoch).toBe(1);
  });

  it('serializes concurrent sends so none are lost or corrupted', async () => {
    const { aliceProvider, bobProvider, groupId } = await twoMemberGroup();
    const payloads = ['m0', 'm1', 'm2', 'm3', 'm4'];
    const sent = await Promise.all(
      payloads.map((p) =>
        aliceProvider.encryptApplicationMessage(groupId, new TextEncoder().encode(p))
      )
    );
    const receivedTexts: string[] = [];
    for (const { messageWire } of sent) {
      const received = await bobProvider.processMessage(groupId, messageWire);
      if (received.kind !== 'application') throw new Error('expected application message');
      receivedTexts.push(text(received.plaintext));
    }
    expect(receivedTexts.sort()).toEqual(payloads);
  });

  it('deleteGroup removes state and further use fails closed', async () => {
    const { aliceProvider, groupId } = await twoMemberGroup();
    expect(await aliceProvider.deleteGroup(groupId)).toBe(true);
    expect(await aliceProvider.hasGroup(groupId)).toBe(false);
    await expectCode(
      aliceProvider.encryptApplicationMessage(groupId, new TextEncoder().encode('gone')),
      'MLS_UNKNOWN_GROUP'
    );
  });
});
