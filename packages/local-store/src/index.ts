import Dexie, { type Table } from 'dexie';
import { type EncryptedKeyMaterial, type SigningKeypair, signEventEnvelope } from '@lfp2p/crypto';
import {
  type JsonValue,
  type SignedEventEnvelope,
  createUnsignedEvent,
  validateSignedEvent
} from '@lfp2p/protocol';
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
import {
  type ApplyUdrEventMeta,
  type UdrState,
  type UdrStateSnapshot,
  applyUdrEvent,
  createEmptyUdrState,
  deserializeUdrState,
  isUdrEventKind,
  serializeUdrState
} from '@lfp2p/udr-projection';
import {
  type ApplyMailboxEventMeta,
  type InboxEntry,
  type MailboxCheckpoint,
  type MailboxEventKind,
  type OutboxEntry,
  applyMailboxEvent,
  hydrateMailboxState,
  isMailboxEventKind
} from '@lfp2p/mailbox-projection';
import {
  type PrivatePayloadAadContext,
  buildPrivatePayloadAad,
  decryptPrivatePayload,
  encryptPrivatePayload
} from '@lfp2p/private-payload';

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
  | 'mlsGroupProjections'
  | 'chatThreads'
  | 'chatEventLog'
  | 'userDataRoot'
  | 'mailboxInbox'
  | 'mailboxOutbox'
  | 'mailboxEventLog'
  | 'mailboxCheckpoints';

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

/**
 * Phase 5 — chat message row as stored in plaintext form before being
 * sealed into `StoredChatThreadProjection.encryptedState`. Plain-object
 * mirror of `ChatMessageRecord` (which uses ReadonlyMap/Set internally) —
 * structured clone requires plain types, and AES-GCM requires a
 * serializable plaintext to encrypt.
 */
export type StoredChatMessageRecord = Readonly<{
  messageId: string;
  authorDeviceId: string;
  plaintextBody: string;
  sentAt: string;
  editedAt?: string;
  deletedAt?: string;
  deleted: boolean;
  replyToMessageId?: string;
}>;

/**
 * Phase 5 — plaintext shape of a projected chat thread, serialized and
 * sealed into `StoredChatThreadProjection.encryptedState` before it ever
 * reaches IndexedDB. Plain-object mirror of `ChatThreadState` — Map →
 * Record, Set → string[].
 */
export type StoredChatThreadProjectionPlaintext = Readonly<{
  threadId: string;
  participants: ReadonlyArray<string>;
  threadName?: string;
  messages: Readonly<Record<string, StoredChatMessageRecord>>;
  acceptedBy: ReadonlyArray<string>;
  createdAt: string;
  appliedEventIds: ReadonlyArray<string>;
}>;

/**
 * Phase 5 — projected chat thread state as stored in IndexedDB.
 * Message bodies, participants, and acceptance state are plaintext chat
 * content — they are sealed into `encryptedState` (an AES-GCM blob, same
 * `EncryptedKeyMaterial` shape used by `StoredDeviceIdentity.encryptedPrivateKey`)
 * rather than written to IndexedDB unencrypted. Only `threadId` (the primary
 * key) and `lastActivityAt` (needed for feed-ordering queries) stay in the
 * clear. Callers decrypt `encryptedState` and parse it as
 * `StoredChatThreadProjectionPlaintext` to read message content; local-store
 * itself never performs the encrypt/decrypt — that is the calling layer's
 * responsibility, mirroring the device-identity pattern.
 */
export type StoredChatThreadProjection = Readonly<{
  threadId: string;
  lastActivityAt: string;
  encryptedState: EncryptedKeyMaterial;
  protectionKeyId: string;
}>;

/**
 * Phase 5 — raw ciphertext chat event as stored in the local event log.
 * The full `SignedEventEnvelope` is preserved so the projection can be
 * rebuilt by decrypting and replaying. The bridge transports these as opaque
 * Class D records; decryption happens only on the local device.
 * `threadIdHash` is a blinded (`sha256Base64Url`) index of the thread id —
 * it lets rebuilds look up a thread's events directly instead of scanning
 * the entire log by `kind`, without writing the real threadId in the clear.
 * This row never reaches the bridge (chatEventLog is local-only IndexedDB),
 * so the hash isn't a confidentiality requirement — it's purely to keep
 * thread rebuild O(matching rows) instead of O(N).
 */
export type StoredChatEventLogRow = Readonly<{
  eventId: string;
  kind: string;
  threadIdHash?: string;
  createdAt: string;
  event: SignedEventEnvelope;
}>;

export type AppendMlsGroupControlEventOptions = Readonly<{
  localDeviceId?: string | undefined;
  allowAutomatedForkRecovery?: boolean | undefined;
  updatedAt?: string;
}>;

/**
 * Phase 5.11 — persisted User Data Root projection row (Step 1).
 *
 * This is exactly a `UdrStateSnapshot` (from `@lfp2p/udr-projection`)
 * keyed by `identityId`. It is a DERIVED, rebuildable cache: the
 * authoritative source is the encrypted `udr.*` event log in
 * `signedEvents`. `appliedEventIds` is persisted so incremental
 * `appendUdrEvent` is idempotent AND self-healing — an event that could
 * not be decrypted yet (key not present) is stored durably but left out
 * of `appliedEventIds`, so a later append/load with the key projects it.
 *
 * Structural ids only (partition/feed/sync-interest/space, mailbox
 * binding). The row is plaintext local IndexedDB (device-owned
 * metadata); message-grade content is never stored here. The plan's
 * reserved `contentRefs` field is deferred until a `udr.content.*`
 * event kind exists to populate it — added with that kind, not now.
 */
export type StoredUserDataRoot = UdrStateSnapshot;

export type AppendUdrEventOptions = Readonly<{
  /** Symmetric key material for the `self`-scoped private payload envelope. */
  keyMaterial: string;
  /**
   * When set, `event.author` MUST equal this identity or the append is
   * rejected. Lets a caller pin the local identity and refuse events
   * routed for a different identity (defence-in-depth alongside the
   * decrypt-to-self gate).
   */
  expectedIdentityId?: string;
}>;

export type AppendUdrEventResult = Readonly<{
  /**
   * - `applied`: decrypted, validated, folded into the projection.
   * - `skipped`: already projected (eventId in `appliedEventIds`).
   * - `undecryptable`: could not decrypt (e.g. key not present yet); the
   *   signed event is stored durably and will project on a later
   *   append/load once the key is available (self-healing).
   * - `rejected`: decrypted but the inner payload is invalid; not stored,
   *   projection unchanged.
   */
  status: 'applied' | 'skipped' | 'undecryptable' | 'rejected';
  state: UdrState;
}>;

