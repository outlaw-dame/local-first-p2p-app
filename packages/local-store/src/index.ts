import Dexie, { type Table } from 'dexie';
import { type EncryptedKeyMaterial } from '@lfp2p/crypto';
import { type SignedEventEnvelope, validateSignedEvent } from '@lfp2p/protocol';
import {
  type LabelerEvent,
  type LabelersState,
  type LocalControlEvent,
  type LocalControlState,
  type ReputationEvent,
  applyLabelerEvent,
  applyLocalControlEvent,
  createEmptyLabelersState,
  createEmptyLocalControlState,
  validateLabelerEvent,
  validateLocalControlEvent,
  validateReputationEvent
} from '@lfp2p/trust-safety';
import {
  type CapabilityProofRecord,
  type ProofRegistry,
  seedProofRegistry,
  validateStoredProofRecord
} from '@lfp2p/capabilities';
import {
  type MlsGroupProjectionState,
  createEmptyMlsGroupProjectionState,
  projectMlsGroupControlEvent
} from '@lfp2p/mls-group-projection';

export type OutboxStatus = 'pending' | 'syncing' | 'confirmed' | 'failed' | 'conflicted';
export type DeviceIdentityStatus = 'active' | 'revoked';
export type LocalFirstTableName =
  | 'signedEvents'
  | 'mutationOutbox'
  | 'eventSummaries'
  | 'deviceIdentities'
  | 'localProtectionKeys'
  | 'syncCheckpoints'
  | 'identityControlProjections'
  | 'contactProfiles'
  | 'trustSafetyControlEvents'
  | 'trustSafetyLabelerEvents'
  | 'trustSafetyReputationEvents'
  | 'capabilityProofRecords'
  | 'mlsGroupProjections';

/**
 * Stored local-control event. The full envelope is preserved as the
 * source of truth; the indexed columns are projected for query
 * efficiency. `sequence` is a monotonic per-row insertion counter so
 * replay order is deterministic even when two events share a
 * createdAt timestamp.
 */
export type StoredTrustSafetyControlEvent = Readonly<{
  eventId: string;
  kind: string;
  createdAt: string;
  sequence: number;
  event: LocalControlEvent;
}>;

/** Stored labeler event. Same shape rationale as the control row. */
export type StoredTrustSafetyLabelerEvent = Readonly<{
  eventId: string;
  kind: string;
  createdAt: string;
  sequence: number;
  event: LabelerEvent;
}>;

/**
 * Phase 1.8.7 — stored reputation event (observation / attestation /
 * revocation / aggregator-published / aggregator-score.removed).
 * Same append-only + idempotent-on-eventId pattern as the other
 * trust-safety tables.
 *
 * The privacy ladder lives on the underlying event envelope, NOT
 * here — Phase 3.1 privacy-safe-logging makes this row safe to
 * persist because the protocol-layer validator (Phase 1.8.1)
 * already enforced bounded-enum fields only (no free-form text).
 */
export type StoredTrustSafetyReputationEvent = Readonly<{
  eventId: string;
  kind: string;
  createdAt: string;
  sequence: number;
  event: ReputationEvent;
}>;

/**
 * Persisted CapabilityProofRecord row.
 *
 * The full `CapabilityProofRecord` from `@lfp2p/capabilities` IS the
 * stored shape — there is no separate envelope. `proofId` is the
 * primary key (one record per proof; UPSERT covers both initial
 * registration and per-device verificationState updates).
 *
 * The persisted `verificationState` is the cache of "what THIS
 * device's verifier stack decided last time" — by doctrine
 * (each-device-verifies-independently) it is a local computation,
 * not a synced field. Cross-device consistency comes from the
 * underlying signed-event sync, not from replicating
 * verificationState.
 *
 * `seedProofRegistry` is the authoritative validator at load time:
 * a corrupt row at rest (schema drift on a downgrade, hostile direct
 * DB mutation) is skipped rather than poisoning the in-memory
 * registry. See `loadProofRegistry` below.
 */
export type StoredCapabilityProofRecord = CapabilityProofRecord;

export type IdentityVerificationStatus =
  | 'unknown'
  | 'controller-known'
  | 'revoked-device-seen'
  | 'mismatch-detected';

export type StoredSignedEvent = Readonly<{
  eventId: string;
  kind: string;
  author: string;
  createdAt: string;
  event: SignedEventEnvelope;
}>;

export type MutationOutboxEntry = Readonly<{
  idempotencyKey: string;
  eventId: string;
  target: string;
  status: OutboxStatus;
  retryCount: number;
  nextRetryAt: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}>;

export type RecoverStaleOutboxClaimsInput = Readonly<{
  staleBefore: string;
  nextRetryAt: string;
  updatedAt?: string;
  lastError?: string;
  limit?: number;
}>;

export type OutboxStatusCounts = Readonly<Record<OutboxStatus, number>>;

export type EventSummaryView = Readonly<{
  eventId: string;
  title: string;
  subtitle: string;
  createdAt: string;
}>;

export type StoredDeviceIdentity = Readonly<{
  recordType: 'local-device-identity.v1';
  identityId: string;
  deviceId: string;
  publicKey: string;
  encryptedPrivateKey: EncryptedKeyMaterial;
  protectionKeyId: string;
  status: DeviceIdentityStatus;
  createdAt: string;
  updatedAt: string;
}>;

export type StoredLocalProtectionKey = Readonly<{
  keyId: string;
  algorithm: 'aes-gcm-256';
  key: CryptoKey;
  createdAt: string;
}>;

export type SyncCheckpointKey = Readonly<{
  sourceId: string;
  streamId: string;
  scope: string;
}>;

export type StoredSyncCheckpoint = SyncCheckpointKey &
  Readonly<{
    checkpointId: string;
    cursor: string;
    sequence: number;
    updatedAt: string;
  }>;

export type AdvanceSyncCheckpointInput = SyncCheckpointKey &
  Readonly<{
    cursor: string;
    sequence: number;
    updatedAt?: string;
    allowRewind?: boolean;
  }>;

export type PutSignedEventWithSyncCheckpointInput = Readonly<{
  event: SignedEventEnvelope;
  checkpoint: AdvanceSyncCheckpointInput;
  identityControlProjectionUpdate?: IdentityControlProjectionUpdate;
}>;

export type PutSignedEventWithSyncCheckpointResult = Readonly<{
  status: 'stored' | 'skipped';
  checkpoint: StoredSyncCheckpoint;
}>;

/**
 * Phase 1.8.14 — return shape for `appendTrustSafetyReputationEvent`.
 * `'stored'` signals a fresh insert; `'skipped'` signals an
 * idempotent no-op (an event with the same `eventId` was already
 * persisted). Callers that don't care about the distinction can
 * ignore the result safely.
 */
export type AppendTrustSafetyReputationEventResult = Readonly<{
  status: 'stored' | 'skipped';
}>;

/**
 * Phase 4b — stored MLS group-control projection row.
 * `MlsGroupProjectionState` already carries `groupId` and `updatedAt` as
 * top-level fields, so no wrapper is needed — the state IS the stored shape.
 * Dexie indexes `groupId` as the primary key and `updatedAt` for range queries.
 */
export type StoredMlsGroupProjection = MlsGroupProjectionState;

export type AppendMlsGroupControlEventOptions = Readonly<{
  localDeviceId?: string | undefined;
  allowAutomatedForkRecovery?: boolean | undefined;
  updatedAt?: string;
}>;

