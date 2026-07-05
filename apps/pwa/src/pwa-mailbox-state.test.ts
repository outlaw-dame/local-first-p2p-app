import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { signingKeypairFromSeed, type SigningKeypair } from '@lfp2p/crypto';
import { generatePrivatePayloadKeyMaterial } from '@lfp2p/private-payload';
import { createLocalFirstStore } from '@lfp2p/local-store';
import type {
  MailboxEnvelopeKeyResolution,
  StoredMailboxInboxRow,
  StoredMailboxOutboxRow
} from '@lfp2p/local-store';
import {
  buildMailboxInboxViewModel,
  createMailboxSweepRunner,
  emitMailboxEnvelopeQueued,
  emitMailboxReceiptIssued,
  sweepAfterForegroundSync,
  type MailboxSweepRunner
} from './pwa-mailbox-state.js';

const ALICE = 'identity:alice';
const BOB = 'identity:bob';
const DEVICE = 'device:bob-1';
const KEYPAIR: SigningKeypair = signingKeypairFromSeed(new Uint8Array(32).fill(9));

const FUTURE = '2026-08-01T00:00:00.000Z';
const PAST = '2026-07-01T00:00:00.000Z';
const NOW = '2026-07-04T12:00:00.000Z';

let dbSeq = 0;
type Ctx = {
  store: ReturnType<typeof createLocalFirstStore>;
  identityId: string;
  deviceId: string;
  signingKeypair: SigningKeypair;
  convKey: string;
  convKeyId: string;
  selfKey: string;
  selfKeyId: string;
  cleanup: () => Promise<void>;
};
function ctx(identityId = BOB): Ctx {
  dbSeq += 1;
  const store = createLocalFirstStore(`pwa-mbx-${dbSeq}-${globalThis.crypto.randomUUID()}`);
  return {
    store,
    identityId,
    deviceId: DEVICE,
    signingKeypair: KEYPAIR,
    convKey: generatePrivatePayloadKeyMaterial(),
    convKeyId: 'content:key:conv',
    selfKey: generatePrivatePayloadKeyMaterial(),
    selfKeyId: 'content:key:self',
    cleanup: () => store.delete()
  };
}

/** Emit a self-to-self queued envelope (populates the emitter's inbox). */
async function queueSelf(
  c: Ctx,
  over: Partial<{
    envelopeId: string;
    recipientDeviceId: string;
    contentRef: string;
    expiresAt: string;
    forwardedFrom: string;
  }> = {}
): Promise<void> {
  const res = await emitMailboxEnvelopeQueued({
    store: c.store,
    identityId: c.identityId,
    deviceId: c.deviceId,
    signingKeypair: c.signingKeypair,
    envelope: {
      envelopeId: over.envelopeId ?? 'e1',
      recipientIdentityId: c.identityId,
      contentRef: over.contentRef ?? 'sha-256:abc',
      expiresAt: over.expiresAt ?? FUTURE,
      ...(over.recipientDeviceId ? { recipientDeviceId: over.recipientDeviceId } : {}),
      ...(over.forwardedFrom ? { forwardedFrom: over.forwardedFrom } : {})
    },
    conversationKey: { keyMaterial: c.convKey, keyId: c.convKeyId, privacy: 'dm' }
  });
  expect(res.status).toBe('applied');
}

