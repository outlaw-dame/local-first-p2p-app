import { describe, expect, it } from 'vitest';
import {
  applyUdrEvent,
  createEmptyUdrState,
  isUdrEventKind,
  UDR_EVENT_KINDS,
  UdrProjectionError
} from '../index.js';
import type { ApplyUdrEventMeta, UdrState } from '../index.js';

let seq = 0;
function meta(
  kind: ApplyUdrEventMeta['kind'],
  overrides: Partial<ApplyUdrEventMeta> = {}
): ApplyUdrEventMeta {
  seq += 1;
  return {
    kind,
    eventId: overrides.eventId ?? `evt_${seq}`,
    createdAt: overrides.createdAt ?? `2026-07-02T00:00:${String(seq % 60).padStart(2, '0')}.000Z`
  };
}

type Event = { payload: unknown; meta: ApplyUdrEventMeta };

function fold(events: Event[], identityId = 'identity:alice'): UdrState {
  let state = createEmptyUdrState(identityId);
  for (const e of events) {
    state = applyUdrEvent(state, e.payload as never, e.meta);
  }
  return state;
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(UdrProjectionError);
    expect((error as UdrProjectionError).code).toBe(code);
    return;
  }
  throw new Error(`expected throw with ${code}`);
}

describe('UDR event kind guard', () => {
  it('recognizes exactly the nine udr.* kinds', () => {
    expect(UDR_EVENT_KINDS).toHaveLength(9);
    for (const k of UDR_EVENT_KINDS) expect(isUdrEventKind(k)).toBe(true);
    expect(isUdrEventKind('chat.message.sent')).toBe(false);
    expect(isUdrEventKind('udr.unknown')).toBe(false);
  });
});

describe('createEmptyUdrState', () => {
  it('starts empty and deep-frozen', () => {
    const s = createEmptyUdrState('identity:alice');
    expect(s.identityId).toBe('identity:alice');
    expect(s.partitionIds.size).toBe(0);
    expect(s.mailboxId).toBeUndefined();
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.isFrozen(s.partitionIds)).toBe(true);
  });

  it('rejects an empty identityId', () => {
    expectCode(() => createEmptyUdrState(''), 'UDR_INVALID_PAYLOAD');
  });
});

describe('applyUdrEvent — set lifecycle', () => {
  it('claims and releases partitions', () => {
    const claimed = fold([
      {
        payload: { partitionId: 'p1', scope: 'private', claimedAt: 'x' },
        meta: meta('udr.partition.claimed')
      },
      {
        payload: { partitionId: 'p2', scope: 'private', claimedAt: 'x' },
        meta: meta('udr.partition.claimed')
      }
    ]);
    expect([...claimed.partitionIds].sort()).toEqual(['p1', 'p2']);

    const afterRelease = applyUdrEvent(
      claimed,
      { partitionId: 'p1', releasedAt: 'x' },
      meta('udr.partition.released')
    );
    expect([...afterRelease.partitionIds]).toEqual(['p2']);
  });

  it('handles feed subscriptions, sync interests, and spaces', () => {
    const s = fold([
      {
        payload: { feedId: 'f1', feedKind: 'following', addedAt: 'x' },
        meta: meta('udr.feed-subscription.added')
      },
      {
        payload: { syncInterestId: 'si1', interest: { scope: 'all' }, addedAt: 'x' },
        meta: meta('udr.sync-interest.added')
      },
      { payload: { spaceId: 'sp1', joinedAt: 'x' }, meta: meta('udr.space.joined') },
      { payload: { spaceId: 'sp2', joinedAt: 'x' }, meta: meta('udr.space.joined') },
      { payload: { spaceId: 'sp1', leftAt: 'x' }, meta: meta('udr.space.left') }
    ]);
    expect([...s.feedSubscriptionIds]).toEqual(['f1']);
    expect([...s.syncInterestIds]).toEqual(['si1']);
    expect([...s.spaceIds]).toEqual(['sp2']);
  });

  it('binds a mailbox and lets a later bind supersede', () => {
    const s = fold([
      { payload: { mailboxId: 'mb1', boundAt: 'x' }, meta: meta('udr.mailbox.bound') },
      { payload: { mailboxId: 'mb2', boundAt: 'x' }, meta: meta('udr.mailbox.bound') }
    ]);
    expect(s.mailboxId).toBe('mb2');
  });

  it('claim is idempotent for a duplicate partition (distinct eventIds)', () => {
    const s = fold([
      {
        payload: { partitionId: 'p1', scope: 'private', claimedAt: 'x' },
        meta: meta('udr.partition.claimed')
      },
      {
        payload: { partitionId: 'p1', scope: 'private', claimedAt: 'x' },
        meta: meta('udr.partition.claimed')
      }
    ]);
    expect([...s.partitionIds]).toEqual(['p1']);
  });

  it('releasing / leaving a non-present member is a safe no-op', () => {
    const s = fold([
      { payload: { partitionId: 'ghost', releasedAt: 'x' }, meta: meta('udr.partition.released') },
      { payload: { spaceId: 'ghost', leftAt: 'x' }, meta: meta('udr.space.left') }
    ]);
    expect(s.partitionIds.size).toBe(0);
    expect(s.spaceIds.size).toBe(0);
  });
});

