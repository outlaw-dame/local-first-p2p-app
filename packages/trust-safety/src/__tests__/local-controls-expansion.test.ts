import { describe, expect, it } from 'vitest';
import type { LocalControlEvent, SemanticKeywordMatcher } from '../index.js';
import {
  applyLocalControlEvent,
  assertSnapshotIsNotStale,
  createEmptyLocalControlState,
  decideVisibility,
  exportPreferencesSnapshot,
  importPreferencesSnapshot,
  pruneExpiredLocalControlState,
  seedLocalControlState,
  snapshotsEqual,
  validateLocalControlSnapshot
} from '../index.js';

function ev<E extends LocalControlEvent>(partial: Partial<E> & { kind: E['kind'] }): E {
  return {
    version: 'lfp2p.local-control-event.v1' as const,
    eventId: 'evt_' + Math.random().toString(36).slice(2, 10),
    createdAt: '2026-05-31T00:00:00Z',
    action: 'apply' as const,
    ...partial
  } as unknown as E;
}

const VALID_DIGEST = {
  algorithm: 'sha-256' as const,
  digest: '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU'
};

// ---------------- TTL ----------------

describe('TTL: selector skips expired entries', () => {
  it('expired block does not hide', () => {
    const state = seedLocalControlState([
      ev({
        kind: 'safety.account.blocked',
        targetActorId: 'actor_x',
        createdAt: '2026-05-01T00:00:00Z',
        expiresAt: '2026-05-15T00:00:00Z'
      })
    ]);
    const now = Date.parse('2026-06-01T00:00:00Z');
    expect(decideVisibility(state, { actorId: 'actor_x' }, { now })).toBe('show');
  });

  it('not-yet-expired block still hides', () => {
    const state = seedLocalControlState([
      ev({
        kind: 'safety.account.blocked',
        targetActorId: 'actor_x',
        createdAt: '2026-05-01T00:00:00Z',
        expiresAt: '2026-12-31T00:00:00Z'
      })
    ]);
    const now = Date.parse('2026-06-01T00:00:00Z');
    expect(decideVisibility(state, { actorId: 'actor_x' }, { now })).toBe('hide');
  });

  it('expired label preference does not affect visibility', () => {
    const state = seedLocalControlState([
      ev({
        kind: 'safety.label.preference.set',
        namespace: 'lfp2p.safety',
        labelKey: 'security.spam',
        preference: 'hide',
        createdAt: '2026-05-01T00:00:00Z',
        expiresAt: '2026-05-15T00:00:00Z'
      })
    ]);
    const now = Date.parse('2026-06-01T00:00:00Z');
    expect(
      decideVisibility(
        state,
        { labels: [{ namespace: 'lfp2p.safety', labelKey: 'security.spam' }] },
        { now }
      )
    ).toBe('show');
  });

  it('pruneExpiredLocalControlState removes expired entries deterministically', () => {
    const state = seedLocalControlState([
      ev({
        kind: 'safety.account.blocked',
        targetActorId: 'actor_old',
        createdAt: '2026-05-01T00:00:00Z',
        expiresAt: '2026-05-15T00:00:00Z'
      }),
      ev({
        kind: 'safety.account.blocked',
        targetActorId: 'actor_current',
        createdAt: '2026-05-01T00:00:00Z'
      })
    ]);
    const pruned = pruneExpiredLocalControlState(state, Date.parse('2026-06-01T00:00:00Z'));
    expect(pruned.blockedActors['actor_old']).toBeUndefined();
    expect(pruned.blockedActors['actor_current']).toBeDefined();
  });

  it('rejects expiresAt before createdAt at validation time', () => {
    expect(() =>
      applyLocalControlEvent(
        createEmptyLocalControlState(),
        {
          version: 'lfp2p.local-control-event.v1',
          eventId: 'e1',
          createdAt: '2026-05-31T00:00:00Z',
          action: 'apply',
          kind: 'safety.account.blocked',
          targetActorId: 'actor_x',
          expiresAt: '2026-05-30T00:00:00Z'
        }
      )
    ).toThrow(/TS_INVALID_TIMESTAMP/);
  });
});

// ---------------- Allowlist ----------------

