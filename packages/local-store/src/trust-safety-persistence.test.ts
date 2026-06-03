/**
 * Phase 1.70.B — Dexie persistence of LocalControlState and
 * LabelersState.
 *
 * The store is event-sourced: it appends validated events and rebuilds
 * the frozen projection on read by replaying the log. Round-trip is
 * byte-equivalent to the in-memory result; replay is pure and
 * idempotent on `eventId`.
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  type LabelerEvent,
  type LocalControlEvent,
  applyLabelerEvent,
  applyLocalControlEvent,
  createEmptyLabelersState,
  createEmptyLocalControlState,
  validateLabelerEvent,
  validateLocalControlEvent
} from '@lfp2p/trust-safety';
import { createLocalFirstStore } from './index.js';

function controlEvent(
  eventId: string,
  body: Record<string, unknown>
): LocalControlEvent {
  return validateLocalControlEvent({
    version: 'lfp2p.local-control-event.v1',
    eventId,
    createdAt: '2026-06-02T00:00:00Z',
    action: 'apply',
    ...body
  });
}

function labelerProfileEvent(
  eventId: string,
  labelerId: string,
  supportedLabels: string[]
): LabelerEvent {
  return validateLabelerEvent({
    version: 'lfp2p.labeler-event.v1',
    eventId,
    createdAt: '2026-06-02T00:00:00Z',
    kind: 'safety.labeler.profile.published',
    profile: {
      version: 'lfp2p.safety-labeler-profile.v1',
      labelerId,
      actorId: `actor_${labelerId}`,
      displayName: labelerId,
      supportedNamespaces: ['lfp2p.safety'],
      supportedLabels,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-06-02T00:00:00Z'
    }
  });
}

describe('Phase 1.70.B — LocalControlState persistence', () => {
  it('round-trips a sequence of events through Dexie', async () => {
    const store = createLocalFirstStore(`ts-ctl-${globalThis.crypto.randomUUID()}`);
    try {
      const events: LocalControlEvent[] = [
        controlEvent('evt_block_1', {
          kind: 'safety.account.blocked',
          targetActorId: 'actor_spammer'
        }),
        controlEvent('evt_kw_phrase_1', {
          kind: 'safety.keyword.muted',
          keyword: 'election fraud',
          matchKind: 'phrase'
        }),
        controlEvent('evt_kw_tag_1', {
          kind: 'safety.keyword.muted',
          keyword: '#Spoilers',
          matchKind: 'hashtag'
        }),
        controlEvent('evt_gate_1', {
          kind: 'safety.adult-content.gate.set',
          enabled: true,
          gatedAt: '2026-06-02T00:00:00Z'
        })
      ];
      for (const e of events) await store.appendTrustSafetyControlEvent(e);

      const persisted = await store.loadLocalControlState();

      let expected = createEmptyLocalControlState();
      for (const e of events) expected = applyLocalControlEvent(expected, e);

      expect(persisted).toEqual(expected);
      expect(persisted.adultContentGate?.enabled).toBe(true);
      expect(persisted.blockedActors.actor_spammer).toBeDefined();
      expect(Object.keys(persisted.mutedKeywords).length).toBe(2);
    } finally {
      await store.delete();
    }
  });

  it('is idempotent on eventId — a re-append is a no-op', async () => {
    const store = createLocalFirstStore(`ts-ctl-idem-${globalThis.crypto.randomUUID()}`);
    try {
      const e = controlEvent('evt_dup_1', {
        kind: 'safety.account.blocked',
        targetActorId: 'actor_x'
      });
      await store.appendTrustSafetyControlEvent(e);
      await store.appendTrustSafetyControlEvent(e);
      await store.appendTrustSafetyControlEvent(e);

      const rows = await store.listTrustSafetyControlEvents();
      expect(rows.length).toBe(1);
    } finally {
      await store.delete();
    }
  });

  it('rejects a malformed event at append-time', async () => {
    const store = createLocalFirstStore(`ts-ctl-bad-${globalThis.crypto.randomUUID()}`);
    try {
      // matchKind=regex is structurally rejected (ReDoS guard).
      await expect(
        store.appendTrustSafetyControlEvent({
          version: 'lfp2p.local-control-event.v1',
          eventId: 'evt_bad',
          createdAt: '2026-06-02T00:00:00Z',
          action: 'apply',
          kind: 'safety.keyword.muted',
          keyword: '.*',
          matchKind: 'regex'
        } as unknown as LocalControlEvent)
      ).rejects.toThrow(/TS_INVALID_ENUM/);
    } finally {
      await store.delete();
    }
  });

  it('survives store close + reopen with stable replay', async () => {
    const dbName = `ts-ctl-reopen-${globalThis.crypto.randomUUID()}`;
    const a = createLocalFirstStore(dbName);
    try {
      await a.appendTrustSafetyControlEvent(
        controlEvent('evt_keep_1', {
          kind: 'safety.keyword.muted',
          keyword: 'spoilers',
          matchKind: 'hashtag'
        })
      );
    } finally {
      await a.close();
    }
    const b = createLocalFirstStore(dbName);
    try {
      const state = await b.loadLocalControlState();
      expect(state.mutedKeywords.spoilers).toBeDefined();
    } finally {
      await b.delete();
    }
  });
});

describe('Phase 1.70.B — LabelersState persistence', () => {
  it('round-trips a profile + subscription through Dexie', async () => {
    const store = createLocalFirstStore(`ts-lab-${globalThis.crypto.randomUUID()}`);
    try {
      const events: LabelerEvent[] = [
        labelerProfileEvent('evt_prof_1', 'labeler_a', ['security.spam']),
        validateLabelerEvent({
          version: 'lfp2p.labeler-event.v1',
          eventId: 'evt_sub_1',
          createdAt: '2026-06-02T00:00:00Z',
          kind: 'safety.labeler.subscribed',
          subscription: {
            version: 'lfp2p.safety-labeler-subscription.v1',
            subscriptionId: 'sub_1',
            subscriberActorId: 'actor_user',
            labelerId: 'labeler_a',
            trustedNamespaces: ['lfp2p.safety'],
            scope: 'account-local',
            createdAt: '2026-06-02T00:00:00Z'
          }
        })
      ];
      for (const e of events) await store.appendTrustSafetyLabelerEvent(e);

      const persisted = await store.loadLabelersState();

      let expected = createEmptyLabelersState();
      for (const e of events) expected = applyLabelerEvent(expected, e);
      expect(persisted).toEqual(expected);
      expect(persisted.labelerProfilesById.labeler_a).toBeDefined();
      expect(persisted.subscriptionsById.sub_1).toBeDefined();
    } finally {
      await store.delete();
    }
  });
});