describe('buildMailboxInboxViewModel', () => {
  it('returns an empty, deep-frozen list when the inbox is empty', async () => {
    const c = ctx();
    const vm = await buildMailboxInboxViewModel(c.store, BOB);
    expect(vm).toEqual([]);
    expect(Object.isFrozen(vm)).toBe(true);
    await c.cleanup();
  });

  it('rejects an empty identityId and a malformed now', async () => {
    const c = ctx();
    await expect(buildMailboxInboxViewModel(c.store, '')).rejects.toThrow(/identityId/);
    await expect(buildMailboxInboxViewModel(c.store, BOB, 'not-a-date')).rejects.toThrow(/now/);
    await c.cleanup();
  });

  it('projects a queued envelope with visible addressing (no deviceId leak)', async () => {
    const c = ctx();
    await queueSelf(c);
    const [item] = await buildMailboxInboxViewModel(c.store, BOB, NOW);
    expect(item?.envelopeId).toBe('e1');
    expect(item?.senderIdentityId).toBe(BOB);
    expect(item?.status).toBe('queued');
    expect(item?.addressing).toBe('visible');
    expect(item?.isExpired).toBe(false);
    expect(Object.isFrozen(item)).toBe(true);
    // Hardening: the raw recipientDeviceId must never appear in the VM.
    expect(Object.keys(item ?? {})).not.toContain('recipientDeviceId');
    await c.cleanup();
  });

  it('marks sealed addressing without exposing the device id, and surfaces forwardedFrom', async () => {
    const c = ctx();
    await queueSelf(c, {
      recipientDeviceId: 'device:bob-secret',
      forwardedFrom: 'env-original'
    });
    const [item] = await buildMailboxInboxViewModel(c.store, BOB, NOW);
    expect(item?.addressing).toBe('sealed');
    expect(item?.forwardedFrom).toBe('env-original');
    expect(JSON.stringify(item)).not.toContain('device:bob-secret');
    await c.cleanup();
  });

  it('derives isExpired from now even before the sweep runs', async () => {
    const c = ctx();
    await queueSelf(c, { expiresAt: PAST });
    const [item] = await buildMailboxInboxViewModel(c.store, BOB, NOW);
    expect(item?.status).toBe('queued'); // not yet swept
    expect(item?.isExpired).toBe(true); // availability already gone
    await c.cleanup();
  });

  it('sorts by soonest expiry then envelopeId', async () => {
    const c = ctx();
    await queueSelf(c, { envelopeId: 'e-late', expiresAt: '2026-09-01T00:00:00.000Z' });
    await queueSelf(c, { envelopeId: 'e-early', expiresAt: '2026-08-01T00:00:00.000Z' });
    await queueSelf(c, { envelopeId: 'e-early2', expiresAt: '2026-08-01T00:00:00.000Z' });
    const vm = await buildMailboxInboxViewModel(c.store, BOB, NOW);
    expect(vm.map((i) => i.envelopeId)).toEqual(['e-early', 'e-early2', 'e-late']);
    await c.cleanup();
  });

  it('IDOR: a different identity sees none of this inbox', async () => {
    const c = ctx();
    await queueSelf(c);
    expect(await buildMailboxInboxViewModel(c.store, ALICE, NOW)).toEqual([]);
    await c.cleanup();
  });
});

describe('emitMailboxEnvelopeQueued', () => {
  it('pins senderIdentityId to the emitter (cannot be spoofed)', async () => {
    const c = ctx();
    await queueSelf(c);
    const [item] = await buildMailboxInboxViewModel(c.store, BOB, NOW);
    expect(item?.senderIdentityId).toBe(BOB);
    // Sender also has an outbox row for the same envelope.
    const outbox = await c.store.getMailboxOutbox(BOB);
    expect(outbox.map((r) => r.envelopeId)).toContain('e1');
    await c.cleanup();
  });

  it('rejects a missing/invalid conversation key privacy', async () => {
    const c = ctx();
    await expect(
      emitMailboxEnvelopeQueued({
        store: c.store,
        identityId: BOB,
        deviceId: DEVICE,
        signingKeypair: KEYPAIR,
        envelope: {
          envelopeId: 'e1',
          recipientIdentityId: BOB,
          contentRef: 'r',
          expiresAt: FUTURE
        },
        conversationKey: { keyMaterial: c.convKey, keyId: c.convKeyId, privacy: 'self' as never }
      })
    ).rejects.toThrow(/privacy must be/);
    await c.cleanup();
  });

  it('rejects a malformed expiresAt and empty ids', async () => {
    const c = ctx();
    const base = {
      store: c.store,
      identityId: BOB,
      deviceId: DEVICE,
      signingKeypair: KEYPAIR,
      conversationKey: { keyMaterial: c.convKey, keyId: c.convKeyId, privacy: 'dm' as const }
    };
    await expect(
      emitMailboxEnvelopeQueued({
        ...base,
        envelope: { envelopeId: 'e1', recipientIdentityId: BOB, contentRef: 'r', expiresAt: 'nope' }
      })
    ).rejects.toThrow(/expiresAt/);
    await expect(
      emitMailboxEnvelopeQueued({
        ...base,
        envelope: { envelopeId: '', recipientIdentityId: BOB, contentRef: 'r', expiresAt: FUTURE }
      })
    ).rejects.toThrow(/envelopeId/);
    await c.cleanup();
  });
});

describe('emitMailboxReceiptIssued', () => {
  it('annotates the recipient inbox entry with a receipt', async () => {
    const c = ctx();
    await queueSelf(c);
    const res = await emitMailboxReceiptIssued({
      store: c.store,
      identityId: BOB,
      deviceId: DEVICE,
      signingKeypair: KEYPAIR,
      envelopeId: 'e1',
      receiptId: 'rcpt-1',
      receiptKind: 'recipient-applied',
      selfKey: { keyMaterial: c.selfKey, keyId: c.selfKeyId }
    });
    expect(res.status).toBe('applied');
    const [item] = await buildMailboxInboxViewModel(c.store, BOB, NOW);
    expect(item?.receiptCount).toBe(1);
    await c.cleanup();
  });

  it('rejects an unknown receiptKind before any crypto runs', async () => {
    const c = ctx();
    await expect(
      emitMailboxReceiptIssued({
        store: c.store,
        identityId: BOB,
        deviceId: DEVICE,
        signingKeypair: KEYPAIR,
        envelopeId: 'e1',
        receiptId: 'rcpt-1',
        receiptKind: 'forged' as never,
        selfKey: { keyMaterial: c.selfKey, keyId: c.selfKeyId }
      })
    ).rejects.toThrow(/receiptKind/);
    await c.cleanup();
  });
});

