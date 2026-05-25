import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { generateSigningKeypair, signEventEnvelope } from '@lfp2p/crypto';
import { createLocalFirstStore, type DexieLocalFirstStore, type MutationOutboxEntry } from '@lfp2p/local-store';
import { createUnsignedEvent } from '@lfp2p/protocol';
import type { OutboxTransport } from '@lfp2p/sync-client';
import { runManualOutboxDelivery } from './pwa-outbox-manual-gate.js';

const DEV_ENV = { DEV: true } as const;
const MANUAL_ENABLED_ENV = { ...DEV_ENV, VITE_LFP2P_MANUAL_OUTBOX_DELIVERY_ENABLED: 'true' } as const;
const BRIDGE_ENABLED_ENV = {
  VITE_LFP2P_BRIDGE_SYNC_ENABLED: 'true',
  VITE_LFP2P_BRIDGE_ENDPOINT: 'https://bridge.example.test/events'
} as const;

describe('runManualOutboxDelivery', () => {
  it('is unavailable outside dev mode', async () => {
    let factoryCalls = 0;
    const result = await runManualOutboxDelivery({
      store: fakeStore(),
      env: { VITE_LFP2P_MANUAL_OUTBOX_DELIVERY_ENABLED: 'true' },
      createTransport: () => {
        factoryCalls += 1;
        throw new Error('unexpected factory call');
      }
    });

    expect(result).toMatchObject({ status: 'disabled', reason: 'not-dev-mode' });
    expect(factoryCalls).toBe(0);
  });

  it('is off by default in dev mode', async () => {
    let factoryCalls = 0;
    const result = await runManualOutboxDelivery({
      store: fakeStore(),
      env: DEV_ENV,
      createTransport: () => {
        factoryCalls += 1;
        throw new Error('unexpected factory call');
      }
    });

    expect(result).toMatchObject({ status: 'disabled', reason: 'manual-delivery-disabled' });
    expect(factoryCalls).toBe(0);
  });

  it('blocks unavailable bridge states', async () => {
    const disabledBridge = await runManualOutboxDelivery({ store: fakeStore(), env: MANUAL_ENABLED_ENV });
    const invalidBridge = await runManualOutboxDelivery({
      store: fakeStore(),
      env: { ...MANUAL_ENABLED_ENV, VITE_LFP2P_BRIDGE_SYNC_ENABLED: 'true' }
    });
    const missingFetch = await runManualOutboxDelivery({
      store: fakeStore(),
      env: { ...MANUAL_ENABLED_ENV, ...BRIDGE_ENABLED_ENV },
      fetch: null
    });

    expect(disabledBridge).toMatchObject({ status: 'blocked', reason: 'bridge-config-disabled' });
    expect(invalidBridge).toMatchObject({ status: 'blocked', reason: 'bridge-config-invalid' });
    expect(missingFetch).toMatchObject({ status: 'blocked', reason: 'fetch-unavailable' });
  });

  it('rejects unsafe batch sizes', async () => {
    await expect(runManualOutboxDelivery({ store: fakeStore(), env: MANUAL_ENABLED_ENV, batchSize: 0 })).rejects.toThrow(
      'manual outbox delivery batchSize must be a positive safe integer no greater than 5.'
    );
    await expect(runManualOutboxDelivery({ store: fakeStore(), env: MANUAL_ENABLED_ENV, batchSize: 6 })).rejects.toThrow(
      'manual outbox delivery batchSize must be a positive safe integer no greater than 5.'
    );
  });

  it('runs one explicit enabled batch', async () => {
    const store = createLocalFirstStore(`manual-outbox-delivery-${globalThis.crypto.randomUUID()}`);
    try {
      const entry = await seedOutboxEntry(store, 'evt_manual_outbox_delivery');
      const sent: string[] = [];
      const transport: OutboxTransport = {
        async send(input) {
          sent.push(input.entry.idempotencyKey);
          expect(input.event.eventId).toBe('evt_manual_outbox_delivery');
          return { status: 'confirmed', sequence: 1 };
        }
      };

      const result = await runManualOutboxDelivery({
        store,
        env: { ...MANUAL_ENABLED_ENV, ...BRIDGE_ENABLED_ENV },
        createTransport: () => transport,
        now: new Date('2026-05-25T00:00:00.000Z'),
        batchSize: 1
      });

      expect(result).toMatchObject({ status: 'delivered', batchSize: 1 });
      if (result.status !== 'delivered') throw new Error('Expected delivered result');
      expect(result.result).toEqual({ attempted: 1, confirmed: 1, conflicted: 0, retried: 0, failed: 0, skipped: 0 });
      expect(sent).toEqual([entry.idempotencyKey]);
      expect((await store.getOutboxEntry(entry.idempotencyKey))?.status).toBe('confirmed');
    } finally {
      await store.delete();
    }
  });
});

function fakeStore(): DexieLocalFirstStore {
  return {} as DexieLocalFirstStore;
}

async function seedOutboxEntry(store: DexieLocalFirstStore, eventId: string): Promise<MutationOutboxEntry> {
  const event = makeSignedEvent(eventId);
  await store.putSignedEvent(event);
  const now = '2026-05-25T00:00:00.000Z';
  const entry: MutationOutboxEntry = {
    idempotencyKey: `idem_${eventId}`,
    eventId,
    target: 'bridge:development',
    status: 'pending',
    retryCount: 0,
    nextRetryAt: now,
    createdAt: now,
    updatedAt: now
  };
  await store.enqueueOutbox(entry);
  return entry;
}

function makeSignedEvent(eventId: string) {
  const keypair = generateSigningKeypair();
  return signEventEnvelope(
    createUnsignedEvent({
      eventId,
      kind: 'outbox.test.created',
      author: `identity:${keypair.publicKey}`,
      deviceId: `device:${keypair.publicKey.slice(0, 16)}`,
      createdAt: '2026-05-25T00:00:00.000Z',
      privacy: 'dm',
      payload: { body: eventId }
    }),
    keypair
  );
}
