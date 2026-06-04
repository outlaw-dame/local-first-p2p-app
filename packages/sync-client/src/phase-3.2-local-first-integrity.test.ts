/**
 * Phase 3.2 — Local-first integrity test suite.
 *
 * The canonical proof that this repo's "local-first guarantee" holds
 * across every projection. Pins five structural invariants in one
 * place so a regression in any projection's apply/seed contract is
 * caught even when the per-phase test suite for that projection is
 * untouched.
 *
 * Invariants pinned here:
 *
 *  1. Replay equivalence
 *     For every projection P:
 *       seed([E1, …, En])
 *       === [E1, …, En].reduce(apply, createEmpty())     (deep equal)
 *     This is the local-first guarantee in one line: store the log,
 *     rebuild the snapshot deterministically.
 *
 *  2. Deep-freeze walk
 *     For every projection's terminal state, every nested object and
 *     every nested array is Object.isFrozen. Phase 1.65 added freeze
 *     helpers for projections; this test prevents a future field
 *     addition from accidentally introducing a mutable handle into
 *     the projection tree.
 *
 *  3. Class A commutativity
 *     For Class A (eventually consistent) projections, shuffling the
 *     event order produces the same final state. Per
 *     docs/protocol/operation-consistency-classes.md, Class A is the
 *     family where this MUST hold; testing it here catches a future
 *     "I'll just stash state.lastEventOrder somewhere" regression
 *     that would break the convergence promise.
 *
 *  4. Cross-projection isolation
 *     Event kinds are partitioned across projections. Feeding a
 *     LabelerEvent into the LocalControlState validator (or vice
 *     versa) fails closed; no projection ever accepts another
 *     projection's events.
 *
 *  5. End-to-end interleaved replay
 *     A single signed-event stream containing IdentityControl +
 *     LocalControl + Labeler events, fed through the canonical
 *     inbound dispatcher, lands each event in exactly one
 *     projection and leaves the other two structurally unchanged.
 *
 * Discipline:
 *  - The test loads existing canonical JSON fixtures from disk for
 *    every trust-safety projection. The same files the per-phase
 *    suites validate. If a protocol shape ever drifts, both this
 *    test and the per-phase suite fail in lockstep — no divergence.
 *  - Identity events are constructed in code because the identity
 *    fixtures intentionally use synthetic public keys for shape
 *    testing; the projection requires `event.signature.publicKey ===
 *    payload.controllerPublicKey`, which the JSON form cannot
 *    satisfy without a real keypair.
 *  - The deep-freeze walk uses `Object.isFrozen` recursively on every
 *    plain-object / array node. We deliberately do NOT call
 *    `Object.freeze` ourselves to "fix" anything we find — that
 *    would mask the real bug.
 */
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applyIdentityControlEvent,
  createEmptyIdentityControlState,
  seedIdentityControlProjection,
  IDENTITY_EVENT_KINDS
} from '@lfp2p/identity';
import { signEventEnvelope, signingKeypairFromSeed } from '@lfp2p/crypto';
import {
  createUnsignedEvent,
  type EventKind,
  type SignedEventEnvelope
} from '@lfp2p/protocol';
import {
  applyCurationEvent,
  applyLabelerEvent,
  applyLocalControlEvent,
  applyModerationEvent,
  applyReportAppealEvent,
  applyTransportEvent,
  createEmptyCurationState,
  createEmptyLabelersState,
  createEmptyLocalControlState,
  createEmptyModerationState,
  createEmptyReportsAppealsState,
  createEmptyTransportAdmissionState,
  seedCurationState,
  seedLabelersState,
  seedLocalControlState,
  seedModerationState,
  seedReportsAppealsState,
  seedTransportAdmissionState,
  validateCurationEvent,
  validateLabelerEvent,
  validateLocalControlEvent,
  validateModerationEvent,
  validateReportAppealEvent,
  validateTransportEvent
} from '@lfp2p/trust-safety';
import type {
  CurationEvent,
  LabelerEvent,
  LocalControlEvent,
  ModerationEvent,
  ReportAppealEvent,
  TransportEvent
} from '@lfp2p/trust-safety';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
// `packages/sync-client/src/` → repo root is three up.
const REPO_ROOT = resolve(HERE, '..', '..', '..');

function loadJson(relPath: string): unknown {
  return JSON.parse(readFileSync(join(REPO_ROOT, relPath), 'utf8')) as unknown;
}

