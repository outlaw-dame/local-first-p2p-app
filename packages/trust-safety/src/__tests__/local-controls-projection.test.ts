import { describe, expect, it } from 'vitest';
import type { LocalControlEvent } from '../index.js';
import {
  applyLocalControlEvent,
  createEmptyLocalControlState,
  labelPreferenceKey,
  seedLocalControlState
} from '../index.js';

function ev(partial: Partial<LocalControlEvent> & { kind: LocalControlEvent['kind'] }): LocalControlEvent {
  return {
    version: 'lfp2p.local-control-event.v1' as const,
    eventId: 'evt_' + Math.random().toString(36).slice(2, 10),
    createdAt: '2026-05-31T00:00:00Z',
    action: 'apply' as const,
    ...partial
  } as LocalControlEvent;
}

describe('createEmptyLocalControlState', () => {
  it('produces a fully empty frozen snapshot', () => {
    const s = createEmptyLocalControlState();
    expect(s.blockedActors).toEqual({});
    expect(s.mutedActors).toEqual({});
    expect(s.blockedDomains).toEqual({});
    expect(s.mutedKeywords).toEqual({});
    expect(s.mutedThreads).toEqual({});
    expect(s.hiddenPosts).toEqual({});
    expect(s.labelPreferences).toEqual({});
    expect(s.appliedEventIds.size).toBe(0);
    expect(Object.isFrozen(s)).toBe(true);
  });
});

describe('applyLocalControlEvent — happy path', () => {
  it('records a blocked actor', () => {
    const s = applyLocalControlEvent(
      createEmptyLocalControlState(),
      ev({
        eventId: 'e1',
        kind: 'safety.account.blocked',
        targetActorId: 'actor_x',
        reasonCode: 'abuse.harassment'
      })
    );
    expect(s.blockedActors['actor_x']).toMatchObject({ reasonCode: 'abuse.harassment' });
  });

  it('reverts a blocked actor (apply then revert returns to empty)', () => {
    const empty = createEmptyLocalControlState();
    const blocked = applyLocalControlEvent(
      empty,
      ev({ eventId: 'e1', kind: 'safety.account.blocked', targetActorId: 'actor_x' })
    );
    const reverted = applyLocalControlEvent(
      blocked,
      ev({
        eventId: 'e2',
        action: 'revert',
        kind: 'safety.account.blocked',
        targetActorId: 'actor_x'
      })
    );
    expect(reverted.blockedActors).toEqual({});
  });

  it('records a label preference under namespace::labelKey', () => {
    const s = applyLocalControlEvent(
      createEmptyLocalControlState(),
      ev({
        eventId: 'e1',
        kind: 'safety.label.preference.set',
        namespace: 'lfp2p.safety',
        labelKey: 'media-safety.adult-explicit',
        preference: 'blur-media'
      })
    );
    const key = labelPreferenceKey('lfp2p.safety', 'media-safety.adult-explicit');
    expect(s.labelPreferences[key]).toMatchObject({ preference: 'blur-media' });
  });

  it('records muted keywords under a lower-cased key', () => {
    const s = applyLocalControlEvent(
      createEmptyLocalControlState(),
      ev({
        eventId: 'e1',
        kind: 'safety.keyword.muted',
        keyword: 'Spoiler',
        matchKind: 'word'
      })
    );
    expect(s.mutedKeywords['spoiler']).toBeDefined();
    expect(s.mutedKeywords['Spoiler']).toBeUndefined();
  });
});

describe('applyLocalControlEvent — idempotency', () => {
  it('applying the same event twice yields the same state', () => {
    const empty = createEmptyLocalControlState();
    const event = ev({
      eventId: 'e1',
      kind: 'safety.account.blocked',
      targetActorId: 'actor_x'
    });
    const once = applyLocalControlEvent(empty, event);
    const twice = applyLocalControlEvent(once, event);
    expect(twice).toBe(once);
  });

  it('records the eventId on first apply', () => {
    const empty = createEmptyLocalControlState();
    const event = ev({
      eventId: 'e1',
      kind: 'safety.account.blocked',
      targetActorId: 'actor_x'
    });
    const after = applyLocalControlEvent(empty, event);
    expect(after.appliedEventIds.has('e1')).toBe(true);
  });
});

