export const MAILBOX_DELIVERY_ENVELOPE_SCHEMA_VERSION =
  'lfp2p.mailbox.delivery-envelope.v1' as const;
export const MAILBOX_RECEIPT_SCHEMA_VERSION = 'lfp2p.mailbox.receipt.v1' as const;
export const MAILBOX_ACK_SCHEMA_VERSION = 'lfp2p.mailbox.ack.v1' as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

export const MAILBOX_ERROR_CODES = Object.freeze({
  INVALID_ENVELOPE: 'MAILBOX_INVALID_ENVELOPE',
  INVALID_RECEIPT: 'MAILBOX_INVALID_RECEIPT',
  INVALID_ACK: 'MAILBOX_INVALID_ACK',
  INVALID_ROUTE_STATE: 'MAILBOX_INVALID_ROUTE_STATE',
  UNSUPPORTED_TRANSITION: 'MAILBOX_UNSUPPORTED_TRANSITION'
} as const);

export type MailboxErrorCode = (typeof MAILBOX_ERROR_CODES)[keyof typeof MAILBOX_ERROR_CODES];

export class MailboxRuntimeError extends Error {
  readonly code: MailboxErrorCode;

  constructor(code: MailboxErrorCode, message: string) {
    super(message);
    this.name = 'MailboxRuntimeError';
    this.code = code;
  }
}

export type MailboxRecipientKind = 'identity' | 'device' | 'group' | 'space' | 'channel';

export type MailboxRecipientScope = Readonly<{
  kind: MailboxRecipientKind;
  id: string;
}>;

export type MailboxDeliveryEnvelopeV1 = Readonly<{
  schemaVersion: typeof MAILBOX_DELIVERY_ENVELOPE_SCHEMA_VERSION;
  envelopeId: string;
  authorId: string;
  submitterId: string;
  recipientScopes: readonly MailboxRecipientScope[];
  conversationRef: string;
  payloadRef?: string;
  protectedInlinePayload?: JsonObject;
  createdAt: string;
  expiresAt?: string;
  routeHints: readonly string[];
  dedupeKey: string;
  signature?: string;
}>;

export type MailboxReceiptType =
  | 'provider.accepted'
  | 'provider.rejected'
  | 'provider.expired'
  | 'recipient.fetched'
  | 'recipient.rejected'
  | 'recipient.applied'
  | 'recipient.unreadable';

export type MailboxReceiptV1 = Readonly<{
  schemaVersion: typeof MAILBOX_RECEIPT_SCHEMA_VERSION;
  receiptId: string;
  envelopeId: string;
  receiptType: MailboxReceiptType;
  actorId: string;
  observedAt: string;
  routeHint?: string;
  reason?: string;
}>;

export type MailboxAckV1 = Readonly<{
  schemaVersion: typeof MAILBOX_ACK_SCHEMA_VERSION;
  ackId: string;
  envelopeId: string;
  receiptId: string;
  producerId: string;
  recipientId: string;
  deviceId: string;
  acknowledgedAt: string;
}>;

export type MailboxRouteStatus =
  | 'queued'
  | 'submitted'
  | 'provider.accepted'
  | 'provider.rejected'
  | 'fetched'
  | 'applied'
  | 'expired'
  | 'failed'
  | 'unreadable';

export type MailboxRouteState = Readonly<{
  envelopeId: string;
  status: MailboxRouteStatus;
  updatedAt: string;
  receiptIds: readonly string[];
}>;

const RECIPIENT_KINDS = new Set<MailboxRecipientKind>([
  'identity',
  'device',
  'group',
  'space',
  'channel'
]);
const RECEIPT_TYPES = new Set<MailboxReceiptType>([
  'provider.accepted',
  'provider.rejected',
  'provider.expired',
  'recipient.fetched',
  'recipient.rejected',
  'recipient.applied',
  'recipient.unreadable'
]);

const ROUTE_STATUSES = new Set<MailboxRouteStatus>([
  'queued',
  'submitted',
  'provider.accepted',
  'provider.rejected',
  'fetched',
  'applied',
  'expired',
  'failed',
  'unreadable'
]);

const STATUS_PRECEDENCE: Record<MailboxRouteStatus, number> = {
  queued: 0,
  submitted: 1,
  'provider.accepted': 2,
  'provider.rejected': 3,
  fetched: 4,
  expired: 5,
  unreadable: 5,
  failed: 5,
  applied: 6
};

