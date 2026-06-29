import {
  buildPrivatePayloadAad,
  decryptPrivatePayload,
  type DecryptPrivatePayloadOptions,
  type PrivatePayloadAadContext
} from '@lfp2p/private-payload';
import type { EventKind, JsonValue, SignedEventEnvelope } from '@lfp2p/protocol';

// ---------------------------------------------------------------------------
// Stable error codes (Phase 3.1 doctrine — logged by code, never by content)
// ---------------------------------------------------------------------------

export const CHAT_ERROR_CODES = Object.freeze([
  'CHAT_THREAD_ALREADY_EXISTS',
  'CHAT_THREAD_NOT_FOUND',
  'CHAT_MESSAGE_NOT_FOUND',
  'CHAT_MESSAGE_ALREADY_DELETED',
  'CHAT_INVALID_PAYLOAD',
  'CHAT_DECRYPT_FAILED',
  'CHAT_INVALID_PRIVACY',
  'CHAT_INVALID_KIND'
] as const);

export type ChatErrorCode = (typeof CHAT_ERROR_CODES)[number];

export class ChatProjectionError extends Error {
  readonly code: ChatErrorCode;
  constructor(code: ChatErrorCode, detail?: string) {
    super(detail !== undefined ? `${code}: ${detail}` : code);
    this.name = 'ChatProjectionError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Chat event kind type guard
// ---------------------------------------------------------------------------

export const CHAT_EVENT_KINDS = Object.freeze([
  'chat.thread.created',
  'chat.message.sent',
  'chat.message.edited',
  'chat.message.deleted',
  'chat.thread.accepted'
] as const);

export type ChatEventKind = (typeof CHAT_EVENT_KINDS)[number];

export function isChatEventKind(kind: EventKind): kind is ChatEventKind {
  return (CHAT_EVENT_KINDS as ReadonlyArray<string>).includes(kind);
}

// ---------------------------------------------------------------------------
// Decrypted payload shapes (validated at apply time, never logged)
// ---------------------------------------------------------------------------

export type ChatThreadCreatedPayload = Readonly<{
  threadId: string;
  participantIds: ReadonlyArray<string>;
  threadName?: string;
  createdAt: string;
}>;

export type ChatMessageSentPayload = Readonly<{
  threadId: string;
  messageId: string;
  body: string;
  replyToMessageId?: string;
  sentAt: string;
}>;

export type ChatMessageEditedPayload = Readonly<{
  threadId: string;
  messageId: string;
  newBody: string;
  editedAt: string;
  editReason?: string;
}>;

export type ChatMessageDeletedPayload = Readonly<{
  threadId: string;
  messageId: string;
  deletedAt: string;
}>;

export type ChatThreadAcceptedPayload = Readonly<{
  threadId: string;
  acceptedAt: string;
}>;

// ---------------------------------------------------------------------------
// Projection state types
// ---------------------------------------------------------------------------

export type ChatMessageRecord = Readonly<{
  messageId: string;
  authorDeviceId: string;
  plaintextBody: string;
  sentAt: string;
  editedAt?: string;
  deletedAt?: string;
  deleted: boolean;
  replyToMessageId?: string;
}>;

export type ChatThreadState = Readonly<{
  threadId: string;
  participants: ReadonlyArray<string>;
  threadName?: string;
  messages: ReadonlyMap<string, ChatMessageRecord>;
  acceptedBy: ReadonlySet<string>;
  createdAt: string;
  lastActivityAt: string;
  appliedEventIds: ReadonlySet<string>;
}>;

export function createEmptyChatThreadState(threadId: string): ChatThreadState {
  return Object.freeze({
    threadId,
    participants: Object.freeze([]) as ReadonlyArray<string>,
    messages: Object.freeze(new Map<string, ChatMessageRecord>()),
    acceptedBy: Object.freeze(new Set<string>()),
    createdAt: '',
    lastActivityAt: '',
    appliedEventIds: Object.freeze(new Set<string>())
  });
}

// ---------------------------------------------------------------------------
// Pure state machine (operates on already-decrypted payloads)
// ---------------------------------------------------------------------------

export type ApplyChatEventMeta = Readonly<{
  eventId: string;
  kind: ChatEventKind;
  authorDeviceId: string;
  createdAt: string;
}>;

export function applyChatEvent(
  state: ChatThreadState,
  decryptedPayload: JsonValue,
  meta: ApplyChatEventMeta
): ChatThreadState {
  if (state.appliedEventIds.has(meta.eventId)) return state;

  const newApplied = new Set(state.appliedEventIds);
  newApplied.add(meta.eventId);

  switch (meta.kind) {
    case 'chat.thread.created':
      return applyThreadCreated(state, decryptedPayload, meta, newApplied);
    case 'chat.message.sent':
      return applyMessageSent(state, decryptedPayload, meta, newApplied);
    case 'chat.message.edited':
      return applyMessageEdited(state, decryptedPayload, meta, newApplied);
    case 'chat.message.deleted':
      return applyMessageDeleted(state, decryptedPayload, meta, newApplied);
    case 'chat.thread.accepted':
      return applyThreadAccepted(state, decryptedPayload, meta, newApplied);
    default:
      // Forward-compat: unknown chat event kinds pass through without
      // mutating state. Only the eventId is recorded.
      return Object.freeze({ ...state, appliedEventIds: Object.freeze(newApplied) });
  }
}

function applyThreadCreated(
  state: ChatThreadState,
  raw: JsonValue,
  meta: ApplyChatEventMeta,
  newApplied: Set<string>
): ChatThreadState {
  if (state.createdAt !== '') {
    throw new ChatProjectionError('CHAT_THREAD_ALREADY_EXISTS', meta.eventId);
  }
  const payload = validateThreadCreatedPayload(raw, meta.eventId);
  requireThreadIdMatch(state, payload.threadId, meta.eventId);
  return Object.freeze({
    ...state,
    participants: Object.freeze([...payload.participantIds]),
    ...(payload.threadName !== undefined ? { threadName: payload.threadName } : {}),
    createdAt: payload.createdAt,
    lastActivityAt: payload.createdAt,
    appliedEventIds: Object.freeze(newApplied)
  });
}

function applyMessageSent(
  state: ChatThreadState,
  raw: JsonValue,
  meta: ApplyChatEventMeta,
  newApplied: Set<string>
): ChatThreadState {
  requireThreadInitialized(state, meta.eventId);
  const payload = validateMessageSentPayload(raw, meta.eventId);
  requireThreadIdMatch(state, payload.threadId, meta.eventId);
  if (state.messages.has(payload.messageId)) {
    // True no-op: a duplicate messageId (replay or conflicting resend)
    // must not reorder the thread or mutate existing content. Only the
    // idempotency guard advances.
    return Object.freeze({ ...state, appliedEventIds: Object.freeze(newApplied) });
  }
  const newMessages = new Map(state.messages);
  newMessages.set(
    payload.messageId,
    Object.freeze({
      messageId: payload.messageId,
      authorDeviceId: meta.authorDeviceId,
      plaintextBody: payload.body,
      sentAt: payload.sentAt,
      deleted: false,
      ...(payload.replyToMessageId !== undefined
        ? { replyToMessageId: payload.replyToMessageId }
        : {})
    })
  );
  return Object.freeze({
    ...state,
    messages: Object.freeze(newMessages),
    lastActivityAt: payload.sentAt,
    appliedEventIds: Object.freeze(newApplied)
  });
}

function applyMessageEdited(
  state: ChatThreadState,
  raw: JsonValue,
  meta: ApplyChatEventMeta,
  newApplied: Set<string>
): ChatThreadState {
  requireThreadInitialized(state, meta.eventId);
  const payload = validateMessageEditedPayload(raw, meta.eventId);
  requireThreadIdMatch(state, payload.threadId, meta.eventId);
  const existing = state.messages.get(payload.messageId);
  if (existing === undefined) {
    throw new ChatProjectionError('CHAT_MESSAGE_NOT_FOUND', payload.messageId);
  }
  if (existing.deleted) {
    throw new ChatProjectionError('CHAT_MESSAGE_ALREADY_DELETED', payload.messageId);
  }
  const newMessages = new Map(state.messages);
  newMessages.set(
    payload.messageId,
    Object.freeze({
      ...existing,
      plaintextBody: payload.newBody,
      editedAt: payload.editedAt,
      ...(payload.editReason !== undefined ? { editReason: payload.editReason } : {})
    })
  );
  return Object.freeze({
    ...state,
    messages: Object.freeze(newMessages),
    lastActivityAt: payload.editedAt,
    appliedEventIds: Object.freeze(newApplied)
  });
}

function applyMessageDeleted(
  state: ChatThreadState,
  raw: JsonValue,
  meta: ApplyChatEventMeta,
  newApplied: Set<string>
): ChatThreadState {
  requireThreadInitialized(state, meta.eventId);
  const payload = validateMessageDeletedPayload(raw, meta.eventId);
  requireThreadIdMatch(state, payload.threadId, meta.eventId);
  const existing = state.messages.get(payload.messageId);
  if (existing === undefined) {
    throw new ChatProjectionError('CHAT_MESSAGE_NOT_FOUND', payload.messageId);
  }
  if (existing.deleted) {
    return Object.freeze({ ...state, appliedEventIds: Object.freeze(newApplied) });
  }
  const newMessages = new Map(state.messages);
  newMessages.set(
    payload.messageId,
    Object.freeze({
      ...existing,
      plaintextBody: '',
      deleted: true,
      deletedAt: payload.deletedAt
    })
  );
  return Object.freeze({
    ...state,
    messages: Object.freeze(newMessages),
    lastActivityAt: payload.deletedAt,
    appliedEventIds: Object.freeze(newApplied)
  });
}

function applyThreadAccepted(
  state: ChatThreadState,
  raw: JsonValue,
  meta: ApplyChatEventMeta,
  newApplied: Set<string>
): ChatThreadState {
  requireThreadInitialized(state, meta.eventId);
  const payload = validateThreadAcceptedPayload(raw, meta.eventId);
  requireThreadIdMatch(state, payload.threadId, meta.eventId);
  const newAccepted = new Set(state.acceptedBy);
  newAccepted.add(meta.authorDeviceId);
  return Object.freeze({
    ...state,
    acceptedBy: Object.freeze(newAccepted),
    lastActivityAt: payload.acceptedAt,
    appliedEventIds: Object.freeze(newApplied)
  });
}

// ---------------------------------------------------------------------------
// Decrypt-and-apply helper
// ---------------------------------------------------------------------------

export type DecryptAndApplyOptions = Readonly<{
  keyMaterial: string;
}>;

export async function decryptAndApplyChatEvent(
  state: ChatThreadState,
  event: SignedEventEnvelope,
  options: DecryptAndApplyOptions
): Promise<ChatThreadState> {
  if (!isChatEventKind(event.kind)) {
    throw new ChatProjectionError('CHAT_INVALID_KIND', event.kind);
  }
  if (event.privacy !== 'dm' && event.privacy !== 'group') {
    throw new ChatProjectionError('CHAT_INVALID_PRIVACY', event.privacy);
  }

  const context: PrivatePayloadAadContext = {
    eventId: event.eventId,
    kind: event.kind,
    author: event.author,
    deviceId: event.deviceId,
    createdAt: event.createdAt,
    privacy: event.privacy,
    schemaVersion: event.schemaVersion,
    ...(event.lamport !== undefined ? { lamport: event.lamport } : {}),
    ...(event.refs !== undefined ? { refs: event.refs } : {})
  };

  const decryptOptions: DecryptPrivatePayloadOptions = {
    envelope: event.payload as unknown as Parameters<typeof decryptPrivatePayload>[0]['envelope'],
    context,
    keyMaterial: options.keyMaterial
  };

  let decrypted: JsonValue;
  try {
    decrypted = await decryptPrivatePayload(decryptOptions);
  } catch {
    throw new ChatProjectionError('CHAT_DECRYPT_FAILED', event.eventId);
  }

  const meta: ApplyChatEventMeta = {
    eventId: event.eventId,
    kind: event.kind,
    authorDeviceId: event.deviceId,
    createdAt: event.createdAt
  };

  return applyChatEvent(state, decrypted, meta);
}

// ---------------------------------------------------------------------------
// AAD builder re-export (for callers building matching encrypt contexts)
// ---------------------------------------------------------------------------

export { buildPrivatePayloadAad };

// ---------------------------------------------------------------------------
// Payload validators (called at apply time — NOT at bridge admission time)
// ---------------------------------------------------------------------------

function requireString(raw: JsonValue, field: string, eventId: string): string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ChatProjectionError('CHAT_INVALID_PAYLOAD', `${eventId}: payload must be object`);
  }
  const value = (raw as Record<string, unknown>)[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ChatProjectionError('CHAT_INVALID_PAYLOAD', `${eventId}: ${field} must be non-empty string`);
  }
  return value;
}