export type AppendMlsGroupControlEventResult = Readonly<{
  status: 'stored' | 'skipped';
  outcome: 'accepted' | 'rejected' | 'fork-queued';
  state: MlsGroupProjectionState;
}>;

export type SyncCheckpointRejectedCode = 'stale-sequence' | 'cursor-mismatch';

export type StoredIdentityControlDevice = Readonly<{
  deviceId: string;
  publicKey: string;
  status: 'active' | 'revoked';
  authorizedAt: string;
  revokedAt?: string;
}>;

export type StoredIdentityControlCapability = Readonly<{
  capabilityId: string;
  delegateDeviceId: string;
  scope: string;
  expiresAt?: string;
  status: 'granted' | 'revoked';
  grantedAt: string;
  revokedAt?: string;
}>;

/**
 * Snapshot of the most recent contact-card publication audit entry
 * (Phase 2.1). Older publications stay in the signed-event log; the
 * projection retains only the latest.
 */
export type StoredIdentityContactCardPublication = Readonly<{
  contactCardDigest: string;
  capturedAt: string;
  publishedAt: string;
}>;

export type StoredIdentityControlProjection = Readonly<{
  identityId: string;
  controllerPublicKey?: string;
  epoch: number;
  devices: Readonly<Record<string, StoredIdentityControlDevice>>;
  capabilities: Readonly<Record<string, StoredIdentityControlCapability>>;
  contactCardPublication?: StoredIdentityContactCardPublication;
  lastEventId?: string;
  updatedAt: string;
}>;

export type StoredContactProfile = Readonly<{
  identityId: string;
  petname?: string;
  petnameCanonical?: string;
  displayName?: string;
  avatarUrl?: string;
  websiteUrl?: string;
  note?: string;
  primaryDeviceId?: string;
  controllerPublicKey?: string;
  shortFingerprint?: string;
  verificationStatus: IdentityVerificationStatus;
  createdAt: string;
  updatedAt: string;
}>;

export type PutContactProfileInput = Readonly<{
  identityId: string;
  petname?: string;
  displayName?: string;
  avatarUrl?: string;
  websiteUrl?: string;
  note?: string;
  primaryDeviceId?: string;
  controllerPublicKey?: string;
  shortFingerprint?: string;
  verificationStatus?: IdentityVerificationStatus;
  updatedAt?: string;
}>;

export type IdentityControlProjectionUpdate = (
  current: StoredIdentityControlProjection | undefined,
  event: SignedEventEnvelope,
  updatedAt: string
) => Promise<StoredIdentityControlProjection> | StoredIdentityControlProjection;

type OutboxStatusPatch = Readonly<{
  updatedAt?: string;
  lastError?: string;
}>;

type CheckpointAdvanceDecision = 'advance' | 'skip';

export class SyncCheckpointRejectedError extends Error {
  readonly code: SyncCheckpointRejectedCode;

  constructor(code: SyncCheckpointRejectedCode, message: string) {
    super(message);
    this.name = 'SyncCheckpointRejectedError';
    this.code = code;
  }
}

class LocalFirstP2PDatabase extends Dexie {
  signedEvents!: Table<StoredSignedEvent, string>;
  mutationOutbox!: Table<MutationOutboxEntry, string>;
  eventSummaries!: Table<EventSummaryView, string>;
  deviceIdentities!: Table<StoredDeviceIdentity, string>;
  localProtectionKeys!: Table<StoredLocalProtectionKey, string>;
  syncCheckpoints!: Table<StoredSyncCheckpoint, string>;
  identityControlProjections!: Table<StoredIdentityControlProjection, string>;
  contactProfiles!: Table<StoredContactProfile, string>;
  trustSafetyControlEvents!: Table<StoredTrustSafetyControlEvent, string>;
  trustSafetyLabelerEvents!: Table<StoredTrustSafetyLabelerEvent, string>;
  trustSafetyReputationEvents!: Table<StoredTrustSafetyReputationEvent, string>;
  capabilityProofRecords!: Table<StoredCapabilityProofRecord, string>;
  mlsGroupProjections!: Table<StoredMlsGroupProjection, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      signedEvents: 'eventId, kind, author, createdAt',
      mutationOutbox: 'idempotencyKey, eventId, status, nextRetryAt, createdAt',
      eventSummaries: 'eventId, createdAt'
    });
    this.version(2).stores({
      signedEvents: 'eventId, kind, author, createdAt',
      mutationOutbox: 'idempotencyKey, eventId, status, nextRetryAt, createdAt',
      eventSummaries: 'eventId, createdAt',
      deviceIdentities: 'identityId, deviceId, publicKey, status, createdAt',
      localProtectionKeys: 'keyId, algorithm, createdAt'
    });
    this.version(3).stores({
      signedEvents: 'eventId, kind, author, createdAt',
      mutationOutbox: 'idempotencyKey, eventId, status, nextRetryAt, createdAt, [status+nextRetryAt]',
      eventSummaries: 'eventId, createdAt',
      deviceIdentities: 'identityId, deviceId, publicKey, status, createdAt',
      localProtectionKeys: 'keyId, algorithm, createdAt'
    });
    this.version(4).stores({
      signedEvents: 'eventId, kind, author, createdAt',
      mutationOutbox: 'idempotencyKey, eventId, status, nextRetryAt, createdAt, [status+nextRetryAt]',
      eventSummaries: 'eventId, createdAt',
      deviceIdentities: 'identityId, deviceId, publicKey, status, createdAt',
      localProtectionKeys: 'keyId, algorithm, createdAt',
      syncCheckpoints: 'checkpointId'
    });
    this.version(5).stores({
      signedEvents: 'eventId, kind, author, createdAt',
      mutationOutbox: 'idempotencyKey, eventId, status, nextRetryAt, createdAt, [status+nextRetryAt]',
      eventSummaries: 'eventId, createdAt',
      deviceIdentities: 'identityId, deviceId, publicKey, status, createdAt',
      localProtectionKeys: 'keyId, algorithm, createdAt',
      syncCheckpoints: 'checkpointId',
      identityControlProjections: 'identityId, updatedAt'
    });
    this.version(6).stores({
      signedEvents: 'eventId, kind, author, createdAt',
      mutationOutbox: 'idempotencyKey, eventId, status, nextRetryAt, createdAt, [status+nextRetryAt]',
      eventSummaries: 'eventId, createdAt',
      deviceIdentities: 'identityId, deviceId, publicKey, status, createdAt',
      localProtectionKeys: 'keyId, algorithm, createdAt',
      syncCheckpoints: 'checkpointId',
      identityControlProjections: 'identityId, updatedAt',
      contactProfiles: 'identityId, petnameCanonical, updatedAt'
    });
    this.version(7).stores({
      signedEvents: 'eventId, kind, author, createdAt',
      mutationOutbox: 'idempotencyKey, eventId, status, nextRetryAt, createdAt, [status+nextRetryAt]',
      eventSummaries: 'eventId, createdAt',
      deviceIdentities: 'identityId, deviceId, publicKey, status, createdAt',
      localProtectionKeys: 'keyId, algorithm, createdAt',
      syncCheckpoints: 'checkpointId',
      identityControlProjections: 'identityId, updatedAt',
      contactProfiles: 'identityId, petnameCanonical, updatedAt',
      // Trust & Safety: append-only event logs. Primary key is eventId
      // so a duplicate append (replay, retry) is a silent no-op. The
      // composite [sequence] secondary index gives us deterministic
      // replay order even when two events share a createdAt.
      trustSafetyControlEvents: 'eventId, kind, createdAt, sequence',
      trustSafetyLabelerEvents: 'eventId, kind, createdAt, sequence'
    });
    // Phase 1.8.7 — adds the reputation event log. Schema bump is
    // additive: existing v7 rows roll forward unchanged.
    this.version(8).stores({
      signedEvents: 'eventId, kind, author, createdAt',
      mutationOutbox: 'idempotencyKey, eventId, status, nextRetryAt, createdAt, [status+nextRetryAt]',
      eventSummaries: 'eventId, createdAt',
      deviceIdentities: 'identityId, deviceId, publicKey, status, createdAt',
      localProtectionKeys: 'keyId, algorithm, createdAt',
      syncCheckpoints: 'checkpointId',
      identityControlProjections: 'identityId, updatedAt',
      contactProfiles: 'identityId, petnameCanonical, updatedAt',
      trustSafetyControlEvents: 'eventId, kind, createdAt, sequence',
      trustSafetyLabelerEvents: 'eventId, kind, createdAt, sequence',
      trustSafetyReputationEvents: 'eventId, kind, createdAt, sequence'
    });
    // Step 2 of the post-#84 follow-up — proof-registry persistence.
    // Adds the capabilityProofRecords table keyed by proofId. Schema
    // bump is additive: existing v8 rows roll forward unchanged.
    // Indexes on (scheme, verificationState, expiresAt) support the
    // common admin / debug queries without forcing a full scan.
    this.version(9).stores({
      signedEvents: 'eventId, kind, author, createdAt',
      mutationOutbox: 'idempotencyKey, eventId, status, nextRetryAt, createdAt, [status+nextRetryAt]',
      eventSummaries: 'eventId, createdAt',
      deviceIdentities: 'identityId, deviceId, publicKey, status, createdAt',
      localProtectionKeys: 'keyId, algorithm, createdAt',
      syncCheckpoints: 'checkpointId',
      identityControlProjections: 'identityId, updatedAt',
      contactProfiles: 'identityId, petnameCanonical, updatedAt',
      trustSafetyControlEvents: 'eventId, kind, createdAt, sequence',
      trustSafetyLabelerEvents: 'eventId, kind, createdAt, sequence',
      trustSafetyReputationEvents: 'eventId, kind, createdAt, sequence',
      capabilityProofRecords: 'proofId, scheme, verificationState, expiresAt'
    });
    // Phase 4b — MLS group-control projection cache. Adds the
    // mlsGroupProjections table keyed by groupId. Schema bump is additive:
    // existing v9 rows roll forward unchanged.
    this.version(10).stores({
      signedEvents: 'eventId, kind, author, createdAt',
      mutationOutbox: 'idempotencyKey, eventId, status, nextRetryAt, createdAt, [status+nextRetryAt]',
      eventSummaries: 'eventId, createdAt',
      deviceIdentities: 'identityId, deviceId, publicKey, status, createdAt',
      localProtectionKeys: 'keyId, algorithm, createdAt',
      syncCheckpoints: 'checkpointId',
      identityControlProjections: 'identityId, updatedAt',
      contactProfiles: 'identityId, petnameCanonical, updatedAt',
      trustSafetyControlEvents: 'eventId, kind, createdAt, sequence',
      trustSafetyLabelerEvents: 'eventId, kind, createdAt, sequence',
      trustSafetyReputationEvents: 'eventId, kind, createdAt, sequence',
      capabilityProofRecords: 'proofId, scheme, verificationState, expiresAt',
      mlsGroupProjections: 'groupId, updatedAt'
    });
  }
}

