/**
 * Phase 5.11 Step 5 — PWA User Data Root (UDR) view model and emit
 * helpers.
 *
 * This is the local, user-facing surface for the UDR: it reads the
 * persisted projection into a UI-friendly view model, and emits the
 * nine `self`-scoped `udr.*` lifecycle events (partition claim/release,
 * feed subscription add/remove, sync-interest add/remove, mailbox bind,
 * space join/leave).
 *
 * Discipline (mirrors the Phase 2.2 / 1.8.7 emit helpers):
 *  - `udr.*` events are `self`-scoped and MUST carry a
 *    `PrivatePayloadEnvelopeV1`. We encrypt the payload to the user's
 *    own content key, bind the ciphertext to the exact envelope via
 *    AAD, then sign. The plaintext never leaves this device unencrypted
 *    and never reaches the bridge (Phase 1.64: `self` never traverses a
 *    bridge/relay/super-peer).
 *  - Persistence is atomic and idempotent via
 *    `store.appendUdrEvent` (decrypt-to-self is its projection gate).
 *  - IDOR guard: every emit pins `expectedIdentityId = identityId`, so
 *    an event can only advance the projection for the emitting identity.
 *  - Inputs are validated/sanitised at this boundary (bounded,
 *    non-empty ids) — defence in depth over the projection's own
 *    post-decrypt validation.
 *  - No key material or plaintext is ever logged.
 */
import { signEventEnvelope, type SigningKeypair } from '@lfp2p/crypto';
import { type createLocalFirstStore, type AppendUdrEventResult } from '@lfp2p/local-store';
import {
  buildPrivatePayloadAad,
  encryptPrivatePayload,
  type PrivatePayloadAadContext
} from '@lfp2p/private-payload';
import {
  createUnsignedEvent,
  type EventKind,
  type JsonValue,
  type SignedEventEnvelope
} from '@lfp2p/protocol';
import type { UdrEventKind } from '@lfp2p/udr-projection';

type Store = ReturnType<typeof createLocalFirstStore>;

/** Upper bound on any UDR identifier accepted at the emit boundary. */
const MAX_ID_LENGTH = 512;

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

export type UdrViewModel = Readonly<{
  identityId: string;
  /** Whether a persisted projection row exists yet for this identity. */
  present: boolean;
  partitions: readonly string[];
  feedSubscriptions: readonly string[];
  syncInterests: readonly string[];
  spaces: readonly string[];
  mailboxId: string | undefined;
  counts: Readonly<{
    partitions: number;
    feedSubscriptions: number;
    syncInterests: number;
    spaces: number;
  }>;
  /** ISO timestamp of the most recently applied event, or empty. */
  updatedAt: string;
}>;

function emptyViewModel(identityId: string): UdrViewModel {
  return Object.freeze({
    identityId,
    present: false,
    partitions: Object.freeze([]),
    feedSubscriptions: Object.freeze([]),
    syncInterests: Object.freeze([]),
    spaces: Object.freeze([]),
    mailboxId: undefined,
    counts: Object.freeze({
      partitions: 0,
      feedSubscriptions: 0,
      syncInterests: 0,
      spaces: 0
    }),
    updatedAt: ''
  });
}

/**
 * Read the persisted UDR projection for `identityId` into a deep-frozen,
 * UI-friendly view model. Does not decrypt anything — the projection row
 * holds structural ids only (the encrypted event log is the
 * authoritative source; use `store.loadUdrState` to rebuild/recover).
 * Returns an empty view model when no row exists yet.
 */