function requireStringArray(raw: JsonValue, field: string, eventId: string): ReadonlyArray<string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ChatProjectionError('CHAT_INVALID_PAYLOAD', `${eventId}: payload must be object`);
  }
  const value = (raw as Record<string, unknown>)[field];
  if (!Array.isArray(value) || value.length === 0) {
    throw new ChatProjectionError('CHAT_INVALID_PAYLOAD', `${eventId}: ${field} must be non-empty array`);
  }
  return value.map((item, i) => {
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw new ChatProjectionError('CHAT_INVALID_PAYLOAD', `${eventId}: ${field}[${i}] must be non-empty string`);
    }
    return item;
  });
}

function optionalString(raw: JsonValue, field: string): string | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const value = (raw as Record<string, unknown>)[field];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function validateThreadCreatedPayload(raw: JsonValue, eventId: string): ChatThreadCreatedPayload {
  const threadName = optionalString(raw, 'threadName');
  return Object.freeze({
    threadId: requireString(raw, 'threadId', eventId),
    participantIds: requireStringArray(raw, 'participantIds', eventId),
    createdAt: requireString(raw, 'createdAt', eventId),
    ...(threadName !== undefined ? { threadName } : {})
  });
}

function validateMessageSentPayload(raw: JsonValue, eventId: string): ChatMessageSentPayload {
  const replyToMessageId = optionalString(raw, 'replyToMessageId');
  return Object.freeze({
    threadId: requireString(raw, 'threadId', eventId),
    messageId: requireString(raw, 'messageId', eventId),
    body: requireString(raw, 'body', eventId),
    sentAt: requireString(raw, 'sentAt', eventId),
    ...(replyToMessageId !== undefined ? { replyToMessageId } : {})
  });
}

