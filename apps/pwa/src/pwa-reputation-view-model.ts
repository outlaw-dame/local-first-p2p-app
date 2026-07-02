/**
 * Phase 1.8.9 — PWA reputation view-model.
 *
 * Pure logic that loads the locally-emitted reputation events from
 * Dexie (`loadReputationEvents`), converts them into the
 * `ReputationGraphInputs` shape the Phase 1.8.2 computer takes, and
 * runs `computeReputation` to produce a per-subject view.
 *
 * Discipline:
 *
 *   1. Privacy-safe per Phase 3.1: the produced view exposes the
 *      doctrine band (`high` / `mid` / `low` / `untrusted`) as a
 *      stable string AND the raw `score` for the data panel that
 *      the user explicitly opened to inspect their reputation
 *      state. Privacy-sensitive audit chrome (logs, exports)
 *      should consume the band ONLY.
 *
 *   2. Local-first per the Phase 1.8 doctrine: the observer for
 *      every locally-emitted observation / attestation /
 *      revocation is the device's actor id. Cross-device
 *      observations are out of scope for this slice (deferred).
 *
 *   3. Phase 3.2 frozen output: the returned view is deep-frozen.
 *      Replay-equivalent given the same inputs.
 *
 *   4. Seed contact defaults: when the caller supplies no explicit
 *      seed contacts, the observer is seeded as their own contact
 *      at strength 1.0 — the user is always at least their own
 *      seed. Callers wiring Phase 2.3 contact graph data pass the
 *      contact list explicitly.
 */
import {
  computeReputation,
  getReputationBand,
  subjectRefToKey,
  type AttestationRecord,
  type ObservationRecord,
  type ReputationEvent,
  type ReputationGraphInputs,
  type RevocationRecord,
  type SeedContact,
  type SubjectKey,
  type ReputationBand
} from '@lfp2p/trust-safety';
import type { SafetySubjectRef } from '@lfp2p/trust-safety';
import type { createLocalFirstStore } from '@lfp2p/local-store';

type Store = ReturnType<typeof createLocalFirstStore>;

/**
 * Caller input. The observer actor id identifies "the user" — the
 * signing author of every locally-emitted observation /
 * attestation. Defaults: nowIso = now, seedContacts = singleton
 * seed of the observer at strength 1.0.
 */
export type BuildReputationViewInput = Readonly<{
  store: Store;
  /** The user's stable actor id. Used as the observer for every
   *  locally-emitted reputation event AND as the default seed. */
  observerActorId: string;
  /** Optional explicit seed contacts. When omitted, defaults to the
   *  singleton seed of `observerActorId` at strength 1.0. */
  seedContacts?: ReadonlyArray<
    Readonly<{
      actorId: string;
      strength: number;
      attestedAt?: string;
    }>
  >;
  /** Optional reference clock. Defaults to `new Date().toISOString()`. */
  nowIso?: string;
}>;

/**
 * Per-subject row the UI renders. The `band` field is the
 * privacy-safe stable string Phase 3.1 callers should log; `score`
 * + `confidence` + `seedDistance` are the explicit data fields the
 * user opened the panel to inspect.
 */
export type ReputationViewEntry = Readonly<{
  subject: SubjectKey;
  score: number;
  band: ReputationBand;
  confidence: number;
  seedDistance: number;
}>;

export type ReputationView = Readonly<{
  version: 'lfp2p.pwa-reputation-view.v1';
  computedAtMs: number;
  totalEventsLoaded: number;
  totalEventsConsumed: number;
  truncated: boolean;
  convergedWithinIterations: boolean;
  /** Sorted ascending by score (highest first). Privacy-safe band on each row. */
  entries: ReadonlyArray<ReputationViewEntry>;
}>;

export const REPUTATION_VIEW_VERSION = 'lfp2p.pwa-reputation-view.v1' as const;

/**
 * Load the locally-persisted reputation event log, run the Phase
 * 1.8.2 computer over it, and return a frozen view. Pure on its
 * arguments + store contents.
 */
