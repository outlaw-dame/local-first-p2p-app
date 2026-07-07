# Phase Exit Report: Phase 1.8.8 + 1.8.9 + 1.8.10 — Deferred Phase 1.8 follow-ups

- Status: Accepted as complete
- Date: 2026-06-05

## Phase scope

Closes the highest-impact deferred items called out at the end of
the Phase 1.8.7 exit report:

- **Phase 1.8.8** — aggregator `score.removed` consumption in the
  runtime,
- **Phase 1.8.9** — PWA computed-state visualization panel,
- **Phase 1.8.10** — root settings integration + threat-model row
  updates citing each new sybil-hardening test by name.

Three deferred items remain explicitly out of scope: an external
OpenRank adapter package, reputation-events cross-device sync
(opt-in flow), and aggregator-event ingestion plumbing at the
sync-client inbound layer. Those deserve their own focused phases.

## Completed work

### Phase 1.8.8 — `score.removed` consumption (`aggregator-runtime.ts`)

- New `AggregatorRemovalEventWithSource` shape:
  `{ publisherLabelerId, event }` with same source-attribution
  convention as `AggregatorEventWithSource`.
- `ComputeAggregatedReputationInput.removalEvents` optional array
  (defaults to empty when omitted; backward-compat preserved
  byte-identically — pinned by test).
- Removal application happens **after** the candidate set is built:
  for each removal whose `publisherLabelerId` is subscribed, the
  matching `(subject, labeler)` pair is purged. **Doctrine non-
  negotiable preserved**: the LOCAL source's score for that
  subject is unaffected.
- **Opt-in discipline preserved**: removals from non-subscribed
  labelers are silently ignored.
- **Stale removals fail open**: a removal arriving before any
  matching publish is a no-op (no throw, no view mutation).
- **No code duplication**: the previously-private `subjectScoreKey`
  helper deleted in favor of the canonical `subjectRefToKey`
  exported from `inputs.ts`. Single source of truth across the
  reputation graph track.
- 8 new adversarial tests covering: basic eviction; per-labeler
  isolation; opt-in discipline; stale-removal fail-open;
  LOCAL-ALWAYS-#0 preservation across removal; all 4 removal
  reason codes accepted; non-array removal-events throws; backward
  compat (omitted vs empty arrays produce byte-identical views).

### Phase 1.8.9 — PWA computed-state visualization (`pwa-reputation-view-model.ts` + `pwa-reputation-view.tsx`)

- `buildReputationView({ store, observerActorId, seedContacts?, nowIso? }) → ReputationView`:
  - loads the locally-persisted reputation event log via
    `store.loadReputationEvents`,
  - projects events into `ReputationGraphInputs` via the new
    exported `projectEventsToGraphInputs` pure function,
  - runs `computeReputation` and decorates each subject row with
    the Phase 1.8.3 stable band string + raw score + confidence +
    seed distance.
- Default seed = observer at strength 1.0 (the user is always at
  least their own seed). Callers wiring Phase 2.3 contact graph
  data pass `seedContacts` explicitly.
- Aggregator events in the log are intentionally skipped here —
  they feed the Phase 1.8.4 aggregator runtime, not the local
  computer. (Pinned by test.)
- Deep-frozen `ReputationView` per Phase 3.2 frozen-walk discipline.
- React component renders per-subject rows sorted descending by
  score (most-trusted first), with `band` as the privacy-safe
  display string. Reload button + loading / error state.
- **Subject-key canonicalization delegated to the canonical
  `subjectRefToKey`** — no duplicate switch statement, no drift.
- 11 new adversarial tests (`pwa-reputation-view-model.test.ts`):
  empty observerActorId rejected, empty log returns singleton
  seed entry, observation flow includes both observer and
  subject, sort order descending by score, fingerprint-verified
  attestation produces a subject entry, revocation removes
  matching attestation from view, replay determinism (two calls
  byte-identical), aggregator events skipped in pure projection,
  explicit seed contacts override default, default seed = observer
  at strength 1.0, observation event projects observer to
  `actor:<observerActorId>`.