export async function buildUdrViewModel(store: Store, identityId: string): Promise<UdrViewModel> {
  requireId(identityId, 'identityId');
  const row = await store.getUserDataRoot(identityId);
  if (row === undefined) {
    return emptyViewModel(identityId);
  }
  // The snapshot arrays are already canonical (sorted) from
  // serializeUdrState; copy defensively so the view model owns them.
  const partitions = Object.freeze([...row.partitionIds]);
  const feedSubscriptions = Object.freeze([...row.feedSubscriptionIds]);
  const syncInterests = Object.freeze([...row.syncInterestIds]);
  const spaces = Object.freeze([...row.spaceIds]);
  return Object.freeze({
    identityId,
    present: true,
    partitions,
    feedSubscriptions,
    syncInterests,
    spaces,
    mailboxId: row.mailboxId,
    counts: Object.freeze({
      partitions: partitions.length,
      feedSubscriptions: feedSubscriptions.length,
      syncInterests: syncInterests.length,
      spaces: spaces.length
    }),
    updatedAt: row.updatedAt
  });
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

/** Shared inputs every UDR emit helper requires. */
export type UdrEmitContext = Readonly<{
  store: Store;
  /** Controller/identity id; also the event author and projection key. */
  identityId: string;
  /** Authorised device id doing the signing. */
  deviceId: string;
  /** Signing keypair for the `self` event envelope. */
  signingKeypair: SigningKeypair;
  /** Symmetric content-key material the `self` payload is encrypted to. */
  keyMaterial: string;
  /** Key id recorded on the envelope (references the content key, not the key). */
  keyId: string;
}>;

type EmitOverrides = Readonly<{
  /** Defaults to a fresh `new Date().toISOString()`. */
  createdAt?: string;
  /** Defaults to a `crypto.randomUUID()`-derived id. */
  eventId?: string;
}>;

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw new Error(`${field} must be a non-empty string of at most ${MAX_ID_LENGTH} characters`);
  }
  return value;
}

function newEventId(): string {
  const rand = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `evt_udr_${rand}`;
}

/**
 * Core emit: encrypt `plaintext` to the user's own key with AAD bound to
 * the exact envelope, sign, and append. Both the AAD context and
 * `createUnsignedEvent` are built from the SAME fixed field values
 * (`lamport: 0`, `schemaVersion: 1`, `privacy: 'self'`, no refs) so the
 * AAD the store recomputes on decrypt matches byte-for-byte. The
 * `createdAt` is resolved by the caller (so it equals the payload
 * timestamp) and passed in explicitly. Returns the store's append
 * result.
 */
async function emitUdrEvent(
  ctx: UdrEmitContext,
  kind: UdrEventKind,
  plaintext: JsonValue,
  createdAt: string,
  eventId: string | undefined
): Promise<AppendUdrEventResult> {
  requireId(ctx.identityId, 'identityId');
  requireId(ctx.deviceId, 'deviceId');
  requireId(ctx.keyMaterial, 'keyMaterial');
  requireId(ctx.keyId, 'keyId');

  const resolvedEventId = eventId ?? newEventId();
  const lamport = 0;
  const schemaVersion = 1;

  const context: PrivatePayloadAadContext = {
    eventId: resolvedEventId,
    kind: kind as EventKind,
    author: ctx.identityId,
    deviceId: ctx.deviceId,
    createdAt,
    privacy: 'self',
    schemaVersion,
    lamport
  };
  // Validate the AAD context up front (also guards field shapes).
  buildPrivatePayloadAad(context);

  const envelope = await encryptPrivatePayload({
    plaintext,
    context,
    keyMaterial: ctx.keyMaterial,
    keyId: ctx.keyId
  });

  const signed: SignedEventEnvelope = signEventEnvelope(
    createUnsignedEvent({
      eventId: resolvedEventId,
      kind: kind as EventKind,
      author: ctx.identityId,
      deviceId: ctx.deviceId,
      createdAt,
      lamport,
      schemaVersion,
      privacy: 'self',
      payload: envelope as unknown as JsonValue as SignedEventEnvelope['payload']
    }),
    ctx.signingKeypair
  );

  return ctx.store.appendUdrEvent(signed, {
    keyMaterial: ctx.keyMaterial,
    expectedIdentityId: ctx.identityId
  });
}

export type ClaimPartitionInput = UdrEmitContext &
  EmitOverrides &
  Readonly<{ partitionId: string; scope?: string }>;

export async function emitPartitionClaimed(
  input: ClaimPartitionInput
): Promise<AppendUdrEventResult> {
  const partitionId = requireId(input.partitionId, 'partitionId');
  const claimedAt = input.createdAt ?? new Date().toISOString();
  const payload: JsonValue = {
    partitionId,
    claimedAt,
    ...(input.scope === undefined ? {} : { scope: requireId(input.scope, 'scope') })
  };
  return emitUdrEvent(input, 'udr.partition.claimed', payload, claimedAt, input.eventId);
}

export type ReleasePartitionInput = UdrEmitContext &
  EmitOverrides &
  Readonly<{ partitionId: string }>;