export type AppendMlsGroupControlEventResult = Readonly<{
  status: 'stored' | 'skipped';
  outcome: 'accepted' | 'rejected' | 'fork-queued';
  state: MlsGroupProjectionState;
}>;

/* -------------------------------------------------------------------------- */
/*                    Phase 5.11 — mailbox persistence (Step 4)               */
/* -------------------------------------------------------------------------- */

/**
 * Per-envelope inbox row (recipient view). Index columns
 * (`recipientIdentityId`, `status`, `expiresAt`) are stored in the clear
 * so the store can query by owner / status and sweep expired envelopes
 * (Step 5) without deserializing every row; the projected `entry` holds
 * the full lifecycle detail. This is a DERIVED, rebuildable cache — the
 * authoritative source is the encrypted `mailboxEventLog`, so a corrupt
 * or tampered row is corrected by `loadMailboxInboxState` (full replay).
 * Mailboxes are high-cardinality, so per-envelope rows (not a single
 * aggregate blob) keep each append O(1) and bound row growth.
 */
export type StoredMailboxInboxRow = Readonly<{
  envelopeId: string;
  recipientIdentityId: string;
  status: string;
  expiresAt: string;
  entry: InboxEntry;
}>;

export type StoredMailboxOutboxRow = Readonly<{
  envelopeId: string;
  senderIdentityId: string;
  status: string;
  expiresAt: string;
  entry: OutboxEntry;
}>;

/** Durable, dedup-authoritative log of mailbox events (source of truth). */
export type StoredMailboxEventLogRow = Readonly<{
  eventId: string;
  kind: string;
  /** envelopeId for envelope/receipt/ack kinds; mailboxId for checkpoint. */
  envelopeId: string;
  createdAt: string;
  /**
   * Whether the event was successfully decrypted AND folded into the
   * projection. `false` for an event stored while undecryptable — the
   * dedup gate skips only PROJECTED events, so an undecryptable event
   * re-processes (self-heals) once its key is available.
   */
  projected: boolean;
  event: SignedEventEnvelope;
}>;

export type StoredMailboxCheckpoint = MailboxCheckpoint;

export type AppendMailboxEventOptions = Readonly<{
  /** The local mailbox owner (recipient and/or sender). Projection key. */
  ownerIdentityId: string;
  /**
   * Symmetric key material for this event's private-payload envelope. The
   * caller resolves the right key for the event's scope (dm/group/self);
   * a wrong/absent key yields `undecryptable` (self-healing).
   */
  keyMaterial: string;
}>;

export type AppendMailboxEventResult = Readonly<{
  /**
   * - `applied`: decrypted, validated, folded into the inbox/outbox rows.
   * - `skipped`: already in the mailbox event log (idempotent).
   * - `undecryptable`: could not decrypt yet; the signed event is stored
   *   durably and projects on a later append/`loadMailboxInboxState`.
   * - `rejected`: decrypted but invalid, or the owner is not a party to
   *   the envelope (recipient-mismatch) — not stored, no projection change.
   */
  status: 'applied' | 'skipped' | 'undecryptable' | 'rejected';
}>;

/**
 * Conversation key for one envelope's `mailbox.envelope.expired` emit.
 * The protocol pins expired events to `dm`/`group` privacy (delivery-
 * plane, visible to both parties), so the sweep cannot use the owner's
 * self key — the caller resolves the right conversation key and scope.
 */
export type MailboxEnvelopeKeyResolution = Readonly<{
  keyMaterial: string;
  /** Key id recorded on the envelope (references the key, not the key). */
  keyId: string;
  privacy: 'dm' | 'group';
}>;

export type SweepExpiredMailboxEnvelopesOptions = Readonly<{
  /** The local mailbox owner whose inbox/outbox rows are swept. */
  ownerIdentityId: string;
  /** Authorised device id doing the signing; event `deviceId`. */
  deviceId: string;
  /** Signing keypair for the emitted `mailbox.envelope.expired` events. */
  signingKeypair: SigningKeypair;
  /**
   * Per-envelope conversation-key resolver (mirrors the
   * `loadMailboxInboxState` resolver). Return `undefined` to skip the
   * envelope this sweep — it is reported in `skipped` and retried on
   * the next sweep once the key is available.
   */
  resolveEnvelopeKey: (
    row: StoredMailboxInboxRow | StoredMailboxOutboxRow
  ) => MailboxEnvelopeKeyResolution | undefined;
  /** Sweep instant (ISO-8601); defaults to `new Date().toISOString()`. */
  now?: string;
}>;

