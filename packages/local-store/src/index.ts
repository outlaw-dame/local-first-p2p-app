import Dexie, { type Table } from 'dexie';
import { type EncryptedKeyMaterial } from '@lfp2p/crypto';
import { type SignedEventEnvelope, validateSignedEvent } from '@lfp2p/protocol';

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
  | 'contactProfiles';

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

export type StoredIdentityControlProjection = Readonly<{
  identityId: string;
  controllerPublicKey?: string;
  epoch: number;
  devices: Readonly<Record<string, StoredIdentityControlDevice>>;
  capabilities: Readonly<Record<string, StoredIdentityControlCapability>>;
  lastEventId?: string;
  updatedAt: string;
}>;

export type StoredContactProfile = Readonly<{
  identityId: string;
  petname?: string;
  petnameCanonical?: string;
  displayName?: string;
  avatarUrl?: string;
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

function validateAvatarUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('avatarUrl must be a valid URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('avatarUrl must use http or https');
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new Error('avatarUrl must not include credentials');
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
