import { describe, expect, it } from 'vitest';
import {
  applyMailboxEvent,
  createEmptyMailboxState,
  isMailboxEventKind,
  MAILBOX_EVENT_KINDS,
  MailboxProjectionError
} from '../index.js';
import type { ApplyMailboxEventMeta, MailboxDeliveryEnvelope, MailboxState } from '../index.js';

const ALICE = 'identity:alice';
const BOB = 'identity:bob';

let seq = 0;
function meta(
  kind: ApplyMailboxEventMeta['kind'],
  overrides: Partial<ApplyMailboxEventMeta> = {}
): ApplyMailboxEventMeta {
  seq += 1;
  return {
    kind,
    eventId: overrides.eventId ?? `evt_${seq}`,
    createdAt: overrides.createdAt ?? `2026-07-03T00:00:${String(seq % 60).padStart(2, '0')}.000Z`
  };
}

function envelope(overrides: Partial<MailboxDeliveryEnvelope> = {}): MailboxDeliveryEnvelope {
  return {
    envelopeId: overrides.envelopeId ?? 'env1',
    recipientIdentityId: overrides.recipientIdentityId ?? BOB,
    senderIdentityId: overrides.senderIdentityId ?? ALICE,
    contentRef: overrides.contentRef ?? 'sha-256:abc',
    expiresAt: overrides.expiresAt ?? '2026-08-01T00:00:00.000Z',
    ...(overrides.recipientDeviceId === undefined
      ? {}
      : { recipientDeviceId: overrides.recipientDeviceId }),
    ...(overrides.forwardedFrom === undefined ? {} : { forwardedFrom: overrides.forwardedFrom })
  };
}

type Event = { payload: unknown; meta: ApplyMailboxEventMeta };
function fold(identityId: string, events: Event[]): MailboxState {
  let state = createEmptyMailboxState(identityId);
  for (const e of events) state = applyMailboxEvent(state, e.payload as never, e.meta);
  return state;
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(MailboxProjectionError);
    expect((error as MailboxProjectionError).code).toBe(code);
    return;
  }
  throw new Error(`expected throw with ${code}`);
}

describe('mailbox event kind guard', () => {
  it('recognizes exactly the seven mailbox.* kinds', () => {
    expect(MAILBOX_EVENT_KINDS).toHaveLength(7);
    for (const k of MAILBOX_EVENT_KINDS) expect(isMailboxEventKind(k)).toBe(true);
    expect(isMailboxEventKind('udr.space.joined')).toBe(false);
  });
});

