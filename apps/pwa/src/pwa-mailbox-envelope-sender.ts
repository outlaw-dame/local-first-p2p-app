import {
  signEventEnvelope,
  wrapPayloadKeyWithX25519,
  type SigningKeypair
} from '@lfp2p/crypto';
import {
  encryptPrivatePayload,
  generatePrivatePayloadKeyMaterial,
  type PrivatePayloadAadContext
} from '@lfp2p/private-payload';
import {
  createUnsignedEvent,
  type EventKind,
  type JsonValue,
  type PayloadKeyRecipientWrap,
  type SignedEventEnvelope
} from '@lfp2p/protocol';
import type { ResolvedRecipient } from '@lfp2p/envelope';
import type { AppendMailboxEventResult, createLocalFirstStore } from '@lfp2p/local-store';

/**
 * Phase 5.12E sender-side mailbox envelope wiring.
 *
 * This helper is intentionally additive to the older `conversationKey` emit path:
 * it uses Phase 5.12D resolved peer device wrap metadata to generate a fresh
 * per-envelope AES content key, wraps that key once per recipient device and
 * once for the local sender device, signs the mailbox event, and appends it
 * locally with the one-time key so the sender's outbox projection advances.
 * The raw key is never returned to the caller.
 */

type Store = ReturnType<typeof createLocalFirstStore>;

const MAX_ID_LENGTH = 512;
const MAX_REF_LENGTH = 4096;

export type SenderDeviceWrap = Readonly<{
  /** Local sender device X25519 public wrap key. */
  wrapPublicKey: string;
  /** Stable local sender wrap-key reference. */
  wrapKeyRef: string;
}>;

export type MailboxSenderEnvelopeContext = Readonly<{
  store: Store;
  /** The emitting identity — event author and local outbox owner. */
  identityId: string;
  /** Authorised local device doing the signing. */
  deviceId: string;
  /** Local sender device wrap metadata so outbound events survive replay/reload. */
  senderDeviceWrap: SenderDeviceWrap;
  signingKeypair: SigningKeypair;
}>;

export type QueueMailboxEnvelopeToRecipientsInput = MailboxSenderEnvelopeContext &
  Readonly<{
    envelope: Readonly<{
      envelopeId: string;
      recipientIdentityId: string;
      /**
       * Present = sealed to one recipient device; absent = visible to any
       * authorised recipient device.
       */
      recipientDeviceId?: string;
      /** ObjectRef key of the actual message content. */
      contentRef: string;
      expiresAt: string;
      /** envelopeId of the original, when this is a forward. */
      forwardedFrom?: string;
    }>;
    /** `dm` for one peer; `group` for a future group mailbox recipient identity. */
    privacy: 'dm' | 'group';
    /** Resolved through Phase 5.12D from synced identity-control projections. */
    recipients: readonly ResolvedRecipient[];
    /** Optional deterministic test/key id. Defaults to a fresh payload-key id. */
    keyId?: string;
    /** Defaults to a fresh `new Date().toISOString()`. */
    createdAt?: string;
    /** Defaults to a `crypto.randomUUID()`-derived id. */
    eventId?: string;
  }>;

export type QueueMailboxEnvelopeToRecipientsResult = Readonly<{
  append: AppendMailboxEventResult;
  /** Signed event suitable for the normal bridge/sync publication path. */
  event: SignedEventEnvelope;
  keyId: string;
  /** Remote recipient device ids that received a wrapped copy of the content key. */
  recipientDeviceIds: readonly string[];
  /** Local sender device id that received a replay/sweep wrap. */
  senderDeviceId: string;
}>;

