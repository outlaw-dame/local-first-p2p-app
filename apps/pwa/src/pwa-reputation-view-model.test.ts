/**
 * Phase 1.8.9 — adversarial tests for `buildReputationView` and the
 * pure `projectEventsToGraphInputs` projection.
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createLocalFirstStore } from '@lfp2p/local-store';
import {
  emitAttestationPublished,
  emitAttestationRevoked,
  emitObservationRecorded
} from './pwa-reputation-emit.js';
import {
  buildReputationView,
  projectEventsToGraphInputs,
  REPUTATION_VIEW_VERSION
} from './pwa-reputation-view-model.js';

function freshStore(name: string): ReturnType<typeof createLocalFirstStore> {
  return createLocalFirstStore(
    `lfp2p-test-rep-view-${name}-${Math.random().toString(36).slice(2)}`
  );
}

const FIXED_NOW_ISO = '2026-06-01T12:00:00Z';

describe('buildReputationView — input validation', () => {
  it('throws on empty observerActorId', async () => {
    const store = freshStore('bad-observer');
    await expect(
      buildReputationView({ store, observerActorId: '' })
    ).rejects.toThrow(/observerActorId is required/);
  });
});

describe('buildReputationView — empty log', () => {
  it('returns a singleton entry for the seed with the documented version sentinel', async () => {
    const store = freshStore('empty');
    const view = await buildReputationView({
      store,
      observerActorId: 'alice',
      nowIso: FIXED_NOW_ISO
    });
    expect(view.version).toBe(REPUTATION_VIEW_VERSION);
    // The observer is the default seed at strength 1.0; with no
    // observation/attestation events the seed is the only node.
    expect(view.totalEventsLoaded).toBe(0);
    expect(view.totalEventsConsumed).toBe(0);
    expect(view.entries.length).toBe(1);
    expect(view.entries[0]!.subject).toBe('actor:alice');
    expect(view.entries[0]!.seedDistance).toBe(0);
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.entries)).toBe(true);
  });
});

describe('buildReputationView — observation flow', () => {
  it('a single observation produces a view entry with privacy-safe band', async () => {
    const store = freshStore('obs');
    await emitObservationRecorded({
      store,
      subject: { type: 'actor', actorId: 'bob' },
      observationKind: 'outbox.useful',
      satCount: 10,
      unsatCount: 0,
      windowStart: '2026-05-31T00:00:00Z',
      windowEnd: '2026-06-01T00:00:00Z'
    });
    const view = await buildReputationView({
      store,
      observerActorId: 'alice',
      nowIso: FIXED_NOW_ISO
    });
    expect(view.totalEventsLoaded).toBe(1);
    expect(view.totalEventsConsumed).toBe(1);
    expect(view.entries.length).toBeGreaterThan(0);
    // The user (alice) is the default seed; bob is the only observed
    // subject. Both should appear.
    const subjects = view.entries.map((e) => e.subject);
    expect(subjects).toContain('actor:alice');
    expect(subjects).toContain('actor:bob');
    // Each entry has a documented band.
    for (const entry of view.entries) {
      expect(['high', 'mid', 'low', 'untrusted']).toContain(entry.band);
    }
  });

  it('entries sorted descending by score (most-trusted first)', async () => {
    const store = freshStore('sort');
    await emitObservationRecorded({
      store,
      subject: { type: 'actor', actorId: 'bob' },
      observationKind: 'outbox.useful',
      satCount: 5,
      unsatCount: 0,
      windowStart: '2026-05-31T00:00:00Z',
      windowEnd: '2026-06-01T00:00:00Z'
    });
    await emitObservationRecorded({
      store,
      subject: { type: 'actor', actorId: 'carol' },
      observationKind: 'outbox.useful',
      satCount: 3,
      unsatCount: 0,
      windowStart: '2026-05-31T00:00:00Z',
      windowEnd: '2026-06-01T00:00:00Z'
    });
    const view = await buildReputationView({
      store,
      observerActorId: 'alice',
      nowIso: FIXED_NOW_ISO
    });
    // alice is the seed, so she has the highest score.
    for (let i = 1; i < view.entries.length; i++) {
      expect(view.entries[i - 1]!.score).toBeGreaterThanOrEqual(
        view.entries[i]!.score
      );
    }
  });
});

describe('buildReputationView — attestation flow + fingerprint amplifier', () => {
  it('fingerprint-verified attestation produces a high-confidence entry for the subject', async () => {
    const store = freshStore('att-fp');
    await emitAttestationPublished({
      store,
      subject: { type: 'actor', actorId: 'bob' },
      valence: 'positive',
      contextTag: 'contact.verified-in-person',
      strength: 1.0
    });
    const view = await buildReputationView({
      store,
      observerActorId: 'alice',
      nowIso: FIXED_NOW_ISO
    });
    const bob = view.entries.find((e) => e.subject === 'actor:bob');
    expect(bob).toBeDefined();
    expect(bob!.score).toBeGreaterThan(0);
  });

  it('revocation removes a matching attestation from the view', async () => {
    const store = freshStore('rev');
    const att = await emitAttestationPublished({
      store,
      subject: { type: 'actor', actorId: 'mallory' },
      valence: 'positive',
      contextTag: 'community.contributor',
      strength: 0.5,
      eventId: 'evt_rep_att_revocable'
    });
    expect(att.kind).toBe('reputation.attestation.published');

    const before = await buildReputationView({
      store,
      observerActorId: 'alice',
      nowIso: FIXED_NOW_ISO
    });
    expect(
      before.entries.find((e) => e.subject === 'actor:mallory')
    ).toBeDefined();

    await emitAttestationRevoked({
      store,
      attestationId: 'evt_rep_att_revocable',
      eventId: 'evt_rep_att_revoked'
    });

    const after = await buildReputationView({
      store,
      observerActorId: 'alice',
      nowIso: FIXED_NOW_ISO
    });
    expect(
      after.entries.find((e) => e.subject === 'actor:mallory')
    ).toBeUndefined();
  });
});

describe('buildReputationView — replay determinism', () => {
  it('two calls with the same log + nowIso produce byte-identical views', async () => {
    const store = freshStore('replay');
    await emitObservationRecorded({
      store,
      subject: { type: 'actor', actorId: 'bob' },
      observationKind: 'outbox.useful',
      satCount: 7,
      unsatCount: 1,
      windowStart: '2026-05-30T00:00:00Z',
      windowEnd: '2026-06-01T00:00:00Z'
    });
    const a = await buildReputationView({
      store,
      observerActorId: 'alice',
      nowIso: FIXED_NOW_ISO
    });
    const b = await buildReputationView({
      store,
      observerActorId: 'alice',
      nowIso: FIXED_NOW_ISO
    });
    expect(JSON.stringify(a.entries)).toBe(JSON.stringify(b.entries));
  });
});

describe('projectEventsToGraphInputs — pure projection', () => {
  it('aggregator events are skipped (consumed by the Phase 1.8.4 runtime instead)', () => {
    const inputs = projectEventsToGraphInputs({
      events: [
        {
          version: 'lfp2p.reputation-event.v1',
          eventId: 'evt_agg_skip',
          createdAt: FIXED_NOW_ISO,
          kind: 'reputation.aggregator.published',
          algorithm: 'openrank.v1',
          computedAt: FIXED_NOW_ISO,
          subjects: Object.freeze([
            Object.freeze({
              subject: Object.freeze({ type: 'actor' as const, actorId: 'carol' }),
              score: 0.5,
              confidence: 0.5,
              observationCount: 1
            })
          ])
        }
      ],
      observerActorId: 'alice',
      nowIso: FIXED_NOW_ISO
    });
    // The aggregator event is silently dropped from the local-computer
    // projection — it feeds the Phase 1.8.4 aggregator runtime instead.
    expect(inputs.observations.length).toBe(0);
    expect(inputs.attestations.length).toBe(0);
  });

  it('explicit seed contacts override the default singleton', () => {
    const inputs = projectEventsToGraphInputs({
      events: [],
      observerActorId: 'alice',
      nowIso: FIXED_NOW_ISO,
      seedContacts: [
        { actorId: 'bob', strength: 0.8 },
        { actorId: 'carol', strength: 0.5, attestedAt: '2026-05-15T00:00:00Z' }
      ]
    });
    expect(inputs.seedContacts.length).toBe(2);
    expect(inputs.seedContacts[0]!.subject).toBe('actor:bob');
    expect(inputs.seedContacts[1]!.subject).toBe('actor:carol');
    expect(inputs.seedContacts[1]!.attestedAt).toBe('2026-05-15T00:00:00Z');
  });

  it('default seed = observer at strength 1.0', () => {
    const inputs = projectEventsToGraphInputs({
      events: [],
      observerActorId: 'alice',
      nowIso: FIXED_NOW_ISO
    });
    expect(inputs.seedContacts.length).toBe(1);
    expect(inputs.seedContacts[0]).toMatchObject({
      subject: 'actor:alice',
      strength: 1.0
    });
  });

  it('observation event projects observer = `actor:<observerActorId>`', () => {
    const inputs = projectEventsToGraphInputs({
      events: [
        {
          version: 'lfp2p.reputation-event.v1',
          eventId: 'evt_obs',
          createdAt: FIXED_NOW_ISO,
          kind: 'reputation.observation.recorded',
          subject: { type: 'actor', actorId: 'bob' },
          observationKind: 'outbox.useful',
          satCount: 1,
          unsatCount: 0,
          windowStart: '2026-05-25T00:00:00Z',
          windowEnd: '2026-06-01T00:00:00Z'
        }
      ],
      observerActorId: 'alice',
      nowIso: FIXED_NOW_ISO
    });
    expect(inputs.observations[0]).toMatchObject({
      observer: 'actor:alice',
      subject: 'actor:bob'
    });
  });
});