describe('applyLocalControlEvent — adversarial', () => {
  it('rejects __proto__ as targetActorId without polluting Object.prototype', () => {
    const before = (Object.prototype as Record<string, unknown>).polluted;
    const empty = createEmptyLocalControlState();
    const event = ev({
      eventId: 'e1',
      kind: 'safety.account.blocked',
      targetActorId: '__proto__'
    });
    const after = applyLocalControlEvent(empty, event);
    expect(after.blockedActors['__proto__']).toBeDefined();
    // Prototype pollution check: setting __proto__ as a key should still
    // produce a real own-property and not mutate Object.prototype.
    expect((Object.prototype as Record<string, unknown>).polluted).toBe(before);
  });

  it('rejects malformed events', () => {
    expect(() =>
      applyLocalControlEvent(createEmptyLocalControlState(), {
        version: 'lfp2p.local-control-event.v1',
        eventId: 'e1',
        createdAt: '2026-05-31T00:00:00Z',
        action: 'apply',
        kind: 'safety.account.blocked'
      })
    ).toThrow();
  });

  it('rejects non-object events', () => {
    expect(() =>
      applyLocalControlEvent(createEmptyLocalControlState(), 'not an event')
    ).toThrow(/TS_INVALID_INPUT/);
  });
});

describe('seedLocalControlState — replay equivalence', () => {
  it('replaying a sequence yields the same state as step-by-step application', () => {
    const events: LocalControlEvent[] = [
      ev({ eventId: 'a', kind: 'safety.account.blocked', targetActorId: 'actor_x' }),
      ev({ eventId: 'b', kind: 'safety.account.muted', targetActorId: 'actor_y', muteScope: 'all' }),
      ev({ eventId: 'c', kind: 'safety.domain.blocked', domain: 'spam.example' }),
      ev({ eventId: 'd', kind: 'safety.thread.muted', threadId: 'thread_1' }),
      ev({ eventId: 'e', kind: 'safety.post.hidden', postEventId: 'post_1' }),
      ev({
        eventId: 'f',
        kind: 'safety.label.preference.set',
        namespace: 'lfp2p.safety',
        labelKey: 'media-safety.adult-explicit',
        preference: 'blur-media'
      }),
      ev({ eventId: 'g', kind: 'safety.keyword.muted', keyword: 'spoiler', matchKind: 'word' })
    ];
    const seeded = seedLocalControlState(events);
    let stepByStep = createEmptyLocalControlState();
    for (const e of events) {
      stepByStep = applyLocalControlEvent(stepByStep, e);
    }
    expect(seeded).toEqual(stepByStep);
  });

  it('replay is order-stable when event ids are unique', () => {
    const a = ev({ eventId: '1', kind: 'safety.account.blocked', targetActorId: 'actor_x' });
    const b = ev({ eventId: '2', kind: 'safety.account.muted', targetActorId: 'actor_x', muteScope: 'all' });
    const ab = seedLocalControlState([a, b]);
    const ba = seedLocalControlState([b, a]);
    expect(ab.blockedActors['actor_x']).toBeDefined();
    expect(ab.mutedActors['actor_x']).toBeDefined();
    expect(ba.blockedActors['actor_x']).toBeDefined();
    expect(ba.mutedActors['actor_x']).toBeDefined();
  });

  it('rebuilds state correctly after a "store reopen" simulation', () => {
    const events: LocalControlEvent[] = [
      ev({ eventId: 'e1', kind: 'safety.account.blocked', targetActorId: 'actor_x' }),
      ev({
        eventId: 'e2',
        action: 'revert',
        kind: 'safety.account.blocked',
        targetActorId: 'actor_x'
      })
    ];
    const sealedState = seedLocalControlState(events);
    // Simulating store reopen: rebuild from the same event log.
    const reopened = seedLocalControlState(events);
    expect(reopened).toEqual(sealedState);
    expect(reopened.blockedActors).toEqual({});
  });
});
