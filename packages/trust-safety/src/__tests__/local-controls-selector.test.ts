import { describe, expect, it } from 'vitest';
import type { LocalControlEvent } from '../index.js';
import {
  applyLocalControlEvent,
  createEmptyLocalControlState,
  decideVisibility,
  seedLocalControlState
} from '../index.js';

function ev(
  partial: Partial<LocalControlEvent> & { kind: LocalControlEvent['kind'] }
): LocalControlEvent {
  return {
    version: 'lfp2p.local-control-event.v1' as const,
    eventId: 'evt_' + Math.random().toString(36).slice(2, 10),
    createdAt: '2026-05-31T00:00:00Z',
    action: 'apply' as const,
    ...partial
  } as LocalControlEvent;
}

describe('decideVisibility — defaults', () => {
  it('returns show for empty context and empty state', () => {
    expect(decideVisibility(createEmptyLocalControlState(), {})).toBe('show');
  });
});

describe('decideVisibility — block / mute / hide', () => {
  it('returns hide for a blocked actor', () => {
    const s = seedLocalControlState([
      ev({ eventId: 'e1', kind: 'safety.account.blocked', targetActorId: 'actor_x' })
    ]);
    expect(decideVisibility(s, { actorId: 'actor_x' })).toBe('hide');
  });

  it('returns hide for a blocked domain (case-insensitive)', () => {
    const s = seedLocalControlState([
      ev({ eventId: 'e1', kind: 'safety.domain.blocked', domain: 'Spam.Example' })
    ]);
    expect(decideVisibility(s, { domain: 'SPAM.EXAMPLE' })).toBe('hide');
  });

  it('returns hide for a hidden post id', () => {
    const s = seedLocalControlState([
      ev({ eventId: 'e1', kind: 'safety.post.hidden', postEventId: 'post_xyz' })
    ]);
    expect(decideVisibility(s, { postEventId: 'post_xyz' })).toBe('hide');
  });

  it('returns collapse for a muted thread', () => {
    const s = seedLocalControlState([
      ev({ eventId: 'e1', kind: 'safety.thread.muted', threadId: 't1' })
    ]);
    expect(decideVisibility(s, { threadId: 't1' })).toBe('collapse');
  });

  it('returns collapse for muted actor with muteScope=all', () => {
    const s = seedLocalControlState([
      ev({
        eventId: 'e1',
        kind: 'safety.account.muted',
        targetActorId: 'actor_y',
        muteScope: 'all'
      })
    ]);
    expect(decideVisibility(s, { actorId: 'actor_y' })).toBe('collapse');
  });

  it('returns downrank for muted actor with muteScope=feed', () => {
    const s = seedLocalControlState([
      ev({
        eventId: 'e1',
        kind: 'safety.account.muted',
        targetActorId: 'actor_z',
        muteScope: 'feed'
      })
    ]);
    expect(decideVisibility(s, { actorId: 'actor_z' })).toBe('downrank');
  });
});

describe('decideVisibility — keyword matching', () => {
  it('substring matches anywhere', () => {
    const s = seedLocalControlState([
      ev({
        eventId: 'e1',
        kind: 'safety.keyword.muted',
        keyword: 'spoiler',
        matchKind: 'substring'
      })
    ]);
    expect(decideVisibility(s, { text: 'a big SPOILER inside' })).toBe('collapse');
    expect(decideVisibility(s, { text: 'spoileralert today' })).toBe('collapse');
  });

  it('word match requires word boundaries', () => {
    const s = seedLocalControlState([
      ev({ eventId: 'e1', kind: 'safety.keyword.muted', keyword: 'rage', matchKind: 'word' })
    ]);
    expect(decideVisibility(s, { text: 'much rage today' })).toBe('collapse');
    expect(decideVisibility(s, { text: 'storage facility' })).toBe('show');
    expect(decideVisibility(s, { text: 'overrage of energy' })).toBe('show');
  });

  it('empty text never matches', () => {
    const s = seedLocalControlState([
      ev({
        eventId: 'e1',
        kind: 'safety.keyword.muted',
        keyword: 'spoiler',
        matchKind: 'substring'
      })
    ]);
    expect(decideVisibility(s, { text: '' })).toBe('show');
    expect(decideVisibility(s, {})).toBe('show');
  });

  it('does NOT compile a user-supplied regex (literal match only)', () => {
    const s = seedLocalControlState([
      ev({
        eventId: 'e1',
        kind: 'safety.keyword.muted',
        keyword: '.*',
        matchKind: 'substring'
      })
    ]);
    // The literal ".*" should match the literal characters, not act as a regex.
    expect(decideVisibility(s, { text: 'literal .* dot star' })).toBe('collapse');
    expect(decideVisibility(s, { text: 'hello world' })).toBe('show');
  });
});

describe('decideVisibility — label preferences', () => {
  it('maps user label preference to the visibility decision', () => {
    const s = seedLocalControlState([
      ev({
        eventId: 'e1',
        kind: 'safety.label.preference.set',
        namespace: 'lfp2p.safety',
        labelKey: 'media-safety.adult-explicit',
        preference: 'blur-media'
      })
    ]);
    const decision = decideVisibility(s, {
      labels: [{ namespace: 'lfp2p.safety', labelKey: 'media-safety.adult-explicit' }]
    });
    expect(decision).toBe('blur-media');
  });

  it('label "allow" preference does not raise visibility above show baseline', () => {
    const s = seedLocalControlState([
      ev({
        eventId: 'e1',
        kind: 'safety.label.preference.set',
        namespace: 'lfp2p.safety',
        labelKey: 'security.spam',
        preference: 'allow'
      })
    ]);
    expect(
      decideVisibility(s, {
        labels: [{ namespace: 'lfp2p.safety', labelKey: 'security.spam' }]
      })
    ).toBe('show');
  });
});

describe('decideVisibility — most-restrictive combination', () => {
  it('a hard-block dominates a collapse mute', () => {
    let s = createEmptyLocalControlState();
    s = applyLocalControlEvent(
      s,
      ev({
        eventId: 'm1',
        kind: 'safety.account.muted',
        targetActorId: 'actor_x',
        muteScope: 'all'
      })
    );
    s = applyLocalControlEvent(
      s,
      ev({ eventId: 'b1', kind: 'safety.account.blocked', targetActorId: 'actor_x' })
    );
    expect(decideVisibility(s, { actorId: 'actor_x' })).toBe('hide');
  });

  it('label preference + keyword combine to most-restrictive', () => {
    let s = createEmptyLocalControlState();
    s = applyLocalControlEvent(
      s,
      ev({
        eventId: 'l1',
        kind: 'safety.label.preference.set',
        namespace: 'lfp2p.safety',
        labelKey: 'security.spam',
        preference: 'warn'
      })
    );
    s = applyLocalControlEvent(
      s,
      ev({
        eventId: 'k1',
        kind: 'safety.keyword.muted',
        keyword: 'wager',
        matchKind: 'word'
      })
    );
    const decision = decideVisibility(s, {
      text: 'a wager on this',
      labels: [{ namespace: 'lfp2p.safety', labelKey: 'security.spam' }]
    });
    expect(decision).toBe('collapse'); // collapse (keyword) > warn (label)
  });
});
