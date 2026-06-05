import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { generateSigningKeypair, signEventEnvelope } from '@lfp2p/crypto';
import {
  createUnsignedEvent,
  placeholderPrivatePayloadEnvelope,
  type PrivacyScope
} from '@lfp2p/protocol';
import { BridgeService, handleBridgeDeliveryRequest, InMemoryBridgeService, JsonFileBridgeStore } from './index.js';

const BRIDGE_AUTH_TOKEN = 'opaque-dev-value-123';
const BRIDGE_AUTH = { scheme: 'bearer', token: BRIDGE_AUTH_TOKEN } as const;

describe('InMemoryBridgeService', () => {
  it('accepts valid signed bridge-safe events and deduplicates by idempotency key', async () => {
    const bridge = new InMemoryBridgeService({ initialSequence: 0 });
    const event = makeSignedEvent({ eventId: 'evt_bridge_accept', privacy: 'public' });

    const first = await bridge.acceptDelivery(
      { idempotencyKey: 'idem-accept', target: 'bridge:dev', event },
      '1970-01-01T00:00:00.000Z'
    );
    const second = await bridge.acceptDelivery(
      { idempotencyKey: 'idem-accept', target: 'bridge:dev', event },
      '1970-01-01T00:01:00.000Z'
    );

    expect(first).toMatchObject({ status: 'confirmed', duplicate: false, sequence: 1 });
    expect(second).toMatchObject({ status: 'confirmed', duplicate: true, sequence: 1 });
    await expect(bridge.snapshot('1970-01-01T00:01:00.000Z')).resolves.toMatchObject({
      role: 'stateful-edge-actor',
      authoritativeForPrivateState: false,
      storeKind: 'memory',
      acceptedCount: 1,
      latestSequence: 1
    });
  });

  it('does not consume extra sequence values for concurrent duplicate deliveries', async () => {
    const bridge = new InMemoryBridgeService({ initialSequence: 0 });
    const event = makeSignedEvent({ eventId: 'evt_duplicate_race', privacy: 'public' });

    const [first, second] = await Promise.all([
      bridge.acceptDelivery({ idempotencyKey: 'idem-race', target: 'bridge:dev', event }, '1970-01-01T00:00:00.000Z'),
      bridge.acceptDelivery({ idempotencyKey: 'idem-race', target: 'bridge:dev', event }, '1970-01-01T00:00:00.000Z')
    ]);

    expect([first.status, second.status]).toEqual(['confirmed', 'confirmed']);
    expect(new Set([sequenceOf(first), sequenceOf(second)])).toEqual(new Set([1]));
    await expect(bridge.snapshot('1970-01-01T00:00:01.000Z')).resolves.toMatchObject({ latestSequence: 1, acceptedCount: 1 });
  });

  it('bounds in-memory idempotency records by capacity and TTL', async () => {
    const bridge = new InMemoryBridgeService({ initialSequence: 0, maxRecords: 2, ttlMs: 1_000 });
    const first = makeSignedEvent({ eventId: 'evt_capacity_1', privacy: 'public' });
    const second = makeSignedEvent({ eventId: 'evt_capacity_2', privacy: 'public' });
    const third = makeSignedEvent({ eventId: 'evt_capacity_3', privacy: 'public' });

    await bridge.acceptDelivery({ idempotencyKey: 'idem-1', target: 'bridge:dev', event: first }, '2026-05-22T00:00:00.000Z');
    await bridge.acceptDelivery({ idempotencyKey: 'idem-2', target: 'bridge:dev', event: second }, '2026-05-22T00:00:00.100Z');
    await bridge.acceptDelivery({ idempotencyKey: 'idem-3', target: 'bridge:dev', event: third }, '2026-05-22T00:00:00.200Z');

    await expect(bridge.getRecord('idem-1', '2026-05-22T00:00:00.200Z')).resolves.toBeUndefined();
    expect((await bridge.snapshot('2026-05-22T00:00:00.200Z')).acceptedCount).toBe(2);
    expect((await bridge.snapshot('2026-05-22T00:00:02.000Z')).acceptedCount).toBe(0);
  });

  it('rejects local-only privacy scopes', async () => {
    const bridge = new InMemoryBridgeService({ initialSequence: 0 });
    const deviceLocal = await bridge.acceptDelivery({
      idempotencyKey: 'idem-device-local',
      target: 'bridge:dev',
      event: makeSignedEvent({ eventId: 'evt_device_local', privacy: 'device-local' })
    });
    const selfOnly = await bridge.acceptDelivery({
      idempotencyKey: 'idem-self',
      target: 'bridge:dev',
      event: makeSignedEvent({ eventId: 'evt_self', privacy: 'self' })
    });

    expect(deviceLocal).toMatchObject({ status: 'rejected' });
    expect(selfOnly).toMatchObject({ status: 'rejected' });
    expect((await bridge.snapshot()).acceptedCount).toBe(0);
  });

  it('detects idempotency-key conflicts', async () => {
    const bridge = new InMemoryBridgeService({ initialSequence: 0 });
    const first = makeSignedEvent({ eventId: 'evt_first', privacy: 'public' });
    const second = makeSignedEvent({ eventId: 'evt_second', privacy: 'public' });

    await expect(bridge.acceptDelivery({ idempotencyKey: 'idem-conflict', target: 'bridge:dev', event: first })).resolves.toMatchObject({ status: 'confirmed' });
    await expect(bridge.acceptDelivery({ idempotencyKey: 'idem-conflict', target: 'bridge:dev', event: second })).resolves.toMatchObject({
      status: 'conflicted',
      existingEventId: 'evt_first'
    });
    await expect(bridge.acceptDelivery({ idempotencyKey: 'idem-conflict', target: 'bridge:other', event: first })).resolves.toMatchObject({
      status: 'conflicted',
      reason: 'Idempotency key already belongs to a different target'
    });
  });

  it('rejects tampered signatures before duplicate idempotency handling', async () => {
    const bridge = new InMemoryBridgeService({ initialSequence: 0 });
    const signed = makeSignedEvent({ eventId: 'evt_tampered', privacy: 'public' });
    const tampered = { ...signed, payload: { body: 'tampered after signing' } };

    await bridge.acceptDelivery({ idempotencyKey: 'idem-tampered', target: 'bridge:dev', event: signed });
    await expect(bridge.acceptDelivery({ idempotencyKey: 'idem-tampered', target: 'bridge:dev', event: tampered })).resolves.toMatchObject({
      status: 'rejected',
      reason: 'Event signature verification failed'
    });
  });
});