### Phase 1.8.10 — root integration + threat-model

- `apps/pwa/src/root-app.tsx` now mounts `PwaReputationSettings`
  AND `PwaReputationView` immediately after the existing
  `TrustSafetySettings`. The full Phase 1.8 PWA surface is now
  user-reachable from the main page.
- `docs/threat-model/trust-safety-and-abuse.md` gains a new
  "Phase 1.8 reputation graph (1.8.1 – 1.8.10)" section
  documenting **12 attack classes** with mitigations and the
  exact pinned-by-test name + file for each. Specifically:
  vanilla sybil cluster, weakly-connected sybil with foothold,
  feedback clique, community-structure / centrality attack,
  negative-valence-shield bypass, trust laundering via short-lived
  hot accounts, fingerprint amplifier evasion, hostile aggregator
  publishing biased scores, unsubscribed-labeler injection,
  reserved-sentinel impersonation, stale-removal weaponization,
  score-shape forgery, reputation graph privacy leak, replay
  equivalence regression.

### Verification

```bash
pnpm typecheck   # clean
pnpm lint        # clean
pnpm test        # 1517 passing (1477 → 1517, +40)
pnpm build       # clean
```

## Acceptance criteria

| Criterion                                                                   | Status | Evidence                                                           |
| --------------------------------------------------------------------------- | :----: | ------------------------------------------------------------------ |
| Aggregator score.removed consumed; opt-in discipline preserved              |   ✓    | 8 dedicated tests                                                  |
| LOCAL-ALWAYS-#0 preserved across removal                                    |   ✓    | dedicated test                                                     |
| Stale removals fail open (no throw)                                         |   ✓    | dedicated test                                                     |
| Backward compat — omitted `removalEvents` byte-identical to empty           |   ✓    | dedicated test                                                     |
| PWA panel runs `computeReputation` over local Dexie log                     |   ✓    | view-model test surface                                            |
| Privacy-safe band on every view row (Phase 3.1)                             |   ✓    | every row carries `band` stable string                             |
| Default seed = observer at strength 1.0                                     |   ✓    | dedicated test                                                     |
| Subject-key canonicalization shares the Phase 1.8.2 helper (no duplication) |   ✓    | view-model + aggregator runtime both delegate to `subjectRefToKey` |
| Root settings integration                                                   |   ✓    | PwaReputationSettings + PwaReputationView mounted in root-app.tsx  |
| Threat-model rows cite each new sybil-hardening test by name                |   ✓    | 12 mitigation rows w/ test-file citations                          |

## Remaining deferred (post-1.8.10)

- **External OpenRank adapter package** — thin HTTP-to-event
  mapper, lives outside protocol core. The
  `AggregatorEventWithSource` shape from 1.8.4 IS the contract.
- **Aggregator-event ingestion plumbing at sync-client inbound +
  bridge layer** — wires `reputation.aggregator.published` events
  from the bridge into the Dexie reputation event log
  automatically. Today the user emits locally only.
- **Reputation-events cross-device sync (opt-in)** — separate
  design slice; requires UI + protocol decisions about which
  events promote to `account-local` / `public` scopes.

## Decision

- [x] accepted as complete

Reason: the three deferred items chosen for this slice complete the
user-visible Phase 1.8 loop (computed state IS reachable end-to-end
from the PWA settings page) AND complete the runtime's score-life-
cycle handling (`published` + `score.removed` both consumed). The
threat-model doc closes the audit loop by citing each pinned
mitigation by test name. Single-source-of-truth discipline preserved
across the track: no duplicated subject-key code, no parallel
projection logic, no drift between the protocol layer (1.8.1) and
the PWA surface (1.8.7 / 1.8.9).
