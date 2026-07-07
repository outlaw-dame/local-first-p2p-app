import { describe, expect, it } from 'vitest';
import {
  applyMailboxReceiptToRouteState,
  createQueuedMailboxRouteState,
  MAILBOX_ACK_SCHEMA_VERSION,
  MAILBOX_DELIVERY_ENVELOPE_SCHEMA_VERSION,
  MAILBOX_ERROR_CODES,
  MAILBOX_RECEIPT_SCHEMA_VERSION,
  MailboxRuntimeError,
  validateMailboxAck,
  validateMailboxDeliveryEnvelope,
  validateMailboxReceipt,
  type MailboxDeliveryEnvelopeV1,
  type MailboxReceiptV1
} from './index.js';

const T0 = '2026-06-30T00:00:00.000Z';
const T1 = '2026-06-30T00:01:00.000Z';
const ENVELOPE_ID = 'mailbox:envelope:alpha';

function envelope(overrides: Partial<MailboxDeliveryEnvelopeV1> = {}): MailboxDeliveryEnvelopeV1 {
  return {
    schemaVersion: MAILBOX_DELIVERY_ENVELOPE_SCHEMA_VERSION,
    envelopeId: ENVELOPE_ID,
    authorId: 'identity:alice',
    submitterId: 'device:alice-phone',
    recipientScopes: [{ kind: 'device', id: 'device:bob-laptop' }],
    conversationRef: 'thread:alpha',
    payloadRef: 'object:payload:alpha',
    createdAt: T0,
    routeHints: ['bridge:primary'],
    dedupeKey: 'dedupe:alpha',
    signature: 'sig:alpha',
    ...overrides
  };
}

function receipt(overrides: Partial<MailboxReceiptV1> = {}): MailboxReceiptV1 {
  return {
    schemaVersion: MAILBOX_RECEIPT_SCHEMA_VERSION,
    receiptId: 'receipt:alpha',
    envelopeId: ENVELOPE_ID,
    receiptType: 'provider.accepted',
    actorId: 'bridge:primary',
    observedAt: T1,
    ...overrides
  };
}

function expectMailboxError(fn: () => unknown, code: string): void {
  expect(fn).toThrow(MailboxRuntimeError);
  try {
    fn();
  } catch (error) {
    expect((error as MailboxRuntimeError).code).toBe(code);
  }
}

describe('validateMailboxDeliveryEnvelope', () => {
  it('accepts and freezes a valid envelope with a payload ref', () => {
    const validated = validateMailboxDeliveryEnvelope(envelope());

    expect(validated.schemaVersion).toBe(MAILBOX_DELIVERY_ENVELOPE_SCHEMA_VERSION);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.recipientScopes)).toBe(true);
    expect(Object.isFrozen(validated.routeHints)).toBe(true);
  });

  it('accepts protected inline payloads without requiring a payload ref', () => {
    const validated = validateMailboxDeliveryEnvelope(
      envelope({ payloadRef: undefined, protectedInlinePayload: { ciphertextRef: 'payload:sealed' } })
    );

    expect(validated.payloadRef).toBeUndefined();
    expect(validated.protectedInlinePayload?.ciphertextRef).toBe('payload:sealed');
    expect(Object.isFrozen(validated.protectedInlinePayload)).toBe(true);
  });

  it('does not freeze caller-owned inline payload objects', () => {
    const callerPayload = { ciphertextRef: 'payload:sealed' };
    const validated = validateMailboxDeliveryEnvelope(
      envelope({
        payloadRef: undefined,
        protectedInlinePayload: callerPayload
      })
    );
    expect(Object.isFrozen(validated.protectedInlinePayload)).toBe(true);
    expect(Object.isFrozen(callerPayload)).toBe(false);
    callerPayload.ciphertextRef = 'payload:changed';
    expect(validated.protectedInlinePayload?.ciphertextRef).toBe('payload:sealed');
  });

  it('rejects non-plain inline payload objects', () => {
    expectMailboxError(
      () =>
        validateMailboxDeliveryEnvelope(
          envelope({
            payloadRef: undefined,
            protectedInlinePayload: new Date() as unknown as MailboxDeliveryEnvelopeV1['protectedInlinePayload']
          })
        ),
      MAILBOX_ERROR_CODES.INVALID_ENVELOPE
    );
  });

  it('requires schemaVersion for upgrade-safe envelopes', () => {
    const invalid = { ...envelope(), schemaVersion: 'old' };

    expectMailboxError(() => validateMailboxDeliveryEnvelope(invalid), MAILBOX_ERROR_CODES.INVALID_ENVELOPE);
  });

  it('rejects empty recipient scopes', () => {
    expectMailboxError(
      () => validateMailboxDeliveryEnvelope(envelope({ recipientScopes: [] })),
      MAILBOX_ERROR_CODES.INVALID_ENVELOPE
    );
  });

  it('rejects envelopes without any payload carrier', () => {
    expectMailboxError(
      () => validateMailboxDeliveryEnvelope(envelope({ payloadRef: undefined, protectedInlinePayload: undefined })),
      MAILBOX_ERROR_CODES.INVALID_ENVELOPE
    );
  });
});