export function createQueuedMailboxRouteState(
  envelopeId: string,
  createdAt: string
): MailboxRouteState {
  requireNonEmptyString(envelopeId, 'envelopeId', MAILBOX_ERROR_CODES.INVALID_ROUTE_STATE);
  requireNonEmptyString(createdAt, 'createdAt', MAILBOX_ERROR_CODES.INVALID_ROUTE_STATE);
  return freezeRouteState({
    envelopeId,
    status: 'queued',
    updatedAt: createdAt,
    receiptIds: []
  });
}

export function validateMailboxDeliveryEnvelope(input: unknown): MailboxDeliveryEnvelopeV1 {
  const value = requireRecord(
    input,
    MAILBOX_ERROR_CODES.INVALID_ENVELOPE,
    'envelope must be an object'
  );

  requireExact(
    value.schemaVersion,
    MAILBOX_DELIVERY_ENVELOPE_SCHEMA_VERSION,
    'schemaVersion',
    MAILBOX_ERROR_CODES.INVALID_ENVELOPE
  );
  requireNonEmptyString(value.envelopeId, 'envelopeId', MAILBOX_ERROR_CODES.INVALID_ENVELOPE);
  requireNonEmptyString(value.authorId, 'authorId', MAILBOX_ERROR_CODES.INVALID_ENVELOPE);
  requireNonEmptyString(value.submitterId, 'submitterId', MAILBOX_ERROR_CODES.INVALID_ENVELOPE);
  requireNonEmptyString(
    value.conversationRef,
    'conversationRef',
    MAILBOX_ERROR_CODES.INVALID_ENVELOPE
  );
  requireNonEmptyString(value.createdAt, 'createdAt', MAILBOX_ERROR_CODES.INVALID_ENVELOPE);
  requireNonEmptyString(value.dedupeKey, 'dedupeKey', MAILBOX_ERROR_CODES.INVALID_ENVELOPE);

  if (value.expiresAt !== undefined) {
    requireNonEmptyString(value.expiresAt, 'expiresAt', MAILBOX_ERROR_CODES.INVALID_ENVELOPE);
  }
  if (value.signature !== undefined) {
    requireNonEmptyString(value.signature, 'signature', MAILBOX_ERROR_CODES.INVALID_ENVELOPE);
  }

  const recipientScopes = validateRecipientScopes(value.recipientScopes);
  const routeHints = validateStringArray(
    value.routeHints,
    'routeHints',
    MAILBOX_ERROR_CODES.INVALID_ENVELOPE
  );

  const hasPayloadRef = typeof value.payloadRef === 'string' && value.payloadRef.length > 0;
  const hasInlinePayload = isRecord(value.protectedInlinePayload);
  if (!hasPayloadRef && !hasInlinePayload) {
    throw new MailboxRuntimeError(
      MAILBOX_ERROR_CODES.INVALID_ENVELOPE,
      'envelope must include payloadRef or protectedInlinePayload'
    );
  }
  if (value.payloadRef !== undefined) {
    requireNonEmptyString(value.payloadRef, 'payloadRef', MAILBOX_ERROR_CODES.INVALID_ENVELOPE);
  }

  return deepFreeze({
    schemaVersion: MAILBOX_DELIVERY_ENVELOPE_SCHEMA_VERSION,
    envelopeId: value.envelopeId,
    authorId: value.authorId,
    submitterId: value.submitterId,
    recipientScopes,
    conversationRef: value.conversationRef,
    ...(value.payloadRef !== undefined ? { payloadRef: value.payloadRef } : {}),
    ...(value.protectedInlinePayload !== undefined
      ? { protectedInlinePayload: cloneJsonObject(value.protectedInlinePayload) }
      : {}),
    createdAt: value.createdAt,
    ...(value.expiresAt !== undefined ? { expiresAt: value.expiresAt } : {}),
    routeHints,
    dedupeKey: value.dedupeKey,
    ...(value.signature !== undefined ? { signature: value.signature } : {})
  });
}