describe('inbox lifecycle (recipient view)', () => {
  it('queued → delivered → fetched', () => {
    const env = envelope({ envelopeId: 'e1' });
    const s = fold(BOB, [
      { payload: env, meta: meta('mailbox.envelope.queued') },
      {
        payload: { envelopeId: 'e1', deliveredAt: 'd', providerId: 'p1' },
        meta: meta('mailbox.envelope.delivered')
      },
      {
        payload: { envelopeId: 'e1', fetchedAt: 'f', recipientDeviceId: 'device:bob-1' },
        meta: meta('mailbox.envelope.fetched')
      }
    ]);
    const entry = s.inbox.get('e1');
    expect(entry?.status).toBe('fetched');
    expect(entry?.deliveredAt).toBe('d');
    expect(entry?.fetchedAt).toBe('f');
    expect(s.outbox.size).toBe(0); // recipient has no outbox entry
  });

  it('double-fetch is idempotent (distinct eventIds)', () => {
    const env = envelope({ envelopeId: 'e1' });
    const s = fold(BOB, [
      { payload: env, meta: meta('mailbox.envelope.queued') },
      {
        payload: { envelopeId: 'e1', fetchedAt: 'f1', recipientDeviceId: 'd' },
        meta: meta('mailbox.envelope.fetched')
      },
      {
        payload: { envelopeId: 'e1', fetchedAt: 'f2', recipientDeviceId: 'd' },
        meta: meta('mailbox.envelope.fetched')
      }
    ]);
    const entry = s.inbox.get('e1');
    expect(entry?.status).toBe('fetched');
    expect(entry?.fetchedAt).toBe('f2'); // last-applied wins under ordered replay
  });

  it('expiry is terminal — a later delivered/fetched is a no-op', () => {
    const env = envelope({ envelopeId: 'e1' });
    const s = fold(BOB, [
      { payload: env, meta: meta('mailbox.envelope.queued') },
      {
        payload: { envelopeId: 'e1', expiredAt: 'x', reason: 'ttl' },
        meta: meta('mailbox.envelope.expired')
      },
      { payload: { envelopeId: 'e1', deliveredAt: 'd' }, meta: meta('mailbox.envelope.delivered') },
      {
        payload: { envelopeId: 'e1', fetchedAt: 'f', recipientDeviceId: 'd' },
        meta: meta('mailbox.envelope.fetched')
      }
    ]);
    const entry = s.inbox.get('e1');
    expect(entry?.status).toBe('expired');
    expect(entry?.expiredReason).toBe('ttl');
    expect(entry?.deliveredAt).toBeUndefined();
    expect(entry?.fetchedAt).toBeUndefined();
  });

  it('records receipts on the inbox entry, idempotent by receiptId', () => {
    const env = envelope({ envelopeId: 'e1' });
    const s = fold(BOB, [
      { payload: env, meta: meta('mailbox.envelope.queued') },
      {
        payload: {
          envelopeId: 'e1',
          receiptId: 'r1',
          receiptKind: 'recipient-fetched',
          issuedAt: 't'
        },
        meta: meta('mailbox.receipt.issued')
      },
      {
        payload: {
          envelopeId: 'e1',
          receiptId: 'r1',
          receiptKind: 'recipient-fetched',
          issuedAt: 't'
        },
        meta: meta('mailbox.receipt.issued')
      }
    ]);
    expect(s.inbox.get('e1')?.receipts).toHaveLength(1);
  });
});

describe('outbox lifecycle (sender view)', () => {
  it('sender projects queued → delivered and resolves via ack', () => {
    const env = envelope({ envelopeId: 'e1' });
    const s = fold(ALICE, [
      { payload: env, meta: meta('mailbox.envelope.queued') },
      {
        payload: { envelopeId: 'e1', deliveredAt: 'd', providerId: 'p1' },
        meta: meta('mailbox.envelope.delivered')
      },
      {
        payload: { envelopeId: 'e1', ackId: 'a1', ackKind: 'applied', sentAt: 't' },
        meta: meta('mailbox.ack.sent')
      }
    ]);
    const entry = s.outbox.get('e1');
    expect(entry?.status).toBe('delivered');
    expect(entry?.providerId).toBe('p1');
    expect(entry?.ack?.ackKind).toBe('applied');
    expect(s.inbox.size).toBe(0); // sender has no inbox entry
  });

  it('self-to-self envelope populates both inbox and outbox', () => {
    const env = envelope({ envelopeId: 'e1', senderIdentityId: ALICE, recipientIdentityId: ALICE });
    const s = fold(ALICE, [{ payload: env, meta: meta('mailbox.envelope.queued') }]);
    expect(s.inbox.has('e1')).toBe(true);
    expect(s.outbox.has('e1')).toBe(true);
  });
});

describe('checkpoints', () => {
  it('tracks the latest checkpoint per mailboxId', () => {
    const s = fold(BOB, [
      {
        payload: { mailboxId: 'mb1', checkpointId: 'c1', cursor: '10', advancedAt: 't1' },
        meta: meta('mailbox.checkpoint.advanced')
      },
      {
        payload: { mailboxId: 'mb1', checkpointId: 'c2', cursor: '20', advancedAt: 't2' },
        meta: meta('mailbox.checkpoint.advanced')
      }
    ]);
    expect(s.checkpoints.get('mb1')?.cursor).toBe('20');
  });
});

