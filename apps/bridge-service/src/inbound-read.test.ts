import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateSigningKeypair, signEventEnvelope } from '@lfp2p/crypto';
import { createUnsignedEvent, type PrivacyScope } from '@lfp2p/protocol';
import {
  BridgeService,
  type BridgeStore,
  handleBridgeInboundReadRequest,
  InMemoryBridgeService,
  JsonFileBridgeStore
} from './index.js';

describe('Bridge inbound read support', () => {
  it('returns accepted signed events in sequence order for the requested bridge target', async () => {
    const bridge = new InMemoryBridgeService({ initialSequence: 0 });
    const first = makeSignedEvent({ eventId: 'evt_bridge_read_1', privacy: 'public' });
    const second = makeSignedEvent({ eventId: 'evt_bridge_read_2', privacy: 'dm' });
    const otherTarget = makeSignedEvent({ eventId: 'evt_bridge_read_other', privacy: 'public' });

    await bridge.acceptDelivery({ idempotencyKey: 'idem-read-1', target: 'stream:inbox', event: first }, '1970-01-01T00:00:00.000Z');
    await bridge.acceptDelivery({ idempotencyKey: 'idem-read-other', target: 'stream:other', event: otherTarget }, '1970-01-01T00:00:01.000Z');
    await bridge.acceptDelivery({ idempotencyKey: 'idem-read-2', target: 'stream:inbox', event: second }, '1970-01-01T00:00:02.000Z');

    await expect(
      bridge.readInboundRecords(
        { sourceId: 'bridge:primary', streamId: 'stream:inbox', scope: 'identity:alice', limit: 10 },
        '1970-01-01T00:00:03.000Z'
      )
    ).resolves.toEqual({
      records: [
        { cursor: '1', sequence: 1, receivedAt: '1970-01-01T00:00:00.000Z', event: first },
        { cursor: '2000000', sequence: 2_000_000, receivedAt: '1970-01-01T00:00:02.000Z', event: second }
      ]
    });
  });

  it('honors cursors and limits for incremental reads', async () => {
    const bridge = new InMemoryBridgeService({ initialSequence: 0 });
    const first = makeSignedEvent({ eventId: 'evt_cursor_1', privacy: 'public' });
    const second = makeSignedEvent({ eventId: 'evt_cursor_2', privacy: 'public' });
    const third = makeSignedEvent({ eventId: 'evt_cursor_3', privacy: 'public' });

    await bridge.acceptDelivery({ idempotencyKey: 'idem-cursor-1', target: 'stream:inbox', event: first }, '1970-01-01T00:00:00.000Z');
    await bridge.acceptDelivery({ idempotencyKey: 'idem-cursor-2', target: 'stream:inbox', event: second }, '1970-01-01T00:00:01.000Z');
    await bridge.acceptDelivery({ idempotencyKey: 'idem-cursor-3', target: 'stream:inbox', event: third }, '1970-01-01T00:00:02.000Z');

    await expect(
      bridge.readInboundRecords(
        { sourceId: 'bridge:primary', streamId: 'stream:inbox', scope: 'identity:alice', cursor: '1', limit: 1 },
        '1970-01-01T00:00:03.000Z'
      )
    ).resolves.toEqual({
      records: [{ cursor: '1000000', sequence: 1_000_000, receivedAt: '1970-01-01T00:00:01.000Z', event: second }]
    });
  });

  it('exposes readable records over the HTTP handler', async () => {
    const bridge = new InMemoryBridgeService({ initialSequence: 0 });
    const event = makeSignedEvent({ eventId: 'evt_http_read', privacy: 'public' });
    await bridge.acceptDelivery({ idempotencyKey: 'idem-http-read', target: 'stream:inbox', event }, '1970-01-01T00:00:00.000Z');

    const response = await handleBridgeInboundReadRequest(
      bridge,
      new Request('https://bridge.test/inbound', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceId: 'bridge:primary', streamId: 'stream:inbox', scope: 'identity:alice', limit: 10 })
      }),
      '1970-01-01T00:00:01.000Z'
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      records: [{ cursor: '1', sequence: 1, receivedAt: '1970-01-01T00:00:00.000Z', event }]
    });
  });

  it('rejects malformed read requests and oversized limits', async () => {
    const bridge = new InMemoryBridgeService({ initialSequence: 0 });
    const wrongMethod = await handleBridgeInboundReadRequest(
      bridge,
      new Request('https://bridge.test/inbound', { method: 'GET' }),
      '1970-01-01T00:00:00.000Z'
    );
    const oversized = await handleBridgeInboundReadRequest(
      bridge,
      new Request('https://bridge.test/inbound', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceId: 'bridge:primary', streamId: 'stream:inbox', scope: 'identity:alice', limit: 501 })
      }),
      '1970-01-01T00:00:00.000Z'
    );
    const badCursor = await handleBridgeInboundReadRequest(
      bridge,
      new Request('https://bridge.test/inbound', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceId: 'bridge:primary', streamId: 'stream:inbox', scope: 'identity:alice', cursor: 'cursor-1' })
      }),
      '1970-01-01T00:00:00.000Z'
    );

    expect(wrongMethod.status).toBe(405);
    expect(oversized.status).toBe(400);
    await expect(oversized.json()).resolves.toEqual({ reason: 'limit must be at most 500' });
    expect(badCursor.status).toBe(400);
    await expect(badCursor.json()).resolves.toEqual({ reason: 'cursor must be a non-negative integer string' });
  });

  it('returns retryable status for internal read failures', async () => {
    const store = {
      kind: 'memory',
      maxRecords: 1,
      ttlMs: 60_000,
      get: async () => undefined,
      putIfAbsent: async () => {
        throw new Error('not used');
      },
      listAfter: async () => {
        throw new Error('storage unavailable');
      },
      pruneExpired: async () => undefined,
      snapshot: async () => ({ storeKind: 'memory', acceptedCount: 0, maxRecords: 1, ttlMs: 60_000, latestSequence: 0 })
    } satisfies BridgeStore;
    const bridge = new BridgeService({ store });

    const response = await handleBridgeInboundReadRequest(
      bridge,
      new Request('https://bridge.test/inbound', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceId: 'bridge:primary', streamId: 'stream:inbox', scope: 'identity:alice' })
      }),
      '1970-01-01T00:00:00.000Z'
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ reason: 'Bridge inbound read failed' });
  });

  it('persists readable event bodies in the JSON file store', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lfp2p-bridge-read-store-'));
    const filePath = join(dir, 'bridge-store.json');
    try {
      const event = makeSignedEvent({ eventId: 'evt_json_read', privacy: 'public' });
      const writer = new BridgeService({ store: new JsonFileBridgeStore({ filePath, initialSequence: 0, ttlMs: 60_000 }) });
      await writer.acceptDelivery({ idempotencyKey: 'idem-json-read', target: 'stream:inbox', event }, '1970-01-01T00:00:00.000Z');

      const reader = new BridgeService({ store: new JsonFileBridgeStore({ filePath, initialSequence: 0, ttlMs: 60_000 }) });
      await expect(
        reader.readInboundRecords(
          { sourceId: 'bridge:primary', streamId: 'stream:inbox', scope: 'identity:alice' },
          '1970-01-01T00:00:01.000Z'
        )
      ).resolves.toEqual({ records: [{ cursor: '1', sequence: 1, receivedAt: '1970-01-01T00:00:00.000Z', event }] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function makeSignedEvent(input: { eventId: string; privacy: PrivacyScope }) {
  const keypair = generateSigningKeypair();
  return signEventEnvelope(
    createUnsignedEvent({
      eventId: input.eventId,
      kind: 'outbox.test.created',
      author: `identity:${keypair.publicKey}`,
      deviceId: `device:${keypair.publicKey.slice(0, 16)}`,
      createdAt: '2026-05-24T00:00:00.000Z',
      privacy: input.privacy,
      payload: { body: input.eventId }
    }),
    keypair
  );
}
