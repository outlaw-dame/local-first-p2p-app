/**
 * Phase 1.70.A — `phrase` and `hashtag` keyword match kinds.
 *
 * These are first-class match kinds living on the linear-time path
 * inside the package. They deliberately replace what users typically
 * want from regex (filter a phrase, mute a hashtag) without exposing
 * a regex engine that could ReDoS the host or another device that
 * imports the user's preference snapshot.
 */
import { describe, expect, it } from 'vitest';
import {
  KEYWORD_MATCH_KINDS,
  applyLocalControlEvent,
  createEmptyLocalControlState,
  decideVisibility,
  validateLocalControlEvent
} from '../index.js';
import type { LocalControlEvent } from '../index.js';

const BASE = {
  version: 'lfp2p.local-control-event.v1' as const,
  eventId: 'evt_phrase_1',
  createdAt: '2026-06-02T00:00:00Z',
  action: 'apply' as const
};

describe('Phase 1.70.A — KEYWORD_MATCH_KINDS includes hashtag and phrase', () => {
  it('exposes both new kinds', () => {
    expect(KEYWORD_MATCH_KINDS).toContain('substring');
    expect(KEYWORD_MATCH_KINDS).toContain('word');
    expect(KEYWORD_MATCH_KINDS).toContain('phrase');
    expect(KEYWORD_MATCH_KINDS).toContain('hashtag');
    expect(KEYWORD_MATCH_KINDS).toContain('semantic');
  });

  it('still does NOT include regex (deliberate ReDoS guard)', () => {
    expect((KEYWORD_MATCH_KINDS as readonly string[])).not.toContain('regex');
  });
});

describe('Phase 1.70.A — phrase validation', () => {
  it('accepts a phrase with internal whitespace', () => {
    const e = validateLocalControlEvent({
      ...BASE,
      kind: 'safety.keyword.muted',
      keyword: 'election fraud',
      matchKind: 'phrase'
    });
    expect(e).toMatchObject({ keyword: 'election fraud', matchKind: 'phrase' });
  });

  it('collapses runs of internal whitespace and trims', () => {
    const e = validateLocalControlEvent({
      ...BASE,
      kind: 'safety.keyword.muted',
      keyword: '   election    fraud   ',
      matchKind: 'phrase'
    });
    expect(e).toMatchObject({ keyword: 'election fraud' });
  });

  it('preserves the user case in the stored value (snapshot UX)', () => {
    const e = validateLocalControlEvent({
      ...BASE,
      kind: 'safety.keyword.muted',
      keyword: 'Election Fraud',
      matchKind: 'phrase'
    });
    expect(e).toMatchObject({ keyword: 'Election Fraud' });
  });

  it('rejects a whitespace-only phrase', () => {
    expect(() =>
      validateLocalControlEvent({
        ...BASE,
        kind: 'safety.keyword.muted',
        keyword: '     ',
        matchKind: 'phrase'
      })
    ).toThrow(/at least one non-whitespace/);
  });

  it('rejects embedding fields on a phrase', () => {
    expect(() =>
      validateLocalControlEvent({
        ...BASE,
        kind: 'safety.keyword.muted',
        keyword: 'hello world',
        matchKind: 'phrase',
        embeddingModel: 'minilm-v6'
      })
    ).toThrow(/embedding fields are only valid when matchKind="semantic"/);
  });
});

describe('Phase 1.70.A — hashtag validation', () => {
  it('accepts a tag with leading #', () => {
    const e = validateLocalControlEvent({
      ...BASE,
      kind: 'safety.keyword.muted',
      keyword: '#Spoilers',
      matchKind: 'hashtag'
    });
    expect(e).toMatchObject({ keyword: 'spoilers', matchKind: 'hashtag' });
  });

  it('accepts a tag without leading #', () => {
    const e = validateLocalControlEvent({
      ...BASE,
      kind: 'safety.keyword.muted',
      keyword: 'Spoilers',
      matchKind: 'hashtag'
    });
    expect(e).toMatchObject({ keyword: 'spoilers' });
  });

  it('accepts a Unicode-letter tag (café)', () => {
    const e = validateLocalControlEvent({
      ...BASE,
      kind: 'safety.keyword.muted',
      keyword: '#café',
      matchKind: 'hashtag'
    });
    expect(e).toMatchObject({ keyword: 'café' });
  });

  it('accepts underscores and digits in the body', () => {
    const e = validateLocalControlEvent({
      ...BASE,
      kind: 'safety.keyword.muted',
      keyword: '#tag_2026',
      matchKind: 'hashtag'
    });
    expect(e).toMatchObject({ keyword: 'tag_2026' });
  });

  it('rejects whitespace inside the body', () => {
    expect(() =>
      validateLocalControlEvent({
        ...BASE,
        kind: 'safety.keyword.muted',
        keyword: '#two words',
        matchKind: 'hashtag'
      })
    ).toThrow(/letters, numbers, and underscores/);
  });

  it('rejects punctuation inside the body', () => {
    expect(() =>
      validateLocalControlEvent({
        ...BASE,
        kind: 'safety.keyword.muted',
        keyword: '#with.dot',
        matchKind: 'hashtag'
      })
    ).toThrow(/letters, numbers, and underscores/);
  });

  it('rejects an empty body after the #', () => {
    expect(() =>
      validateLocalControlEvent({
        ...BASE,
        kind: 'safety.keyword.muted',
        keyword: '#',
        matchKind: 'hashtag'
      })
    ).toThrow(/body after the leading/);
  });

  it('rejects a body longer than 140 chars', () => {
    expect(() =>
      validateLocalControlEvent({
        ...BASE,
        kind: 'safety.keyword.muted',
        keyword: '#' + 'a'.repeat(141),
        matchKind: 'hashtag'
      })
    ).toThrow(/at most 140 characters/);
  });

  it('rejects embedding fields on a hashtag', () => {
    expect(() =>
      validateLocalControlEvent({
        ...BASE,
        kind: 'safety.keyword.muted',
        keyword: 'spoilers',
        matchKind: 'hashtag',
        embeddingModel: 'minilm-v6'
      })
    ).toThrow(/embedding fields are only valid when matchKind="semantic"/);
  });
});

