import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createUnsignedEvent } from '@lfp2p/protocol';
import { signEventEnvelope, signingKeypairFromSeed } from '@lfp2p/crypto';
import { createLocalFirstStore, type MutationOutboxEntry } from './index.js';

describe('DexieLocalFirstStore', () => {
  it('stores signed events and pending outbox entries', async () => {
    const store = createLocalFirstStore(`test-${globalThis.crypto.randomUUID()}`);
    const keypair = signingKeypairFromSeed(new Uint8Array(32).fill(3));
    const signed = signEventEnvelope(
      createUnsignedEvent({
        eventId: 'evt_store_001',
        kind: 'outbox.test.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-05-22T00:00:00.000Z',
        privacy: 'device-local',
        payload: { body: 'hello' }
      }),
      keypair
    );

    await store.putSignedEvent(signed);
    await store.enqueueOutbox({
      idempotencyKey: 'idem-001',
      eventId: signed.eventId,
      target: 'bridge:local-dev',
      status: 'pending',
      retryCount: 0,
      nextRetryAt: '2026-05-22T00:00:00.000Z',
      createdAt: '2026-05-22T00:00:00.000Z',
      updatedAt: '2026-05-22T00:00:00.000Z'
    });

    expect(await store.getSignedEvent('evt_store_001')).toEqual(signed);
    expect(await store.listPendingOutbox()).toHaveLength(1);
    await store.markOutboxConfirmed('idem-001');
    expect(await store.listPendingOutbox()).toHaveLength(0);
    await store.delete();
  });

  it('claims only pending due outbox entries once', async () => {
    const store = createLocalFirstStore(`claim-test-${globalThis.crypto.randomUUID()}`);
    const entry = makeOutboxEntry({ idempotencyKey: 'idem-claim' });
    await store.enqueueOutbox(entry);

    expect(await store.listDueOutbox('2026-05-21T23:59:59.000Z')).toHaveLength(0);
    expect(await store.listDueOutbox('2026-05-22T00:00:00.000Z')).toHaveLength(1);

    const firstClaim = await store.claimOutboxEntry('idem-claim', '2026-05-22T00:00:01.000Z');
    const secondClaim = await store.claimOutboxEntry('idem-claim', '2026-05-22T00:00:02.000Z');

    expect(firstClaim?.status).toBe('syncing');
    expect(secondClaim).toBeUndefined();
    expect((await store.getOutboxEntry('idem-claim'))?.status).toBe('syncing');
    await store.delete();
  });

  it('recovers stale syncing outbox claims as pending due work', async () => {
    const store = createLocalFirstStore(`recover-test-${globalThis.crypto.randomUUID()}`);
    try {
      await store.enqueueOutbox(
        makeOutboxEntry({
          idempotencyKey: 'idem-stale',
          status: 'syncing',
          updatedAt: '2026-05-22T00:00:00.000Z'
        })
      );
      await store.enqueueOutbox(
        makeOutboxEntry({
          idempotencyKey: 'idem-active',
          status: 'syncing',
          updatedAt: '2026-05-22T00:10:00.000Z'
        })
      );
      await store.enqueueOutbox(
        makeOutboxEntry({
          idempotencyKey: 'idem-terminal',
          status: 'failed',
          updatedAt: '2026-05-22T00:00:00.000Z',
          lastError: 'terminal'
        })
      );

      const recovered = await store.recoverStaleOutboxClaims({
        staleBefore: '2026-05-22T00:05:00.000Z',
        nextRetryAt: '2026-05-22T00:06:00.000Z',
        updatedAt: '2026-05-22T00:06:00.000Z',
        lastError: 'Recovered after interrupted sync',
        limit: 10
      });

      expect(recovered).toBe(1);
      expect(await store.listDueOutbox('2026-05-22T00:05:59.000Z')).toHaveLength(0);
      expect(await store.listDueOutbox('2026-05-22T00:06:00.000Z')).toHaveLength(1);
      expect(await store.getOutboxEntry('idem-stale')).toMatchObject({
        status: 'pending',
        nextRetryAt: '2026-05-22T00:06:00.000Z',
        updatedAt: '2026-05-22T00:06:00.000Z',
        lastError: 'Recovered after interrupted sync'
      });
      expect(await store.getOutboxEntry('idem-active')).toMatchObject({
        status: 'syncing',
        updatedAt: '2026-05-22T00:10:00.000Z'
      });
      expect(await store.getOutboxEntry('idem-terminal')).toMatchObject({
        status: 'failed',
        lastError: 'terminal'
      });
      expect(await store.recoverStaleOutboxClaims({
        staleBefore: '2026-05-22T00:05:00.000Z',
        nextRetryAt: '2026-05-22T00:06:00.000Z'
      })).toBe(0);
    } finally {
      await store.delete();
    }
  });

  it('schedules retries as pending without treating terminal failures as due work', async () => {
    const store = createLocalFirstStore(`retry-test-${globalThis.crypto.randomUUID()}`);
    await store.enqueueOutbox(makeOutboxEntry({ idempotencyKey: 'idem-retry' }));
    await store.scheduleOutboxRetry({
      idempotencyKey: 'idem-retry',
      retryCount: 1,
      nextRetryAt: '2026-05-22T00:05:00.000Z',
      lastError: 'temporary failure',
      updatedAt: '2026-05-22T00:00:01.000Z'
    });

    expect(await store.listDueOutbox('2026-05-22T00:04:59.000Z')).toHaveLength(0);
    expect(await store.listDueOutbox('2026-05-22T00:05:00.000Z')).toHaveLength(1);

    await store.markOutboxFailed('idem-retry', 'retry budget exhausted', '2026-05-22T00:05:01.000Z');
    expect(await store.listDueOutbox('2026-05-22T00:10:00.000Z')).toHaveLength(0);
    expect((await store.countOutboxByStatus()).failed).toBe(1);
    await store.delete();
  });
});

function makeOutboxEntry(overrides: Partial<MutationOutboxEntry> = {}): MutationOutboxEntry {
  const now = '2026-05-22T00:00:00.000Z';
  return {
    idempotencyKey: 'idem-default',
    eventId: 'evt-default',
    target: 'bridge:test',
    status: 'pending',
    retryCount: 0,
    nextRetryAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}
