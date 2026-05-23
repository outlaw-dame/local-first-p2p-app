import { describe, expect, it } from 'vitest';
import { generateSigningKeypair, signEventEnvelope } from '@lfp2p/crypto';
import { createUnsignedEvent } from '@lfp2p/protocol';
import { BridgeService, PgliteBridgeStore } from './index.js';

describe('PgliteBridgeStore', () => {
  it('deduplicates idempotent deliveries without consuming extra sequence values', async () => {
    const service = new BridgeService({ store: new PgliteBridgeStore({ initialSequence: 0, ttlMs: 60_000 }) });
    const event = makeSignedEvent('evt_sql_duplicate');

    const [first, second] = await Promise.all([
      service.acceptDelivery({ idempotencyKey: 'idem-sql-duplicate', target: 'bridge:sql', event }, '1970-01-01T00:00:00.000Z'),
      service.acceptDelivery({ idempotencyKey: 'idem-sql-duplicate', target: 'bridge:sql', event }, '1970-01-01T00:00:00.000Z')
    ]);

    expect(first).toMatchObject({ status: 'confirmed', sequence: 1 });
    expect(second).toMatchObject({ status: 'confirmed', sequence: 1 });
    await expect(service.snapshot('1970-01-01T00:00:01.000Z')).resolves.toMatchObject({
      storeKind: 'pglite',
      acceptedCount: 1,
      latestSequence: 1
    });
  });

  it('persists conflicts and evicts oldest records by capacity', async () => {
    const service = new BridgeService({ store: new PgliteBridgeStore({ initialSequence: 0, maxRecords: 1, ttlMs: 60_000 }) });
    const first = makeSignedEvent('evt_sql_first');
    const second = makeSignedEvent('evt_sql_second');

    await expect(
      service.acceptDelivery({ idempotencyKey: 'idem-sql-first', target: 'bridge:sql', event: first }, '1970-01-01T00:00:00.000Z')
    ).resolves.toMatchObject({ status: 'confirmed' });

    await expect(
      service.acceptDelivery({ idempotencyKey: 'idem-sql-second', target: 'bridge:sql', event: second }, '1970-01-01T00:00:01.000Z')
    ).resolves.toMatchObject({ status: 'confirmed' });

    await expect(service.getRecord('idem-sql-first', '1970-01-01T00:00:02.000Z')).resolves.toBeUndefined();
    await expect(service.getRecord('idem-sql-second', '1970-01-01T00:00:02.000Z')).resolves.toMatchObject({
      eventId: 'evt_sql_second'
    });
  });

  it('prunes expired records before reads and snapshots', async () => {
    const service = new BridgeService({ store: new PgliteBridgeStore({ initialSequence: 0, ttlMs: 1_000 }) });
    const event = makeSignedEvent('evt_sql_expiring');

    await service.acceptDelivery({ idempotencyKey: 'idem-sql-expiring', target: 'bridge:sql', event }, '2026-05-22T00:00:00.000Z');

    await expect(service.getRecord('idem-sql-expiring', '2026-05-22T00:00:02.000Z')).resolves.toBeUndefined();
    await expect(service.snapshot('2026-05-22T00:00:02.000Z')).resolves.toMatchObject({
      storeKind: 'pglite',
      acceptedCount: 0
    });
  });
});

function makeSignedEvent(eventId: string) {
  const keypair = generateSigningKeypair();
  return signEventEnvelope(
    createUnsignedEvent({
      eventId,
      kind: 'outbox.test.created',
      author: `identity:${keypair.publicKey}`,
      deviceId: `device:${keypair.publicKey.slice(0, 16)}`,
      createdAt: '2026-05-22T00:00:00.000Z',
      privacy: 'public',
      payload: { body: eventId }
    }),
    keypair
  );
}