// =============================================================================
// Selector match behaviour
// =============================================================================

function muteEvent(
  eventId: string,
  keyword: string,
  matchKind: 'substring' | 'word' | 'phrase' | 'hashtag'
): LocalControlEvent {
  return validateLocalControlEvent({
    ...BASE,
    eventId,
    kind: 'safety.keyword.muted',
    keyword,
    matchKind
  });
}

describe('Phase 1.70.A — phrase selector matching', () => {
  it('matches whitespace-collapsed substring case-insensitively', () => {
    const s = applyLocalControlEvent(
      createEmptyLocalControlState(),
      muteEvent('e_p1', 'election fraud', 'phrase')
    );
    expect(
      decideVisibility(s, { text: 'I think the Election    Fraud claims are bogus.' })
    ).toBe('collapse');
  });

  it('does not match a partial token (this is a phrase, not a substring of one word)', () => {
    const s = applyLocalControlEvent(
      createEmptyLocalControlState(),
      muteEvent('e_p2', 'gold star', 'phrase')
    );
    // The post contains "goldstar" with no space — phrase wants the
    // two-token form. Substring would match; phrase should NOT.
    // Because phrase is whitespace-normalized substring, this is
    // actually a match too — confirm the doctrine choice explicitly:
    // phrase IS substring-with-whitespace-normalization. The
    // distinction users care about is "the words appear adjacent
    // separated by whitespace" — for that strict case use `word`
    // on each token. We pin the current behaviour here.
    expect(decideVisibility(s, { text: 'I love goldstar awards.' })).toBe('show');
  });

  it('matches across multi-line text', () => {
    const s = applyLocalControlEvent(
      createEmptyLocalControlState(),
      muteEvent('e_p3', 'spoiler alert', 'phrase')
    );
    expect(
      decideVisibility(s, { text: 'WARNING\nspoiler\talert\nbelow' })
    ).toBe('collapse');
  });
});

describe('Phase 1.70.A — hashtag selector matching', () => {
  it('matches an exact tag token case-insensitively', () => {
    const s = applyLocalControlEvent(
      createEmptyLocalControlState(),
      muteEvent('e_h1', '#Spoilers', 'hashtag')
    );
    expect(decideVisibility(s, { text: 'check this out #SPOILERS yo' })).toBe(
      'collapse'
    );
  });

  it('matches the tag at end of text (no trailing boundary)', () => {
    const s = applyLocalControlEvent(
      createEmptyLocalControlState(),
      muteEvent('e_h2', 'spoilers', 'hashtag')
    );
    expect(decideVisibility(s, { text: 'check this out #spoilers' })).toBe(
      'collapse'
    );
  });

  it('does not match a longer tag that contains the needle as a prefix', () => {
    const s = applyLocalControlEvent(
      createEmptyLocalControlState(),
      muteEvent('e_h3', 'spoil', 'hashtag')
    );
    expect(decideVisibility(s, { text: 'tag here #spoilers below' })).toBe(
      'show'
    );
  });

  it('matches a Unicode-letter tag (#café)', () => {
    const s = applyLocalControlEvent(
      createEmptyLocalControlState(),
      muteEvent('e_h4', '#café', 'hashtag')
    );
    expect(decideVisibility(s, { text: 'morning ☕ #café time' })).toBe(
      'collapse'
    );
  });

  it('does not match the same letters appearing without the # prefix', () => {
    const s = applyLocalControlEvent(
      createEmptyLocalControlState(),
      muteEvent('e_h5', 'spoilers', 'hashtag')
    );
    expect(decideVisibility(s, { text: 'no spoilers here, promise' })).toBe(
      'show'
    );
  });
});

describe('Phase 1.70.A — adversarial / ReDoS guard', () => {
  it('is linear-time on a pathological hashtag-like payload', () => {
    // A string that would catastrophically backtrack against
    // `(#)?(a+)+$` if we had built a regex from user input. With our
    // linear scan this completes in milliseconds.
    const s = applyLocalControlEvent(
      createEmptyLocalControlState(),
      muteEvent('e_h6', 'spoilers', 'hashtag')
    );
    const adversarial = '#' + 'a'.repeat(20000) + '!';
    const t0 = Date.now();
    decideVisibility(s, { text: adversarial });
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it('is linear-time on a pathological phrase payload', () => {
    const s = applyLocalControlEvent(
      createEmptyLocalControlState(),
      muteEvent('e_p4', 'never matches this exact phrase abc', 'phrase')
    );
    const adversarial = ' '.repeat(20000) + 'a'.repeat(20000);
    const t0 = Date.now();
    decideVisibility(s, { text: adversarial });
    expect(Date.now() - t0).toBeLessThan(200);
  });
});