export function validateMailboxReceipt(input: unknown): MailboxReceiptV1 {
  const value = requireRecord(
    input,
    MAILBOX_ERROR_CODES.INVALID_RECEIPT,
    'receipt must be an object'
  );
  requireExact(
    value.schemaVersion,
    MAILBOX_RECEIPT_SCHEMA_VERSION,
    'schemaVersion',
    MAILBOX_ERROR_CODES.INVALID_RECEIPT
  );
  requireNonEmptyString(value.receiptId, 'receiptId', MAILBOX_ERROR_CODES.INVALID_RECEIPT);
  requireNonEmptyString(value.envelopeId, 'envelopeId', MAILBOX_ERROR_CODES.INVALID_RECEIPT);
  requireNonEmptyString(value.actorId, 'actorId', MAILBOX_ERROR_CODES.INVALID_RECEIPT);
  requireNonEmptyString(value.observedAt, 'observedAt', MAILBOX_ERROR_CODES.INVALID_RECEIPT);

  if (
    typeof value.receiptType !== 'string' ||
    !RECEIPT_TYPES.has(value.receiptType as MailboxReceiptType)
  ) {
    throw new MailboxRuntimeError(MAILBOX_ERROR_CODES.INVALID_RECEIPT, 'unsupported receiptType');
  }
  if (value.routeHint !== undefined) {
    requireNonEmptyString(value.routeHint, 'routeHint', MAILBOX_ERROR_CODES.INVALID_RECEIPT);
  }
  if (value.reason !== undefined) {
    requireNonEmptyString(value.reason, 'reason', MAILBOX_ERROR_CODES.INVALID_RECEIPT);
  }

  return deepFreeze({
    schemaVersion: MAILBOX_RECEIPT_SCHEMA_VERSION,
    receiptId: value.receiptId,
    envelopeId: value.envelopeId,
    receiptType: value.receiptType as MailboxReceiptType,
    actorId: value.actorId,
    observedAt: value.observedAt,
    ...(value.routeHint !== undefined ? { routeHint: value.routeHint } : {}),
    ...(value.reason !== undefined ? { reason: value.reason } : {})
  });
}

export function validateMailboxAck(input: unknown): MailboxAckV1 {
  const value = requireRecord(input, MAILBOX_ERROR_CODES.INVALID_ACK, 'ack must be an object');
  requireExact(
    value.schemaVersion,
    MAILBOX_ACK_SCHEMA_VERSION,
    'schemaVersion',
    MAILBOX_ERROR_CODES.INVALID_ACK
  );
  requireNonEmptyString(value.ackId, 'ackId', MAILBOX_ERROR_CODES.INVALID_ACK);
  requireNonEmptyString(value.envelopeId, 'envelopeId', MAILBOX_ERROR_CODES.INVALID_ACK);
  requireNonEmptyString(value.receiptId, 'receiptId', MAILBOX_ERROR_CODES.INVALID_ACK);
  requireNonEmptyString(value.producerId, 'producerId', MAILBOX_ERROR_CODES.INVALID_ACK);
  requireNonEmptyString(value.recipientId, 'recipientId', MAILBOX_ERROR_CODES.INVALID_ACK);
  requireNonEmptyString(value.deviceId, 'deviceId', MAILBOX_ERROR_CODES.INVALID_ACK);
  requireNonEmptyString(value.acknowledgedAt, 'acknowledgedAt', MAILBOX_ERROR_CODES.INVALID_ACK);

  return deepFreeze({
    schemaVersion: MAILBOX_ACK_SCHEMA_VERSION,
    ackId: value.ackId,
    envelopeId: value.envelopeId,
    receiptId: value.receiptId,
    producerId: value.producerId,
    recipientId: value.recipientId,
    deviceId: value.deviceId,
    acknowledgedAt: value.acknowledgedAt
  });
}

export function applyMailboxReceiptToRouteState(
  state: MailboxRouteState,
  receipt: MailboxReceiptV1
): MailboxRouteState {
  validateRouteState(state);
  const validReceipt = validateMailboxReceipt(receipt);

  if (state.envelopeId !== validReceipt.envelopeId) {
    throw new MailboxRuntimeError(
      MAILBOX_ERROR_CODES.UNSUPPORTED_TRANSITION,
      'receipt envelopeId does not match route state'
    );
  }
  if (state.receiptIds.includes(validReceipt.receiptId)) {
    return state;
  }

  const nextStatus = receiptTypeToStatus(validReceipt.receiptType);
  const currentPrecedence = STATUS_PRECEDENCE[state.status];
  const nextPrecedence = STATUS_PRECEDENCE[nextStatus];

  let status = state.status;
  let updatedAt = state.updatedAt;

  if (nextPrecedence > currentPrecedence) {
    status = nextStatus;
    updatedAt = validReceipt.observedAt;
  } else if (
    nextPrecedence === currentPrecedence &&
    isNewerTimestamp(validReceipt.observedAt, state.updatedAt)
  ) {
    updatedAt = validReceipt.observedAt;
  }

  return freezeRouteState({
    envelopeId: state.envelopeId,
    status,
    updatedAt,
    receiptIds: [...state.receiptIds, validReceipt.receiptId]
  });
}