export async function emitMailboxEnvelopeQueuedToRecipients(
  input: QueueMailboxEnvelopeToRecipientsInput
): Promise<QueueMailboxEnvelopeToRecipientsResult> {
  requireObject(input, 'input');
  requireStore(input.store);
  const identityId = requireId(input.identityId, 'identityId');
  const deviceId = requireId(input.deviceId, 'deviceId');
  const senderDeviceWrap = normalizeSenderDeviceWrap(input.senderDeviceWrap);
  const envelope = requireObject(input.envelope, 'input.envelope');
  const recipientIdentityId = requireId(envelope.recipientIdentityId, 'envelope.recipientIdentityId');
  const targetDeviceId = optionalId(envelope.recipientDeviceId, 'envelope.recipientDeviceId');
  const privacy = requireMailboxPrivacy(input.privacy);
  const recipients = normalizeMailboxRecipients(
    input.recipients,
    recipientIdentityId,
    targetDeviceId
  );
  const createdAt = requireIsoTimestamp(input.createdAt ?? new Date().toISOString(), 'createdAt');
  const eventId = input.eventId ?? newEventId();
  const keyMaterial = generatePrivatePayloadKeyMaterial();
  const keyId = requireId(input.keyId ?? `payload-key:${globalThis.crypto.randomUUID()}`, 'keyId');

  const payload: JsonValue = {
    envelopeId: requireId(envelope.envelopeId, 'envelope.envelopeId'),
    recipientIdentityId,
    // Anti-spoofing: sender is always the emitting identity, never input.
    senderIdentityId: identityId,
    contentRef: requireRef(envelope.contentRef, 'envelope.contentRef'),
    expiresAt: requireIsoTimestamp(envelope.expiresAt, 'envelope.expiresAt'),
    ...(targetDeviceId === undefined ? {} : { recipientDeviceId: targetDeviceId }),
    ...(envelope.forwardedFrom === undefined
      ? {}
      : { forwardedFrom: requireId(envelope.forwardedFrom, 'envelope.forwardedFrom') })
  };

  const context: PrivatePayloadAadContext = {
    eventId,
    kind: 'mailbox.envelope.queued' as EventKind,
    author: identityId,
    deviceId,
    createdAt,
    privacy,
    schemaVersion: 1,
    lamport: 0
  };

  const recipientWraps = buildRecipientWraps({
    keyMaterial,
    senderIdentityId: identityId,
    senderDeviceId: deviceId,
    senderDeviceWrap,
    recipients
  });

  const encrypted = await encryptPrivatePayload({
    plaintext: payload,
    context,
    keyMaterial,
    keyId,
    recipientWraps
  });

  const signed = signEventEnvelope(
    createUnsignedEvent({
      eventId,
      kind: 'mailbox.envelope.queued' as EventKind,
      author: identityId,
      deviceId,
      createdAt,
      lamport: 0,
      schemaVersion: 1,
      privacy,
      payload: encrypted as unknown as SignedEventEnvelope['payload']
    }),
    input.signingKeypair
  );

  const append = await input.store.appendMailboxEvent(signed, {
    ownerIdentityId: identityId,
    keyMaterial
  });

  return Object.freeze({
    append,
    event: signed,
    keyId,
    recipientDeviceIds: Object.freeze(recipients.map((recipient) => recipient.recipientDeviceId)),
    senderDeviceId: deviceId
  });
}

function buildRecipientWraps(input: Readonly<{
  keyMaterial: string;
  senderIdentityId: string;
  senderDeviceId: string;
  senderDeviceWrap: SenderDeviceWrap;
  recipients: readonly ResolvedRecipient[];
}>): readonly PayloadKeyRecipientWrap[] {
  const wraps: PayloadKeyRecipientWrap[] = [
    Object.freeze({
      recipientIdentityId: input.senderIdentityId,
      recipientDeviceId: input.senderDeviceId,
      keyAgreement: 'x25519-v1',
      wrappedKey: wrapPayloadKeyWithX25519(input.keyMaterial, input.senderDeviceWrap.wrapPublicKey),
      wrappingKeyRef: input.senderDeviceWrap.wrapKeyRef
    })
  ];
  const seen = new Set<string>([
    wrapDedupeKey(input.senderIdentityId, input.senderDeviceId, input.senderDeviceWrap.wrapKeyRef)
  ]);

  for (const recipient of input.recipients) {
    const dedupeKey = wrapDedupeKey(
      recipient.recipientIdentityId,
      recipient.recipientDeviceId,
      recipient.wrapKeyRef
    );
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    wraps.push(
      Object.freeze({
        recipientIdentityId: recipient.recipientIdentityId,
        recipientDeviceId: recipient.recipientDeviceId,
        keyAgreement: 'x25519-v1',
        wrappedKey: wrapPayloadKeyWithX25519(input.keyMaterial, recipient.wrapPublicKey),
        wrappingKeyRef: recipient.wrapKeyRef
      })
    );
  }

  return Object.freeze(wraps);
}