describe('Allowlist: suppresses label-driven decisions but not hard safety or user actions', () => {
  it('allowlist suppresses a non-hard-safety label preference', () => {
    const state = seedLocalControlState([
      ev({
        kind: 'safety.account.allowlisted',
        targetActorId: 'actor_friend'
      }),
      ev({
        kind: 'safety.label.preference.set',
        namespace: 'lfp2p.safety',
        labelKey: 'security.spam',
        preference: 'hide'
      })
    ]);
    const decision = decideVisibility(state, {
      actorId: 'actor_friend',
      labels: [{ namespace: 'lfp2p.safety', labelKey: 'security.spam' }]
    });
    expect(decision).toBe('show');
  });

  it('allowlist does NOT suppress a hard-safety label preference', () => {
    const state = seedLocalControlState([
      ev({
        kind: 'safety.account.allowlisted',
        targetActorId: 'actor_friend'
      }),
      ev({
        kind: 'safety.label.preference.set',
        namespace: 'lfp2p.safety',
        labelKey: 'media-safety.adult-explicit',
        preference: 'blur-media'
      })
    ]);
    const decision = decideVisibility(state, {
      actorId: 'actor_friend',
      labels: [
        {
          namespace: 'lfp2p.safety',
          labelKey: 'media-safety.adult-explicit',
          hardSafety: true
        }
      ]
    });
    expect(decision).toBe('blur-media');
  });

  it('allowlist does NOT override an explicit user block (block wins)', () => {
    const state = seedLocalControlState([
      ev({ kind: 'safety.account.blocked', targetActorId: 'actor_conflicted' }),
      ev({ kind: 'safety.account.allowlisted', targetActorId: 'actor_conflicted' })
    ]);
    expect(decideVisibility(state, { actorId: 'actor_conflicted' })).toBe('hide');
  });

  it('allowlist does NOT override a muted keyword in the post text', () => {
    const state = seedLocalControlState([
      ev({ kind: 'safety.account.allowlisted', targetActorId: 'actor_friend' }),
      ev({
        kind: 'safety.keyword.muted',
        keyword: 'spoiler',
        matchKind: 'substring'
      })
    ]);
    const decision = decideVisibility(state, {
      actorId: 'actor_friend',
      text: 'big spoiler ahead'
    });
    expect(decision).toBe('collapse');
  });

  it('expired allowlist entry does not suppress labels', () => {
    const state = seedLocalControlState([
      ev({
        kind: 'safety.account.allowlisted',
        targetActorId: 'actor_friend',
        createdAt: '2026-05-01T00:00:00Z',
        expiresAt: '2026-05-15T00:00:00Z'
      }),
      ev({
        kind: 'safety.label.preference.set',
        namespace: 'lfp2p.safety',
        labelKey: 'security.spam',
        preference: 'hide'
      })
    ]);
    const decision = decideVisibility(
      state,
      {
        actorId: 'actor_friend',
        labels: [{ namespace: 'lfp2p.safety', labelKey: 'security.spam' }]
      },
      { now: Date.parse('2026-06-01T00:00:00Z') }
    );
    expect(decision).toBe('hide');
  });
});

// ---------------- Semantic matcher ----------------

describe('Semantic keyword matcher: host-supplied, no ML in package', () => {
  const semanticEvent = ev({
    kind: 'safety.keyword.muted',
    keyword: 'racist content',
    matchKind: 'semantic',
    embeddingRef: VALID_DIGEST,
    embeddingModel: 'sentence-transformers/all-MiniLM-L6-v2',
    similarityThreshold: 0.7
  });

  it('semantic entry is a no-op without a host matcher', () => {
    const state = seedLocalControlState([semanticEvent]);
    const decision = decideVisibility(state, { text: 'hateful slur post' });
    expect(decision).toBe('show');
  });

  it('semantic entry consults the host matcher', () => {
    const state = seedLocalControlState([semanticEvent]);
    const semanticMatch: SemanticKeywordMatcher = (entry, text) => {
      expect(entry.embeddingModel).toBe('sentence-transformers/all-MiniLM-L6-v2');
      expect(entry.similarityThreshold).toBe(0.7);
      return text.includes('hateful');
    };
    expect(
      decideVisibility(state, { text: 'this is a hateful post' }, { semanticMatch })
    ).toBe('collapse');
    expect(
      decideVisibility(state, { text: 'an unrelated post' }, { semanticMatch })
    ).toBe('show');
  });

  it('semantic matcher throwing is contained and treated as no-match', () => {
    const state = seedLocalControlState([semanticEvent]);
    const semanticMatch: SemanticKeywordMatcher = (): boolean => {
      throw new Error('model crashed');
    };
    expect(
      decideVisibility(state, { text: 'anything' }, { semanticMatch })
    ).toBe('show');
  });

  it('rejects mixing substring matchKind with embeddingRef', () => {
    expect(() =>
      applyLocalControlEvent(createEmptyLocalControlState(), {
        version: 'lfp2p.local-control-event.v1',
        eventId: 'e1',
        createdAt: '2026-05-31T00:00:00Z',
        action: 'apply',
        kind: 'safety.keyword.muted',
        keyword: 'spoiler',
        matchKind: 'substring',
        embeddingRef: VALID_DIGEST
      })
    ).toThrow(/embedding fields are only valid/);
  });

  it('rejects similarityThreshold outside [0,1]', () => {
    expect(() =>
      applyLocalControlEvent(createEmptyLocalControlState(), {
        version: 'lfp2p.local-control-event.v1',
        eventId: 'e1',
        createdAt: '2026-05-31T00:00:00Z',
        action: 'apply',
        kind: 'safety.keyword.muted',
        keyword: 'x',
        matchKind: 'semantic',
        embeddingRef: VALID_DIGEST,
        embeddingModel: 'model-x',
        similarityThreshold: 1.5
      })
    ).toThrow(/TS_INVALID_NUMBER/);
  });
});