function validateRouteState(state: MailboxRouteState): void {
  requireNonEmptyString(state.envelopeId, 'envelopeId', MAILBOX_ERROR_CODES.INVALID_ROUTE_STATE);
  requireNonEmptyString(state.updatedAt, 'updatedAt', MAILBOX_ERROR_CODES.INVALID_ROUTE_STATE);
  if (!ROUTE_STATUSES.has(state.status)) {
    throw new MailboxRuntimeError(MAILBOX_ERROR_CODES.INVALID_ROUTE_STATE, 'status is unsupported');
  }
  validateStringArray(state.receiptIds, 'receiptIds', MAILBOX_ERROR_CODES.INVALID_ROUTE_STATE);
}

function receiptTypeToStatus(type: MailboxReceiptType): MailboxRouteStatus {
  switch (type) {
    case 'provider.accepted':
      return 'provider.accepted';
    case 'provider.rejected':
      return 'provider.rejected';
    case 'provider.expired':
      return 'expired';
    case 'recipient.fetched':
      return 'fetched';
    case 'recipient.rejected':
      return 'failed';
    case 'recipient.applied':
      return 'applied';
    case 'recipient.unreadable':
      return 'unreadable';
  }
}

function isNewerTimestamp(candidate: string, current: string): boolean {
  const candidateMs = Date.parse(candidate);
  const currentMs = Date.parse(current);
  return !Number.isNaN(candidateMs) && (Number.isNaN(currentMs) || candidateMs > currentMs);
}

function validateRecipientScopes(input: unknown): readonly MailboxRecipientScope[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new MailboxRuntimeError(
      MAILBOX_ERROR_CODES.INVALID_ENVELOPE,
      'recipientScopes must be a non-empty array'
    );
  }

  return deepFreeze(
    input.map((scope, index) => {
      const value = requireRecord(
        scope,
        MAILBOX_ERROR_CODES.INVALID_ENVELOPE,
        `recipientScopes[${index}] must be an object`
      );
      if (
        typeof value.kind !== 'string' ||
        !RECIPIENT_KINDS.has(value.kind as MailboxRecipientKind)
      ) {
        throw new MailboxRuntimeError(
          MAILBOX_ERROR_CODES.INVALID_ENVELOPE,
          `recipientScopes[${index}].kind is unsupported`
        );
      }
      requireNonEmptyString(
        value.id,
        `recipientScopes[${index}].id`,
        MAILBOX_ERROR_CODES.INVALID_ENVELOPE
      );
      return deepFreeze({
        kind: value.kind as MailboxRecipientKind,
        id: value.id
      });
    })
  );
}

function validateStringArray(
  input: unknown,
  field: string,
  code: MailboxErrorCode
): readonly string[] {
  if (!Array.isArray(input)) {
    throw new MailboxRuntimeError(code, `${field} must be an array`);
  }
  for (const [index, item] of input.entries()) {
    requireNonEmptyString(item, `${field}[${index}]`, code);
  }
  return deepFreeze([...input]);
}

function requireRecord(
  input: unknown,
  code: MailboxErrorCode,
  message: string
): Record<string, unknown> {
  if (!isRecord(input)) {
    throw new MailboxRuntimeError(code, message);
  }
  return input;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(input);
  return prototype === null || prototype === Object.prototype;
}

function requireNonEmptyString(
  input: unknown,
  field: string,
  code: MailboxErrorCode
): asserts input is string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new MailboxRuntimeError(code, `${field} must be a non-empty string`);
  }
}

function requireExact(
  input: unknown,
  expected: string,
  field: string,
  code: MailboxErrorCode
): void {
  if (input !== expected) {
    throw new MailboxRuntimeError(code, `${field} must be ${expected}`);
  }
}

function cloneJsonObject(input: unknown): JsonObject {
  if (!isRecord(input)) {
    throw new MailboxRuntimeError(
      MAILBOX_ERROR_CODES.INVALID_ENVELOPE,
      'protectedInlinePayload must be a plain object'
    );
  }
  return deepFreeze(JSON.parse(JSON.stringify(input)) as JsonObject);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return value;
}

function freezeRouteState(state: MailboxRouteState): MailboxRouteState {
  return deepFreeze({ ...state, receiptIds: [...state.receiptIds] });
}