describe('JsonFileBridgeStore', () => {
  it('persists idempotency records and sequence state across service instances', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lfp2p-bridge-store-'));
    const filePath = join(dir, 'bridge-store.json');
    try {
      const firstService = new BridgeService({ store: new JsonFileBridgeStore({ filePath, initialSequence: 0, maxRecords: 10, ttlMs: 60_000 }) });
      const event = makeSignedEvent({ eventId: 'evt_persisted', privacy: 'public' });
      const accepted = await firstService.acceptDelivery(
        { idempotencyKey: 'idem-persisted', target: 'bridge:durable', event },
        '1970-01-01T00:00:00.000Z'
      );

      const secondService = new BridgeService({ store: new JsonFileBridgeStore({ filePath, initialSequence: 0, maxRecords: 10, ttlMs: 60_000 }) });
      const duplicate = await secondService.acceptDelivery(
        { idempotencyKey: 'idem-persisted', target: 'bridge:durable', event },
        '1970-01-01T00:00:30.000Z'
      );
      const next = await secondService.acceptDelivery(
        { idempotencyKey: 'idem-next', target: 'bridge:durable', event: makeSignedEvent({ eventId: 'evt_next', privacy: 'public' }) },
        '1970-01-01T00:00:40.000Z'
      );
      const nextSequence = sequenceOf(next);

      expect(accepted).toMatchObject({ status: 'confirmed', duplicate: false, sequence: 1 });
      expect(duplicate).toMatchObject({ status: 'confirmed', duplicate: true, sequence: 1 });
      expect(next).toMatchObject({ status: 'confirmed', duplicate: false });
      expect(nextSequence).toBeGreaterThan(sequenceOf(duplicate));
      await expect(secondService.getRecord('idem-persisted', '1970-01-01T00:00:30.000Z')).resolves.toMatchObject({ eventId: 'evt_persisted', sequence: 1 });
      await expect(secondService.snapshot('1970-01-01T00:00:40.000Z')).resolves.toMatchObject({ storeKind: 'json-file', acceptedCount: 2, latestSequence: nextSequence });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reloads durable state before writes so one instance cannot overwrite another instance', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lfp2p-bridge-store-'));
    const filePath = join(dir, 'bridge-store.json');
    try {
      const serviceA = new BridgeService({ store: new JsonFileBridgeStore({ filePath, initialSequence: 0, maxRecords: 10, ttlMs: 60_000 }) });
      const serviceB = new BridgeService({ store: new JsonFileBridgeStore({ filePath, initialSequence: 0, maxRecords: 10, ttlMs: 60_000 }) });

      await serviceA.snapshot('1970-01-01T00:00:00.000Z');
      await serviceB.acceptDelivery(
        { idempotencyKey: 'idem-b', target: 'bridge:durable', event: makeSignedEvent({ eventId: 'evt_b', privacy: 'public' }) },
        '1970-01-01T00:00:01.000Z'
      );
      await serviceA.acceptDelivery(
        { idempotencyKey: 'idem-a', target: 'bridge:durable', event: makeSignedEvent({ eventId: 'evt_a', privacy: 'public' }) },
        '1970-01-01T00:00:02.000Z'
      );

      const persisted = JSON.parse(await readFile(filePath, 'utf8')) as { records: Array<{ eventId: string }> };
      expect(persisted.records.map((record) => record.eventId).sort()).toEqual(['evt_a', 'evt_b']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps snapshot read-only while explicit prune persists cleanup', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lfp2p-bridge-store-'));
    const filePath = join(dir, 'bridge-store.json');
    try {
      const store = new JsonFileBridgeStore({ filePath, initialSequence: 0, maxRecords: 10, ttlMs: 1_000 });
      const service = new BridgeService({ store });
      await service.acceptDelivery(
        { idempotencyKey: 'idem-expiring', target: 'bridge:durable', event: makeSignedEvent({ eventId: 'evt_expiring', privacy: 'public' }) },
        '2026-05-22T00:00:00.000Z'
      );

      const beforePrune = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
      expect(beforePrune.recordType).toBe('lfp2p.bridge.store.v1');
      expect((await service.snapshot('2026-05-22T00:00:02.000Z')).acceptedCount).toBe(0);
      const afterSnapshot = JSON.parse(await readFile(filePath, 'utf8')) as { records: unknown[] };
      expect(afterSnapshot.records).toHaveLength(1);

      await store.pruneExpired(Date.parse('2026-05-22T00:00:02.000Z'));
      const afterExplicitPrune = JSON.parse(await readFile(filePath, 'utf8')) as { records: unknown[] };
      expect(afterExplicitPrune.records).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('handleBridgeDeliveryRequest', () => {
  it('maps new and duplicate accepted deliveries to HTTP responses', async () => {
    const bridge = new InMemoryBridgeService({ initialSequence: 0 });
    const event = makeSignedEvent({ eventId: 'evt_http', privacy: 'public' });

    const first = await handleBridgeDeliveryRequest(bridge, makeRequest('idem-http', event), '1970-01-01T00:00:00.000Z');
    const second = await handleBridgeDeliveryRequest(bridge, makeRequest('idem-http', event), '1970-01-01T00:01:00.000Z');

    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({ status: 'confirmed', duplicate: false, sequence: 1 });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ status: 'confirmed', duplicate: true, sequence: 1 });
  });

  it('rejects malformed or inconsistent HTTP delivery requests', async () => {
    const bridge = new InMemoryBridgeService({ initialSequence: 0 });
    const mismatched = await handleBridgeDeliveryRequest(
      bridge,
      makeRequest('idem-body', makeSignedEvent({ eventId: 'evt_http_mismatch', privacy: 'public' }), 'idem-header'),
      '2026-05-22T00:00:00.000Z'
    );
    const wrongMethod = await handleBridgeDeliveryRequest(bridge, new Request('https://bridge.test/events', { method: 'GET' }), '2026-05-22T00:00:00.000Z');

    expect(mismatched.status).toBe(400);
    expect(await mismatched.json()).toMatchObject({ status: 'rejected', reason: 'Idempotency header does not match request body' });
    expect(wrongMethod.status).toBe(405);
  });

  it('enforces optional HTTP auth before parsing delivery bodies', async () => {
    const bridge = new InMemoryBridgeService({ initialSequence: 0 });
    const missing = await handleBridgeDeliveryRequest(
      bridge,
      new Request('https://bridge.test/events', { method: 'POST', body: 'not json' }),
      '2026-05-22T00:00:00.000Z',
      { auth: BRIDGE_AUTH }
    );
    const wrong = await handleBridgeDeliveryRequest(
      bridge,
      makeRequest('idem-auth-wrong', makeSignedEvent({ eventId: 'evt_auth_wrong', privacy: 'public' }), undefined, 'wrong-value'),
      '2026-05-22T00:00:00.000Z',
      { auth: BRIDGE_AUTH }
    );

    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toBe('Bearer realm="lfp2p-bridge"');
    await expect(missing.json()).resolves.toEqual({ status: 'rejected', idempotencyKey: 'unknown', reason: 'Unauthorized' });
    expect(wrong.status).toBe(401);
    await expect(bridge.snapshot('2026-05-22T00:00:01.000Z')).resolves.toMatchObject({ acceptedCount: 0 });
  });

  it('accepts authorized delivery requests without leaking server auth config', async () => {
    const bridge = new InMemoryBridgeService({ initialSequence: 0 });
    const authorized = await handleBridgeDeliveryRequest(
      bridge,
      makeRequest('idem-auth-ok', makeSignedEvent({ eventId: 'evt_auth_ok', privacy: 'public' }), undefined, BRIDGE_AUTH_TOKEN),
      '2026-05-22T00:00:00.000Z',
      { auth: BRIDGE_AUTH }
    );
    const misconfigured = await handleBridgeDeliveryRequest(
      bridge,
      makeRequest('idem-auth-bad-config', makeSignedEvent({ eventId: 'evt_auth_bad_config', privacy: 'public' }), undefined, BRIDGE_AUTH_TOKEN),
      '2026-05-22T00:00:00.000Z',
      { auth: { scheme: 'bearer', token: 'bad config value' } }
    );

    expect(authorized.status).toBe(202);
    await expect(authorized.json()).resolves.toMatchObject({ status: 'confirmed', idempotencyKey: 'idem-auth-ok' });
    expect(misconfigured.status).toBe(503);
    const body = await misconfigured.json();
    expect(body).toEqual({ reason: 'Bridge auth misconfigured' });
    expect(JSON.stringify(body)).not.toContain('bad config value');
  });

  it('accepts authorization scheme casing allowed by HTTP auth semantics', async () => {
    const bridge = new InMemoryBridgeService({ initialSequence: 0 });
    const response = await handleBridgeDeliveryRequest(
      bridge,
      makeRequest('idem-auth-lowercase-scheme', makeSignedEvent({ eventId: 'evt_auth_lowercase_scheme', privacy: 'public' }), undefined, BRIDGE_AUTH_TOKEN, 'bearer'),
      '2026-05-22T00:00:00.000Z',
      { auth: BRIDGE_AUTH }
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ status: 'confirmed', idempotencyKey: 'idem-auth-lowercase-scheme' });
  });

  it('treats malformed runtime auth options as generic server misconfiguration', async () => {
    const bridge = new InMemoryBridgeService({ initialSequence: 0 });
    const nonAsciiAuthToken = ['caf', String.fromCodePoint(0xe9)].join('');
    const nonStringToken = await handleBridgeDeliveryRequest(
      bridge,
      makeRequest('idem-auth-non-string', makeSignedEvent({ eventId: 'evt_auth_non_string', privacy: 'public' }), undefined, BRIDGE_AUTH_TOKEN),
      '2026-05-22T00:00:00.000Z',
      { auth: { scheme: 'bearer', token: 123 } } as unknown as Parameters<typeof handleBridgeDeliveryRequest>[3]
    );
    const nonAsciiToken = await handleBridgeDeliveryRequest(
      bridge,
      makeRequest('idem-auth-non-ascii', makeSignedEvent({ eventId: 'evt_auth_non_ascii', privacy: 'public' }), undefined, BRIDGE_AUTH_TOKEN),
      '2026-05-22T00:00:00.000Z',
      { auth: { scheme: 'bearer', token: nonAsciiAuthToken } } as unknown as Parameters<typeof handleBridgeDeliveryRequest>[3]
    );
    const nullOptions = await handleBridgeDeliveryRequest(
      bridge,
      makeRequest('idem-auth-null-options', makeSignedEvent({ eventId: 'evt_auth_null_options', privacy: 'public' }), undefined, BRIDGE_AUTH_TOKEN),
      '2026-05-22T00:00:00.000Z',
      null as unknown as Parameters<typeof handleBridgeDeliveryRequest>[3]
    );

    expect(nonStringToken.status).toBe(503);
    await expect(nonStringToken.json()).resolves.toEqual({ reason: 'Bridge auth misconfigured' });
    expect(nonAsciiToken.status).toBe(503);
    await expect(nonAsciiToken.json()).resolves.toEqual({ reason: 'Bridge auth misconfigured' });
    expect(nullOptions.status).toBe(503);
    await expect(nullOptions.json()).resolves.toEqual({ reason: 'Bridge auth misconfigured' });
    await expect(bridge.snapshot('2026-05-22T00:00:01.000Z')).resolves.toMatchObject({ acceptedCount: 0 });
  });
});