// ---------------- Notification preferences ----------------

describe('Notification preferences', () => {
  it('records and applies a per-channel preference', () => {
    const state = seedLocalControlState([
      ev({
        kind: 'safety.notification-preference.set',
        channel: 'dm-from-non-contacts',
        preference: 'mute'
      })
    ]);
    expect(state.notificationPreferences['dm-from-non-contacts']).toBeDefined();
    expect(
      decideVisibility(state, { notificationChannel: 'dm-from-non-contacts' })
    ).toBe('collapse');
  });

  it('does not affect channels other than the configured one', () => {
    const state = seedLocalControlState([
      ev({
        kind: 'safety.notification-preference.set',
        channel: 'mentions',
        preference: 'allow'
      })
    ]);
    expect(decideVisibility(state, { notificationChannel: 'reactions' })).toBe('show');
  });

  it('revert removes the preference', () => {
    let state = seedLocalControlState([
      ev({
        kind: 'safety.notification-preference.set',
        channel: 'reactions',
        preference: 'mute'
      })
    ]);
    state = applyLocalControlEvent(
      state,
      ev({
        action: 'revert',
        kind: 'safety.notification-preference.set',
        channel: 'reactions',
        preference: 'mute'
      })
    );
    expect(state.notificationPreferences['reactions']).toBeUndefined();
  });
});

// ---------------- Policy lists ----------------

describe('Policy list subscriptions', () => {
  it('records a subscription with its allowed kinds and trust level', () => {
    const state = seedLocalControlState([
      ev({
        kind: 'safety.policy-list.subscribed',
        policyListId: 'pl_1',
        issuerActorId: 'issuer_x',
        allowedKinds: ['block', 'keyword-mute'],
        trustLevel: 'apply'
      })
    ]);
    expect(state.policyListSubscriptions['pl_1']).toMatchObject({
      issuerActorId: 'issuer_x',
      trustLevel: 'apply'
    });
  });

  it('unsubscribe removes regardless of action discriminator', () => {
    let state = seedLocalControlState([
      ev({
        kind: 'safety.policy-list.subscribed',
        policyListId: 'pl_1',
        issuerActorId: 'issuer_x',
        allowedKinds: ['block'],
        trustLevel: 'advisory'
      })
    ]);
    state = applyLocalControlEvent(
      state,
      ev({
        kind: 'safety.policy-list.unsubscribed',
        policyListId: 'pl_1'
      })
    );
    expect(state.policyListSubscriptions['pl_1']).toBeUndefined();
  });
});

// ---------------- Snapshot / cross-app portability ----------------