export async function buildReputationView(
  input: BuildReputationViewInput
): Promise<ReputationView> {
  if (typeof input.observerActorId !== 'string' || input.observerActorId.length === 0) {
    throw new Error('buildReputationView: observerActorId is required');
  }
  const nowIso = input.nowIso ?? new Date().toISOString();
  const events = await input.store.loadReputationEvents();
  const inputs = projectEventsToGraphInputs({
    events,
    observerActorId: input.observerActorId,
    nowIso,
    ...(input.seedContacts === undefined ? {} : { seedContacts: input.seedContacts })
  });
  const state = computeReputation(inputs);
  const totalConsumed =
    inputs.observations.length + inputs.attestations.length + inputs.revocations.length;
  const rows: ReputationViewEntry[] = [];
  for (const [subject, score] of state.scores) {
    rows.push(
      Object.freeze({
        subject,
        score: score.score,
        band: getReputationBand(score.score),
        confidence: score.confidence,
        seedDistance: score.seedDistance
      })
    );
  }
  // Sort descending by score so the most-trusted subjects render
  // first; ties broken by ascending subject id (replay-deterministic).
  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0;
  });
  return Object.freeze({
    version: REPUTATION_VIEW_VERSION,
    computedAtMs: state.computedAtMs,
    totalEventsLoaded: events.length,
    totalEventsConsumed: totalConsumed,
    truncated: state.truncated,
    convergedWithinIterations: state.convergedWithinIterations,
    entries: Object.freeze(rows)
  });
}

/* -------------------------------------------------------------------------- */
/*                          internal projection                               */
/* -------------------------------------------------------------------------- */

/**
 * Pure projection from the raw event log into the four input arrays
 * the Phase 1.8.2 computer takes. Exported for unit testing.
 *
 * Aggregator events (`reputation.aggregator.published` /
 * `reputation.aggregator.score.removed`) are intentionally NOT
 * consumed here — they feed the Phase 1.8.4 aggregator runtime,
 * not the local computer.
 */
export type ProjectEventsToGraphInputsArgs = Readonly<{
  events: ReadonlyArray<ReputationEvent>;
  observerActorId: string;
  seedContacts?: ReadonlyArray<
    Readonly<{
      actorId: string;
      strength: number;
      attestedAt?: string;
    }>
  >;
  nowIso: string;
}>;

export function projectEventsToGraphInputs(
  args: ProjectEventsToGraphInputsArgs
): ReputationGraphInputs {
  const observer = `actor:${args.observerActorId}`;
  const observations: ObservationRecord[] = [];
  const attestations: AttestationRecord[] = [];
  const revocations: RevocationRecord[] = [];
  for (const evt of args.events) {
    switch (evt.kind) {
      case 'reputation.observation.recorded': {
        observations.push(
          Object.freeze({
            observer,
            subject: subjectKeyFromRef(evt.subject),
            observationKind: evt.observationKind,
            satCount: evt.satCount,
            unsatCount: evt.unsatCount,
            windowStart: evt.windowStart,
            windowEnd: evt.windowEnd,
            createdAt: evt.createdAt
          })
        );
        break;
      }
      case 'reputation.attestation.published': {
        attestations.push(
          Object.freeze({
            observer,
            attestationId: evt.eventId,
            subject: subjectKeyFromRef(evt.subject),
            valence: evt.valence,
            contextTag: evt.contextTag,
            strength: evt.strength,
            createdAt: evt.createdAt,
            ...(evt.expiresAt === undefined ? {} : { expiresAt: evt.expiresAt })
          })
        );
        break;
      }
      case 'reputation.attestation.revoked': {
        revocations.push(
          Object.freeze({
            observer,
            attestationId: evt.attestationId,
            revokedAt: evt.revokedAt
          })
        );
        break;
      }
      case 'reputation.aggregator.published':
      case 'reputation.aggregator.score.removed':
        // Consumed by the Phase 1.8.4 aggregator runtime, not the
        // local computer. Skip silently.
        break;
    }
  }
  const seedContacts: SeedContact[] =
    args.seedContacts !== undefined && args.seedContacts.length > 0
      ? args.seedContacts.map((c) =>
          Object.freeze({
            subject: `actor:${c.actorId}`,
            strength: c.strength,
            attestedAt: c.attestedAt ?? args.nowIso
          })
        )
      : [
          Object.freeze({
            subject: observer,
            strength: 1.0,
            attestedAt: args.nowIso
          })
        ];
  return Object.freeze({
    observations: Object.freeze(observations),
    attestations: Object.freeze(attestations),
    revocations: Object.freeze(revocations),
    seedContacts: Object.freeze(seedContacts),
    nowIso: args.nowIso
  });
}

/* -------------------------------------------------------------------------- */
/*                              helpers                                       */
/* -------------------------------------------------------------------------- */

function subjectKeyFromRef(ref: SafetySubjectRef): SubjectKey {
  // Delegated to the canonical Phase 1.8.2 helper — no drift, no
  // duplication. This is the single source of truth for canonical
  // subject keys across the reputation graph track.
  return subjectRefToKey(ref);
}
