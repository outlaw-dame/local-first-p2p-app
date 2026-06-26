/**
 * Step 2 of the post-#84 follow-up — proof-registry persistence.
 *
 * Verifies the Dexie v9 `capabilityProofRecords` table and the
 * round-trip with `seedProofRegistry`. The store's hydration path
 * MUST drop corrupt rows silently (one bad row cannot poison the
 * whole registry) and MUST preserve every legitimate verificationState
 * including the new `'possession-confirmed'` tier.
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  registerProof,
  revokeProof,
  verifyProof,
  type CapabilityProofRecord,
  type CapabilityProofVerifier
} from '@lfp2p/capabilities';
import { createLocalFirstStore, type StoredCapabilityProofRecord } from './index.js';

const NOW = '2026-06-08T12:00:00.000Z';
const LATER = '2030-01-01T00:00:00.000Z';

const ISSUER = { id: 'did:example:issuer', kind: 'actor' as const };
const SUBJECT = { id: 'did:example:holder', kind: 'actor' as const };

const DIGEST_A = 'sha-256:0000000000000000000000000000000000000000000000000000000000000000';
const DIGEST_B = 'sha-256:1111111111111111111111111111111111111111111111111111111111111111';
const DIGEST_C = 'sha-256:2222222222222222222222222222222222222222222222222222222222222222';

const VERIFY_ALL: CapabilityProofVerifier = () => 'verified';
const REJECT_ALL: CapabilityProofVerifier = () => 'invalid';
const POSSESS: CapabilityProofVerifier = () => 'possession-confirmed';

function freshStore() {
  // Unique DB name per test invocation so fake-indexeddb instances
  // don't cross-contaminate across describe blocks.
  return createLocalFirstStore(`lfp2p-proof-persist-test-${Math.random().toString(36).slice(2)}`);
}

function record(overrides: Partial<CapabilityProofRecord> = {}): CapabilityProofRecord {
  return {
    proofId: 'proof:native:1',
    scheme: 'native-signed-event',
    issuer: ISSUER,
    subject: SUBJECT,
    issuedAt: NOW,
    expiresAt: LATER,
    digest: DIGEST_A,
    verificationState: 'unverified',
    ...overrides
  };
}

/* -------------------------------------------------------------------------- */
/*                                CRUD basics                                 */
/* -------------------------------------------------------------------------- */