describe('idempotency, ordering, replay', () => {
  it('re-applying the same eventId is a no-op', () => {
    const env = envelope({ envelopeId: 'e1' });
    const start = createEmptyMailboxState(BOB);
    const m = meta('mailbox.envelope.queued', { eventId: 'fixed' });
    const once = applyMailboxEvent(start, env, m);
    const twice = applyMailboxEvent(once, env, m);
    expect(twice).toBe(once);
  });

  it('out-of-order: delivered before queued is a no-op, recovered by ordered replay', () => {
    const env = envelope({ envelopeId: 'e1' });
    // Out-of-order arrival (delivered first).
    const outOfOrder = fold(BOB, [
      {
        payload: { envelopeId: 'e1', deliveredAt: 'd' },
        meta: meta('mailbox.envelope.delivered', {
          eventId: 'e-del',
          createdAt: '2026-07-03T00:00:05.000Z'
        })
      },
      {
        payload: env,
        meta: meta('mailbox.envelope.queued', {
          eventId: 'e-q',
          createdAt: '2026-07-03T00:00:01.000Z'
        })
      }
    ]);
    // Incremental append saw delivered-before-queued: delivered was a
    // no-op (no entry), then queued created it at 'queued'.
    expect(outOfOrder.inbox.get('e1')?.status).toBe('queued');

    // Authoritative rebuild replays in (createdAt, eventId) order → queued then delivered.
    const ordered = fold(BOB, [
      {
        payload: env,
        meta: meta('mailbox.envelope.queued', {
          eventId: 'e-q',
          createdAt: '2026-07-03T00:00:01.000Z'
        })
      },
      {
        payload: { envelopeId: 'e1', deliveredAt: 'd' },
        meta: meta('mailbox.envelope.delivered', {
          eventId: 'e-del',
          createdAt: '2026-07-03T00:00:05.000Z'
        })
      }
    ]);
    expect(ordered.inbox.get('e1')?.status).toBe('delivered');
  });

  it('replay equivalence: same ordered log twice yields equal state', () => {
    const env = envelope({ envelopeId: 'e1' });
    const log: Event[] = [
      { payload: env, meta: meta('mailbox.envelope.queued', { eventId: 'q' }) },
      {
        payload: { envelopeId: 'e1', deliveredAt: 'd' },
        meta: meta('mailbox.envelope.delivered', { eventId: 'd1' })
      },
      {
        payload: { envelopeId: 'e1', fetchedAt: 'f', recipientDeviceId: 'x' },
        meta: meta('mailbox.envelope.fetched', { eventId: 'f1' })
      }
    ];
    const a = fold(BOB, log);
    const b = fold(BOB, log);
    expect(a.inbox.get('e1')).toEqual(b.inbox.get('e1'));
    expect(a.updatedAt).toBe(b.updatedAt);
    expect([...a.appliedEventIds].sort()).toEqual([...b.appliedEventIds].sort());
  });
});

describe('immutability (Phase 3.2)', () => {
  it('freezes state and its collections and blocks Map/Set mutation', () => {
    const s = fold(BOB, [
      { payload: envelope({ envelopeId: 'e1' }), meta: meta('mailbox.envelope.queued') }
    ]);
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.isFrozen(s.inbox)).toBe(true);
    expect(() => (s.inbox as Map<string, unknown>).set('evil', {})).toThrow(/read-only/);
    expect(() => (s.inbox as Map<string, unknown>).delete('e1')).toThrow(/read-only/);
    expect(() => (s.appliedEventIds as Set<string>).add('x')).toThrow(/read-only/);
  });
});