function validateMessageEditedPayload(raw: JsonValue, eventId: string): ChatMessageEditedPayload {
  const editReason = optionalString(raw, 'editReason');
  return Object.freeze({
    threadId: requireString(raw, 'threadId', eventId),
    messageId: requireString(raw, 'messageId', eventId),
    newBody: requireString(raw, 'newBody', eventId),
    editedAt: requireString(raw, 'editedAt', eventId),
    ...(editReason !== undefined ? { editReason } : {})
  });
}

function validateMessageDeletedPayload(raw: JsonValue, eventId: string): ChatMessageDeletedPayload {
  return Object.freeze({
    threadId: requireString(raw, 'threadId', eventId),
    messageId: requireString(raw, 'messageId', eventId),
    deletedAt: requireString(raw, 'deletedAt', eventId)
  });
}

function validateThreadAcceptedPayload(raw: JsonValue, eventId: string): ChatThreadAcceptedPayload {
  return Object.freeze({
    threadId: requireString(raw, 'threadId', eventId),
    acceptedAt: requireString(raw, 'acceptedAt', eventId)
  });
}

function requireThreadInitialized(state: ChatThreadState, eventId: string): void {
  if (state.createdAt === '') {
    throw new ChatProjectionError('CHAT_THREAD_NOT_FOUND', eventId);
  }
}

/**
 * Guards against cross-thread state corruption: a decrypted payload's
 * `threadId` must match the thread state it is being applied to. Without
 * this, an event misrouted (or maliciously crafted) to carry a different
 * thread's id would silently mutate the wrong thread's projection.
 */
function requireThreadIdMatch(state: ChatThreadState, payloadThreadId: string, eventId: string): void {
  if (state.threadId !== payloadThreadId) {
    throw new ChatProjectionError(
      'CHAT_INVALID_PAYLOAD',
      `${eventId}: threadId mismatch: expected ${state.threadId}, got ${payloadThreadId}`
    );
  }
}