function wrapDedupeKey(identityId: string, deviceId: string, wrapKeyRef: string): string {
  return `${identityId}\u0000${deviceId}\u0000${wrapKeyRef}`;
}

function normalizeMailboxRecipients(
  recipients: readonly ResolvedRecipient[],
  recipientIdentityId: string,
  targetDeviceId?: string
): readonly ResolvedRecipient[] {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error('recipients must be a non-empty array');
  }
  const selected =
    targetDeviceId === undefined
      ? recipients
      : recipients.filter((recipient) => recipient?.recipientDeviceId === targetDeviceId);
  if (selected.length === 0) {
    throw new Error(`recipientDeviceId ${String(targetDeviceId)} not found in resolved recipients`);
  }

  const seenDeviceIds = new Set<string>();
  const normalized = selected.map((recipient, index) => {
    requireObject(recipient, `recipients[${index}]`);
    const resolvedIdentityId = requireId(
      recipient.recipientIdentityId,
      `recipients[${index}].recipientIdentityId`
    );
    if (resolvedIdentityId !== recipientIdentityId) {
      throw new Error('recipient identity mismatch for mailbox envelope');
    }
    const recipientDeviceId = requireId(
      recipient.recipientDeviceId,
      `recipients[${index}].recipientDeviceId`
    );
    if (seenDeviceIds.has(recipientDeviceId)) {
      throw new Error(`Duplicate recipient device id: ${recipientDeviceId}`);
    }
    seenDeviceIds.add(recipientDeviceId);
    return Object.freeze({
      recipientIdentityId: resolvedIdentityId,
      recipientDeviceId,
      wrapPublicKey: requireId(recipient.wrapPublicKey, `recipients[${index}].wrapPublicKey`),
      wrapKeyRef: requireId(recipient.wrapKeyRef, `recipients[${index}].wrapKeyRef`)
    });
  });
  normalized.sort((left, right) => left.recipientDeviceId.localeCompare(right.recipientDeviceId));
  return Object.freeze(normalized);
}

function normalizeSenderDeviceWrap(value: SenderDeviceWrap): SenderDeviceWrap {
  requireObject(value, 'senderDeviceWrap');
  return Object.freeze({
    wrapPublicKey: requireId(value.wrapPublicKey, 'senderDeviceWrap.wrapPublicKey'),
    wrapKeyRef: requireId(value.wrapKeyRef, 'senderDeviceWrap.wrapKeyRef')
  });
}

function requireStore(value: Store): void {
  if (value === null || typeof value !== 'object' || typeof value.appendMailboxEvent !== 'function') {
    throw new Error('store must be a valid Store instance');
  }
}

function requireObject<T>(value: T, field: string): T {
  if (value === null || typeof value !== 'object') {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw new Error(`${field} must be a non-empty string of at most ${MAX_ID_LENGTH} characters`);
  }
  return value;
}

function optionalId(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requireId(value, field);
}

function requireRef(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_REF_LENGTH) {
    throw new Error(`${field} must be a non-empty string of at most ${MAX_REF_LENGTH} characters`);
  }
  return value;
}

function requireMailboxPrivacy(value: unknown): 'dm' | 'group' {
  if (value !== 'dm' && value !== 'group') {
    throw new Error("privacy must be 'dm' or 'group'");
  }
  return value;
}

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

function newEventId(): string {
  const rand = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `evt_mbx_${rand}`;
}
