/**
 * Phase 5.11 Step 6 — PWA mailbox surface: inbox view model, outbound
 * emit helpers, and the expiry-sweep lifecycle runner.
 *
 * This is the local, user-facing surface for mailbox delivery. It reads
 * the persisted per-envelope projection into a UI-friendly view model,
 * emits the two client-originated mailbox events (an outbound
 * `mailbox.envelope.queued` and a post-fetch `mailbox.receipt.issued`),
 * and wraps the store's idempotent TTL sweep so the app shell can call
 * it on foreground resume and after a sync batch.
 *
 * Discipline (mirrors `pwa-udr-state` and the Phase 2.2 emit helpers):
 *  - Every non-`self` mailbox event carries a `PrivatePayloadEnvelopeV1`.
 *    We encrypt the payload to the correct key (the shared *conversation*
 *    key for `dm`/`group`; the user's own *self* key for `self`), bind
 *    the ciphertext to the exact envelope via AAD, then sign. Plaintext
 *    never leaves the device unencrypted.
 *  - The AAD context and `createUnsignedEvent` are built from the SAME
 *    fixed fields (`lamport: 0`, `schemaVersion: 1`, no refs) so the AAD
 *    the store recomputes on decrypt matches byte-for-byte — a mismatch
 *    surfaces as an `undecryptable` append, never silent corruption.
 *  - Anti-spoofing: an outbound envelope's `senderIdentityId` is pinned
 *    to the emitting identity, never taken from caller input. The store's
 *    decrypt-to-party gate then only advances the projection for an
 *    identity that is actually a party to the envelope.
 *  - IDOR guard on read: the view model filters to rows the identity is
 *    truly the recipient of (defence in depth over the store's own
 *    `recipientIdentityId` index) and never echoes another party's data.
 *  - Sealed-vs-visible addressing is surfaced as a derived flag; the raw
 *    `recipientDeviceId` is NOT copied into the view model, so a
 *    device-pin can never leak through UI logs/analytics.
 *  - Inputs are validated/sanitised at this boundary (bounded, non-empty
 *    ids; ISO timestamps; enum membership) before any crypto runs.
 *  - No key material or plaintext is ever logged.
 */
import { signEventEnvelope, type SigningKeypair } from '@lfp2p/crypto';
import {
  type createLocalFirstStore,
  type AppendMailboxEventResult,
  type MailboxEnvelopeKeyResolution,
  type StoredMailboxInboxRow,
  type StoredMailboxOutboxRow,
  type SweepExpiredMailboxEnvelopesResult
} from '@lfp2p/local-store';
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
import {
  RECEIPT_KINDS,
  type EnvelopeStatus,
  type ExpiryReason,
  type MailboxEventKind,
  type ReceiptKind
} from '@lfp2p/mailbox-projection';

type Store = ReturnType<typeof createLocalFirstStore>;

/** Upper bound on any mailbox identifier accepted at this boundary. */
const MAX_ID_LENGTH = 512;
/** Content refs are digests/URIs — allow more room than a bare id. */
const MAX_REF_LENGTH = 4096;
/** Default coalescing window so an online+visible burst sweeps once. */
const DEFAULT_SWEEP_MIN_INTERVAL_MS = 5_000;

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

/** `sealed` = pinned to one device; `visible` = any authorised device. */
export type MailboxAddressing = 'sealed' | 'visible';

/**
 * One recipient-inbox envelope, projected into a deep-frozen,
 * UI-friendly shape. Intentionally minimal: it carries what the UI needs
 * to render and act (fetch/receipt), and nothing that could leak another
 * party's device identity.
 */
export type MailboxInboxItem = Readonly<{
  envelopeId: string;
  senderIdentityId: string;
  contentRef: string;
  status: EnvelopeStatus;
  expiresAt: string;
  /**
   * True once the envelope is terminally `expired`, OR once its
   * `expiresAt` is at/behind `now` — availability is gone at the actor
   * even before the local sweep has emitted the `expired` event.
   */
  isExpired: boolean;
  /** Derived from device-pinning; the raw deviceId is deliberately omitted. */
  addressing: MailboxAddressing;
  deliveredAt?: string;
  fetchedAt?: string;
  expiredAt?: string;
  expiredReason?: ExpiryReason;
  forwardedFrom?: string;
  receiptCount: number;
}>;

