import { describe, expect, it } from 'vitest';
import {
  KEYWORD_MATCH_KINDS,
  LABEL_PREFERENCE_ACTIONS,
  LOCAL_CONTROL_KINDS,
  assertLocalControlEnvelopeScope,
  validateLocalControlEvent
} from '../index.js';

const BASE = {
  version: 'lfp2p.local-control-event.v1' as const,
  eventId: 'evt_1',
  createdAt: '2026-05-31T00:00:00Z',
  action: 'apply' as const
};

describe('validateLocalControlEvent — kinds', () => {
  it('accepts safety.account.blocked with reasonCode', () => {
    expect(() =>
      validateLocalControlEvent({
        ...BASE,
        kind: 'safety.account.blocked',
        targetActorId: 'actor_x',
        reasonCode: 'abuse.harassment'
      })
    ).not.toThrow();
  });

  it('accepts safety.account.muted with muteScope', () => {
    expect(() =>
      validateLocalControlEvent({
        ...BASE,
        kind: 'safety.account.muted',
        targetActorId: 'actor_x',
        muteScope: 'feed'
      })
    ).not.toThrow();
  });

  it('accepts safety.domain.blocked and lowercases the domain', () => {
    const e = validateLocalControlEvent({
      ...BASE,
      kind: 'safety.domain.blocked',
      domain: 'Example.COM'
    });
    expect(e).toMatchObject({ kind: 'safety.domain.blocked', domain: 'example.com' });
  });

  it('rejects safety.domain.blocked with a URL', () => {
    expect(() =>
      validateLocalControlEvent({
        ...BASE,
        kind: 'safety.domain.blocked',
        domain: 'https://x.example/'
      })
    ).toThrow(/TS_INVALID_INPUT/);
  });

  it('accepts safety.keyword.muted in substring and word modes', () => {
    for (const matchKind of ['substring', 'word'] as const) {
      expect(() =>
        validateLocalControlEvent({
          ...BASE,
          kind: 'safety.keyword.muted',
          keyword: 'spoiler',
          matchKind
        })
      ).not.toThrow();
    }
  });

  it('KEYWORD_MATCH_KINDS includes semantic, but semantic requires embeddingRef + model', () => {
    expect(KEYWORD_MATCH_KINDS).toContain('semantic');
    expect(() =>
      validateLocalControlEvent({
        ...BASE,
        kind: 'safety.keyword.muted',
        keyword: 'racist content',
        matchKind: 'semantic'
      })
    ).toThrow(/embeddingRef/);
  });

  it('rejects safety.keyword.muted with matchKind=regex (ReDoS guard)', () => {
    expect(() =>
      validateLocalControlEvent({
        ...BASE,
        kind: 'safety.keyword.muted',
        keyword: '(?:a+)+',
        matchKind: 'regex'
      })
    ).toThrow(/TS_INVALID_ENUM/);
  });

  it('rejects safety.label.preference.set with infrastructure action', () => {
    expect(() =>
      validateLocalControlEvent({
        ...BASE,
        kind: 'safety.label.preference.set',
        namespace: 'lfp2p.safety',
        labelKey: 'security.spam',
        preference: 'reject-transport'
      })
    ).toThrow(/TS_INVALID_ENUM/);
  });

  it('accepts every documented LABEL_PREFERENCE_ACTIONS value', () => {
    for (const preference of LABEL_PREFERENCE_ACTIONS) {
      expect(() =>
        validateLocalControlEvent({
          ...BASE,
          kind: 'safety.label.preference.set',
          namespace: 'lfp2p.safety',
          labelKey: 'security.spam',
          preference
        })
      ).not.toThrow();
    }
  });

  it('rejects unknown kind', () => {
    expect(() =>
      validateLocalControlEvent({
        ...BASE,
        kind: 'safety.account.cancelled',
        targetActorId: 'actor_x'
      })
    ).toThrow(/TS_INVALID_ENUM/);
  });

  it('rejects unknown action', () => {
    expect(() =>
      validateLocalControlEvent({
        ...BASE,
        action: 'undo',
        kind: 'safety.account.blocked',
        targetActorId: 'actor_x'
      })
    ).toThrow(/TS_INVALID_ENUM/);
  });

  it('rejects unknown version', () => {
    expect(() =>
      validateLocalControlEvent({
        ...BASE,
        version: 'lfp2p.local-control-event.v2',
        kind: 'safety.account.blocked',
        targetActorId: 'actor_x'
      })
    ).toThrow(/TS_UNKNOWN_VERSION/);
  });

  it('exposes the documented kinds (7 baseline + 5 portability expansion)', () => {
    expect(LOCAL_CONTROL_KINDS.length).toBe(12);
    expect(LOCAL_CONTROL_KINDS).toContain('safety.account.blocked');
    expect(LOCAL_CONTROL_KINDS).toContain('safety.account.allowlisted');
    expect(LOCAL_CONTROL_KINDS).toContain('safety.policy-list.subscribed');
    expect(LOCAL_CONTROL_KINDS).toContain('safety.policy-list.unsubscribed');
    expect(LOCAL_CONTROL_KINDS).toContain('safety.notification-preference.set');
    expect(LOCAL_CONTROL_KINDS).toContain('safety.preferences.snapshot');
  });
});

describe('assertLocalControlEnvelopeScope', () => {
  it('accepts device-local and account-local', () => {
    expect(assertLocalControlEnvelopeScope('device-local')).toBe('device-local');
    expect(assertLocalControlEnvelopeScope('account-local')).toBe('account-local');
  });

  it('rejects every networked / public scope with TS_PRIVATE_LEAK', () => {
    for (const scope of [
      'community-local',
      'bridge-local',
      'relay-local',
      'super-peer-local',
      'index-local',
      'app-surface-local',
      'network-advisory'
    ]) {
      expect(() => assertLocalControlEnvelopeScope(scope)).toThrow(/TS_PRIVATE_LEAK/);
    }
  });

  it('rejects non-string', () => {
    expect(() => assertLocalControlEnvelopeScope(42)).toThrow(/TS_INVALID_INPUT/);
  });
});