export class DexieLocalFirstStore {
  readonly #db: LocalFirstP2PDatabase;

  constructor(databaseName = 'lfp2p-local-store') {
    this.#db = new LocalFirstP2PDatabase(databaseName);
  }

  async putSignedEvent(event: SignedEventEnvelope): Promise<void> {
    validateSignedEvent(event);
    await this.#db.signedEvents.put(storedSignedEvent(event));
  }

  async getSignedEvent(eventId: string): Promise<SignedEventEnvelope | undefined> {
    return (await this.#db.signedEvents.get(eventId))?.event;
  }

  async listSignedEvents(limit = 50): Promise<StoredSignedEvent[]> {
    return this.#db.signedEvents.orderBy('createdAt').reverse().limit(limit).toArray();
  }

  async enqueueOutbox(entry: MutationOutboxEntry): Promise<void> {
    validateOutboxEntry(entry);
    await this.#db.mutationOutbox.put(entry);
  }

  async getOutboxEntry(idempotencyKey: string): Promise<MutationOutboxEntry | undefined> {
    requireNonEmpty(idempotencyKey, 'idempotencyKey');
    return this.#db.mutationOutbox.get(idempotencyKey);
  }

  async listPendingOutbox(limit = 50): Promise<MutationOutboxEntry[]> {
    return this.#db.mutationOutbox.where('status').equals('pending').limit(limit).toArray();
  }

  async listDueOutbox(now = new Date().toISOString(), limit = 50): Promise<MutationOutboxEntry[]> {
    requireIsoDate(now, 'now');
    requirePositiveInteger(limit, 'limit');
    return this.#db.mutationOutbox
      .where('[status+nextRetryAt]')
      .between(['pending', ''], ['pending', now], true, true)
      .limit(limit)
      .toArray();
  }

  async claimOutboxEntry(idempotencyKey: string, updatedAt = new Date().toISOString()): Promise<MutationOutboxEntry | undefined> {
    requireNonEmpty(idempotencyKey, 'idempotencyKey');
    requireIsoDate(updatedAt, 'updatedAt');
    return this.transaction('rw', ['mutationOutbox'], async () => {
      const entry = await this.#db.mutationOutbox.get(idempotencyKey);
      if (!entry || entry.status !== 'pending') return undefined;
      const claimed: MutationOutboxEntry = {
        ...entry,
        status: 'syncing',
        updatedAt
      };
      await this.#db.mutationOutbox.put(claimed);
      return claimed;
    });
  }

  async markOutboxConfirmed(idempotencyKey: string, updatedAt = new Date().toISOString()): Promise<void> {
    requireNonEmpty(idempotencyKey, 'idempotencyKey');
    requireIsoDate(updatedAt, 'updatedAt');
    await this.transaction('rw', ['mutationOutbox'], async () => {
      const entry = await this.#db.mutationOutbox.get(idempotencyKey);
      if (!entry) return;
      const confirmed: MutationOutboxEntry = {
        idempotencyKey: entry.idempotencyKey,
        eventId: entry.eventId,
        target: entry.target,
        status: 'confirmed',
        retryCount: entry.retryCount,
        nextRetryAt: entry.nextRetryAt,
        createdAt: entry.createdAt,
        updatedAt
      };
      await this.#db.mutationOutbox.put(confirmed);
    });
  }

  async markOutboxConflicted(
    idempotencyKey: string,
    lastError: string,
    updatedAt = new Date().toISOString()
  ): Promise<void> {
    await this.updateOutboxStatus(idempotencyKey, 'conflicted', { updatedAt, lastError });
  }

  async markOutboxFailed(
    idempotencyKey: string,
    lastError: string,
    updatedAt = new Date().toISOString()
  ): Promise<void> {
    await this.updateOutboxStatus(idempotencyKey, 'failed', { updatedAt, lastError });
  }

  async scheduleOutboxRetry(input: {
    idempotencyKey: string;
    retryCount: number;
    nextRetryAt: string;
    lastError: string;
    updatedAt?: string;
  }): Promise<void> {
    requireNonEmpty(input.idempotencyKey, 'idempotencyKey');
    requireNonNegativeInteger(input.retryCount, 'retryCount');
    requireIsoDate(input.nextRetryAt, 'nextRetryAt');
    requireNonEmpty(input.lastError, 'lastError');
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    requireIsoDate(updatedAt, 'updatedAt');
    await this.#db.mutationOutbox.update(input.idempotencyKey, {
      status: 'pending',
      retryCount: input.retryCount,
      nextRetryAt: input.nextRetryAt,
      lastError: input.lastError,
      updatedAt
    });
  }

  async recoverStaleOutboxClaims(input: RecoverStaleOutboxClaimsInput): Promise<number> {
    requireIsoDate(input.staleBefore, 'staleBefore');
    requireIsoDate(input.nextRetryAt, 'nextRetryAt');
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    requireIsoDate(updatedAt, 'updatedAt');
    const lastError = input.lastError ?? 'Recovered stale outbox claim';
    requireNonEmpty(lastError, 'lastError');
    const limit = input.limit === undefined ? 50 : requirePositiveInteger(input.limit, 'limit');
    const staleBeforeMs = Date.parse(input.staleBefore);

    return this.transaction('rw', ['mutationOutbox'], async () => {
      const staleEntries = await this.#db.mutationOutbox
        .where('status')
        .equals('syncing')
        .filter((entry) => Date.parse(entry.updatedAt) <= staleBeforeMs)
        .limit(limit)
        .toArray();

      if (staleEntries.length === 0) return 0;

      await this.#db.mutationOutbox.bulkPut(
        staleEntries.map((entry) => ({
          ...entry,
          status: 'pending' as const,
          retryCount: entry.retryCount + 1,
          nextRetryAt: input.nextRetryAt,
          updatedAt,
          lastError
        }))
      );
      return staleEntries.length;
    });
  }

  async countOutboxByStatus(): Promise<OutboxStatusCounts> {
    const [pending, syncing, confirmed, failed, conflicted] = await Promise.all([
      this.#db.mutationOutbox.where('status').equals('pending').count(),
      this.#db.mutationOutbox.where('status').equals('syncing').count(),
      this.#db.mutationOutbox.where('status').equals('confirmed').count(),
      this.#db.mutationOutbox.where('status').equals('failed').count(),
      this.#db.mutationOutbox.where('status').equals('conflicted').count()
    ]);
    return { pending, syncing, confirmed, failed, conflicted };
  }

  async putEventSummary(summary: EventSummaryView): Promise<void> {
    await this.#db.eventSummaries.put(summary);
  }

  async listEventSummaries(limit = 50): Promise<EventSummaryView[]> {
    return this.#db.eventSummaries.orderBy('createdAt').reverse().limit(limit).toArray();
  }

  async putDeviceIdentity(identity: StoredDeviceIdentity): Promise<void> {
    validateDeviceIdentity(identity);
    await this.#db.deviceIdentities.put(identity);
  }

  async getActiveDeviceIdentity(): Promise<StoredDeviceIdentity | undefined> {
    return this.#db.deviceIdentities.where('status').equals('active').first();
  }

  async putLocalProtectionKey(key: StoredLocalProtectionKey): Promise<void> {
    validateLocalProtectionKey(key);
    await this.#db.localProtectionKeys.put(key);
  }

  async getLocalProtectionKey(keyId: string): Promise<StoredLocalProtectionKey | undefined> {
    return this.#db.localProtectionKeys.get(keyId);
  }

  async getSyncCheckpoint(key: SyncCheckpointKey): Promise<StoredSyncCheckpoint | undefined> {
    const normalized = normalizeSyncCheckpointKey(key);
    return this.#db.syncCheckpoints.get(syncCheckpointId(normalized));
  }

  async getIdentityControlProjection(identityId: string): Promise<StoredIdentityControlProjection | undefined> {
    requireNonEmpty(identityId, 'identityId');
    return this.#db.identityControlProjections.get(identityId);
  }

  // -------------------------------------------------------------------
  // Phase 4b — MLS group-control projection persistence
  //
  // `appendMlsGroupControlEvent` is the atomic unit: it persists the
  // signed event to `signedEvents` and runs `projectMlsGroupControlEvent`
  // from `@lfp2p/mls-group-projection`, then stores the resulting state
  // in `mlsGroupProjections`. Idempotent on `eventId`: re-appending an
  // already-persisted event returns the current projection without
  // re-applying. The projection reducer is fail-closed: a `rejected`
  // outcome is persisted as-is (the event still lands in `signedEvents`)
  // so auditors can inspect the full chain.
  // -------------------------------------------------------------------

  async getMlsGroupProjection(groupId: string): Promise<MlsGroupProjectionState | undefined> {
    requireNonEmpty(groupId, 'groupId');
    return this.#db.mlsGroupProjections.get(groupId);
  }

  async appendMlsGroupControlEvent(
    event: SignedEventEnvelope,
    options: AppendMlsGroupControlEventOptions = {}
  ): Promise<AppendMlsGroupControlEventResult> {
    validateSignedEvent(event);
    const updatedAt = options.updatedAt ?? new Date().toISOString();
    requireIsoDate(updatedAt, 'updatedAt');
    return this.transaction(
      'rw',
      ['signedEvents', 'mlsGroupProjections'],
      async () => {
        const existing = await this.#db.signedEvents.get(event.eventId);
        if (existing !== undefined) {
          const payload = event.payload as Record<string, unknown> | null | undefined;
          const groupId = typeof payload?.groupId === 'string' ? payload.groupId : '';
          const currentState = groupId
            ? await this.#db.mlsGroupProjections.get(groupId)
            : undefined;
          const controlId = typeof payload?.controlId === 'string' ? payload.controlId : event.eventId;
          let outcome: 'accepted' | 'rejected' | 'fork-queued' = 'accepted';
          if (currentState) {
            if (currentState.rejectedControls.some((r) => r.controlId === controlId)) {
              outcome = 'rejected';
            } else if (currentState.forkCandidates.some((c) => c.controlId === controlId)) {
              outcome = 'fork-queued';
            }
          }
          const fallback = groupId
            ? createEmptyMlsGroupProjectionState(groupId, updatedAt)
            : createEmptyMlsGroupProjectionState('unknown', updatedAt);
          return {
            status: 'skipped',
            outcome,
            state: currentState ?? fallback
          } satisfies AppendMlsGroupControlEventResult;
        }

        const payload = event.payload as Record<string, unknown> | null | undefined;
        const groupId = typeof payload?.groupId === 'string' ? payload.groupId : '';
        const currentState = groupId
          ? await this.#db.mlsGroupProjections.get(groupId)
          : undefined;

        const result = projectMlsGroupControlEvent({
          state: currentState,
          event,
          localDeviceId: options.localDeviceId,
          allowAutomatedForkRecovery: options.allowAutomatedForkRecovery
        });

        await this.#db.signedEvents.put(storedSignedEvent(event));
        await this.#db.mlsGroupProjections.put(result.state);
        return {
          status: 'stored',
          outcome: result.outcome,
          state: result.state
        } satisfies AppendMlsGroupControlEventResult;
      }
    );
  }

  // -------------------------------------------------------------------
  // Local identity-event append + replay (Phase 2.2)
  //
  // The inbound sync path in `@lfp2p/sync-client` already persists
  // identity events that arrive from the bridge via
  // `putSignedEventWithSyncCheckpoint`. These helpers are the
  // *locally-emitted* counterpart: when the PWA itself produces a
  // signed identity event (e.g. `identity.contact-card.published`
  // when the user exports a contact card), it goes through
  // `appendLocalIdentityEvent` so the projection updates atomically
  // with the persisted signed event.
  //
  // `loadIdentityControlState` is the rebuild-from-log helper.
  // Persisted projections are a snapshot for fast load; the source
  // of truth is the signed-event log. A reopen replays the log into
  // a fresh `IdentityControlState` (the protocol's frozen shape),
  // which `seedIdentityControlProjection` does for us.
  // -------------------------------------------------------------------

  /**
   * Locally-emitted identity-event append: atomically persists the
   * signed event and updates the cached projection. Caller supplies
   * a `projectionUpdate` callback that knows how to apply the event
   * (the identity package owns the protocol-level apply logic; the
   * store is identity-agnostic to avoid a circular package
   * dependency).
   *
   * Idempotent on `eventId`: a re-append of the same event returns
   * the persisted projection without re-applying. Re-applying a
   * Class B/C event a second time would either silent-no-op
   * (revoke-already-revoked) or throw (lifecycle transition); the
   * store-level idempotency makes the behaviour stable at this
   * boundary.
   */
  async appendLocalIdentityEvent(
    event: SignedEventEnvelope,
    projectionUpdate: IdentityControlProjectionUpdate,
    options: Readonly<{ updatedAt?: string }> = {}
  ): Promise<StoredIdentityControlProjection> {
    validateSignedEvent(event);
    const updatedAt = options.updatedAt ?? new Date().toISOString();
    requireIsoDate(updatedAt, 'updatedAt');
    return this.transaction(
      'rw',
      ['signedEvents', 'identityControlProjections'],
      async () => {
        const existing = await this.#db.signedEvents.get(event.eventId);
        const projection =
          await this.#db.identityControlProjections.get(event.author);
        if (existing !== undefined) {
          if (projection === undefined) {
            throw new Error(
              `appendLocalIdentityEvent: signedEvent ${event.eventId} present but projection for ${event.author} is missing`
            );
          }
          return projection;
        }
        const nextProjection = await projectionUpdate(
          projection,
          event,
          updatedAt
        );
        validateIdentityControlProjection(nextProjection);
        if (nextProjection.identityId !== event.author) {
          throw new Error(
            'identity control projection identityId must match event.author'
          );
        }
        await this.#db.signedEvents.put(storedSignedEvent(event));
        await this.#db.identityControlProjections.put(nextProjection);
        return nextProjection;
      }
    );
  }

  /**
   * List every locally-stored identity event for `identityId` in
   * stable order (by `createdAt`, then `eventId`). Intended for
   * replay-based projection rebuilds — the caller passes the result
   * to `seedIdentityControlProjection` from `@lfp2p/identity`.
   *
   * This avoids a circular dependency: the store does not depend on
   * `@lfp2p/identity`.
   */
  async listLocalIdentityEvents(
    identityId: string
  ): Promise<SignedEventEnvelope[]> {
    requireNonEmpty(identityId, 'identityId');
    const rows = await this.#db.signedEvents
      .where('author')
      .equals(identityId)
      .sortBy('createdAt');
    return rows
      .filter((row) => row.kind.startsWith('identity.'))
      .map((row) => row.event);
  }

  async getContactProfile(identityId: string): Promise<StoredContactProfile | undefined> {
    requireNonEmpty(identityId, 'identityId');
    return this.#db.contactProfiles.get(identityId);
  }

  async listContactProfiles(limit = 100): Promise<StoredContactProfile[]> {
    requirePositiveInteger(limit, 'limit');
    return this.#db.contactProfiles.orderBy('updatedAt').reverse().limit(limit).toArray();
  }

  async putContactProfile(input: PutContactProfileInput): Promise<StoredContactProfile> {
    const prepared = validatePutContactProfileInput(input);
    return this.transaction('rw', ['contactProfiles'], async () => {
      const existing = await this.#db.contactProfiles.get(prepared.identityId);
      if (prepared.petnameCanonical !== undefined) {
        const conflicting = await this.#db.contactProfiles.where('petnameCanonical').equals(prepared.petnameCanonical).first();
        if (conflicting !== undefined && conflicting.identityId !== prepared.identityId) {
          throw new Error(`petname already assigned to ${conflicting.identityId}`);
        }
      }

      const createdAt = existing?.createdAt ?? prepared.updatedAt;
      const next: StoredContactProfile = {
        identityId: prepared.identityId,
        ...(prepared.petname === undefined ? {} : { petname: prepared.petname }),
        ...(prepared.petnameCanonical === undefined ? {} : { petnameCanonical: prepared.petnameCanonical }),
        ...(prepared.displayName === undefined ? {} : { displayName: prepared.displayName }),
        ...(prepared.avatarUrl === undefined ? {} : { avatarUrl: prepared.avatarUrl }),
        ...(prepared.websiteUrl === undefined ? {} : { websiteUrl: prepared.websiteUrl }),
        ...(prepared.note === undefined ? {} : { note: prepared.note }),
        ...(prepared.primaryDeviceId === undefined ? {} : { primaryDeviceId: prepared.primaryDeviceId }),
        ...(prepared.controllerPublicKey === undefined ? {} : { controllerPublicKey: prepared.controllerPublicKey }),
        ...(prepared.shortFingerprint === undefined ? {} : { shortFingerprint: prepared.shortFingerprint }),
        verificationStatus: prepared.verificationStatus,
        createdAt,
        updatedAt: prepared.updatedAt
      };

      validateStoredContactProfile(next);
      await this.#db.contactProfiles.put(next);
      return next;
    });
  }

  // -------------------------------------------------------------------
  // Trust & Safety event-log persistence (Phase 1.70)
  //
  // The stored rows are an append-only log per-kind. The frozen
  // projection state is rebuilt deterministically by replaying the rows
  // in `sequence` order. Replay is pure (no IO), uses the validated
  // protocol shapes from `@lfp2p/trust-safety`, and is idempotent on
  // `eventId` (a re-append of the same event is a silent no-op).
  //
  // Why event-source rather than persist a snapshot of the state?
  //  - Two devices that sync the same account-local event log MUST end
  //    up with byte-equivalent state. Snapshot serialisation drift
  //    (e.g. property-order differences in Object.freeze) is a real
  //    risk; replay is structurally drift-free.
  //  - Cross-app `safety.preferences.snapshot` round-trips assume an
  //    event log behind them.
  //  - Compaction (when needed) lives in
  //    `@lfp2p/trust-safety/pruneExpiredLocalControlState`, not here.
  // -------------------------------------------------------------------

  async appendTrustSafetyControlEvent(event: LocalControlEvent): Promise<void> {
    // Re-validate at the persistence boundary. Defense-in-depth: even
    // if the caller forgot, we will not store a malformed event.
    const validated = validateLocalControlEvent(event);
    await this.transaction('rw', ['trustSafetyControlEvents'], async () => {
      const existing = await this.#db.trustSafetyControlEvents.get(validated.eventId);
      if (existing !== undefined) return; // idempotent
      const sequence = await this.#db.trustSafetyControlEvents.count();
      const row: StoredTrustSafetyControlEvent = {
        eventId: validated.eventId,
        kind: validated.kind,
        createdAt: validated.createdAt,
        sequence,
        event: validated
      };
      await this.#db.trustSafetyControlEvents.add(row);
    });
  }

  async listTrustSafetyControlEvents(): Promise<StoredTrustSafetyControlEvent[]> {
    return this.#db.trustSafetyControlEvents.orderBy('sequence').toArray();
  }

  async loadLocalControlState(): Promise<LocalControlState> {
    const rows = await this.listTrustSafetyControlEvents();
    let state = createEmptyLocalControlState();
    for (const row of rows) {
      // Validate again on read. If a row was corrupted at rest (e.g.
      // tampering, schema drift on a future downgrade), we will skip
      // it rather than poison the projection.
      let validated: LocalControlEvent;
      try {
        validated = validateLocalControlEvent(row.event);
      } catch {
        continue;
      }
      state = applyLocalControlEvent(state, validated);
    }
    return state;
  }

  async appendTrustSafetyLabelerEvent(event: LabelerEvent): Promise<void> {
    const validated = validateLabelerEvent(event);
    await this.transaction('rw', ['trustSafetyLabelerEvents'], async () => {
      const existing = await this.#db.trustSafetyLabelerEvents.get(validated.eventId);
      if (existing !== undefined) return;
      const sequence = await this.#db.trustSafetyLabelerEvents.count();
      const row: StoredTrustSafetyLabelerEvent = {
        eventId: validated.eventId,
        kind: validated.kind,
        createdAt: validated.createdAt,
        sequence,
        event: validated
      };
      await this.#db.trustSafetyLabelerEvents.add(row);
    });
  }

  async listTrustSafetyLabelerEvents(): Promise<StoredTrustSafetyLabelerEvent[]> {
    return this.#db.trustSafetyLabelerEvents.orderBy('sequence').toArray();
  }

  async loadLabelersState(): Promise<LabelersState> {
    const rows = await this.listTrustSafetyLabelerEvents();
    let state = createEmptyLabelersState();
    for (const row of rows) {
      let validated: LabelerEvent;
      try {
        validated = validateLabelerEvent(row.event);
      } catch {
        continue;
      }
      try {
        state = applyLabelerEvent(state, validated);
      } catch {
        // Lifecycle-transition errors (e.g. an unsubscribed-then-
        // unsubscribed pair) should never poison the rebuild. Skip
        // the offending event; the rest of the log replays cleanly.
        continue;
      }
    }
    return state;
  }

  // -------------------------------------------------------------------
  // Phase 1.8.7 — Reputation event persistence (append-only log).
  //
  // Mirrors the local-control + labeler patterns above. The
  // validator runs at BOTH append time AND list-time so a corrupt
  // row at rest (schema drift on a downgrade, hostile direct DB
  // mutation) is skipped rather than poisoning consumers. Idempotent
  // on `eventId` so retries are silent no-ops.
  //
  // The Phase 1.8.1 validator enforces bounded enums + range checks
  // at the persistence boundary; we get defense-in-depth without
  // duplicating any validation logic here.
  // -------------------------------------------------------------------

  async appendTrustSafetyReputationEvent(
    event: ReputationEvent
  ): Promise<AppendTrustSafetyReputationEventResult> {
    const validated = validateReputationEvent(event);
    return this.transaction('rw', ['trustSafetyReputationEvents'], async () => {
      const existing = await this.#db.trustSafetyReputationEvents.get(validated.eventId);
      if (existing !== undefined) {
        // Phase 1.8.14 — surface idempotency to callers so the
        // sync-client routing can distinguish "applied" from
        // "duplicate" without double-counting. Existing callers that
        // ignore the return value continue to work unchanged.
        return { status: 'skipped' };
      }
      const sequence = await this.#db.trustSafetyReputationEvents.count();
      const row: StoredTrustSafetyReputationEvent = {
        eventId: validated.eventId,
        kind: validated.kind,
        createdAt: validated.createdAt,
        sequence,
        event: validated
      };
      await this.#db.trustSafetyReputationEvents.add(row);
      return { status: 'stored' };
    });
  }

  async listTrustSafetyReputationEvents(): Promise<StoredTrustSafetyReputationEvent[]> {
    return this.#db.trustSafetyReputationEvents.orderBy('sequence').toArray();
  }

  /**
   * Load every persisted reputation event in replay order, dropping
   * corrupt rows silently. Returns only validated events so a caller
   * can feed them straight into the Phase 1.8.2 `computeReputation`
   * pipeline.
   */
  async loadReputationEvents(): Promise<ReputationEvent[]> {
    const rows = await this.listTrustSafetyReputationEvents();
    const out: ReputationEvent[] = [];
    for (const row of rows) {
      try {
        out.push(validateReputationEvent(row.event));
      } catch {
        // Corrupt at rest — skip rather than poisoning the
        // projection. The Phase 1.8.1 validator's exhaustive
        // checks ensure any survivor is well-formed.
        continue;
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------------ */
  /*                         capability proof records                         */
  /* ------------------------------------------------------------------------ */
  //
  // Step 2 of the post-#84 follow-up — proof-registry persistence.
  //
  // The local-store holds a per-device snapshot of every
  // CapabilityProofRecord the local app has registered. Verification
  // state is local-per-device by doctrine
  // (each-device-verifies-independently); registered records are
  // derived from the synced event stream so cross-device consistency
  // comes from event sync, not from replicating this table.
  //
  // UPSERT covers both "register a new proof" and "update an
  // existing proof's verificationState after verifyProof". A direct
  // `delete` is also exposed for cleanup paths that aren't
  // revocation (revocation belongs in capabilities' revokeProof
  // semantics).

  /**
   * Validate AND persist a CapabilityProofRecord. Validation runs
   * through `seedProofRegistry([record])` so the same enum / digest /
   * timestamp guards that protect the in-memory registry also gate
   * this persistence boundary. A malformed record is rejected
   * loudly rather than poisoning the table at rest.
   */
  async putCapabilityProofRecord(record: CapabilityProofRecord): Promise<void> {
    // `validateStoredProofRecord` validates the record AND
    // deep-freezes it, so the row written to Dexie is shielded
    // from caller-side mutation after this call returns. Direct
    // single-record validation avoids the throwaway 1-element
    // registry/map allocations the `seedProofRegistry([record])`
    // path used to do. Gemini review on PR #95.
    const validated = validateStoredProofRecord(record);
    await this.#db.capabilityProofRecords.put(validated);
  }

  async getCapabilityProofRecord(
    proofId: string
  ): Promise<CapabilityProofRecord | undefined> {
    requireNonEmpty(proofId, 'proofId');
    return this.#db.capabilityProofRecords.get(proofId);
  }

  async listCapabilityProofRecords(): Promise<CapabilityProofRecord[]> {
    return this.#db.capabilityProofRecords.orderBy('proofId').toArray();
  }

  async deleteCapabilityProofRecord(proofId: string): Promise<void> {
    requireNonEmpty(proofId, 'proofId');
    await this.#db.capabilityProofRecords.delete(proofId);
  }

  /**
   * Hydrate every persisted record into an in-memory ProofRegistry,
   * skipping corrupt rows silently. The returned registry is the
   * same shape `@lfp2p/capabilities` produces, so it can be used
   * with `summarizeProofStates`, `verifyProof`, the trust-safety
   * cap-adapter, or composed with the verifier suite without any
   * further translation.
   *
   * Corrupt-row resilience mirrors `loadReputationEvents`: rather
   * than throwing on the first bad row, we try one-record-at-a-time
   * and drop the offenders. The `seedProofRegistry` validator's
   * exhaustive checks ensure any survivor is well-formed.
   */
  async loadProofRegistry(): Promise<ProofRegistry> {
    const rows = await this.listCapabilityProofRecords();
    const survivors: CapabilityProofRecord[] = [];
    for (const row of rows) {
      try {
        // Validate each row directly rather than building a
        // throwaway 1-element registry per row. Gemini review on
        // PR #95.
        survivors.push(validateStoredProofRecord(row));
      } catch {
        // Corrupt at rest — drop. We deliberately do NOT log
        // (Phase 3.1 privacy-safe logging discipline) and we
        // deliberately do NOT throw (one bad row must not poison
        // the whole hydrated registry — the reliance gate already
        // fails closed on missing proofs).
        continue;
      }
    }
    // `seedProofRegistry` re-validates inputs, which catches a
    // duplicate-proofId scenario (different rows for the same
    // proofId — would signal a real storage-layer bug). The
    // per-row validation above already gated each field; the
    // duplicate check is the only remaining invariant left for
    // the registry-level pass.
    return seedProofRegistry(survivors);
  }

  async advanceSyncCheckpoint(input: AdvanceSyncCheckpointInput): Promise<StoredSyncCheckpoint> {
    const next = validateAdvanceSyncCheckpointInput(input);
    return this.transaction('rw', ['syncCheckpoints'], async () => {
      const existing = await this.#db.syncCheckpoints.get(next.checkpointId);
      const decision = checkpointAdvanceDecision(existing, next, input.allowRewind === true);
      if (decision === 'skip' && existing) return existing;
      await this.#db.syncCheckpoints.put(next);
      return next;
    });
  }

  async putSignedEventWithSyncCheckpoint(
    input: PutSignedEventWithSyncCheckpointInput
  ): Promise<PutSignedEventWithSyncCheckpointResult> {
    const next = validateAdvanceSyncCheckpointInput(input.checkpoint);
    const tables: LocalFirstTableName[] = ['signedEvents', 'syncCheckpoints'];
    if (input.identityControlProjectionUpdate !== undefined) {
      tables.push('identityControlProjections');
    }
    return this.transaction('rw', tables, async () => {
      const existing = await this.#db.syncCheckpoints.get(next.checkpointId);
      const decision = checkpointAdvanceDecision(existing, next, input.checkpoint.allowRewind === true);
      if (decision === 'skip' && existing) return { status: 'skipped', checkpoint: existing };

      validateSignedEvent(input.event);
      if (input.identityControlProjectionUpdate !== undefined) {
        const currentProjection = await this.#db.identityControlProjections.get(input.event.author);
        const nextProjection = await input.identityControlProjectionUpdate(currentProjection, input.event, next.updatedAt);
        validateIdentityControlProjection(nextProjection);
        if (nextProjection.identityId !== input.event.author) {
          throw new Error('identity control projection identityId must match event.author');
        }
        await this.#db.identityControlProjections.put(nextProjection);
      }
      await this.#db.signedEvents.put(storedSignedEvent(input.event));
      await this.#db.syncCheckpoints.put(next);
      return { status: 'stored', checkpoint: next };
    });
  }

  async transaction<T>(
    mode: 'r' | 'rw',
    tables: readonly LocalFirstTableName[],
    callback: () => Promise<T>
  ): Promise<T> {
    const resolvedTables = tables.map((table) => this.#resolveTable(table));
    return this.#db.transaction(mode, resolvedTables, callback);
  }

  async close(): Promise<void> {
    this.#db.close();
  }

  async delete(): Promise<void> {
    if (typeof globalThis.indexedDB === 'undefined') {
      this.#db.close();
      return;
    }
    try {
      await this.#db.delete();
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('deleteDatabase')) {
        this.#db.close();
        return;
      }
      throw error;
    }
  }

  async updateOutboxStatus(idempotencyKey: string, status: OutboxStatus, patch: OutboxStatusPatch): Promise<void> {
    requireNonEmpty(idempotencyKey, 'idempotencyKey');
    if (patch.updatedAt !== undefined) requireIsoDate(patch.updatedAt, 'updatedAt');
    if (patch.lastError !== undefined) requireNonEmpty(patch.lastError, 'lastError');
    await this.#db.mutationOutbox.update(idempotencyKey, { status, ...patch });
  }

  #resolveTable(table: LocalFirstTableName): Table {
    switch (table) {
      case 'signedEvents':
        return this.#db.signedEvents;
      case 'mutationOutbox':
        return this.#db.mutationOutbox;
      case 'eventSummaries':
        return this.#db.eventSummaries;
      case 'deviceIdentities':
        return this.#db.deviceIdentities;
      case 'localProtectionKeys':
        return this.#db.localProtectionKeys;
      case 'syncCheckpoints':
        return this.#db.syncCheckpoints;
      case 'identityControlProjections':
        return this.#db.identityControlProjections;
      case 'contactProfiles':
        return this.#db.contactProfiles;
      case 'trustSafetyControlEvents':
        return this.#db.trustSafetyControlEvents;
      case 'trustSafetyLabelerEvents':
        return this.#db.trustSafetyLabelerEvents;
      case 'trustSafetyReputationEvents':
        return this.#db.trustSafetyReputationEvents;
      case 'capabilityProofRecords':
        return this.#db.capabilityProofRecords;
      case 'mlsGroupProjections':
        return this.#db.mlsGroupProjections;
    }
  }
}

export function createLocalFirstStore(databaseName?: string): DexieLocalFirstStore {
  return new DexieLocalFirstStore(databaseName);
}

function storedSignedEvent(event: SignedEventEnvelope): StoredSignedEvent {
  return {
    eventId: event.eventId,
    kind: event.kind,
    author: event.author,
    createdAt: event.createdAt,
    event
  };
}

function checkpointAdvanceDecision(
  existing: StoredSyncCheckpoint | undefined,
  next: StoredSyncCheckpoint,
  allowRewind: boolean
): CheckpointAdvanceDecision {
  if (!existing) return 'advance';
  if (next.sequence < existing.sequence && !allowRewind) {
    throw new SyncCheckpointRejectedError('stale-sequence', 'Sync checkpoint cannot move backwards without allowRewind');
  }
  if (next.sequence === existing.sequence) {
    if (next.cursor === existing.cursor) return 'skip';
    if (!allowRewind) {
      throw new SyncCheckpointRejectedError('cursor-mismatch', 'Sync checkpoint cursor mismatch at same sequence');
    }
  }
  return 'advance';
}

function validateOutboxEntry(entry: MutationOutboxEntry): void {
  requireNonEmpty(entry.idempotencyKey, 'idempotencyKey');
  requireNonEmpty(entry.eventId, 'eventId');
  requireNonEmpty(entry.target, 'target');
  requireNonNegativeInteger(entry.retryCount, 'retryCount');
  requireIsoDate(entry.nextRetryAt, 'nextRetryAt');
  requireIsoDate(entry.createdAt, 'createdAt');
  requireIsoDate(entry.updatedAt, 'updatedAt');
  if (entry.lastError !== undefined) requireNonEmpty(entry.lastError, 'lastError');
}

function validateDeviceIdentity(identity: StoredDeviceIdentity): void {
  if (identity.recordType !== 'local-device-identity.v1') {
    throw new Error('Unsupported device identity record type');
  }
  if (identity.identityId.trim().length === 0) throw new Error('identityId is required');
  if (identity.deviceId.trim().length === 0) throw new Error('deviceId is required');
  if (identity.publicKey.trim().length === 0) throw new Error('publicKey is required');
  if (identity.protectionKeyId.trim().length === 0) throw new Error('protectionKeyId is required');
}

function validateLocalProtectionKey(key: StoredLocalProtectionKey): void {
  if (key.algorithm !== 'aes-gcm-256') throw new Error('Unsupported protection key algorithm');
  if (key.keyId.trim().length === 0) throw new Error('keyId is required');
}

function validateAdvanceSyncCheckpointInput(input: AdvanceSyncCheckpointInput): StoredSyncCheckpoint {
  const key = normalizeSyncCheckpointKey(input);
  requireNonEmpty(input.cursor, 'cursor');
  requireNonNegativeInteger(input.sequence, 'sequence');
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  requireIsoDate(updatedAt, 'updatedAt');
  return {
    checkpointId: syncCheckpointId(key),
    ...key,
    cursor: input.cursor,
    sequence: input.sequence,
    updatedAt
  };
}

function validateIdentityControlProjection(projection: StoredIdentityControlProjection): void {
  requireNonEmpty(projection.identityId, 'identityId');
  requireNonNegativeInteger(projection.epoch, 'epoch');
  if (projection.controllerPublicKey !== undefined) {
    requireNonEmpty(projection.controllerPublicKey, 'controllerPublicKey');
  }
  if (projection.lastEventId !== undefined) {
    requireNonEmpty(projection.lastEventId, 'lastEventId');
  }
  requireIsoDate(projection.updatedAt, 'updatedAt');
}

function validateStoredContactProfile(profile: StoredContactProfile): void {
  requireNonEmpty(profile.identityId, 'identityId');
  if (profile.petname !== undefined) {
    requireLengthBetween(profile.petname, 'petname', 1, 64);
  }
  if (profile.petnameCanonical !== undefined) {
    requireLengthBetween(profile.petnameCanonical, 'petnameCanonical', 1, 64);
  }
  if (profile.displayName !== undefined) {
    requireLengthBetween(profile.displayName, 'displayName', 1, 96);
  }
  if (profile.avatarUrl !== undefined) {
    validateAvatarUrl(profile.avatarUrl);
  }
  if (profile.websiteUrl !== undefined) {
    validateExternalUrl(profile.websiteUrl, 'websiteUrl');
  }
  if (profile.note !== undefined) {
    requireLengthBetween(profile.note, 'note', 1, 280);
  }
  if (profile.primaryDeviceId !== undefined) {
    requireNonEmpty(profile.primaryDeviceId, 'primaryDeviceId');
  }
  if (profile.controllerPublicKey !== undefined) {
    requireNonEmpty(profile.controllerPublicKey, 'controllerPublicKey');
  }
  if (profile.shortFingerprint !== undefined) {
    requireLengthBetween(profile.shortFingerprint, 'shortFingerprint', 8, 64);
  }
  requireIdentityVerificationStatus(profile.verificationStatus, 'verificationStatus');
  requireIsoDate(profile.createdAt, 'createdAt');
  requireIsoDate(profile.updatedAt, 'updatedAt');
}

function validatePutContactProfileInput(input: PutContactProfileInput): Readonly<{
  identityId: string;
  petname?: string;
  petnameCanonical?: string;
  displayName?: string;
  avatarUrl?: string;
  websiteUrl?: string;
  note?: string;
  primaryDeviceId?: string;
  controllerPublicKey?: string;
  shortFingerprint?: string;
  verificationStatus: IdentityVerificationStatus;
  updatedAt: string;
}> {
  const identityId = requireNonEmpty(input.identityId, 'identityId');
  const petname = normalizeOptionalText(input.petname, 'petname', 64);
  const petnameCanonical = petname === undefined ? undefined : normalizePetnameCanonical(petname);
  const displayName = normalizeOptionalText(input.displayName, 'displayName', 96);
  const avatarUrl = normalizeOptionalAvatarUrl(input.avatarUrl);
  const websiteUrl = normalizeOptionalExternalUrl(input.websiteUrl, 'websiteUrl');
  const note = normalizeOptionalText(input.note, 'note', 280);
  const primaryDeviceId = normalizeOptionalText(input.primaryDeviceId, 'primaryDeviceId', 128);
  const controllerPublicKey = normalizeOptionalText(input.controllerPublicKey, 'controllerPublicKey', 2048);
  const shortFingerprint = normalizeOptionalText(input.shortFingerprint, 'shortFingerprint', 64);
  const verificationStatus = requireIdentityVerificationStatus(input.verificationStatus ?? 'unknown', 'verificationStatus');
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  requireIsoDate(updatedAt, 'updatedAt');
  return {
    identityId,
    ...(petname === undefined ? {} : { petname }),
    ...(petnameCanonical === undefined ? {} : { petnameCanonical }),
    ...(displayName === undefined ? {} : { displayName }),
    ...(avatarUrl === undefined ? {} : { avatarUrl }),
    ...(websiteUrl === undefined ? {} : { websiteUrl }),
    ...(note === undefined ? {} : { note }),
    ...(primaryDeviceId === undefined ? {} : { primaryDeviceId }),
    ...(controllerPublicKey === undefined ? {} : { controllerPublicKey }),
    ...(shortFingerprint === undefined ? {} : { shortFingerprint }),
    verificationStatus,
    updatedAt
  };
}

function normalizeOptionalText(value: string | undefined, label: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  requireLengthBetween(normalized, label, 1, maxLength);
  return normalized;
}

function normalizePetnameCanonical(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeOptionalAvatarUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  validateAvatarUrl(normalized);
  return normalized;
}

function normalizeOptionalExternalUrl(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  validateExternalUrl(normalized, label);
  return normalized;
}

function validateAvatarUrl(value: string): void {
  validateExternalUrl(value, 'avatarUrl');
}

function validateExternalUrl(value: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${label} must use http or https`);
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new Error(`${label} must not include credentials`);
  }
}

function requireLengthBetween(value: string, label: string, min: number, max: number): string {
  if (value.length < min || value.length > max) {
    throw new Error(`${label} length must be between ${min} and ${max}`);
  }
  return value;
}

function requireIdentityVerificationStatus(value: string, label: string): IdentityVerificationStatus {
  switch (value) {
    case 'unknown':
    case 'controller-known':
    case 'revoked-device-seen':
    case 'mismatch-detected':
      return value;
    default:
      throw new Error(`${label} is invalid`);
  }
}

function normalizeSyncCheckpointKey(key: SyncCheckpointKey): SyncCheckpointKey {
  return {
    sourceId: requireNonEmpty(key.sourceId, 'sourceId'),
    streamId: requireNonEmpty(key.streamId, 'streamId'),
    scope: requireNonEmpty(key.scope, 'scope')
  };
}

function syncCheckpointId(key: SyncCheckpointKey): string {
  return JSON.stringify([key.sourceId, key.streamId, key.scope]);
}

function requireNonEmpty(value: string, label: string): string {
  if (value.trim().length === 0) throw new Error(`${label} is required`);
  return value;
}

function requireIsoDate(value: string, label: string): string {
  requireNonEmpty(value, label);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO date string`);
  return value;
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be positive`);
  return value;
}

function requireNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be non-negative`);
  return value;
}