function toInboxItem(row: StoredMailboxInboxRow, nowIso: string): MailboxInboxItem {
  const { entry } = row;
  const { envelope } = entry;
  const isExpired = entry.status === 'expired' || envelope.expiresAt <= nowIso;
  const item: {
    -readonly [K in keyof MailboxInboxItem]: MailboxInboxItem[K];
  } = {
    envelopeId: envelope.envelopeId,
    senderIdentityId: envelope.senderIdentityId,
    contentRef: envelope.contentRef,
    status: entry.status,
    expiresAt: envelope.expiresAt,
    isExpired,
    addressing: envelope.recipientDeviceId !== undefined ? 'sealed' : 'visible',
    receiptCount: entry.receipts.length
  };
  if (entry.deliveredAt !== undefined) item.deliveredAt = entry.deliveredAt;
  if (entry.fetchedAt !== undefined) item.fetchedAt = entry.fetchedAt;
  if (entry.expiredAt !== undefined) item.expiredAt = entry.expiredAt;
  if (entry.expiredReason !== undefined) item.expiredReason = entry.expiredReason;
  if (envelope.forwardedFrom !== undefined) item.forwardedFrom = envelope.forwardedFrom;
  return Object.freeze(item);
}

/**
 * Read `identityId`'s persisted mailbox inbox into a deep-frozen list of
 * view-model items, sorted by soonest expiry then envelopeId (stable and
 * deterministic for the UI and tests). Reads projected rows only — the
 * encrypted `mailboxEventLog` is the authoritative source, recoverable
 * via `store.loadMailboxInboxState`.
 *
 * IDOR: the store already scopes the query to `recipientIdentityId`, but
 * we re-filter here so a stray/foreign row (e.g. a future index bug)
 * can never be rendered as this user's mail.
 */
export async function buildMailboxInboxViewModel(
  store: Store,
  identityId: string,
  now: string = new Date().toISOString()
): Promise<readonly MailboxInboxItem[]> {
  if (store === null || typeof store !== 'object' || typeof store.getMailboxInbox !== 'function') {
    throw new Error('store must be a valid Store instance');
  }
  requireId(identityId, 'identityId');
  const nowIso = requireIsoTimestamp(now, 'now');
  const rows = await store.getMailboxInbox(identityId);
  const items = rows
    .filter((row) => row.recipientIdentityId === identityId)
    .map((row) => toInboxItem(row, nowIso));
  items.sort((a, b) => {
    if (a.expiresAt !== b.expiresAt) return a.expiresAt < b.expiresAt ? -1 : 1;
    if (a.envelopeId === b.envelopeId) return 0;
    return a.envelopeId < b.envelopeId ? -1 : 1;
  });
  return Object.freeze(items);
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

/** Shared inputs every mailbox emit helper requires. */
export type MailboxEmitContext = Readonly<{
  store: Store;
  /** The emitting identity — event author AND the projection owner. */
  identityId: string;
  /** Authorised device id doing the signing. */
  deviceId: string;
  /** Signing keypair for the event envelope. */
  signingKeypair: SigningKeypair;
}>;

/** Key material for a shared `dm`/`group` conversation envelope. */
export type ConversationKey = Readonly<{
  keyMaterial: string;
  /** Key id recorded on the envelope (references the key, not the key). */
  keyId: string;
  privacy: 'dm' | 'group';
}>;

/** Key material for the user's own `self`-scoped envelope. */
export type SelfKey = Readonly<{
  keyMaterial: string;
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

function requireRef(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_REF_LENGTH) {
    throw new Error(`${field} must be a non-empty string of at most ${MAX_REF_LENGTH} characters`);
  }
  return value;
}

/**
 * Validate an ISO-8601 timestamp AND canonicalise it to UTC (`…Z`, ms
 * precision). `expiresAt` and the view model's `now` are compared
 * lexicographically, so a non-UTC offset (e.g. `+02:00`) must be
 * normalised or it would sort incorrectly and evade expiry.
 */
function requireIsoTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw new Error(`${field} must be a non-empty ISO-8601 timestamp`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new Error(`${field} must be a valid ISO-8601 timestamp`);
  }
  return new Date(ms).toISOString();
}