describe('createMailboxSweepRunner', () => {
  function resolver(
    c: Ctx
  ): (
    row: StoredMailboxInboxRow | StoredMailboxOutboxRow
  ) => MailboxEnvelopeKeyResolution | undefined {
    return () => ({ keyMaterial: c.convKey, keyId: c.convKeyId, privacy: 'dm' });
  }

  it('sweeps an expired envelope and reports it via onSwept', async () => {
    const c = ctx();
    await queueSelf(c, { expiresAt: PAST });
    let swept: readonly string[] | undefined;
    const runner = createMailboxSweepRunner({
      store: c.store,
      ownerIdentityId: BOB,
      deviceId: DEVICE,
      signingKeypair: KEYPAIR,
      resolveEnvelopeKey: resolver(c),
      now: () => NOW,
      onSwept: (r) => (swept = r.expired)
    });
    const result = await runner.run();
    expect(result?.expired).toEqual(['e1']);
    expect(swept).toEqual(['e1']);
    const [item] = await buildMailboxInboxViewModel(c.store, BOB, NOW);
    expect(item?.status).toBe('expired');
    expect(item?.expiredReason).toBe('ttl');
    await c.cleanup();
  });

  it('coalesces overlapping runs into a single sweep (in-flight dedup)', async () => {
    const c = ctx();
    await queueSelf(c, { expiresAt: PAST });
    let sweeps = 0;
    const runner = createMailboxSweepRunner({
      store: c.store,
      ownerIdentityId: BOB,
      deviceId: DEVICE,
      signingKeypair: KEYPAIR,
      resolveEnvelopeKey: resolver(c),
      now: () => NOW,
      onSwept: () => (sweeps += 1)
    });
    const p1 = runner.run();
    const p2 = runner.run();
    expect(p1).toBe(p2); // same in-flight promise reused
    await Promise.all([p1, p2]);
    expect(sweeps).toBe(1);
    await c.cleanup();
  });

  it('coalesces re-triggers inside the minInterval window', async () => {
    const c = ctx();
    await queueSelf(c, { envelopeId: 'e1', expiresAt: PAST });
    let clock = 1_000;
    let sweeps = 0;
    const runner = createMailboxSweepRunner({
      store: c.store,
      ownerIdentityId: BOB,
      deviceId: DEVICE,
      signingKeypair: KEYPAIR,
      resolveEnvelopeKey: resolver(c),
      now: () => NOW,
      monotonicNow: () => clock,
      minIntervalMs: 5_000,
      onSwept: () => (sweeps += 1)
    });
    await runner.run();
    clock += 1_000; // still inside the window
    const skipped = await runner.run();
    expect(skipped).toBeUndefined();
    expect(sweeps).toBe(1);
    clock += 5_000; // window elapsed
    await runner.run();
    expect(sweeps).toBe(2);
    await c.cleanup();
  });

  it('isolates a resolver failure: onError fires, run resolves undefined, state unchanged', async () => {
    const c = ctx();
    await queueSelf(c, { expiresAt: PAST });
    let errored: unknown;
    const runner = createMailboxSweepRunner({
      store: c.store,
      ownerIdentityId: BOB,
      deviceId: DEVICE,
      signingKeypair: KEYPAIR,
      resolveEnvelopeKey: () => {
        throw new Error('boom');
      },
      now: () => NOW,
      onError: (e) => (errored = e)
    });
    const result = await runner.run();
    expect(result).toBeUndefined();
    expect((errored as Error).message).toBe('boom');
    // The envelope was not expired — availability projection is untouched.
    const [item] = await buildMailboxInboxViewModel(c.store, BOB, NOW);
    expect(item?.status).toBe('queued');
    await c.cleanup();
  });

  it('rejects construction with a non-function resolver', () => {
    const c = ctx();
    expect(() =>
      createMailboxSweepRunner({
        store: c.store,
        ownerIdentityId: BOB,
        deviceId: DEVICE,
        signingKeypair: KEYPAIR,
        resolveEnvelopeKey: undefined as never
      })
    ).toThrow(/resolveEnvelopeKey/);
    void c.cleanup();
  });
});

describe('sweepAfterForegroundSync', () => {
  it('sweeps only after a completed sync', () => {
    let runs = 0;
    const runner: MailboxSweepRunner = {
      run: () => {
        runs += 1;
        return Promise.resolve(undefined);
      }
    };
    sweepAfterForegroundSync(runner, { status: 'skipped' });
    sweepAfterForegroundSync(runner, { status: 'failed' });
    expect(runs).toBe(0);
    sweepAfterForegroundSync(runner, { status: 'completed' });
    expect(runs).toBe(1);
  });
});
