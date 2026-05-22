import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createUnsignedEvent } from '@lfp2p/protocol';
import { signEventEnvelope, signingKeypairFromSeed } from '@lfp2p/crypto';
import { createLocalFirstStore } from './index.js';

describe('DexieLocalFirstStore', () => {
  it('stores signed events and pending outbox entries', async () => {
    const store = createLocalFirstStore(`test-${crypto.randomUUID()}`);
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
});