function sequenceOf(response: Awaited<ReturnType<BridgeService['acceptDelivery']>>): number {
  if (response.status !== 'confirmed') throw new Error('Expected confirmed response');
  return response.sequence;
}

function makeRequest(
  idempotencyKey: string,
  event: ReturnType<typeof makeSignedEvent>,
  headerKey = idempotencyKey,
  authToken?: string,
  authScheme = 'Bearer'
): Request {
  return new Request('https://bridge.test/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-lfp2p-idempotency-key': headerKey,
      ...(authToken === undefined ? {} : { authorization: `${authScheme} ${authToken}` })
    },
    body: JSON.stringify({ idempotencyKey, target: 'bridge:dev', event })
  });
}

function makeSignedEvent(input: { eventId: string; privacy: PrivacyScope }) {
  const keypair = generateSigningKeypair();
  // Phase 5.0E follow-up: dm / group / self (non-identity kinds)
  // require a PrivatePayloadEnvelopeV1.
  const isPrivacyScopeRequiringEnvelope =
    input.privacy === 'dm' || input.privacy === 'group' || input.privacy === 'self';
  const payload = isPrivacyScopeRequiringEnvelope
    ? placeholderPrivatePayloadEnvelope({ keyId: `placeholder-${input.eventId}` })
    : { body: input.eventId };
  return signEventEnvelope(
    createUnsignedEvent({
      eventId: input.eventId,
      kind: 'outbox.test.created',
      author: `identity:${keypair.publicKey}`,
      deviceId: `device:${keypair.publicKey.slice(0, 16)}`,
      createdAt: '2026-05-22T00:00:00.000Z',
      privacy: input.privacy,
      payload
    }),
    keypair
  );
}