function requireObject<T>(value: T, field: string): T {
  if (value === null || typeof value !== 'object') {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

function newEventId(): string {
  const rand = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `evt_mbx_${rand}`;
}

/**
 * Core emit: encrypt `plaintext` to `keyMaterial`/`keyId` under `privacy`
 * with AAD bound to the exact envelope, sign, and append via the store's
 * decrypt-and-apply gate. Returns the append result (`applied`,
 * `undecryptable`, `rejected`, or `skipped`).
 */
async function emitMailboxEvent(
  ctx: MailboxEmitContext,
  kind: MailboxEventKind,
  privacy: 'dm' | 'group' | 'self',
  plaintext: JsonValue,
  keyMaterial: string,
  keyId: string,
  createdAt: string,
  eventId: string | undefined
): Promise<AppendMailboxEventResult> {
  requireId(ctx.identityId, 'identityId');
  requireId(ctx.deviceId, 'deviceId');
  requireId(keyMaterial, 'keyMaterial');
  requireId(keyId, 'keyId');

  const resolvedEventId = eventId ?? newEventId();
  const lamport = 0;
  const schemaVersion = 1;

  const context: PrivatePayloadAadContext = {
    eventId: resolvedEventId,
    kind: kind as EventKind,
    author: ctx.identityId,
    deviceId: ctx.deviceId,
    createdAt,
    privacy,
    schemaVersion,
    lamport
  };
  // Validate the AAD context up front (also guards field shapes).
  buildPrivatePayloadAad(context);

  const envelope = await encryptPrivatePayload({
    plaintext,
    context,
    keyMaterial,
    keyId
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
      privacy,
      payload: envelope as unknown as JsonValue as SignedEventEnvelope['payload']
    }),
    ctx.signingKeypair
  );

  return ctx.store.appendMailboxEvent(signed, {
    ownerIdentityId: ctx.identityId,
    keyMaterial
  });
}

export type QueueMailboxEnvelopeInput = MailboxEmitContext &
  EmitOverrides &
  Readonly<{
    envelope: Readonly<{
      envelopeId: string;
      recipientIdentityId: string;
      /** Present = sealed (only that device); absent = visible. */
      recipientDeviceId?: string;
      /** ObjectRef key of the actual message content. */
      contentRef: string;
      expiresAt: string;
      /** envelopeId of the original, when this is a forward. */
      forwardedFrom?: string;
    }>;
    /** Shared `dm`/`group` key the delivery envelope is encrypted to. */
    conversationKey: ConversationKey;
  }>;

/**
 * Emit an outbound `mailbox.envelope.queued` (delivery-plane, `dm`/`group`
 * scope). The `senderIdentityId` is pinned to `ctx.identityId` and cannot
 * be spoofed by the caller. Returns the store append result — `applied`
 * confirms the outbox projection advanced.
 */
export async function emitMailboxEnvelopeQueued(
  input: QueueMailboxEnvelopeInput
): Promise<AppendMailboxEventResult> {
  requireObject(input, 'input');
  const src = requireObject(input.envelope, 'input.envelope');
  const key = input.conversationKey;
  if (key === null || typeof key !== 'object') {
    throw new Error('conversationKey must be provided for a dm/group delivery envelope');
  }
  if (key.privacy !== 'dm' && key.privacy !== 'group') {
    throw new Error("conversationKey.privacy must be 'dm' or 'group'");
  }

  const createdAt = input.createdAt ?? new Date().toISOString();
  const payload: JsonValue = {
    envelopeId: requireId(src.envelopeId, 'envelope.envelopeId'),
    recipientIdentityId: requireId(src.recipientIdentityId, 'envelope.recipientIdentityId'),
    // Anti-spoofing: sender is always the emitting identity, never input.
    senderIdentityId: requireId(input.identityId, 'identityId'),
    contentRef: requireRef(src.contentRef, 'envelope.contentRef'),
    expiresAt: requireIsoTimestamp(src.expiresAt, 'envelope.expiresAt'),
    ...(src.recipientDeviceId === undefined
      ? {}
      : { recipientDeviceId: requireId(src.recipientDeviceId, 'envelope.recipientDeviceId') }),
    ...(src.forwardedFrom === undefined
      ? {}
      : { forwardedFrom: requireId(src.forwardedFrom, 'envelope.forwardedFrom') })
  };

  return emitMailboxEvent(
    input,
    'mailbox.envelope.queued',
    key.privacy,
    payload,
    key.keyMaterial,
    key.keyId,
    createdAt,
    input.eventId
  );
}

export type IssueMailboxReceiptInput = MailboxEmitContext &
  EmitOverrides &
  Readonly<{
    envelopeId: string;
    receiptId: string;
    receiptKind: ReceiptKind;
    /** The user's own `self` key the receipt is encrypted to. */
    selfKey: SelfKey;
  }>;

/**
 * Emit a `mailbox.receipt.issued` (recipient-local, `self` scope) after
 * fetching/handling an inbox envelope. Annotates the recipient's own
 * inbox entry; it never crosses a bridge (self is device/account-local).
 */
export async function emitMailboxReceiptIssued(
  input: IssueMailboxReceiptInput
): Promise<AppendMailboxEventResult> {
  requireObject(input, 'input');
  const receiptKind = input.receiptKind;
  if (!(RECEIPT_KINDS as readonly string[]).includes(receiptKind)) {
    throw new Error(`receiptKind must be one of ${RECEIPT_KINDS.join(', ')}`);
  }
  if (input.selfKey === null || typeof input.selfKey !== 'object') {
    throw new Error('selfKey must be provided for a self-scoped receipt');
  }
  const issuedAt = input.createdAt ?? new Date().toISOString();
  const payload: JsonValue = {
    envelopeId: requireId(input.envelopeId, 'envelopeId'),
    receiptId: requireId(input.receiptId, 'receiptId'),
    receiptKind,
    issuedAt
  };

  return emitMailboxEvent(
    input,
    'mailbox.receipt.issued',
    'self',
    payload,
    input.selfKey.keyMaterial,
    input.selfKey.keyId,
    issuedAt,
    input.eventId
  );
}

// ---------------------------------------------------------------------------
// Expiry-sweep lifecycle runner
// ---------------------------------------------------------------------------

/**
 * Configuration for the TTL expiry-sweep runner. The runner wraps the
 * store's idempotent `sweepExpiredMailboxEnvelopes` with the concurrency
 * and error-isolation discipline a UI lifecycle needs.
 */
export type MailboxSweepContext = Readonly<{
  store: Store;
  ownerIdentityId: string;
  deviceId: string;
  signingKeypair: SigningKeypair;
  /**
   * Per-envelope conversation-key resolver. `mailbox.envelope.expired` is
   * `dm`/`group`, so each emit encrypts to that envelope's shared key.
   * Return `undefined` to skip an envelope this sweep (it is retried on a
   * later sweep once the key is available — self-healing).
   */
  resolveEnvelopeKey: (
    row: StoredMailboxInboxRow | StoredMailboxOutboxRow
  ) => MailboxEnvelopeKeyResolution | undefined;
  /** ISO sweep instant; defaults to `new Date().toISOString()`. */
  now?: () => string;
  /** Monotonic clock for the coalescing window (testable); defaults to `Date.now`. */
  monotonicNow?: () => number;
  /** Re-triggers within this window are coalesced. Default 5s; 0 disables. */
  minIntervalMs?: number;
  /** Notified after each real sweep with its result (never with an error). */
  onSwept?: (result: SweepExpiredMailboxEnvelopesResult) => void;
  /** Notified if a sweep throws; the runner then resolves `undefined`. */
  onError?: (error: unknown) => void;
}>;

export type MailboxSweepRunner = Readonly<{
  /**
   * Run one sweep. Concurrency-safe: an in-flight sweep is reused rather
   * than started twice. Coalesced: a call within `minIntervalMs` of the
   * previous run resolves `undefined` without touching the store. Never
   * throws — a failure is routed to `onError` and resolves `undefined`.
   */
  run: () => Promise<SweepExpiredMailboxEnvelopesResult | undefined>;
}>;

/**
 * Build a sweep runner suitable for calling on foreground resume and on
 * sync-batch completion. The underlying store sweep is idempotent and
 * emits nothing when there is nothing to expire, so redundant triggers
 * are cheap; the in-flight guard additionally prevents two overlapping
 * sweeps from emitting duplicate `expired` events for the same envelope,
 * and the coalescing window absorbs the common online+visible burst.
 * A full retry/backoff policy is intentionally omitted: the sweep is a
 * local, idempotent IndexedDB operation whose triggers are already
 * rate-limited by the foreground-sync controller.
 */
export function createMailboxSweepRunner(ctx: MailboxSweepContext): MailboxSweepRunner {
  requireObject(ctx, 'ctx');
  requireId(ctx.ownerIdentityId, 'ownerIdentityId');
  requireId(ctx.deviceId, 'deviceId');
  if (typeof ctx.resolveEnvelopeKey !== 'function') {
    throw new Error('resolveEnvelopeKey must be a function');
  }
  const nowIso = ctx.now ?? (() => new Date().toISOString());
  const monotonic = ctx.monotonicNow ?? (() => Date.now());
  const minIntervalMs = ctx.minIntervalMs ?? DEFAULT_SWEEP_MIN_INTERVAL_MS;

  let inFlight: Promise<SweepExpiredMailboxEnvelopesResult | undefined> | undefined;
  let lastRunMs: number | undefined;

  async function doRun(): Promise<SweepExpiredMailboxEnvelopesResult | undefined> {
    try {
      const result = await ctx.store.sweepExpiredMailboxEnvelopes({
        ownerIdentityId: ctx.ownerIdentityId,
        deviceId: ctx.deviceId,
        signingKeypair: ctx.signingKeypair,
        resolveEnvelopeKey: ctx.resolveEnvelopeKey,
        now: nowIso()
      });
      ctx.onSwept?.(result);
      return result;
    } catch (error) {
      ctx.onError?.(error);
      return undefined;
    }
  }

  return Object.freeze({
    run(): Promise<SweepExpiredMailboxEnvelopesResult | undefined> {
      if (inFlight !== undefined) return inFlight;
      const nowMs = monotonic();
      if (lastRunMs !== undefined && minIntervalMs > 0 && nowMs - lastRunMs < minIntervalMs) {
        return Promise.resolve(undefined);
      }
      lastRunMs = nowMs;
      const pending = doRun().finally(() => {
        if (inFlight === pending) inFlight = undefined;
      });
      inFlight = pending;
      return pending;
    }
  });
}

/**
 * Minimal shape of a foreground-sync result the sweep cares about (avoids
 * a hard import of the sync-client result union). A completed sync means
 * fresh mailbox events may have landed, so we sweep afterwards.
 */
export type ForegroundSyncOutcome = Readonly<{ status: string }>;

/**
 * Adapter for the app shell's foreground-sync `onResult` seam: sweep only
 * after a sync actually completes (skipped/failed syncs bring no new
 * envelopes to expire). Foreground resume flows through the same seam via
 * the `visible` trigger, so this one wiring covers both plan callers.
 * Fire-and-forget: the runner never throws.
 */
export function sweepAfterForegroundSync(
  runner: MailboxSweepRunner,
  result: ForegroundSyncOutcome
): void {
  if (runner === null || typeof runner !== 'object' || typeof runner.run !== 'function') {
    throw new Error('runner must be a valid MailboxSweepRunner');
  }
  requireObject(result, 'result');
  if (result.status === 'completed') {
    void runner.run();
  }
}