export type SweepExpiredMailboxEnvelopesResult = Readonly<{
  /** envelopeIds marked expired by this sweep, in emit order. */
  expired: readonly string[];
  /** envelopeIds past expiry but not swept (no key resolved); retried next sweep. */
  skipped: readonly string[];
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
  chatThreads!: Table<StoredChatThreadProjection, string>;
  chatEventLog!: Table<StoredChatEventLogRow, string>;
  userDataRoot!: Table<StoredUserDataRoot, string>;
  mailboxInbox!: Table<StoredMailboxInboxRow, string>;
  mailboxOutbox!: Table<StoredMailboxOutboxRow, string>;
  mailboxEventLog!: Table<StoredMailboxEventLogRow, string>;
  mailboxCheckpoints!: Table<StoredMailboxCheckpoint, string>;

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
      mutationOutbox:
        'idempotencyKey, eventId, status, nextRetryAt, createdAt, [status+nextRetryAt]',
      eventSummaries: 'eventId, createdAt',
      deviceIdentities: 'identityId, deviceId, publicKey, status, createdAt',
      localProtectionKeys: 'keyId, algorithm, createdAt'
    });
    this.version(4).stores({
      signedEvents: 'eventId, kind, author, createdAt',
      mutationOutbox:
        'idempotencyKey, eventId, status, nextRetryAt, createdAt, [status+nextRetryAt]',
      eventSummaries: 'eventId, createdAt',
      deviceIdentities: 'identityId, deviceId, publicKey, status, createdAt',
      localProtectionKeys: 'keyId, algorithm, createdAt',
      syncCheckpoints: 'checkpointId'
    });
    this.version(5).stores({
      signedEvents: 'eventId, kind, author, createdAt',
      mutationOutbox:
        'idempotencyKey, eventId, status, nextRetryAt, createdAt, [status+nextRetryAt]',
      eventSummaries: 'eventId, createdAt',
      deviceIdentities: 'identityId, deviceId, publicKey, status, createdAt',
      localProtectionKeys: 'keyId, algorithm, createdAt',
      syncCheckpoints: 'checkpointId',
      identityControlProjections: 'identityId, updatedAt'
    });
    this.version(6).stores({
      signedEvents: 'eventId, kind, author, createdAt',
      mutationOutbox:
        'idempotencyKey, eventId, status, nextRetryAt, createdAt, [status+nextRetryAt]',
      eventSummaries: 'eventId, createdAt',
      deviceIdentities: 'identityId, deviceId, publicKey, status, createdAt',
      localProtectionKeys: 'keyId, algorithm, createdAt',
      syncCheckpoints: 'checkpointId',
      identityControlProjections: 'identityId, updatedAt',
      contactProfiles: 'identityId, petnameCanonical, updatedAt'
    });
    this.version(7).stores({
      signedEvents: 'eventId, kind, author, createdAt',
      mutationOutbox:
        'idempotencyKey, eventId, status, nextRetryAt, createdAt, [status+nextRetryAt]',
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
      mutationOutbox:
        'idempotencyKey, eventId, status, nextRetryAt, createdAt, [status+nextRetryAt]',
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
      mutationOutbox:
        'idempotencyKey, eventId, status, nextRetryAt, createdAt, [status+nextRetryAt]',
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
      mutationOutbox:
        'idempotencyKey, eventId, status, nextRetryAt, createdAt, [status+nextRetryAt]',
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
    // Phase 5 — encrypted chat thread projection cache and raw ciphertext
    // event log. Schema bump is additive: existing v10 rows roll forward.
    // chatThreads: threadId PK + lastActivityAt index for feed ordering;
    // message content lives in the encrypted `encryptedState` blob, never
    // in a plaintext column.
    // chatEventLog: eventId PK + kind/threadIdHash/createdAt — threadIdHash
    // is a blinded index so rebuilds can look up a thread's events directly
    // instead of scanning the whole log by kind.
    this.version(11).stores({
      signedEvents: 'eventId, kind, author, createdAt',
      mutationOutbox:
        'idempotencyKey, eventId, status, nextRetryAt, createdAt, [status+nextRetryAt]',
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
      mlsGroupProjections: 'groupId, updatedAt',
      chatThreads: 'threadId, lastActivityAt',
      chatEventLog: 'eventId, kind, threadIdHash, createdAt'
    });
    // Phase 5.11 — User Data Root projection cache. Additive over v11:
    // existing rows roll forward untouched. `userDataRoot` is keyed by
    // identityId; the projected id-sets live in the row (no separate
    // index needed — one row per identity). The authoritative source is
    // the encrypted `udr.*` event log in `signedEvents`.
    this.version(12).stores({
      signedEvents: 'eventId, kind, author, createdAt',
      mutationOutbox:
        'idempotencyKey, eventId, status, nextRetryAt, createdAt, [status+nextRetryAt]',
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
      mlsGroupProjections: 'groupId, updatedAt',
      chatThreads: 'threadId, lastActivityAt',
      chatEventLog: 'eventId, kind, threadIdHash, createdAt',
      userDataRoot: 'identityId, updatedAt'
    });
    // Phase 5.11 — mailbox delivery projection. Additive over v12:
    // existing rows roll forward untouched. Per-envelope inbox/outbox
    // rows (not an aggregate blob) keep each append O(1) and let the
    // expiry sweep query by `expiresAt`. The `mailboxEventLog` is the
    // durable, dedup-authoritative source; inbox/outbox are a derived,
    // rebuildable cache.
    this.version(13).stores({
      signedEvents: 'eventId, kind, author, createdAt',
      mutationOutbox:
        'idempotencyKey, eventId, status, nextRetryAt, createdAt, [status+nextRetryAt]',
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
      mlsGroupProjections: 'groupId, updatedAt',
      chatThreads: 'threadId, lastActivityAt',
      chatEventLog: 'eventId, kind, threadIdHash, createdAt',
      userDataRoot: 'identityId, updatedAt',
      mailboxInbox: 'envelopeId, recipientIdentityId, status, expiresAt',
      mailboxOutbox: 'envelopeId, senderIdentityId, status, expiresAt',
      mailboxEventLog: 'eventId, kind, envelopeId, createdAt',
      mailboxCheckpoints: 'mailboxId'
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

  async claimOutboxEntry(
    idempotencyKey: string,
    updatedAt = new Date().toISOString()
  ): Promise<MutationOutboxEntry | undefined> {
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

  async markOutboxConfirmed(
    idempotencyKey: string,
    updatedAt = new Date().toISOString()
  ): Promise<void> {
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

  async getIdentityControlProjection(
    identityId: string
  ): Promise<StoredIdentityControlProjection | undefined> {
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
    return this.transaction('rw', ['signedEvents', 'mlsGroupProjections'], async () => {
      const existing = await this.#db.signedEvents.get(event.eventId);
      if (existing !== undefined) {
        const payload = event.payload as Record<string, unknown> | null | undefined;
        const groupId = typeof payload?.groupId === 'string' ? payload.groupId : '';
        const currentState = groupId ? await this.#db.mlsGroupProjections.get(groupId) : undefined;
        const controlId =
          typeof payload?.controlId === 'string' ? payload.controlId : event.eventId;
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
      const currentState = groupId ? await this.#db.mlsGroupProjections.get(groupId) : undefined;

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
    });
  }

  /**
   * Phase 4c — dispatch-path projection update. Runs `projectMlsGroupControlEvent`
   * against the current stored state and writes the result back to
   * `mlsGroupProjections`. Does NOT write to `signedEvents` — this is the
   * inbound-sync counterpart to `appendMlsGroupControlEvent`: the event is
   * already persisted by `putSignedEventWithSyncCheckpoint`; this method
   * applies the secondary projection update, like `appendTrustSafetyReputationEvent`
   * does for reputation events.
   *
   * Callers (sync-client) are responsible for calling this only on freshly
   * stored events (`putSignedEventWithSyncCheckpoint` returned `'stored'`).
   */
  async updateMlsGroupProjection(
    event: SignedEventEnvelope,
    options: AppendMlsGroupControlEventOptions = {}
  ): Promise<AppendMlsGroupControlEventResult> {
    validateSignedEvent(event);
    const updatedAt = options.updatedAt ?? new Date().toISOString();
    requireIsoDate(updatedAt, 'updatedAt');
    const payload = event.payload as Record<string, unknown> | null | undefined;
    const groupId = typeof payload?.groupId === 'string' ? payload.groupId.trim() : '';
    if (groupId.length === 0) {
      throw new Error('updateMlsGroupProjection: event payload missing or empty groupId');
    }
    return this.transaction('rw', ['mlsGroupProjections'], async () => {
      const currentState = await this.#db.mlsGroupProjections.get(groupId);
      // Idempotency guard: if the controlId is already tracked in the
      // projection (accepted / rejected / fork-queued), skip re-applying.
      // Without this, a bridge re-delivery at a higher checkpoint sequence
      // would run the reducer again and could append duplicate fork candidates.
      const controlId = typeof payload?.controlId === 'string' ? payload.controlId : '';
      if (controlId.length > 0 && currentState !== undefined) {
        const alreadyAccepted = currentState.acceptedControlIds.includes(controlId);
        const alreadyRejected = currentState.rejectedControls.some(
          (r) => r.controlId === controlId
        );
        const alreadyQueued = currentState.forkCandidates.some((c) => c.controlId === controlId);
        if (alreadyAccepted || alreadyRejected || alreadyQueued) {
          let outcome: 'accepted' | 'rejected' | 'fork-queued' = 'accepted';
          if (alreadyRejected) outcome = 'rejected';
          else if (alreadyQueued) outcome = 'fork-queued';
          return {
            status: 'skipped',
            outcome,
            state: currentState
          } satisfies AppendMlsGroupControlEventResult;
        }
      }
      const result = projectMlsGroupControlEvent({
        state: currentState,
        event,
        localDeviceId: options.localDeviceId,
        allowAutomatedForkRecovery: options.allowAutomatedForkRecovery
      });
      await this.#db.mlsGroupProjections.put(result.state);
      return {
        status: 'stored',
        outcome: result.outcome,
        state: result.state
      } satisfies AppendMlsGroupControlEventResult;
    });
  }

  // -------------------------------------------------------------------
  // User Data Root persistence (Phase 5.11 Step 4)
  //
  // Delivery-path note: `udr.*` events are `self`-scoped. By Phase 1.64
  // doctrine (`self`/`device-local` never traverse a bridge/relay/
  // super-peer), UDR events are NOT bridge-admissible — so there is
  // deliberately no `processInboundSyncBatch` routing for them yet.
  // Their cross-device transport is the encrypted mailbox / account-
  // local sync envelope (a separate deferred phase). Until then the
  // live path is: local device emits a `udr.*` event → `appendUdrEvent`
  // → projection. Do NOT "fix" this by adding `self` to the bridge
  // allow-list; that would silently widen infrastructure scope and
  // violate the admission doctrine.
  // -------------------------------------------------------------------

  async getUserDataRoot(identityId: string): Promise<StoredUserDataRoot | undefined> {
    requireNonEmpty(identityId, 'identityId');
    return this.#db.userDataRoot.get(identityId);
  }

  /**
   * Decrypt-and-apply one `self`-scoped `udr.*` event into the identity's
   * UDR projection. Idempotent on `eventId` (via the projection's
   * `appliedEventIds`). Self-healing: an event whose payload cannot be
   * decrypted yet (e.g. the content key is not present) is stored
   * durably but left unprojected, so a later `appendUdrEvent` /
   * `loadUdrState` with the key folds it in. A decrypted-but-invalid
   * payload is rejected and NOT stored (permanent garbage).
   *
   * The decrypt-to-self gate is the projection-authorization boundary:
   * only events the local key can decrypt advance the projection, so a
   * forged event for another identity cannot corrupt state. (Authoritative
   * envelope-layer signature verification remains a repo-wide deferred
   * guard.)
   */
  async appendUdrEvent(
    event: SignedEventEnvelope,
    options: AppendUdrEventOptions
  ): Promise<AppendUdrEventResult> {
    validateSignedEvent(event);
    if (!isUdrEventKind(event.kind)) {
      throw new Error(`appendUdrEvent: ${event.kind} is not a udr.* event kind`);
    }
    requireNonEmpty(options.keyMaterial, 'keyMaterial');
    const identityId = event.author;
    requireNonEmpty(identityId, 'event.author');
    if (options.expectedIdentityId !== undefined && options.expectedIdentityId !== identityId) {
      throw new Error('appendUdrEvent: event.author does not match expectedIdentityId');
    }

    // Decrypt BEFORE opening a Dexie transaction: awaiting WebCrypto
    // inside a transaction commits it prematurely. `applyUdrEvent`
    // itself is synchronous and runs inside the transaction below.
    const decrypted = await decryptUdrPayload(event, options.keyMaterial);

    return this.transaction('rw', ['signedEvents', 'userDataRoot'], async () => {
      const storedRow = await this.#db.userDataRoot.get(identityId);
      const currentState = storedRow
        ? deserializeUdrState(storedRow)
        : createEmptyUdrState(identityId);
      // Idempotency re-checked inside the transaction against the
      // current row, so concurrent appends of the same event converge.
      if (currentState.appliedEventIds.has(event.eventId)) {
        return { status: 'skipped', state: currentState } satisfies AppendUdrEventResult;
      }
      if (decrypted === undefined) {
        // Undecryptable (e.g. key not present yet): store durably for
        // self-healing, leave the projection row untouched.
        await this.#db.signedEvents.put(storedSignedEvent(event));
        return { status: 'undecryptable', state: currentState } satisfies AppendUdrEventResult;
      }
      let nextState: UdrState;
      try {
        nextState = applyUdrEvent(currentState, decrypted, udrApplyMeta(event));
      } catch {
        // Decrypted but structurally invalid — do not persist, do not
        // project (permanent garbage must not pollute the durable log).
        return { status: 'rejected', state: currentState } satisfies AppendUdrEventResult;
      }
      await this.#db.signedEvents.put(storedSignedEvent(event));
      await this.#db.userDataRoot.put(serializeUdrState(nextState));
      return { status: 'applied', state: nextState } satisfies AppendUdrEventResult;
    });
  }

  /**
   * Every locally-stored `udr.*` event for `identityId`, filtered to
   * events actually authored by that identity, in stable replay order
   * (`createdAt`, then `eventId`).
   */
  async listLocalUdrEvents(identityId: string): Promise<SignedEventEnvelope[]> {
    requireNonEmpty(identityId, 'identityId');
    const rows = await this.#db.signedEvents.where('author').equals(identityId).toArray();
    const events = rows.filter((row) => isUdrEventKind(row.kind)).map((row) => row.event);
    events.sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
      if (a.eventId === b.eventId) return 0;
      return a.eventId < b.eventId ? -1 : 1;
    });
    return events;
  }

  /**
   * Rebuild the UDR projection for `identityId` from its encrypted event
   * log (the authoritative source) and persist the refreshed row. This
   * is the recovery / self-healing path: events that were previously
   * undecryptable are folded in once `keyMaterial` can decrypt them.
   * Undecryptable / invalid events are skipped rather than aborting the
   * rebuild.
   */
  async loadUdrState(identityId: string, keyMaterial: string): Promise<UdrState> {
    requireNonEmpty(identityId, 'identityId');
    requireNonEmpty(keyMaterial, 'keyMaterial');
    const events = await this.listLocalUdrEvents(identityId);
    // Decrypt + fold the whole log in memory (all async crypto happens
    // OUTSIDE any Dexie transaction), then persist the rebuilt row in a
    // single short write transaction. Undecryptable / invalid events are
    // skipped so one bad record cannot abort the rebuild.
    let state = createEmptyUdrState(identityId);
    for (const event of events) {
      const decrypted = await decryptUdrPayload(event, keyMaterial);
      if (decrypted === undefined) continue;
      try {
        state = applyUdrEvent(state, decrypted, udrApplyMeta(event));
      } catch {
        // Structurally invalid decrypted payload — skip.
      }
    }
    await this.transaction('rw', ['userDataRoot'], async () => {
      await this.#db.userDataRoot.put(serializeUdrState(state));
    });
    return state;
  }

  // -------------------------------------------------------------------
  // Mailbox delivery persistence (Phase 5.11 Step 4)
  //
  // Delivery-path note: mailbox `dm`/`group` events DO traverse the
  // bridge (unlike `self`-scoped UDR), so a future
  // `processInboundSyncBatch` route can feed inbound events here — but
  // that route needs per-event decrypt-key resolution at the sync layer,
  // which does not exist yet. It is therefore deliberately deferred (not
  // dead-coded). The live path is: local emit / caller-supplied event →
  // `appendMailboxEvent`. `mailbox.checkpoint.advanced` is also routed
  // here for the sync cursor.
  //
  // Storage model: per-envelope inbox/outbox rows (mailboxes are
  // high-cardinality, so an aggregate blob would grow unbounded and cost
  // O(n) per append). `mailboxEventLog` is the durable, dedup-
  // authoritative source of truth; the inbox/outbox rows are a derived
  // cache rebuilt by `loadMailboxInboxState`.
  // -------------------------------------------------------------------

  async getMailboxInbox(identityId: string): Promise<StoredMailboxInboxRow[]> {
    requireNonEmpty(identityId, 'identityId');
    return this.#db.mailboxInbox.where('recipientIdentityId').equals(identityId).toArray();
  }

  async getMailboxOutbox(identityId: string): Promise<StoredMailboxOutboxRow[]> {
    requireNonEmpty(identityId, 'identityId');
    return this.#db.mailboxOutbox.where('senderIdentityId').equals(identityId).toArray();
  }

  async getMailboxCheckpoint(mailboxId: string): Promise<StoredMailboxCheckpoint | undefined> {
    requireNonEmpty(mailboxId, 'mailboxId');
    return this.#db.mailboxCheckpoints.get(mailboxId);
  }

  /**
   * Decrypt-and-apply one mailbox event into the per-envelope projection
   * for `options.ownerIdentityId`. Idempotent on `eventId` via the
   * mailbox event log. Self-healing: an event whose payload cannot be
   * decrypted yet is stored durably but unprojected, and folds in on a
   * later `appendMailboxEvent` / `loadMailboxInboxState` with the key. A
   * decrypted-but-invalid payload, or one whose owner is not a party to
   * the envelope (recipient-mismatch), is rejected and NOT stored.
   *
   * The decrypt-to-party gate is the projection-authorization boundary
   * (mirrors the UDR decrypt-to-self gate): only events the owner can
   * decrypt AND is a party to advance the projection.
   */
  async appendMailboxEvent(
    event: SignedEventEnvelope,
    options: AppendMailboxEventOptions
  ): Promise<AppendMailboxEventResult> {
    validateSignedEvent(event);
    if (!isMailboxEventKind(event.kind)) {
      throw new Error(`appendMailboxEvent: ${event.kind} is not a mailbox.* event kind`);
    }
    requireNonEmpty(options.ownerIdentityId, 'ownerIdentityId');
    requireNonEmpty(options.keyMaterial, 'keyMaterial');

    // Decrypt BEFORE the Dexie transaction (awaiting WebCrypto inside a
    // transaction commits it prematurely). The projection apply is
    // synchronous and runs inside the transaction below.
    const decrypted = await decryptMailboxPayload(event, options.keyMaterial);
    const owner = options.ownerIdentityId;

    return this.transaction(
      'rw',
      ['mailboxEventLog', 'mailboxInbox', 'mailboxOutbox', 'mailboxCheckpoints'],
      async () => {
        // Idempotency: skip only if the event was already PROJECTED. An
        // event stored while undecryptable (projected=false) re-processes
        // so it can self-heal once its key is available.
        const logged = await this.#db.mailboxEventLog.get(event.eventId);
        if (logged?.projected === true) {
          return { status: 'skipped' } satisfies AppendMailboxEventResult;
        }
        if (decrypted === undefined) {
          // Undecryptable: store durably for self-healing; no projection.
          await this.#db.mailboxEventLog.put(mailboxEventLogRow(event, undefined, false));
          return { status: 'undecryptable' } satisfies AppendMailboxEventResult;
        }

        const targetId = mailboxTargetId(event.kind, decrypted);
        if (targetId === undefined) {
          // Payload lacks the id field the kind requires — invalid.
          return { status: 'rejected' } satisfies AppendMailboxEventResult;
        }

        // Seed a minimal state with just this envelope's current entries
        // (each envelope's lifecycle is independent), apply, extract.
        const existingInbox = await this.#db.mailboxInbox.get(targetId);
        const existingOutbox = await this.#db.mailboxOutbox.get(targetId);
        const existingCheckpoint =
          event.kind === 'mailbox.checkpoint.advanced'
            ? await this.#db.mailboxCheckpoints.get(targetId)
            : undefined;

        const seeded = hydrateMailboxState({
          identityId: owner,
          inbox: existingInbox ? [[targetId, existingInbox.entry]] : [],
          outbox: existingOutbox ? [[targetId, existingOutbox.entry]] : [],
          checkpoints: existingCheckpoint ? [[targetId, existingCheckpoint]] : []
        });

        let next;
        try {
          next = applyMailboxEvent(seeded, decrypted, mailboxApplyMeta(event));
        } catch {
          // Invalid payload OR recipient-mismatch (owner not a party):
          // do not persist, do not project. Privacy-safe: no detail.
          return { status: 'rejected' } satisfies AppendMailboxEventResult;
        }

        // Upsert the affected rows from the projection result.
        const inboxEntry = next.inbox.get(targetId);
        if (inboxEntry !== undefined) {
          await this.#db.mailboxInbox.put(inboxRow(targetId, inboxEntry));
        }
        const outboxEntry = next.outbox.get(targetId);
        if (outboxEntry !== undefined) {
          await this.#db.mailboxOutbox.put(outboxRow(targetId, outboxEntry));
        }
        const checkpoint = next.checkpoints.get(targetId);
        if (checkpoint !== undefined) {
          await this.#db.mailboxCheckpoints.put(checkpoint);
        }
        await this.#db.mailboxEventLog.put(mailboxEventLogRow(event, targetId, true));
        return { status: 'applied' } satisfies AppendMailboxEventResult;
      }
    );
  }

  /** Every locally-stored mailbox event, in stable replay order. */
  async listLocalMailboxEvents(): Promise<SignedEventEnvelope[]> {
    const rows = await this.#db.mailboxEventLog.toArray();
    rows.sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
      if (a.eventId === b.eventId) return 0;
      return a.eventId < b.eventId ? -1 : 1;
    });
    return rows.map((r) => r.event);
  }

  /**
   * Rebuild `identityId`'s mailbox projection from the durable event log
   * (authoritative source) and reconcile the derived inbox/outbox/
   * checkpoint rows. Recovery / self-healing path: previously
   * undecryptable events fold in once `resolveKeyMaterial` can decrypt
   * them. `resolveKeyMaterial(event)` returns the per-event key (or
   * `undefined` to skip). Events for a different identity
   * (recipient-mismatch) or with invalid payloads are skipped.
   */
  async loadMailboxInboxState(
    identityId: string,
    resolveKeyMaterial: (event: SignedEventEnvelope) => string | undefined
  ): Promise<StoredMailboxInboxRow[]> {
    requireNonEmpty(identityId, 'identityId');
    const events = await this.listLocalMailboxEvents();
    // Decrypt + fold the whole log in memory (all async crypto OUTSIDE a
    // transaction), then reconcile rows in a single write transaction.
    let state = hydrateMailboxState({ identityId });
    for (const event of events) {
      const keyMaterial = resolveKeyMaterial(event);
      if (keyMaterial === undefined || keyMaterial.length === 0) continue;
      const decrypted = await decryptMailboxPayload(event, keyMaterial);
      if (decrypted === undefined) continue;
      try {
        state = applyMailboxEvent(state, decrypted, mailboxApplyMeta(event));
      } catch {
        // recipient-mismatch (other identity) or invalid payload — skip.
      }
    }
    const rebuilt = state;
    await this.transaction(
      'rw',
      ['mailboxInbox', 'mailboxOutbox', 'mailboxCheckpoints'],
      async () => {
        for (const [envelopeId, entry] of rebuilt.inbox) {
          await this.#db.mailboxInbox.put(inboxRow(envelopeId, entry));
        }
        for (const [envelopeId, entry] of rebuilt.outbox) {
          await this.#db.mailboxOutbox.put(outboxRow(envelopeId, entry));
        }
        for (const [, checkpoint] of rebuilt.checkpoints) {
          await this.#db.mailboxCheckpoints.put(checkpoint);
        }
      }
    );
    return [...rebuilt.inbox.entries()].map(([envelopeId, entry]) => inboxRow(envelopeId, entry));
  }

  /**
   * Phase 5.11 Step 5 — TTL expiry sweep. Marks every owner envelope
   * whose `expiresAt` has passed (status still `queued`/`delivered`)
   * expired by EMITTING a signed `mailbox.envelope.expired` event
   * (reason `ttl`) through `appendMailboxEvent`, so the durable event
   * log stays the source of truth and a replay reproduces the expired
   * state. Rows are never deleted — expiry destroys availability at
   * the mailbox actor, not local history. `fetched` envelopes are left
   * alone: the content was already retrieved, and the state machine is
   * `queued/delivered → expired`.
   *
   * Idempotent: a repeat sweep finds no non-expired rows past
   * `expiresAt` and emits nothing. Concurrent sweeps on two devices
   * emit distinct events; the projection no-ops the second. Intended
   * callers: PWA foreground resume and sync batch completion.
   */
  async sweepExpiredMailboxEnvelopes(
    options: SweepExpiredMailboxEnvelopesOptions
  ): Promise<SweepExpiredMailboxEnvelopesResult> {
    requireNonEmpty(options.ownerIdentityId, 'ownerIdentityId');
    requireNonEmpty(options.deviceId, 'deviceId');
    const owner = options.ownerIdentityId;
    // Canonicalise `now` to UTC so the lexicographic index range query is
    // sound: stored `expiresAt` values are canonicalised by the mailbox
    // projection, and comparing them against a caller-supplied `now` that
    // carried a non-UTC offset would otherwise mis-order the boundary.
    const now = canonicalizeIsoTimestamp(options.now, 'now') ?? new Date().toISOString();

    // `expiresAt <= now` counts as expired (the TTL instant itself is
    // past availability). ISO-8601 strings order lexicographically, so
    // the cleartext index column answers this without decrypting rows.
    const sweepable = (status: string) => status === 'queued' || status === 'delivered';
    const inboxRows = await this.#db.mailboxInbox
      .where('expiresAt')
      .belowOrEqual(now)
      .filter((row) => row.recipientIdentityId === owner && sweepable(row.status))
      .toArray();
    const outboxRows = await this.#db.mailboxOutbox
      .where('expiresAt')
      .belowOrEqual(now)
      .filter((row) => row.senderIdentityId === owner && sweepable(row.status))
      .toArray();

    // One event per envelope even when the owner is both sender and
    // recipient — a single expired event updates both rows.
    const candidates = new Map<string, StoredMailboxInboxRow | StoredMailboxOutboxRow>();
    for (const row of [...inboxRows, ...outboxRows]) {
      if (!candidates.has(row.envelopeId)) candidates.set(row.envelopeId, row);
    }

    const expired: string[] = [];
    const skipped: string[] = [];
    for (const envelopeId of [...candidates.keys()].sort()) {
      const row = candidates.get(envelopeId);
      if (row === undefined) continue;
      const key = options.resolveEnvelopeKey(row);
      if (key === undefined || key.keyMaterial.length === 0 || key.keyId.length === 0) {
        skipped.push(envelopeId);
        continue;
      }
      // Encrypt + sign OUTSIDE any transaction (WebCrypto await);
      // `appendMailboxEvent` owns its own transaction.
      const event = await buildExpiredMailboxEvent(envelopeId, now, options, key);
      const result = await this.appendMailboxEvent(event, {
        ownerIdentityId: owner,
        keyMaterial: key.keyMaterial
      });
      if (result.status === 'applied') {
        expired.push(envelopeId);
      } else {
        // Defensive — we encrypt and decrypt with the same key, so a
        // non-applied result should not occur; report it for retry.
        skipped.push(envelopeId);
      }
    }
    return { expired, skipped };
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
    return this.transaction('rw', ['signedEvents', 'identityControlProjections'], async () => {
      const existing = await this.#db.signedEvents.get(event.eventId);
      const projection = await this.#db.identityControlProjections.get(event.author);
      if (existing !== undefined) {
        if (projection === undefined) {
          throw new Error(
            `appendLocalIdentityEvent: signedEvent ${event.eventId} present but projection for ${event.author} is missing`
          );
        }
        return projection;
      }
      const nextProjection = await projectionUpdate(projection, event, updatedAt);
      validateIdentityControlProjection(nextProjection);
      if (nextProjection.identityId !== event.author) {
        throw new Error('identity control projection identityId must match event.author');
      }
      await this.#db.signedEvents.put(storedSignedEvent(event));
      await this.#db.identityControlProjections.put(nextProjection);
      return nextProjection;
    });
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
  async listLocalIdentityEvents(identityId: string): Promise<SignedEventEnvelope[]> {
    requireNonEmpty(identityId, 'identityId');
    const rows = await this.#db.signedEvents.where('author').equals(identityId).sortBy('createdAt');
    return rows.filter((row) => row.kind.startsWith('identity.')).map((row) => row.event);
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
        const conflicting = await this.#db.contactProfiles
          .where('petnameCanonical')
          .equals(prepared.petnameCanonical)
          .first();
        if (conflicting !== undefined && conflicting.identityId !== prepared.identityId) {
          throw new Error(`petname already assigned to ${conflicting.identityId}`);
        }
      }

      const createdAt = existing?.createdAt ?? prepared.updatedAt;
      const next: StoredContactProfile = {
        identityId: prepared.identityId,
        ...(prepared.petname === undefined ? {} : { petname: prepared.petname }),
        ...(prepared.petnameCanonical === undefined
          ? {}
          : { petnameCanonical: prepared.petnameCanonical }),
        ...(prepared.displayName === undefined ? {} : { displayName: prepared.displayName }),
        ...(prepared.avatarUrl === undefined ? {} : { avatarUrl: prepared.avatarUrl }),
        ...(prepared.websiteUrl === undefined ? {} : { websiteUrl: prepared.websiteUrl }),
        ...(prepared.note === undefined ? {} : { note: prepared.note }),
        ...(prepared.primaryDeviceId === undefined
          ? {}
          : { primaryDeviceId: prepared.primaryDeviceId }),
        ...(prepared.controllerPublicKey === undefined
          ? {}
          : { controllerPublicKey: prepared.controllerPublicKey }),
        ...(prepared.shortFingerprint === undefined
          ? {}
          : { shortFingerprint: prepared.shortFingerprint }),
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

  async getCapabilityProofRecord(proofId: string): Promise<CapabilityProofRecord | undefined> {
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
      const decision = checkpointAdvanceDecision(
        existing,
        next,
        input.checkpoint.allowRewind === true
      );
      if (decision === 'skip' && existing) return { status: 'skipped', checkpoint: existing };

      validateSignedEvent(input.event);
      if (input.identityControlProjectionUpdate !== undefined) {
        const currentProjection = await this.#db.identityControlProjections.get(input.event.author);
        const nextProjection = await input.identityControlProjectionUpdate(
          currentProjection,
          input.event,
          next.updatedAt
        );
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

  async updateOutboxStatus(
    idempotencyKey: string,
    status: OutboxStatus,
    patch: OutboxStatusPatch
  ): Promise<void> {
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
      case 'chatThreads':
        return this.#db.chatThreads;
      case 'chatEventLog':
        return this.#db.chatEventLog;
      case 'userDataRoot':
        return this.#db.userDataRoot;
      case 'mailboxInbox':
        return this.#db.mailboxInbox;
      case 'mailboxOutbox':
        return this.#db.mailboxOutbox;
      case 'mailboxEventLog':
        return this.#db.mailboxEventLog;
      case 'mailboxCheckpoints':
        return this.#db.mailboxCheckpoints;
    }
  }
}

export function createLocalFirstStore(databaseName?: string): DexieLocalFirstStore {
  return new DexieLocalFirstStore(databaseName);
}

/**
 * Build the AAD context that binds the private-payload ciphertext to
 * this exact event envelope. Must match the fields the encrypt side
 * used, or decryption fails closed. `udr.*` events are `self`-scoped.
 */
function buildUdrAadContext(event: SignedEventEnvelope): PrivatePayloadAadContext {
  return {
    eventId: event.eventId,
    kind: event.kind,
    author: event.author,
    deviceId: event.deviceId,
    createdAt: event.createdAt,
    privacy: event.privacy as PrivatePayloadAadContext['privacy'],
    schemaVersion: event.schemaVersion,
    ...(event.lamport !== undefined ? { lamport: event.lamport } : {}),
    ...(event.refs !== undefined ? { refs: event.refs } : {})
  };
}

/**
 * Decrypt a `self`-scoped `udr.*` envelope to plaintext. This is the
 * only async (WebCrypto) step and MUST run OUTSIDE any Dexie
 * transaction — awaiting a non-Dexie promise inside a transaction
 * auto-commits it prematurely. The subsequent read-modify-write folds
 * the plaintext in with the synchronous, pure `applyUdrEvent` INSIDE a
 * transaction. Returns `undefined` on decrypt failure (privacy-safe: no
 * error detail surfaced); the caller treats that as `undecryptable`.
 */
async function decryptUdrPayload(
  event: SignedEventEnvelope,
  keyMaterial: string
): Promise<JsonValue | undefined> {
  try {
    return await decryptPrivatePayload({
      envelope: event.payload as unknown as Parameters<typeof decryptPrivatePayload>[0]['envelope'],
      context: buildUdrAadContext(event),
      keyMaterial
    });
  } catch {
    return undefined;
  }
}

/** Build the projection meta for a udr event (pure). */
function udrApplyMeta(event: SignedEventEnvelope): ApplyUdrEventMeta {
  return {
    kind: event.kind as ApplyUdrEventMeta['kind'],
    eventId: event.eventId,
    createdAt: event.createdAt
  };
}

// --- Phase 5.11 mailbox helpers (mirror the UDR decrypt seam) ---

/**
 * Decrypt a mailbox event's private-payload envelope to plaintext. Only
 * async (WebCrypto) step; MUST run OUTSIDE any Dexie transaction.
 * Returns `undefined` on decrypt failure (privacy-safe — no detail),
 * which the caller treats as `undecryptable`.
 */
async function decryptMailboxPayload(
  event: SignedEventEnvelope,
  keyMaterial: string
): Promise<JsonValue | undefined> {
  try {
    return await decryptPrivatePayload({
      envelope: event.payload as unknown as Parameters<typeof decryptPrivatePayload>[0]['envelope'],
      context: buildMailboxAadContext(event),
      keyMaterial
    });
  } catch {
    return undefined;
  }
}

function buildMailboxAadContext(event: SignedEventEnvelope): PrivatePayloadAadContext {
  return {
    eventId: event.eventId,
    kind: event.kind,
    author: event.author,
    deviceId: event.deviceId,
    createdAt: event.createdAt,
    privacy: event.privacy as PrivatePayloadAadContext['privacy'],
    schemaVersion: event.schemaVersion,
    ...(event.lamport !== undefined ? { lamport: event.lamport } : {}),
    ...(event.refs !== undefined ? { refs: event.refs } : {})
  };
}

/**
 * Build the signed `mailbox.envelope.expired` event the sweep emits.
 * The AAD context and `createUnsignedEvent` are built from the SAME
 * fixed field values (`lamport: 0`, `schemaVersion: 1`, no refs) so
 * the AAD recomputed on decrypt matches byte-for-byte, and `createdAt`
 * equals the payload's `expiredAt` (the sweep instant).
 */
async function buildExpiredMailboxEvent(
  envelopeId: string,
  expiredAt: string,
  options: SweepExpiredMailboxEnvelopesOptions,
  key: MailboxEnvelopeKeyResolution
): Promise<SignedEventEnvelope> {
  const rand = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const eventId = `evt_mbx_${rand}`;
  const lamport = 0;
  const schemaVersion = 1;
  const context: PrivatePayloadAadContext = {
    eventId,
    kind: 'mailbox.envelope.expired',
    author: options.ownerIdentityId,
    deviceId: options.deviceId,
    createdAt: expiredAt,
    privacy: key.privacy,
    schemaVersion,
    lamport
  };
  // Validate the AAD context up front (also guards field shapes).
  buildPrivatePayloadAad(context);
  const envelope = await encryptPrivatePayload({
    plaintext: { envelopeId, expiredAt, reason: 'ttl' },
    context,
    keyMaterial: key.keyMaterial,
    keyId: key.keyId
  });
  return signEventEnvelope(
    createUnsignedEvent({
      eventId,
      kind: 'mailbox.envelope.expired',
      author: options.ownerIdentityId,
      deviceId: options.deviceId,
      createdAt: expiredAt,
      lamport,
      schemaVersion,
      privacy: key.privacy,
      payload: envelope as unknown as JsonValue as SignedEventEnvelope['payload']
    }),
    options.signingKeypair
  );
}

/**
 * Validate and canonicalise an optional ISO-8601 timestamp to UTC.
 * Returns `undefined` when the input is absent (caller falls back to a
 * fresh timestamp). Throws on a present-but-unparseable value so a bad
 * `now` cannot silently corrupt an expiry range query.
 */
function canonicalizeIsoTimestamp(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new Error(`${field} must be a valid ISO-8601 timestamp`);
  }
  return new Date(ms).toISOString();
}

function mailboxApplyMeta(event: SignedEventEnvelope): ApplyMailboxEventMeta {
  return {
    kind: event.kind as MailboxEventKind,
    eventId: event.eventId,
    createdAt: event.createdAt
  };
}

/**
 * The projection key a decrypted mailbox payload targets: `envelopeId`
 * for envelope/receipt/ack kinds, `mailboxId` for checkpoint. Returns
 * `undefined` when the required id field is missing/invalid, so the
 * caller can reject the event without throwing.
 */
function mailboxTargetId(kind: string, payload: JsonValue): string | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, JsonValue>;
  const field = kind === 'mailbox.checkpoint.advanced' ? 'mailboxId' : 'envelopeId';
  const value = record[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function inboxRow(envelopeId: string, entry: InboxEntry): StoredMailboxInboxRow {
  return {
    envelopeId,
    recipientIdentityId: entry.envelope.recipientIdentityId,
    status: entry.status,
    expiresAt: entry.envelope.expiresAt,
    entry
  };
}

function outboxRow(envelopeId: string, entry: OutboxEntry): StoredMailboxOutboxRow {
  return {
    envelopeId,
    senderIdentityId: entry.envelope.senderIdentityId,
    status: entry.status,
    expiresAt: entry.envelope.expiresAt,
    entry
  };
}

function mailboxEventLogRow(
  event: SignedEventEnvelope,
  targetId: string | undefined,
  projected: boolean
): StoredMailboxEventLogRow {
  return {
    eventId: event.eventId,
    kind: event.kind,
    // For an undecryptable event we cannot read the envelopeId; use a
    // placeholder so the row is still keyed/queryable. Replay recovers
    // the true target once the key is available.
    envelopeId: targetId ?? '',
    createdAt: event.createdAt,
    projected,
    event
  };
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
    throw new SyncCheckpointRejectedError(
      'stale-sequence',
      'Sync checkpoint cannot move backwards without allowRewind'
    );
  }
  if (next.sequence === existing.sequence) {
    if (next.cursor === existing.cursor) return 'skip';
    if (!allowRewind) {
      throw new SyncCheckpointRejectedError(
        'cursor-mismatch',
        'Sync checkpoint cursor mismatch at same sequence'
      );
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

function validateAdvanceSyncCheckpointInput(
  input: AdvanceSyncCheckpointInput
): StoredSyncCheckpoint {
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
  const controllerPublicKey = normalizeOptionalText(
    input.controllerPublicKey,
    'controllerPublicKey',
    2048
  );
  const shortFingerprint = normalizeOptionalText(input.shortFingerprint, 'shortFingerprint', 64);
  const verificationStatus = requireIdentityVerificationStatus(
    input.verificationStatus ?? 'unknown',
    'verificationStatus'
  );
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

function normalizeOptionalText(
  value: string | undefined,
  label: string,
  maxLength: number
): string | undefined {
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

function normalizeOptionalExternalUrl(
  value: string | undefined,
  label: string
): string | undefined {
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

function requireIdentityVerificationStatus(
  value: string,
  label: string
): IdentityVerificationStatus {
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