export async function emitPartitionReleased(
  input: ReleasePartitionInput
): Promise<AppendUdrEventResult> {
  const partitionId = requireId(input.partitionId, 'partitionId');
  const releasedAt = input.createdAt ?? new Date().toISOString();
  return emitUdrEvent(
    input,
    'udr.partition.released',
    { partitionId, releasedAt },
    releasedAt,
    input.eventId
  );
}

export type AddFeedSubscriptionInput = UdrEmitContext &
  EmitOverrides &
  Readonly<{ feedId: string; feedKind?: string }>;

export async function emitFeedSubscriptionAdded(
  input: AddFeedSubscriptionInput
): Promise<AppendUdrEventResult> {
  const feedId = requireId(input.feedId, 'feedId');
  const addedAt = input.createdAt ?? new Date().toISOString();
  const payload: JsonValue = {
    feedId,
    addedAt,
    ...(input.feedKind === undefined ? {} : { feedKind: requireId(input.feedKind, 'feedKind') })
  };
  return emitUdrEvent(input, 'udr.feed-subscription.added', payload, addedAt, input.eventId);
}

export type RemoveFeedSubscriptionInput = UdrEmitContext &
  EmitOverrides &
  Readonly<{ feedId: string }>;

export async function emitFeedSubscriptionRemoved(
  input: RemoveFeedSubscriptionInput
): Promise<AppendUdrEventResult> {
  const feedId = requireId(input.feedId, 'feedId');
  const removedAt = input.createdAt ?? new Date().toISOString();
  return emitUdrEvent(
    input,
    'udr.feed-subscription.removed',
    { feedId, removedAt },
    removedAt,
    input.eventId
  );
}

export type AddSyncInterestInput = UdrEmitContext &
  EmitOverrides &
  Readonly<{ syncInterestId: string; interest?: JsonValue }>;

export async function emitSyncInterestAdded(
  input: AddSyncInterestInput
): Promise<AppendUdrEventResult> {
  const syncInterestId = requireId(input.syncInterestId, 'syncInterestId');
  const addedAt = input.createdAt ?? new Date().toISOString();
  const payload: JsonValue = {
    syncInterestId,
    addedAt,
    ...(input.interest === undefined ? {} : { interest: input.interest })
  };
  return emitUdrEvent(input, 'udr.sync-interest.added', payload, addedAt, input.eventId);
}

export type RemoveSyncInterestInput = UdrEmitContext &
  EmitOverrides &
  Readonly<{ syncInterestId: string }>;

export async function emitSyncInterestRemoved(
  input: RemoveSyncInterestInput
): Promise<AppendUdrEventResult> {
  const syncInterestId = requireId(input.syncInterestId, 'syncInterestId');
  const removedAt = input.createdAt ?? new Date().toISOString();
  return emitUdrEvent(
    input,
    'udr.sync-interest.removed',
    { syncInterestId, removedAt },
    removedAt,
    input.eventId
  );
}

export type BindMailboxInput = UdrEmitContext & EmitOverrides & Readonly<{ mailboxId: string }>;

export async function emitMailboxBound(input: BindMailboxInput): Promise<AppendUdrEventResult> {
  const mailboxId = requireId(input.mailboxId, 'mailboxId');
  const boundAt = input.createdAt ?? new Date().toISOString();
  return emitUdrEvent(input, 'udr.mailbox.bound', { mailboxId, boundAt }, boundAt, input.eventId);
}

export type JoinSpaceInput = UdrEmitContext & EmitOverrides & Readonly<{ spaceId: string }>;

export async function emitSpaceJoined(input: JoinSpaceInput): Promise<AppendUdrEventResult> {
  const spaceId = requireId(input.spaceId, 'spaceId');
  const joinedAt = input.createdAt ?? new Date().toISOString();
  return emitUdrEvent(input, 'udr.space.joined', { spaceId, joinedAt }, joinedAt, input.eventId);
}

export type LeaveSpaceInput = UdrEmitContext & EmitOverrides & Readonly<{ spaceId: string }>;

export async function emitSpaceLeft(input: LeaveSpaceInput): Promise<AppendUdrEventResult> {
  const spaceId = requireId(input.spaceId, 'spaceId');
  const leftAt = input.createdAt ?? new Date().toISOString();
  return emitUdrEvent(input, 'udr.space.left', { spaceId, leftAt }, leftAt, input.eventId);
}