describe('applyUdrEvent — idempotency and replay', () => {
  it('re-applying the same eventId is a no-op that returns the same state', () => {
    const start = createEmptyUdrState('identity:alice');
    const m = meta('udr.space.joined', { eventId: 'evt_fixed' });
    const once = applyUdrEvent(start, { spaceId: 'sp1', joinedAt: 'x' }, m);
    const twice = applyUdrEvent(once, { spaceId: 'sp1', joinedAt: 'x' }, m);
    expect(twice).toBe(once);
    expect([...twice.spaceIds]).toEqual(['sp1']);
  });

  it('replay equivalence: applying the same ordered log twice yields equal state', () => {
    const log: Event[] = [
      {
        payload: { partitionId: 'p1', scope: 'private', claimedAt: 'x' },
        meta: meta('udr.partition.claimed', { eventId: 'e1' })
      },
      {
        payload: { spaceId: 'sp1', joinedAt: 'x' },
        meta: meta('udr.space.joined', { eventId: 'e2' })
      },
      {
        payload: { partitionId: 'p1', releasedAt: 'x' },
        meta: meta('udr.partition.released', { eventId: 'e3' })
      },
      {
        payload: { mailboxId: 'mb1', boundAt: 'x' },
        meta: meta('udr.mailbox.bound', { eventId: 'e4' })
      }
    ];
    const a = fold(log);
    const b = fold(log);
    expect([...a.partitionIds]).toEqual([...b.partitionIds]);
    expect([...a.spaceIds]).toEqual([...b.spaceIds]);
    expect(a.mailboxId).toBe(b.mailboxId);
    expect(a.updatedAt).toBe(b.updatedAt);
    expect([...a.appliedEventIds].sort()).toEqual([...b.appliedEventIds].sort());
  });

  it('updatedAt tracks the latest timestamp and does not regress on out-of-order events', () => {
    const start = createEmptyUdrState('identity:alice');
    const late = applyUdrEvent(
      start,
      { spaceId: 'sp1', joinedAt: 'x' },
      {
        kind: 'udr.space.joined',
        eventId: 'e-late',
        createdAt: '2026-07-02T12:00:00.000Z'
      }
    );
    const early = applyUdrEvent(
      late,
      { spaceId: 'sp2', joinedAt: 'x' },
      {
        kind: 'udr.space.joined',
        eventId: 'e-early',
        createdAt: '2026-07-01T00:00:00.000Z'
      }
    );
    expect(early.updatedAt).toBe('2026-07-02T12:00:00.000Z');
  });
});

describe('applyUdrEvent — deep freeze', () => {
  it('freezes returned state and its collections', () => {
    const s = fold([
      {
        payload: { partitionId: 'p1', scope: 'private', claimedAt: 'x' },
        meta: meta('udr.partition.claimed')
      }
    ]);
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.isFrozen(s.partitionIds)).toBe(true);
    expect(Object.isFrozen(s.appliedEventIds)).toBe(true);
  });
});

describe('applyUdrEvent — adversarial payloads', () => {
  const start = () => createEmptyUdrState('identity:alice');

  it('rejects unknown kinds', () => {
    expectCode(
      () =>
        applyUdrEvent(
          start(),
          { spaceId: 'sp1' },
          { kind: 'udr.bogus' as never, eventId: 'e1', createdAt: 'x' }
        ),
      'UDR_UNKNOWN_KIND'
    );
  });

  it('rejects non-object and array payloads', () => {
    expectCode(
      () => applyUdrEvent(start(), 'nope' as never, meta('udr.space.joined')),
      'UDR_INVALID_PAYLOAD'
    );
    expectCode(
      () => applyUdrEvent(start(), null as never, meta('udr.space.joined')),
      'UDR_INVALID_PAYLOAD'
    );
    expectCode(
      () => applyUdrEvent(start(), [] as never, meta('udr.space.joined')),
      'UDR_INVALID_PAYLOAD'
    );
  });

  it('rejects missing, empty, non-string, and oversized ids', () => {
    expectCode(() => applyUdrEvent(start(), {}, meta('udr.space.joined')), 'UDR_INVALID_PAYLOAD');
    expectCode(
      () => applyUdrEvent(start(), { spaceId: '' }, meta('udr.space.joined')),
      'UDR_INVALID_PAYLOAD'
    );
    expectCode(
      () => applyUdrEvent(start(), { spaceId: 42 } as never, meta('udr.space.joined')),
      'UDR_INVALID_PAYLOAD'
    );
    expectCode(
      () => applyUdrEvent(start(), { spaceId: 'x'.repeat(513) }, meta('udr.space.joined')),
      'UDR_INVALID_PAYLOAD'
    );
  });

  it('rejects an empty eventId in meta', () => {
    expectCode(
      () =>
        applyUdrEvent(
          start(),
          { spaceId: 'sp1' },
          { kind: 'udr.space.joined', eventId: '', createdAt: 'x' }
        ),
      'UDR_INVALID_PAYLOAD'
    );
  });

  it('does not mutate the input state on a rejected event', () => {
    const s = fold([
      { payload: { spaceId: 'sp1', joinedAt: 'x' }, meta: meta('udr.space.joined') }
    ]);
    expectCode(() => applyUdrEvent(s, {}, meta('udr.partition.claimed')), 'UDR_INVALID_PAYLOAD');
    expect([...s.spaceIds]).toEqual(['sp1']);
    expect(s.partitionIds.size).toBe(0);
  });
});