describe('capability-proof persistence: CRUD basics', () => {
  it('round-trips a record via put → get', async () => {
    const store = freshStore();
    const r = record();
    await store.putCapabilityProofRecord(r);
    const got = await store.getCapabilityProofRecord(r.proofId);
    expect(got).toEqual(r);
  });

  it('UPSERT semantics — put twice with different verificationState updates in place', async () => {
    const store = freshStore();
    await store.putCapabilityProofRecord(record({ verificationState: 'unverified' }));
    await store.putCapabilityProofRecord(record({ verificationState: 'verified' }));
    const got = await store.getCapabilityProofRecord('proof:native:1');
    expect(got?.verificationState).toBe('verified');
  });

  it('listCapabilityProofRecords returns every persisted row', async () => {
    const store = freshStore();
    await store.putCapabilityProofRecord(record({ proofId: 'p1', digest: DIGEST_A }));
    await store.putCapabilityProofRecord(record({ proofId: 'p2', scheme: 'ucan', digest: DIGEST_B }));
    await store.putCapabilityProofRecord(record({ proofId: 'p3', scheme: 'vc', digest: DIGEST_C }));
    const rows = await store.listCapabilityProofRecords();
    expect(rows.map((r) => r.proofId).sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('deleteCapabilityProofRecord removes the row', async () => {
    const store = freshStore();
    await store.putCapabilityProofRecord(record());
    await store.deleteCapabilityProofRecord('proof:native:1');
    expect(await store.getCapabilityProofRecord('proof:native:1')).toBeUndefined();
  });

  it('getCapabilityProofRecord returns undefined for an unknown proofId', async () => {
    const store = freshStore();
    expect(await store.getCapabilityProofRecord('proof:not-here')).toBeUndefined();
  });

  it('getCapabilityProofRecord rejects empty proofId', async () => {
    const store = freshStore();
    await expect(store.getCapabilityProofRecord('')).rejects.toThrow();
  });

  it('deleteCapabilityProofRecord rejects empty proofId', async () => {
    const store = freshStore();
    await expect(store.deleteCapabilityProofRecord('')).rejects.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/*                            validation at the boundary                      */
/* -------------------------------------------------------------------------- */

describe('capability-proof persistence: validation at the boundary', () => {
  it('rejects an unknown scheme at put time (does not poison the table)', async () => {
    const store = freshStore();
    await expect(
      store.putCapabilityProofRecord(record({ scheme: 'bogus' as never }))
    ).rejects.toThrow();
    // And the table really is untouched.
    expect(await store.listCapabilityProofRecords()).toHaveLength(0);
  });

  it('rejects an unknown verificationState at put time', async () => {
    const store = freshStore();
    await expect(
      store.putCapabilityProofRecord(record({ verificationState: 'pwned' as never }))
    ).rejects.toThrow();
  });

  it('rejects malformed digest at put time', async () => {
    const store = freshStore();
    await expect(
      store.putCapabilityProofRecord(record({ digest: 'not-a-digest' }))
    ).rejects.toThrow();
  });

  it('rejects issuedAt >= expiresAt at put time', async () => {
    const store = freshStore();
    await expect(
      store.putCapabilityProofRecord(record({ issuedAt: LATER, expiresAt: NOW }))
    ).rejects.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/*                            loadProofRegistry                               */
/* -------------------------------------------------------------------------- */

describe('capability-proof persistence: loadProofRegistry', () => {
  it('empty store → empty registry', async () => {
    const store = freshStore();
    const reg = await store.loadProofRegistry();
    expect(reg.proofs.size).toBe(0);
  });

  it('hydrates every persisted record into the registry', async () => {
    const store = freshStore();
    await store.putCapabilityProofRecord(record({ proofId: 'p1', verificationState: 'verified', digest: DIGEST_A }));
    await store.putCapabilityProofRecord(record({ proofId: 'p2', scheme: 'ucan', verificationState: 'unverified', digest: DIGEST_B }));
    const reg = await store.loadProofRegistry();
    expect(reg.proofs.size).toBe(2);
    expect(reg.proofs.get('p1')?.verificationState).toBe('verified');
    expect(reg.proofs.get('p2')?.verificationState).toBe('unverified');
  });

  it('preserves the possession-confirmed verdict tier across persistence', async () => {
    const store = freshStore();
    await store.putCapabilityProofRecord(
      record({ scheme: 'bearcap', verificationState: 'possession-confirmed' })
    );
    const reg = await store.loadProofRegistry();
    expect(reg.proofs.get('proof:native:1')?.verificationState).toBe('possession-confirmed');
  });

  it('preserves revokedAt + verificationState === "revoked"', async () => {
    const store = freshStore();
    await store.putCapabilityProofRecord(
      record({ revokedAt: NOW, verificationState: 'revoked' })
    );
    const reg = await store.loadProofRegistry();
    const got = reg.proofs.get('proof:native:1');
    expect(got?.revokedAt).toBe(NOW);
    expect(got?.verificationState).toBe('revoked');
  });

  it('drops corrupt rows silently — one bad row does not poison the registry', async () => {
    const store = freshStore();
    // Insert one valid record via the validating API.
    await store.putCapabilityProofRecord(record({ proofId: 'good', digest: DIGEST_A }));
    // Sneak a corrupt row past validation by talking to Dexie directly.
    // (Simulates schema drift, hostile direct DB mutation, or a
    // downgrade.) Use the private-table reach-around via the table
    // resolver so we don't have to expose internals.
    const db = store as unknown as {
      transaction: (
        mode: 'rw',
        tables: string[],
        fn: (tx: { capabilityProofRecords: { put: (row: Record<string, unknown>) => Promise<unknown> } }) => Promise<unknown>
      ) => Promise<unknown>;
    };
    // Reach into the Dexie instance via the documented table API.
    // Note: this works because Dexie's `put` skips our validator
    // and is what a real corruption path would also exercise.
    await db.transaction('rw', ['capabilityProofRecords'], async (tx) => {
      await tx.capabilityProofRecords.put({
        proofId: 'corrupt',
        scheme: 'bogus-scheme', // not in CAPABILITY_PROOF_SCHEMES
        issuer: ISSUER,
        subject: SUBJECT,
        issuedAt: NOW,
        expiresAt: LATER,
        digest: DIGEST_B,
        verificationState: 'verified'
      });
    });

    // The corrupt row IS persisted at rest (confirm that before
    // asserting the resilience). If we don't, the test could pass
    // simply because the row never landed in the table.
    const allRows = await store.listCapabilityProofRecords();
    expect(allRows.map((r) => r.proofId).sort()).toEqual(['corrupt', 'good']);

    // …but loadProofRegistry's validator drops it on hydration.
    const reg = await store.loadProofRegistry();
    expect(reg.proofs.has('good')).toBe(true);
    expect(reg.proofs.has('corrupt')).toBe(false);
  });

  it('hydrated registry round-trips through verifyProof end-to-end', async () => {
    // Persist a record, hydrate, run verifyProof against the
    // hydrated registry — the verifier suite plays cleanly with the
    // persisted state.
    const store = freshStore();
    await store.putCapabilityProofRecord(record({ verificationState: 'unverified' }));
    let reg = await store.loadProofRegistry();
    reg = verifyProof(reg, 'proof:native:1', { now: NOW, verifier: VERIFY_ALL }).registry;
    expect(reg.proofs.get('proof:native:1')?.verificationState).toBe('verified');
  });

  it('hydrated registry can be re-persisted after verifyProof updates state', async () => {
    // Simulates the canonical flow: load → verify → re-persist →
    // load again to confirm the verified state survives.
    const store = freshStore();
    await store.putCapabilityProofRecord(record({ verificationState: 'unverified' }));

    let reg = await store.loadProofRegistry();
    reg = verifyProof(reg, 'proof:native:1', { now: NOW, verifier: POSSESS }).registry;
    // Persist the updated record.
    const updated = reg.proofs.get('proof:native:1');
    expect(updated).toBeDefined();
    await store.putCapabilityProofRecord(updated as CapabilityProofRecord);

    const reg2 = await store.loadProofRegistry();
    expect(reg2.proofs.get('proof:native:1')?.verificationState).toBe(
      'possession-confirmed'
    );
  });

  it('full canonical flow: registerProof → persist → load → verifyProof → re-persist → load', async () => {
    const store = freshStore();
    // Start from an empty registry, register one proof, persist it.
    const { record: rec } = registerProof(
      await store.loadProofRegistry(),
      {
        proofId: 'proof:native:flow',
        scheme: 'native-signed-event',
        issuer: ISSUER,
        subject: SUBJECT,
        issuedAt: NOW,
        expiresAt: LATER,
        digest: DIGEST_A
      }
    );
    await store.putCapabilityProofRecord(rec);

    // Reload, verify, re-persist.
    const reg1 = await store.loadProofRegistry();
    const { registry: reg2, record: verified } = verifyProof(
      reg1,
      'proof:native:flow',
      { now: NOW, verifier: VERIFY_ALL }
    );
    expect(verified.verificationState).toBe('verified');
    await store.putCapabilityProofRecord(verified);

    // Final load — verified state survived a round-trip.
    const reg3 = await store.loadProofRegistry();
    expect(reg3.proofs.get('proof:native:flow')?.verificationState).toBe('verified');

    // Now revoke, persist, reload — revoked state survives too.
    const { record: revoked } = revokeProof(reg2, 'proof:native:flow', { revokedAt: NOW });
    await store.putCapabilityProofRecord(revoked);
    const reg4 = await store.loadProofRegistry();
    expect(reg4.proofs.get('proof:native:flow')?.verificationState).toBe('revoked');
    expect(reg4.proofs.get('proof:native:flow')?.revokedAt).toBe(NOW);
  });

  it('REJECT_ALL verifier produces "invalid" that survives re-persistence', async () => {
    const store = freshStore();
    await store.putCapabilityProofRecord(record());
    let reg = await store.loadProofRegistry();
    reg = verifyProof(reg, 'proof:native:1', { now: NOW, verifier: REJECT_ALL }).registry;
    await store.putCapabilityProofRecord(reg.proofs.get('proof:native:1') as CapabilityProofRecord);
    const reg2 = await store.loadProofRegistry();
    expect(reg2.proofs.get('proof:native:1')?.verificationState).toBe('invalid');
  });
});

/* -------------------------------------------------------------------------- */
/*                            type re-export sanity                           */
/* -------------------------------------------------------------------------- */

describe('capability-proof persistence: type re-exports', () => {
  it('StoredCapabilityProofRecord is structurally identical to CapabilityProofRecord', () => {
    // Compile-time check: a CapabilityProofRecord IS-A StoredCapabilityProofRecord.
    const r: CapabilityProofRecord = record();
    const stored: StoredCapabilityProofRecord = r;
    expect(stored.proofId).toBe(r.proofId);
  });
});
