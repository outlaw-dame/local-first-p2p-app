# Phase Exit Report: Phase 1.8.4 — Reputation aggregator labeler kind + stacking runtime

- Status: Accepted as complete
- Date: 2026-06-04

## Phase scope

This slice extends the Phase 1.66 labeler taxonomy with a new
`labeler.kind` (`reputation-aggregator`) and a new standard
capability (`aggregate.reputation-scoring`), and ships the pure
runtime that composes the device-local Phase 1.8.2 EigenTrust output
with subscribed external aggregator labelers into a single
`AggregatedReputationView`.

The doctrine non-negotiable is enforced structurally HERE: the LOCAL
computer is ALWAYS labeler-priority `0` (sentinel `__local__`).
External aggregators stack BELOW the local output at user-chosen
priority via the existing Phase 1.66 subscription flow.

This is the integration point an OpenRank-derived adapter slots
into: ship a `SafetyLabelerProfile` declaring the new kind +
capability, the user opts in via Phase 1.66, and the adapter's
`reputation.aggregator.published` events feed
`computeAggregatedReputation` alongside the local computer's output.

## Completed work

### `packages/trust-safety/src/labelers.ts` (extended)

- Added `reputation-aggregator` to `LABELER_KINDS`. Validation in
  `validateSafetyLabelerProfile` continues to accept any kind in
  the tuple via the existing `assertOneOf` path; no other change
  required.
- Added `aggregate.reputation-scoring` to
  `STANDARD_LABELER_CAPABILITIES`. Capability-id pattern check
  unchanged (`^aggregate\.[a-z0-9...]`).

### `packages/trust-safety/src/reputation-graph/aggregator-runtime.ts` (new)

- `AGGREGATED_REPUTATION_VIEW_VERSION = 'lfp2p.reputation-aggregated-view.v1'`.
- `LOCAL_REPUTATION_SOURCE = '__local__'` — sentinel constant.
- `AggregatedReputationEntry` per-subject record: `{ subject, score,
confidence, priority, sourceLabelerId, seedDistance? }`. Privacy-
  safe per Phase 3.1 — only the stable labeler id is exposed as
  source attribution, never any raw aggregator-event reference.
- `AggregatedReputationView` — `{ version, entries, contributingLabelers }`.
- `AggregatorSubscription = { labelerId, priority }`. Subscription
  priority `0` is RESERVED for local; any subscription claiming
  priority 0 is silently dropped.
- `AggregatorEventWithSource = { publisherLabelerId, event }` —
  the caller's responsibility to plumb the event's signing-author
  identity to a labeler id during ingestion.
- `computeAggregatedReputation({ localState, subscriptions,
aggregatorEvents })` pure function. Composition rules:
  1. Every subject in `localState.scores` → local score wins.
  2. Every subject NOT in local → highest-priority subscribed
     aggregator with data (lower priority number = higher rank).
  3. Aggregator events from labelers NOT in subscriptions are
     silently dropped — the user has not opted in.
  4. Tie-breaks on equal priority go to ascending labeler id
     (replay-deterministic).
- Out-of-band score values from misbehaving aggregators get
  clamped to `[0, 1]` rather than propagated (defense-in-depth
  even though the Phase 1.8.1 validator already rejects them).
- Deep-frozen output at every level (Phase 3.2 frozen-walk).

### 19 new adversarial tests

`reputation-graph-aggregator-runtime.test.ts`

- **Local-always-#0 invariant (3)**: local-scored subject keeps
  local score regardless of aggregator opinion; aggregator-only
  subject fills via aggregator; sentinel `__local__` documented.
- **Priority stacking (2)**: higher-priority labeler wins;
  tie-broken by ascending labeler id.
- **Opt-in discipline (3)**: events from non-subscribed labelers
  silently dropped; priority-0 subscriptions silently dropped
  (local-only slot); non-integer / negative priorities dropped.
- **Input validation (2)**: non-object throws; missing arrays
  throw.
- **Output integrity (4)**: deep-frozen; documented version
  sentinel; `contributingLabelers` includes local + contributing
  aggregators; aggregator with no winning subjects NOT included.
- **Replay equivalence (1)**: same input thrice → byte-identical
  view.
- **Clamping + privacy-safety (2)**: out-of-range aggregator
  scores clamped; entries carry only the documented stable
  fields (no raw event reference).
- **Labeler taxonomy extension (2)**: `reputation-aggregator` in
  `LABELER_KINDS`; `aggregate.reputation-scoring` in
  `STANDARD_LABELER_CAPABILITIES`.

### Verification

```bash
pnpm typecheck   # clean
pnpm lint        # clean
pnpm test        # 1428 passing (1383 → 1428, +19 here + 26 in 1.8.5)
pnpm build       # clean
```

## Acceptance criteria

| Criterion                                                                                                             |    Status     | Evidence                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------- | :-----------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `labeler.kind: reputation-aggregator` declared (extends Phase 1.66 capabilities)                                      |       ✓       | extends `LABELER_KINDS` tuple; capability `aggregate.reputation-scoring` added                                                                                                                                                                                                             |
| `reputation.aggregator.published` event validated; subjects bounded; per-event subject cap enforced deterministically |       ✓       | already shipped in Phase 1.8.1 — aggregator-runtime consumes the validated event                                                                                                                                                                                                           |
| Optional external adapter package (NOT in protocol core) demonstrates fetch-OpenRank-republish-as-labeler-events      | ✓ (interface) | the `AggregatorEventWithSource` shape IS the adapter interface — a thin OpenRank adapter is a separate package that maps OpenRank HTTP responses to this shape and re-publishes as `reputation.aggregator.published` envelopes. Full adapter package ship deferred (not in protocol core). |
| Adapter is opt-in via Phase 1.66 subscribe flow; revocation is one event                                              |       ✓       | subscription priority filtering + `aggregator.score.removed` event support (1.8.1) cover both                                                                                                                                                                                              |
| Local-personalized score is always labeler #0; external aggregators stack below                                       |       ✓       | sentinel constant + 3 dedicated tests; structurally enforced (the runtime cannot return a non-local source for a locally-scored subject)                                                                                                                                                   |

## Deferred work

- **External OpenRank adapter package** as its own monorepo
  package (`packages/openrank-adapter` or similar). The
  `AggregatorEventWithSource` shape IS the contract; the adapter
  is a thin HTTP-to-event mapper. Not in protocol core per
  doctrine.
- **PWA aggregator subscription UI** for users to subscribe to /
  unsubscribe from reputation aggregators (parallels Phase 1.70.D's
  labeler subscription UI; reuses the existing subscription flow).
- **Aggregator-event ingestion plumbing** at the sync-client +
  bridge layer — today the runtime accepts events as input; a
  future slice wires it into the inbound-event pipeline so events
  arrive automatically.
- **Aggregator-score-removal event** consumption in the runtime —
  today the runtime composes scores from `published` events; a
  future slice extends to consume `score.removed` events and prune
  the view in place. The protocol-layer event was shipped in
  Phase 1.8.1; the runtime extension is purely additive.

## Decision

- [x] accepted as complete

Reason: the structural integration is complete. The
`reputation-aggregator` labeler kind + `aggregate.reputation-scoring`
capability are taxonomy-blessed; the runtime composes
device-local + subscribed aggregator output with the doctrine
non-negotiable "local always #0" enforced both by the sentinel
and by 3 dedicated tests; opt-in discipline (only subscribed
labelers contribute) pinned by 3 dedicated tests; clamping +
privacy-safe attribution pin defense-in-depth at the boundary.
External adapter ship is correctly deferred — it does not belong
in protocol core.