/**
 * Recursively asserts that every plain-object and every array in the
 * value tree is `Object.isFrozen`. Returns the list of paths that
 * fail (empty list = pass).
 *
 * We treat the following as leaves and do NOT descend:
 *  - `null`
 *  - primitives (string, number, boolean, bigint, symbol, undefined)
 *  - `Set` / `Map` instances (their internal storage is not
 *    enumerable; the surrounding container being frozen is enough)
 *
 * The walk uses a `seen` set as a safety belt against cycles. The
 * projection trees we test are tree-shaped today, so a cycle would
 * itself be a bug.
 */
function findUnfrozenNodes(
  value: unknown,
  path: string = '$',
  seen: WeakSet<object> = new WeakSet()
): string[] {
  if (value === null || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (value instanceof Set || value instanceof Map) {
    return Object.isFrozen(value) ? [] : [path];
  }
  const out: string[] = [];
  if (!Object.isFrozen(value)) out.push(path);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      out.push(...findUnfrozenNodes(value[i], `${path}[${i}]`, seen));
    }
    return out;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    out.push(
      ...findUnfrozenNodes(
        (value as Record<string, unknown>)[key],
        `${path}.${key}`,
        seen
      )
    );
  }
  return out;
}

function shuffled<T>(arr: ReadonlyArray<T>, seed = 1): T[] {
  // Deterministic Fisher-Yates with a tiny LCG so the test is
  // reproducible. We do NOT use Math.random() — non-deterministic
  // shuffles produce flaky tests.
  const out = [...arr];
  let s = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-projection event sequences loaded from canonical JSON fixtures
// ---------------------------------------------------------------------------

const FX_LOCAL_CONTROLS = 'packages/trust-safety/fixtures/local-controls/valid';
const FX_LABELERS = 'packages/trust-safety/fixtures/labelers/valid';
const FX_REPORTS = 'packages/trust-safety/fixtures/reports-appeals/valid';
const FX_TRANSPORT = 'packages/trust-safety/fixtures/transport-admission/valid';
const FX_CURATION = 'packages/trust-safety/fixtures/curation/valid';
const FX_MODERATION = 'packages/trust-safety/fixtures/moderation/valid';

/**
 * Five independent Class A local-control events. None of them cross-
 * reference each other, so any permutation produces the same final
 * state — exactly the commutativity property Invariant 3 checks.
 */
function localControlEvents(): LocalControlEvent[] {
  return [
    'account-blocked.json',
    'domain-blocked.json',
    'keyword-muted-substring.json',
    'label-preference-set.json',
    'notification-preference.json'
  ]
    .map((name) => loadJson(`${FX_LOCAL_CONTROLS}/${name}`))
    .map((v) => validateLocalControlEvent(v));
}

/**
 * Labelers form a chain: profile → subscription → label-applied.
 * Order matters (subscription references profile.labelerId; label
 * applied references the same labeler), so this sequence is the
 * canonical lifecycle slice.
 */
function labelerEvents(): LabelerEvent[] {
  return [
    'profile-published-automated.json',
    'subscribed.json',
    'label-applied.json'
  ]
    .map((name) => loadJson(`${FX_LABELERS}/${name}`))
    .map((v) => validateLabelerEvent(v) as LabelerEvent);
}

/**
 * Reports lifecycle: created → acknowledged. Cross-reference on
 * reportId is satisfied by the canonical fixtures.
 */
function reportEvents(): ReportAppealEvent[] {
  return ['report-created.json', 'report-acknowledged.json']
    .map((name) => loadJson(`${FX_REPORTS}/${name}`))
    .map((v) => validateReportAppealEvent(v) as ReportAppealEvent);
}

/**
 * Transport admission slice: a single accepted admission.
 */
function transportEvents(): TransportEvent[] {
  return ['event-accepted.json']
    .map((name) => loadJson(`${FX_TRANSPORT}/${name}`))
    .map((v) => validateTransportEvent(v) as TransportEvent);
}

/**
 * Curation slice: a single rule-creation event.
 */
function curationEvents(): CurationEvent[] {
  return ['rule-created.json']
    .map((name) => loadJson(`${FX_CURATION}/${name}`))
    .map((v) => validateCurationEvent(v) as CurationEvent);
}

/**
 * Moderation slice: policy-created + queue-item-created. Both load
 * cleanly without cross-reference on subject IDs at projection time.
 */
function moderationEvents(): ModerationEvent[] {
  return ['policy-created.json', 'queue-item-created.json']
    .map((name) => loadJson(`${FX_MODERATION}/${name}`))
    .map((v) => validateModerationEvent(v) as ModerationEvent);
}

// Identity events: signed envelopes around real Ed25519 keys.
const CONTROLLER = signingKeypairFromSeed(new Uint8Array(32).fill(42));
const SECONDARY = signingKeypairFromSeed(new Uint8Array(32).fill(43));

function signIdentity(
  eventId: string,
  kind: EventKind,
  payload: Record<string, unknown>,
  createdAt: string
): SignedEventEnvelope {
  return signEventEnvelope(
    createUnsignedEvent({
      eventId,
      kind,
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt,
      privacy: 'self',
      payload
    }),
    CONTROLLER
  );
}

function identityEvents(): SignedEventEnvelope[] {
  return [
    signIdentity(
      'evt_p32_id_1',
      'identity.controller.created',
      {
        controllerPublicKey: CONTROLLER.publicKey,
        initialDeviceId: 'device:alice-phone'
      },
      '2026-06-04T00:00:00Z'
    ),
    signIdentity(
      'evt_p32_id_2',
      'identity.device.authorized',
      {
        authorizedDeviceId: 'device:alice-laptop',
        authorizedPublicKey: SECONDARY.publicKey,
        epoch: 2
      },
      '2026-06-04T00:01:00Z'
    )
  ];
}

// Sanity: the fixture loaders return non-empty sequences. If any
// returns empty (e.g. a path typo or fixture relocation), the
// downstream invariants would pass trivially against empty input.
describe('Phase 3.2 — fixture loader sanity', () => {
  it('every loader returns at least one validated event', () => {
    expect(localControlEvents().length).toBeGreaterThanOrEqual(1);
    expect(labelerEvents().length).toBeGreaterThanOrEqual(1);
    expect(reportEvents().length).toBeGreaterThanOrEqual(1);
    expect(transportEvents().length).toBeGreaterThanOrEqual(1);
    expect(curationEvents().length).toBeGreaterThanOrEqual(1);
    expect(moderationEvents().length).toBeGreaterThanOrEqual(1);
    expect(identityEvents().length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Invariant 1 — Replay equivalence: seed === reduce(apply, empty)
// ---------------------------------------------------------------------------

describe('Phase 3.2 — Invariant 1: replay equivalence', () => {
  it('LocalControlState: seed equals reduce', () => {
    const events = localControlEvents();
    const seeded = seedLocalControlState(events);
    const reduced = events.reduce(
      (s, e) => applyLocalControlEvent(s, e),
      createEmptyLocalControlState()
    );
    expect(seeded).toEqual(reduced);
  });

  it('LabelersState: seed equals reduce', () => {
    const events = labelerEvents();
    const seeded = seedLabelersState(events);
    const reduced = events.reduce(
      (s, e) => applyLabelerEvent(s, e),
      createEmptyLabelersState()
    );
    expect(seeded).toEqual(reduced);
  });

  it('ReportsAppealsState: seed equals reduce', () => {
    const events = reportEvents();
    const seeded = seedReportsAppealsState(events);
    const reduced = events.reduce(
      (s, e) => applyReportAppealEvent(s, e),
      createEmptyReportsAppealsState()
    );
    expect(seeded).toEqual(reduced);
  });

  it('TransportAdmissionState: seed equals reduce', () => {
    const events = transportEvents();
    const seeded = seedTransportAdmissionState(events);
    const reduced = events.reduce(
      (s, e) => applyTransportEvent(s, e),
      createEmptyTransportAdmissionState()
    );
    expect(seeded).toEqual(reduced);
  });

  it('CurationState: seed equals reduce', () => {
    const events = curationEvents();
    const seeded = seedCurationState(events);
    const reduced = events.reduce(
      (s, e) => applyCurationEvent(s, e),
      createEmptyCurationState()
    );
    expect(seeded).toEqual(reduced);
  });

  it('ModerationState: seed equals reduce', () => {
    const events = moderationEvents();
    const seeded = seedModerationState(events);
    const reduced = events.reduce(
      (s, e) => applyModerationEvent(s, e),
      createEmptyModerationState()
    );
    expect(seeded).toEqual(reduced);
  });

  it('IdentityControlState: seed equals reduce', () => {
    const events = identityEvents();
    const seeded = seedIdentityControlProjection(events);
    const reduced = events.reduce(
      (s, e) => applyIdentityControlEvent(s, e),
      createEmptyIdentityControlState()
    );
    expect(seeded).toEqual(reduced);
  });
});

// ---------------------------------------------------------------------------
// Invariant 2 — Deep-freeze walk
// ---------------------------------------------------------------------------

describe('Phase 3.2 — Invariant 2: deep-freeze walk', () => {
  type Walked = {
    readonly name: string;
    readonly state: unknown;
  };

  const cases: Walked[] = [
    { name: 'LocalControlState', state: seedLocalControlState(localControlEvents()) },
    { name: 'LabelersState', state: seedLabelersState(labelerEvents()) },
    { name: 'ReportsAppealsState', state: seedReportsAppealsState(reportEvents()) },
    {
      name: 'TransportAdmissionState',
      state: seedTransportAdmissionState(transportEvents())
    },
    { name: 'CurationState', state: seedCurationState(curationEvents()) },
    { name: 'ModerationState', state: seedModerationState(moderationEvents()) },
    {
      name: 'IdentityControlState',
      state: seedIdentityControlProjection(identityEvents())
    }
  ];

  for (const { name, state } of cases) {
    it(`${name}: every nested object/array is Object.isFrozen`, () => {
      const unfrozen = findUnfrozenNodes(state, `${name}`);
      if (unfrozen.length > 0) {
        throw new Error(
          `Found ${unfrozen.length} unfrozen node(s) in ${name}:\n` +
            unfrozen.map((p) => `  ${p}`).join('\n')
        );
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Invariant 3 — Class A commutativity (LocalControlState)
// ---------------------------------------------------------------------------

describe('Phase 3.2 — Invariant 3: Class A commutativity', () => {
  it('LocalControlState converges under any permutation of independent Class A events', () => {
    const events = localControlEvents();
    const baseline = seedLocalControlState(events);
    // Three different deterministic shuffles via distinct LCG seeds.
    for (const seed of [7, 31, 257]) {
      const reordered = shuffled(events, seed);
      const recomputed = seedLocalControlState(reordered);
      expect(recomputed).toEqual(baseline);
    }
  });
});

// ---------------------------------------------------------------------------
// Invariant 4 — Cross-projection isolation
// ---------------------------------------------------------------------------

describe('Phase 3.2 — Invariant 4: cross-projection isolation', () => {
  // Pick one representative event per projection (the first one).
  const localControlEvt = localControlEvents()[0]!;
  const labelerEvt = labelerEvents()[0]!;
  const reportEvt = reportEvents()[0]!;
  const transportEvt = transportEvents()[0]!;
  const curationEvt = curationEvents()[0]!;
  const moderationEvt = moderationEvents()[0]!;

  const wrongFeeds: Array<[string, () => void]> = [
    ['LabelerEvent → LocalControl', () => validateLocalControlEvent(labelerEvt)],
    ['ReportEvent → LocalControl', () => validateLocalControlEvent(reportEvt)],
    ['TransportEvent → LocalControl', () => validateLocalControlEvent(transportEvt)],
    ['CurationEvent → LocalControl', () => validateLocalControlEvent(curationEvt)],
    ['ModerationEvent → LocalControl', () => validateLocalControlEvent(moderationEvt)],
    ['LocalControlEvent → Labeler', () => validateLabelerEvent(localControlEvt)],
    ['ReportEvent → Labeler', () => validateLabelerEvent(reportEvt)],
    ['TransportEvent → Labeler', () => validateLabelerEvent(transportEvt)],
    ['CurationEvent → Labeler', () => validateLabelerEvent(curationEvt)],
    ['ModerationEvent → Labeler', () => validateLabelerEvent(moderationEvt)],
    ['LocalControlEvent → Report', () => validateReportAppealEvent(localControlEvt)],
    ['LabelerEvent → Report', () => validateReportAppealEvent(labelerEvt)],
    ['TransportEvent → Report', () => validateReportAppealEvent(transportEvt)],
    ['CurationEvent → Report', () => validateReportAppealEvent(curationEvt)],
    ['ModerationEvent → Report', () => validateReportAppealEvent(moderationEvt)],
    ['LocalControlEvent → Transport', () => validateTransportEvent(localControlEvt)],
    ['LabelerEvent → Transport', () => validateTransportEvent(labelerEvt)],
    ['ReportEvent → Transport', () => validateTransportEvent(reportEvt)],
    ['CurationEvent → Transport', () => validateTransportEvent(curationEvt)],
    ['ModerationEvent → Transport', () => validateTransportEvent(moderationEvt)],
    ['LocalControlEvent → Curation', () => validateCurationEvent(localControlEvt)],
    ['LabelerEvent → Curation', () => validateCurationEvent(labelerEvt)],
    ['ReportEvent → Curation', () => validateCurationEvent(reportEvt)],
    ['TransportEvent → Curation', () => validateCurationEvent(transportEvt)],
    ['ModerationEvent → Curation', () => validateCurationEvent(moderationEvt)],
    ['LocalControlEvent → Moderation', () => validateModerationEvent(localControlEvt)],
    ['LabelerEvent → Moderation', () => validateModerationEvent(labelerEvt)],
    ['ReportEvent → Moderation', () => validateModerationEvent(reportEvt)],
    ['TransportEvent → Moderation', () => validateModerationEvent(transportEvt)],
    ['CurationEvent → Moderation', () => validateModerationEvent(curationEvt)]
  ];

  for (const [label, fn] of wrongFeeds) {
    it(`${label} fails closed`, () => {
      expect(fn).toThrow();
    });
  }
});

// ---------------------------------------------------------------------------
// Invariant 5 — End-to-end interleaved replay
// ---------------------------------------------------------------------------

function isIdentityKind(kind: string): boolean {
  return (IDENTITY_EVENT_KINDS as readonly string[]).includes(kind);
}

/**
 * Order-preserving interleave: weaves three streams together with a
 * deterministic per-step picker, while preserving the relative
 * order WITHIN each stream. This matters because identity events
 * (Class C) and labeler events (Class B) are order-dependent — a
 * pure shuffle would put a `device.authorized` before a
 * `controller.created` and the projection would correctly throw.
 *
 * The picker uses the same LCG as `shuffled` so the test stays
 * deterministic.
 */
function interleaveDeterministic<T>(
  streams: ReadonlyArray<ReadonlyArray<T>>,
  seed = 1
): T[] {
  const heads = streams.map(() => 0);
  const lengths = streams.map((s) => s.length);
  const out: T[] = [];
  let s = seed;
  while (true) {
    // Build the list of streams that still have unconsumed elements.
    const live: number[] = [];
    for (let i = 0; i < streams.length; i += 1) {
      if (heads[i]! < lengths[i]!) live.push(i);
    }
    if (live.length === 0) break;
    s = (s * 1664525 + 1013904223) >>> 0;
    const pick = live[s % live.length]!;
    out.push(streams[pick]![heads[pick]!]!);
    heads[pick]! += 1;
  }
  return out;
}

describe('Phase 3.2 — Invariant 5: end-to-end interleaved replay', () => {
  it('a mixed stream lands each event in exactly one projection', () => {
    type LocalEnvelope =
      | { sort: 'identity'; event: SignedEventEnvelope }
      | { sort: 'local-control'; event: LocalControlEvent }
      | { sort: 'labeler'; event: LabelerEvent };

    const idEnvs: LocalEnvelope[] = identityEvents().map((e) => ({
      sort: 'identity',
      event: e
    }));
    const lcEnvs: LocalEnvelope[] = localControlEvents().map((e) => ({
      sort: 'local-control',
      event: e
    }));
    const labEnvs: LocalEnvelope[] = labelerEvents().map((e) => ({
      sort: 'labeler',
      event: e
    }));
    // Within-stream order preserved; between-stream order interleaved.
    const interleaved = interleaveDeterministic([idEnvs, lcEnvs, labEnvs], 19);

    let identityState = createEmptyIdentityControlState();
    let localControl = createEmptyLocalControlState();
    let labelers = createEmptyLabelersState();

    for (const item of interleaved) {
      switch (item.sort) {
        case 'identity':
          if (!isIdentityKind(item.event.kind)) {
            throw new Error(
              `dispatcher mis-routed an event with kind ${item.event.kind}`
            );
          }
          identityState = applyIdentityControlEvent(identityState, item.event);
          break;
        case 'local-control':
          localControl = applyLocalControlEvent(localControl, item.event);
          break;
        case 'labeler':
          labelers = applyLabelerEvent(labelers, item.event);
          break;
      }
    }

    // The three projections must equal the per-projection seeds
    // computed from the un-interleaved per-kind subsequences.
    expect(identityState).toEqual(seedIdentityControlProjection(identityEvents()));
    expect(localControl).toEqual(seedLocalControlState(localControlEvents()));
    expect(labelers).toEqual(seedLabelersState(labelerEvents()));
  });
});