describe('validateMailboxReceipt', () => {
  it('accepts a valid provider receipt', () => {
    const validated = validateMailboxReceipt(receipt());

    expect(validated.schemaVersion).toBe(MAILBOX_RECEIPT_SCHEMA_VERSION);
    expect(Object.isFrozen(validated)).toBe(true);
  });

  it('preserves receipt-specific error codes for bad schema versions', () => {
    expectMailboxError(
      () => validateMailboxReceipt(receipt({ schemaVersion: 'old' as typeof MAILBOX_RECEIPT_SCHEMA_VERSION })),
      MAILBOX_ERROR_CODES.INVALID_RECEIPT
    );
  });

  it('rejects unsupported receipt transitions', () => {
    expectMailboxError(
      () => validateMailboxReceipt(receipt({ receiptType: 'recipient.read' as MailboxReceiptV1['receiptType'] })),
      MAILBOX_ERROR_CODES.INVALID_RECEIPT
    );
  });
});

describe('validateMailboxAck', () => {
  it('accepts a valid acknowledgement', () => {
    const ack = validateMailboxAck({
      schemaVersion: MAILBOX_ACK_SCHEMA_VERSION,
      ackId: 'ack:alpha',
      envelopeId: ENVELOPE_ID,
      receiptId: 'receipt:alpha',
      producerId: 'identity:alice',
      recipientId: 'identity:bob',
      deviceId: 'device:bob-laptop',
      acknowledgedAt: T1
    });

    expect(ack.schemaVersion).toBe(MAILBOX_ACK_SCHEMA_VERSION);
    expect(Object.isFrozen(ack)).toBe(true);
  });

  it('preserves ack-specific error codes for bad schema versions', () => {
    expectMailboxError(
      () =>
        validateMailboxAck({
          schemaVersion: 'old',
          ackId: 'ack:alpha',
          envelopeId: ENVELOPE_ID,
          receiptId: 'receipt:alpha',
          producerId: 'identity:alice',
          recipientId: 'identity:bob',
          deviceId: 'device:bob-laptop',
          acknowledgedAt: T1
        }),
      MAILBOX_ERROR_CODES.INVALID_ACK
    );
  });
});

describe('mailbox route state transitions', () => {
  it('creates frozen queued route state', () => {
    const state = createQueuedMailboxRouteState(ENVELOPE_ID, T0);

    expect(state.status).toBe('queued');
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.receiptIds)).toBe(true);
  });

  it('provider acceptance does not imply recipient apply', () => {
    const initial = createQueuedMailboxRouteState(ENVELOPE_ID, T0);
    const next = applyMailboxReceiptToRouteState(initial, receipt());

    expect(next.status).toBe('provider.accepted');
    expect(next.status).not.toBe('applied');
    expect(next.receiptIds).toEqual(['receipt:alpha']);
  });

  it('recipient applied is a distinct transition', () => {
    const initial = createQueuedMailboxRouteState(ENVELOPE_ID, T0);
    const next = applyMailboxReceiptToRouteState(
      initial,
      receipt({ receiptId: 'receipt:applied', receiptType: 'recipient.applied' })
    );

    expect(next.status).toBe('applied');
  });

  it('duplicate receipts are idempotent', () => {
    const initial = createQueuedMailboxRouteState(ENVELOPE_ID, T0);
    const first = applyMailboxReceiptToRouteState(initial, receipt());
    const second = applyMailboxReceiptToRouteState(first, receipt());

    expect(second).toBe(first);
    expect(second.receiptIds).toEqual(['receipt:alpha']);
  });

  it('rejects receipts for another envelope', () => {
    const initial = createQueuedMailboxRouteState(ENVELOPE_ID, T0);

    expectMailboxError(
      () => applyMailboxReceiptToRouteState(initial, receipt({ envelopeId: 'mailbox:envelope:other' })),
      MAILBOX_ERROR_CODES.UNSUPPORTED_TRANSITION
    );
  });

  it('does not regress from recipient applied to provider accepted when receipts arrive out of order', () => {
    const initial = createQueuedMailboxRouteState(ENVELOPE_ID, T0);
    const applied = applyMailboxReceiptToRouteState(
      initial,
      receipt({
        receiptId: 'receipt:applied',
        receiptType: 'recipient.applied',
        observedAt: '2026-06-30T00:05:00.000Z'
      })
    );
    const lateProviderAccepted = applyMailboxReceiptToRouteState(
      applied,
      receipt({
        receiptId: 'receipt:late-provider-accepted',
        receiptType: 'provider.accepted',
        observedAt: '2026-06-30T00:01:00.000Z'
      })
    );
    expect(lateProviderAccepted.status).toBe('applied');
    expect(lateProviderAccepted.updatedAt).toBe('2026-06-30T00:05:00.000Z');
    expect(lateProviderAccepted.receiptIds).toEqual([
      'receipt:applied',
      'receipt:late-provider-accepted'
    ]);
  });

  it('does not regress updatedAt for equal-precedence stale receipts', () => {
    const initial = createQueuedMailboxRouteState(ENVELOPE_ID, T0);
    const first = applyMailboxReceiptToRouteState(
      initial,
      receipt({
        receiptId: 'receipt:failed-newer',
        receiptType: 'recipient.rejected',
        observedAt: '2026-06-30T00:05:00.000Z'
      })
    );
    const staleSamePrecedence = applyMailboxReceiptToRouteState(
      first,
      receipt({
        receiptId: 'receipt:failed-older',
        receiptType: 'provider.expired',
        observedAt: '2026-06-30T00:02:00.000Z'
      })
    );
    expect(staleSamePrecedence.status).toBe('failed');
    expect(staleSamePrecedence.updatedAt).toBe('2026-06-30T00:05:00.000Z');
  });
});