describe('Snapshot export/import: cross-app portability', () => {
  function buildOpinionatedState() {
    return seedLocalControlState([
      ev({ kind: 'safety.account.blocked', targetActorId: 'actor_x', createdAt: '2026-05-01T00:00:00Z' }),
      ev({ kind: 'safety.account.allowlisted', targetActorId: 'actor_friend', createdAt: '2026-05-01T00:00:00Z' }),
      ev({
        kind: 'safety.keyword.muted',
        keyword: 'spoiler',
        matchKind: 'substring',
        createdAt: '2026-05-01T00:00:00Z'
      }),
      ev({
        kind: 'safety.label.preference.set',
        namespace: 'lfp2p.safety',
        labelKey: 'media-safety.adult-explicit',
        preference: 'blur-media',
        createdAt: '2026-05-01T00:00:00Z'
      }),
      ev({
        kind: 'safety.notification-preference.set',
        channel: 'mentions',
        preference: 'allow',
        createdAt: '2026-05-01T00:00:00Z'
      })
    ]);
  }

  it('export -> import round-trip preserves observable behavior', () => {
    const state = buildOpinionatedState();
    const snapshot = exportPreferencesSnapshot(state, {
      capturedAt: '2026-05-31T00:00:00Z'
    });
    const rebuilt = importPreferencesSnapshot(createEmptyLocalControlState(), snapshot);
    expect(decideVisibility(rebuilt, { actorId: 'actor_x' })).toBe('hide');
    expect(
      decideVisibility(rebuilt, { text: 'big spoiler ahead' })
    ).toBe('collapse');
    expect(rebuilt.snapshotAppliedAt).toBe('2026-05-31T00:00:00Z');
  });

  it('snapshot round-trip is structurally equal (snapshotsEqual)', () => {
    const state = buildOpinionatedState();
    const snapshot = exportPreferencesSnapshot(state, {
      capturedAt: '2026-05-31T00:00:00Z'
    });
    const rebuilt = importPreferencesSnapshot(createEmptyLocalControlState(), snapshot);
    const exported2 = exportPreferencesSnapshot(rebuilt, {
      capturedAt: '2026-05-31T00:00:00Z'
    });
    expect(snapshotsEqual(snapshot, exported2)).toBe(true);
  });

  it('default union strategy merges existing local state with snapshot', () => {
    const local = seedLocalControlState([
      ev({ kind: 'safety.account.blocked', targetActorId: 'local_only_block' })
    ]);
    const remoteState = seedLocalControlState([
      ev({ kind: 'safety.account.blocked', targetActorId: 'remote_only_block' })
    ]);
    const snapshot = exportPreferencesSnapshot(remoteState, {
      capturedAt: '2026-05-31T00:00:00Z'
    });
    const merged = importPreferencesSnapshot(local, snapshot);
    expect(merged.blockedActors['local_only_block']).toBeDefined();
    expect(merged.blockedActors['remote_only_block']).toBeDefined();
  });

  it('replace strategy discards existing local state', () => {
    const local = seedLocalControlState([
      ev({ kind: 'safety.account.blocked', targetActorId: 'local_only_block' })
    ]);
    const remoteState = seedLocalControlState([
      ev({ kind: 'safety.account.blocked', targetActorId: 'remote_only_block' })
    ]);
    const snapshot = exportPreferencesSnapshot(remoteState, {
      capturedAt: '2026-05-31T00:00:00Z'
    });
    const replaced = importPreferencesSnapshot(local, snapshot, {
      mergeStrategy: 'replace'
    });
    expect(replaced.blockedActors['local_only_block']).toBeUndefined();
    expect(replaced.blockedActors['remote_only_block']).toBeDefined();
  });

  it('merge-newer-wins keeps the entry with the later since timestamp', () => {
    const localOld = seedLocalControlState([
      ev({
        kind: 'safety.account.blocked',
        targetActorId: 'actor_x',
        createdAt: '2026-04-01T00:00:00Z',
        reasonCode: 'old-reason'
      })
    ]);
    const remoteNew = seedLocalControlState([
      ev({
        kind: 'safety.account.blocked',
        targetActorId: 'actor_x',
        createdAt: '2026-05-01T00:00:00Z',
        reasonCode: 'new-reason'
      })
    ]);
    const snapshot = exportPreferencesSnapshot(remoteNew, {
      capturedAt: '2026-05-31T00:00:00Z'
    });
    const merged = importPreferencesSnapshot(localOld, snapshot, {
      mergeStrategy: 'merge-newer-wins'
    });
    expect(merged.blockedActors['actor_x']?.reasonCode).toBe('new-reason');
  });

  it('validateLocalControlSnapshot rejects unknown schema versions (fail-closed)', () => {
    expect(() =>
      validateLocalControlSnapshot({
        schema: 'lfp2p.local-control-snapshot.v999',
        capturedAt: '2026-05-31T00:00:00Z',
        blockedActors: {},
        allowlistedActors: {},
        mutedActors: {},
        blockedDomains: {},
        mutedKeywords: {},
        mutedThreads: {},
        hiddenPosts: {},
        labelPreferences: {},
        policyListSubscriptions: {},
        notificationPreferences: {}
      })
    ).toThrow(/TS_UNKNOWN_VERSION/);
  });

  it('assertSnapshotIsNotStale refuses to roll backward', () => {
    const state = importPreferencesSnapshot(
      createEmptyLocalControlState(),
      exportPreferencesSnapshot(createEmptyLocalControlState(), {
        capturedAt: '2026-05-31T00:00:00Z'
      })
    );
    expect(() =>
      assertSnapshotIsNotStale(state, '2026-04-01T00:00:00Z')
    ).toThrow(/older than the currently applied snapshot/);
    // forward-in-time is fine
    expect(() =>
      assertSnapshotIsNotStale(state, '2026-06-01T00:00:00Z')
    ).not.toThrow();
  });

  it('safety.preferences.snapshot event cannot be applied via applyLocalControlEvent', () => {
    expect(() =>
      applyLocalControlEvent(createEmptyLocalControlState(), {
        version: 'lfp2p.local-control-event.v1',
        eventId: 'e1',
        createdAt: '2026-05-31T00:00:00Z',
        action: 'apply',
        kind: 'safety.preferences.snapshot',
        snapshotId: 'snap_1',
        capturedAt: '2026-05-31T00:00:00Z',
        snapshot: { schema: 'lfp2p.local-control-snapshot.v1', capturedAt: '2026-05-31T00:00:00Z' }
      })
    ).toThrow(/must be applied via importPreferencesSnapshot/);
  });
});