describe('IDOR / recipient-mismatch guard', () => {
  it('rejects a queued envelope where the identity is neither sender nor recipient', () => {
    const env = envelope({ envelopeId: 'e1', senderIdentityId: ALICE, recipientIdentityId: BOB });
    // Mallory is neither party.
    expectCode(
      () =>
        applyMailboxEvent(
          createEmptyMailboxState('identity:mallory'),
          env,
          meta('mailbox.envelope.queued')
        ),
      'MAILBOX_RECIPIENT_MISMATCH'
    );
  });

  it('a lifecycle event for an unknown envelope cannot inject foreign state', () => {
    // No queued was ever seen → delivered/fetched/expired are pure no-ops,
    // so a stray lifecycle event cannot create an inbox/outbox entry.
    const s = fold(BOB, [
      {
        payload: { envelopeId: 'ghost', deliveredAt: 'd' },
        meta: meta('mailbox.envelope.delivered')
      },
      {
        payload: { envelopeId: 'ghost', fetchedAt: 'f', recipientDeviceId: 'x' },
        meta: meta('mailbox.envelope.fetched')
      },
      {
        payload: {
          envelopeId: 'ghost',
          receiptId: 'r',
          receiptKind: 'recipient-applied',
          issuedAt: 't'
        },
        meta: meta('mailbox.receipt.issued')
      }
    ]);
    expect(s.inbox.size).toBe(0);
    expect(s.outbox.size).toBe(0);
  });
});

describe('adversarial payloads', () => {
  const start = () => createEmptyMailboxState(BOB);

  it('rejects unknown kinds', () => {
    expectCode(
      () =>
        applyMailboxEvent(
          start(),
          {},
          { kind: 'mailbox.bogus' as never, eventId: 'e', createdAt: 't' }
        ),
      'MAILBOX_UNKNOWN_KIND'
    );
  });

  it('rejects non-object / array payloads and empty meta fields', () => {
    expectCode(
      () => applyMailboxEvent(start(), 'x' as never, meta('mailbox.envelope.delivered')),
      'MAILBOX_INVALID_PAYLOAD'
    );
    expectCode(
      () => applyMailboxEvent(start(), [] as never, meta('mailbox.envelope.delivered')),
      'MAILBOX_INVALID_PAYLOAD'
    );
    expectCode(
      () =>
        applyMailboxEvent(
          start(),
          { envelopeId: 'e', deliveredAt: 'd' },
          { kind: 'mailbox.envelope.delivered', eventId: '', createdAt: 't' }
        ),
      'MAILBOX_INVALID_PAYLOAD'
    );
    expectCode(
      () =>
        applyMailboxEvent(
          start(),
          { envelopeId: 'e', deliveredAt: 'd' },
          { kind: 'mailbox.envelope.delivered', eventId: 'e', createdAt: '' }
        ),
      'MAILBOX_INVALID_PAYLOAD'
    );
  });

  it('rejects malformed envelopes and bad enum values', () => {
    expectCode(
      () => applyMailboxEvent(start(), { envelopeId: 'e1' }, meta('mailbox.envelope.queued')),
      'MAILBOX_INVALID_PAYLOAD'
    );
    // Bad expiry reason enum.
    const env = envelope({ envelopeId: 'e1' });
    const s = fold(BOB, [{ payload: env, meta: meta('mailbox.envelope.queued') }]);
    expectCode(
      () =>
        applyMailboxEvent(
          s,
          { envelopeId: 'e1', expiredAt: 'x', reason: 'nope' },
          meta('mailbox.envelope.expired')
        ),
      'MAILBOX_INVALID_PAYLOAD'
    );
    expectCode(
      () =>
        applyMailboxEvent(
          s,
          { envelopeId: 'e1', receiptId: 'r', receiptKind: 'bogus', issuedAt: 't' },
          meta('mailbox.receipt.issued')
        ),
      'MAILBOX_INVALID_PAYLOAD'
    );
  });

  it('does not mutate the input state on a rejected event', () => {
    const s = fold(BOB, [
      { payload: envelope({ envelopeId: 'e1' }), meta: meta('mailbox.envelope.queued') }
    ]);
    expectCode(
      () => applyMailboxEvent(s, { envelopeId: 'e1' }, meta('mailbox.envelope.delivered')),
      'MAILBOX_INVALID_PAYLOAD'
    );
    expect(s.inbox.get('e1')?.status).toBe('queued');
  });
});
