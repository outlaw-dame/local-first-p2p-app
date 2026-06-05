/**
 * Phase 4.2 — Adversarial tests for the admission-state persistence layer.
 *
 * Covered:
 *  - Serialize/deserialize round-trip preserves every field AND the
 *    deep-freeze invariant pinned by the Phase 3.2 integrity suite.
 *  - Corrupted snapshots are rejected with a typed error (no silent
 *    "start fresh", which would let an attacker who corrupted the
 *    file gain a fresh budget every restart).
 *  - InMemoryAdmissionStateStore round-trips correctly and exposes a
 *    deliberate `failNextSaveWith` hook for fail-closed testing.
 *  - JsonFileAdmissionStateStore writes atomically (temp-then-
 *    rename), survives a missing target file as cold-start, and
 *    persists across instances.
 *  - BridgeAdmissionGateway.create() pre-loads persisted state.
 *  - BridgeAdmissionGateway.admitAndPersist() fail-closes: a save
 *    failure throws and the in-memory reference does NOT advance.
 *  - BridgeService.acceptDelivery() turns an admission-persist
 *    failure into a doctrine-compliant rejection response.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { signEventEnvelope, signingKeypairFromSeed } from '@lfp2p/crypto';
import {
  createUnsignedEvent,
  placeholderPrivatePayloadEnvelope,
  type SignedEventEnvelope
} from '@lfp2p/protocol';
import {
  ADMISSION_STATE_SNAPSHOT_VERSION,
  AdmissionStateCorruptError,
  BridgeAdmissionGateway,
  InMemoryAdmissionStateStore,
  InMemoryBridgeService,
  JsonFileAdmissionStateStore,
  createTempDir,
  deserializeAdmissionState,
  removeDir,
  serializeAdmissionState
} from './index.js';
import type { BridgeDeliveryRequest } from './types.js';

const KEYPAIR = signingKeypairFromSeed(new Uint8Array(32).fill(11));

const OPERATOR_AUTHORITY = {
  version: 'lfp2p.safety-authority.v1' as const,
  authorityId: 'auth_bridge_p42',
  actorId: 'actor_bridge_op',
  role: 'bridge-operator' as const,
  scope: 'bridge-local' as const,
  createdAt: '2026-05-01T00:00:00Z'
};

const CONFIG = {
  surface: 'bridge' as const,
  operatorAuthority: OPERATOR_AUTHORITY,
  policyVersion: 'bridge.policy.v1'
};

function signedNote(eventId: string): SignedEventEnvelope {
  return signEventEnvelope(
    createUnsignedEvent({
      eventId,
      kind: 'note.created',
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: '2026-06-04T00:00:00.000Z',
      privacy: 'group',
      // Phase 5.0E follow-up: `group` privacy requires a
      // PrivatePayloadEnvelopeV1.
      payload: placeholderPrivatePayloadEnvelope({ keyId: 'placeholder-state-store' })
    }),
    KEYPAIR
  );
}

function request(eventId: string): BridgeDeliveryRequest {
  return {
    idempotencyKey: `idem_${eventId}`,
    target: 'durable-stream:inbox',
    event: signedNote(eventId)
  };
}

// ---------------------------------------------------------------------------
// Serialize / deserialize
// ---------------------------------------------------------------------------

describe('Phase 4.2 — serialize/deserialize round-trip', () => {
  it('round-trips a freshly admitted state with byte-equivalent shape', async () => {
    const gateway = new BridgeAdmissionGateway({ config: CONFIG });
    await gateway.admitAndPersist(request('evt_p42_rt_1'), 1000);
    await gateway.admitAndPersist(request('evt_p42_rt_2'), 2000);
    const state = gateway.state;

    const serialized = serializeAdmissionState(state);
    expect(serialized.version).toBe(ADMISSION_STATE_SNAPSHOT_VERSION);
    expect(Array.isArray(serialized.state.appliedEventIds)).toBe(true);

    const json = JSON.stringify(serialized);
    const reparsed = JSON.parse(json) as unknown;
    const rehydrated = deserializeAdmissionState(reparsed);

    // Field-by-field equivalence.
    expect(rehydrated.peerReputation).toEqual(state.peerReputation);
    expect(rehydrated.rateLimitState).toEqual(state.rateLimitState);
    expect(rehydrated.replayCache).toEqual(state.replayCache);
    expect(rehydrated.quarantinedPeers).toEqual(state.quarantinedPeers);
    expect(rehydrated.quarantinedEvents).toEqual(state.quarantinedEvents);
    expect(rehydrated.quarantinedMedia).toEqual(state.quarantinedMedia);
    expect(rehydrated.auditLog).toEqual(state.auditLog);
    expect([...rehydrated.appliedEventIds].sort()).toEqual(
      [...state.appliedEventIds].sort()
    );
  });

  it('rehydrated appliedEventIds is a Set (not an array)', async () => {
    const gateway = new BridgeAdmissionGateway({ config: CONFIG });
    await gateway.admitAndPersist(request('evt_p42_set_1'), 1000);
    const serialized = serializeAdmissionState(gateway.state);
    const rehydrated = deserializeAdmissionState(
      JSON.parse(JSON.stringify(serialized))
    );
    expect(rehydrated.appliedEventIds).toBeInstanceOf(Set);
  });

  it('every nested node of the rehydrated state is Object.isFrozen', async () => {
    const gateway = new BridgeAdmissionGateway({ config: CONFIG });
    await gateway.admitAndPersist(request('evt_p42_fr_1'), 1000);
    const rehydrated = deserializeAdmissionState(
      JSON.parse(JSON.stringify(serializeAdmissionState(gateway.state)))
    );
    // Sample a few critical nodes — the Phase 3.2 integrity suite
    // walks every node exhaustively; here we just spot-check the
    // ones a consumer is most likely to reach.
    expect(Object.isFrozen(rehydrated)).toBe(true);
    expect(Object.isFrozen(rehydrated.replayCache)).toBe(true);
    expect(Object.isFrozen(rehydrated.replayCache.entries)).toBe(true);
    expect(Object.isFrozen(rehydrated.peerReputation)).toBe(true);
    expect(Object.isFrozen(rehydrated.appliedEventIds)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Corruption rejection
// ---------------------------------------------------------------------------

describe('Phase 4.2 — corruption is rejected, never silently discarded', () => {
  it('rejects a non-object snapshot', () => {
    expect(() => deserializeAdmissionState('not an object')).toThrow(
      AdmissionStateCorruptError
    );
    expect(() => deserializeAdmissionState(null)).toThrow(AdmissionStateCorruptError);
    expect(() => deserializeAdmissionState([])).toThrow(AdmissionStateCorruptError);
  });

  it('rejects a snapshot whose version does not match', () => {
    expect(() =>
      deserializeAdmissionState({
        version: 'lfp2p.admission-state-snapshot.v0',
        state: {}
      })
    ).toThrow(/version/);
  });

  it('rejects a snapshot missing the state envelope', () => {
    expect(() =>
      deserializeAdmissionState({
        version: ADMISSION_STATE_SNAPSHOT_VERSION,
        state: 'oops'
      })
    ).toThrow(/state is not a plain object/);
  });

  it('rejects a snapshot whose state is missing a required field', () => {
    expect(() =>
      deserializeAdmissionState({
        version: ADMISSION_STATE_SNAPSHOT_VERSION,
        state: {
          peerReputation: {},
          rateLimitState: {},
          replayCache: { entries: {}, insertionOrder: [] },
          quarantinedPeers: {},
          quarantinedEvents: {},
          quarantinedMedia: {},
          auditLog: { capacity: 100, entries: [] }
          // appliedEventIds intentionally omitted
        }
      })
    ).toThrow(/appliedEventIds is missing/);
  });

  it('rejects appliedEventIds with non-string members', () => {
    expect(() =>
      deserializeAdmissionState({
        version: ADMISSION_STATE_SNAPSHOT_VERSION,
        state: {
          peerReputation: {},
          rateLimitState: {},
          replayCache: { entries: {}, insertionOrder: [] },
          quarantinedPeers: {},
          quarantinedEvents: {},
          quarantinedMedia: {},
          auditLog: { capacity: 100, entries: [] },
          appliedEventIds: [42, 'ok']
        }
      })
    ).toThrow(/strings only/);
  });
});

// ---------------------------------------------------------------------------
// InMemoryAdmissionStateStore
// ---------------------------------------------------------------------------

describe('Phase 4.2 — InMemoryAdmissionStateStore', () => {
  it('load() returns undefined before any save', async () => {
    const store = new InMemoryAdmissionStateStore();
    expect(await store.load()).toBeUndefined();
  });

  it('save() + load() round-trip preserves state', async () => {
    const store = new InMemoryAdmissionStateStore();
    const gateway = new BridgeAdmissionGateway({ config: CONFIG });
    await gateway.admitAndPersist(request('evt_p42_im_1'), 1000);
    await store.save(gateway.state);
    const loaded = await store.load();
    expect(loaded?.peerReputation).toEqual(gateway.state.peerReputation);
  });

  it('failNextSaveWith hook causes a single save to throw, then resets', async () => {
    const store = new InMemoryAdmissionStateStore();
    const gateway = new BridgeAdmissionGateway({ config: CONFIG });
    await gateway.admitAndPersist(request('evt_p42_hook_1'), 1000);

    store.failNextSaveWith = new Error('disk full');
    await expect(store.save(gateway.state)).rejects.toThrow(/disk full/);

    // Subsequent saves succeed.
    await expect(store.save(gateway.state)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// JsonFileAdmissionStateStore
// ---------------------------------------------------------------------------

describe('Phase 4.2 — JsonFileAdmissionStateStore', () => {
  it('cold start with missing file returns undefined', async () => {
    const dir = await createTempDir('p42-cold-');
    try {
      const store = new JsonFileAdmissionStateStore({
        filePath: join(dir, 'state.json')
      });
      expect(await store.load()).toBeUndefined();
    } finally {
      await removeDir(dir);
    }
  });

  it('save then load round-trips state across distinct store instances', async () => {
    const dir = await createTempDir('p42-rt-');
    const filePath = join(dir, 'state.json');
    try {
      const gateway = new BridgeAdmissionGateway({ config: CONFIG });
      await gateway.admitAndPersist(request('evt_p42_disk_1'), 1000);
      const writer = new JsonFileAdmissionStateStore({ filePath });
      await writer.save(gateway.state);
      // Fresh instance simulates a process restart.
      const reader = new JsonFileAdmissionStateStore({ filePath });
      const loaded = await reader.load();
      expect(loaded?.peerReputation).toEqual(gateway.state.peerReputation);
    } finally {
      await removeDir(dir);
    }
  });

  it('rejects a corrupt JSON file with AdmissionStateCorruptError', async () => {
    const dir = await createTempDir('p42-corrupt-');
    const filePath = join(dir, 'state.json');
    try {
      await writeFile(filePath, 'not valid json {');
      const store = new JsonFileAdmissionStateStore({ filePath });
      await expect(store.load()).rejects.toThrow(AdmissionStateCorruptError);
    } finally {
      await removeDir(dir);
    }
  });

  it('rejects a JSON file with a wrong-version snapshot', async () => {
    const dir = await createTempDir('p42-ver-');
    const filePath = join(dir, 'state.json');
    try {
      await writeFile(
        filePath,
        JSON.stringify({ version: 'lfp2p.admission-state-snapshot.v0', state: {} })
      );
      const store = new JsonFileAdmissionStateStore({ filePath });
      await expect(store.load()).rejects.toThrow(/version/);
    } finally {
      await removeDir(dir);
    }
  });

  it('after save() the temp file is gone (atomic rename leaves only the target)', async () => {
    const dir = await createTempDir('p42-atomic-');
    const filePath = join(dir, 'state.json');
    try {
      const gateway = new BridgeAdmissionGateway({ config: CONFIG });
      await gateway.admitAndPersist(request('evt_p42_atom_1'), 1000);
      const store = new JsonFileAdmissionStateStore({
        filePath,
        tempSuffix: 'fixed-test-suffix'
      });
      await store.save(gateway.state);
      // The target file exists.
      const text = await readFile(filePath, 'utf8');
      expect(text.length).toBeGreaterThan(0);
      // The temp file does not.
      const tempPath = `${filePath}.${process.pid}.fixed-test-suffix.tmp`;
      await expect(readFile(tempPath)).rejects.toThrow(/ENOENT/);
    } finally {
      await removeDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// BridgeAdmissionGateway.create — cold-load
// ---------------------------------------------------------------------------

describe('Phase 4.2 — BridgeAdmissionGateway.create() cold-loads persisted state', () => {
  it('a fresh process picks up a prior process\'s rate-limit budget', async () => {
    const store = new InMemoryAdmissionStateStore();
    const first = await BridgeAdmissionGateway.create({
      config: CONFIG,
      stateStore: store
    });
    await first.admitAndPersist(request('evt_p42_warm_1'), 1000);
    const firstStateAfter = first.state;

    // "Restart" — create a new gateway against the same store.
    const second = await BridgeAdmissionGateway.create({
      config: CONFIG,
      stateStore: store
    });
    expect(second.state.peerReputation).toEqual(firstStateAfter.peerReputation);
    expect([...second.state.appliedEventIds].sort()).toEqual(
      [...firstStateAfter.appliedEventIds].sort()
    );
  });

  it('cold start with no persisted state begins with the empty state', async () => {
    const store = new InMemoryAdmissionStateStore();
    const gateway = await BridgeAdmissionGateway.create({
      config: CONFIG,
      stateStore: store
    });
    expect(Object.keys(gateway.state.peerReputation).length).toBe(0);
    expect(gateway.state.appliedEventIds.size).toBe(0);
  });

  it('refuses to start on corruption — propagates the load error to the operator', async () => {
    const dir = await createTempDir('p42-refuse-');
    const filePath = join(dir, 'state.json');
    try {
      await writeFile(filePath, '{ bad json');
      const store = new JsonFileAdmissionStateStore({ filePath });
      await expect(
        BridgeAdmissionGateway.create({ config: CONFIG, stateStore: store })
      ).rejects.toThrow(AdmissionStateCorruptError);
    } finally {
      await removeDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// Fail-closed: admitAndPersist throws => in-memory state unchanged
// ---------------------------------------------------------------------------

describe('Phase 4.2 — admitAndPersist fail-closes on save failure', () => {
  it('a save() throw leaves the in-memory state unchanged', async () => {
    const store = new InMemoryAdmissionStateStore();
    const gateway = new BridgeAdmissionGateway({
      config: CONFIG,
      stateStore: store
    });
    // First admit succeeds and persists.
    await gateway.admitAndPersist(request('evt_p42_fc_1'), 1000);
    const stateAfterFirst = gateway.state;

    // Second admit's save throws.
    store.failNextSaveWith = new Error('disk full');
    await expect(
      gateway.admitAndPersist(request('evt_p42_fc_2'), 2000)
    ).rejects.toThrow(/disk full/);

    // In-memory state MUST NOT have advanced — that's the
    // fail-closed contract. Reference equality is the primary
    // invariant; we cross-check via per-peer reputation (the
    // engine updates this on every admit, so a moved-forward
    // state would show 2 reputation samples but the failed save
    // leaves only the one from the successful first admit).
    expect(gateway.state).toBe(stateAfterFirst);
    expect(Object.keys(gateway.state.peerReputation)).toHaveLength(1);
    expect(gateway.state.peerReputation['device:alice-phone']).toBe(
      stateAfterFirst.peerReputation['device:alice-phone']
    );
  });
});

// ---------------------------------------------------------------------------
// BridgeService end-to-end: persistence failure → privacy-safe rejection
// ---------------------------------------------------------------------------

describe('Phase 4.2 — BridgeService surfaces persistence failure as rejection', () => {
  it('a save failure inside admission becomes a rejected delivery with a stable code', async () => {
    const store = new InMemoryAdmissionStateStore();
    const gateway = new BridgeAdmissionGateway({
      config: CONFIG,
      stateStore: store
    });
    const service = new InMemoryBridgeService({ admission: gateway });

    store.failNextSaveWith = new Error('simulated-io-error');
    const response = await service.acceptDelivery(request('evt_p42_e2e_1'));

    expect(response.status).toBe('rejected');
    if (response.status === 'rejected') {
      // Reason carries only the Error class name + a static label —
      // never the envelope payload or the underlying IO message.
      // Per Phase 3.1 privacy-safe-logging doctrine.
      expect(response.reason).toMatch(/^admission-persist-failed:Error$/);
      expect(response.reason).not.toMatch(/simulated-io-error/);
    }
  });
});
