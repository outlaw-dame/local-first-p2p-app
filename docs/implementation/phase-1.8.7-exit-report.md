# Phase Exit Report: Phase 1.8.7 — PWA reputation persistence + emit + settings UI

- Status: Accepted as complete
- Date: 2026-06-04

## Phase scope

Closes the Phase 1.8 PWA wiring track: Dexie v8 schema, emit
helpers for all five Phase 1.8.1 event kinds, view-model logic for
spam-gate thresholds + observation/attestation forms + aggregator
subscription list, and a functional React settings surface.

Parallels the Phase 1.70 pattern (PWA T&S settings) so the doctrine
non-negotiables — "default privacy = device-local" and "LOCAL ALWAYS
priority #0" — are surfaced UI-side, NOT just in protocol math.

## Completed work

### Dexie schema v8 (`packages/local-store/src/index.ts`)

- New table `trustSafetyReputationEvents` (eventId, kind, createdAt,
  sequence) following the Phase 1.70.B append-only event-log
  pattern. Idempotent on `eventId` (silent no-op on retry).
- New `StoredTrustSafetyReputationEvent` row type.
- New helper methods:
  - `appendTrustSafetyReputationEvent(event)` — validates via
    `validateReputationEvent` at the persistence boundary
    (defense-in-depth) BEFORE inserting,
  - `listTrustSafetyReputationEvents()` — returns rows ordered by
    monotonic `sequence`,
  - `loadReputationEvents()` — replay-from-log helper that
    re-validates each row on load and skips corrupt rows silently
    rather than poisoning the projection.
- Backward-compatible migration: v8 is purely additive — existing
  v7 rows roll forward unchanged.

### `apps/pwa/src/pwa-reputation-emit.ts` (new)

Five emit helpers, one per Phase 1.8.1 event kind:

- `emitObservationRecorded({ subject, observationKind, satCount, unsatCount, windowStart, windowEnd, ... })`
- `emitAttestationPublished({ subject, valence, contextTag, strength, expiresAt?, ... })`
- `emitAttestationRevoked({ attestationId, revokedAt?, ... })`
- `emitAggregatorPublished({ algorithm, computedAt, subjects, ... })`
- `emitAggregatorRemoved({ subject, reason, ... })`

Each helper:

- builds the event payload from caller inputs,
- validates via `validateReputationEvent` (raises
  `TrustSafetyError` on out-of-range / bounded-enum violations
  BEFORE touching the store),
- persists atomically via `appendTrustSafetyReputationEvent`,
- is idempotent on the explicit `eventId`,
- defaults `createdAt` to `new Date().toISOString()` and `eventId`
  to a `crypto.randomUUID()`-derived prefix.

The doctrine's "default privacy = device-local" is enforced
STRUCTURALLY: the helpers do NOT cross-publish or sign-and-send.
The persisted reputation events live in the local Dexie log only.
Cross-device propagation is a separate opt-in flow (deferred).

### `apps/pwa/src/pwa-reputation-state.ts` (new) — view-model logic

Three responsibilities:

1. **`clampSpamGateInput({ spamScoreThreshold, spamSeedDistanceMax })`**
   — clamps + warns:
   - NaN / negative → reset to doctrine default + warning,
   - `> 1` threshold → clamp + warning,
   - `> 0.5` threshold → warn (permissive — may flag legitimate),
   - distance: non-integer / negative → reset to default,
   - distance `> 10` → clamp to 10 + warning,
   - final defense-in-depth via `resolveSpamGateConfig` validator.

2. **Form defaults** frozen at module load:
   - `OBSERVATION_FORM_DEFAULTS`, `ATTESTATION_FORM_DEFAULTS`,
     `REMOVAL_FORM_DEFAULTS` — bound to the documented Phase 1.8.1
     enums for UI binding.
   - `DEVICE_LOCAL_PRIVACY_NOTICE` — frozen title + body the form
     MUST surface whenever the user is about to emit (the doctrine
     "default privacy = device-local" rule made UI-visible).

3. **`buildAggregatorSubscriptionList(inputs)`**:
   - **Reserved sentinel rejection**: any subscription claiming
     `LOCAL_REPUTATION_SOURCE` (`'__local__'`) is dropped outright
     with a warning. Doctrine non-negotiable: "LOCAL ALWAYS owns
     priority 0."
   - Priority 0 bumped to 1 with a warning.
   - Non-integer / negative priorities reset to 1 with a warning.
   - Empty labelerIds dropped.
   - Unknown algorithms dropped.
   - Duplicate labelerIds dedup'd, keeping the highest-priority
     entry, others surface as warnings.
   - Output sorted ascending by priority (ties broken by ascending
     labeler id) — deterministic presentation.
   - Output deep-frozen at every level (Phase 3.2).

### `apps/pwa/src/pwa-reputation-settings.tsx` (new)

Functional React component with three sub-sections:

- **Spam-gate thresholds** — two number inputs feeding
  `clampSpamGateInput`; shows live warnings + effective config.
- **Observation emit form** — subject actor id + observation kind
  dropdown + sat/unsat counts + window inputs + save button.
  Surfaces `DEVICE_LOCAL_PRIVACY_NOTICE` prominently above the
  inputs.
- **Attestation emit form** — same shape with valence + context
  tag dropdowns + strength slider.
- **Aggregator subscription list** — add-form (labeler id +
  priority + algorithm dropdown), live warnings, sortable list,
  per-row unsubscribe.

Like Phase 1.70: controlled-by-store. No optimistic UI; every
emit goes through the Phase 1.8.7 helpers and persists via the
Dexie reputation event log.

### 34 new adversarial tests

`pwa-reputation-state.test.ts` (22):

- **Spam-gate clamping** (8): defaults pass through; clamp > 1;
  reset NaN; warn permissive; clamp > 10 distance; reset
  non-integer distance; reject negative threshold; frozen output.
- **Privacy notice** (2): frozen content; explicit wording check.
- **Form defaults** (3): frozen + completeness for observation,
  attestation, removal.
- **Subscription list** (8): **reserved-sentinel rejection** (the
  doctrine non-negotiable); priority-0 bumped; non-integer /
  negative priority reset; empty labelerId dropped; unknown
  algorithm dropped; **duplicate dedup with priority preference**;
  output ordering + frozen-walk.

`pwa-reputation-emit.test.ts` (12):

- **Observation emit** (4): happy path + idempotency, inverted
  window, unknown kind, corrupt-row protection.
- **Attestation emit** (3): happy path with fingerprint tag,
  strength range, expiresAt < createdAt.
- **Revocation emit** (2): happy path, revokedAt < createdAt.
- **Aggregator published/removed** (3): full round-trip, empty
  batch rejected, unknown reason rejected.
- **Cross-helper sequencing** (1): multi-kind log replays in
  insertion order with monotonic sequence.

### Verification

```bash
pnpm typecheck   # clean
pnpm lint        # clean
pnpm test        # 1477 passing (1428 → 1477, +34 here + 15 in 1.8.6)
pnpm build       # clean
```

## Acceptance criteria

| Criterion                                                             | Status | Evidence                                                                |
| --------------------------------------------------------------------- | :----: | ----------------------------------------------------------------------- |
| Dexie schema v8 with `trustSafetyReputationEvents` table              |   ✓    | append/list/load methods + idempotent on eventId + corrupt-row skipping |
| Five PWA emit helpers (one per Phase 1.8.1 event kind)                |   ✓    | dedicated tests across happy + adversarial paths                        |
| Spam-gate threshold sliders with clamping + warnings                  |   ✓    | 8 dedicated tests + defense-in-depth via `resolveSpamGateConfig`        |
| Observation / attestation emit forms with device-local privacy notice |   ✓    | `DEVICE_LOCAL_PRIVACY_NOTICE` frozen + surfaced                         |
| Aggregator subscription UI enforces LOCAL-ALWAYS-#0 at the form layer |   ✓    | reserved-sentinel rejection test + priority-0 bump test                 |
| All inputs validate at the helper boundary (defense-in-depth)         |   ✓    | every helper test pins `TrustSafetyError` on invalid input              |

## Deferred work

- **Reputation events cross-device sync.** Today emit-helpers
  persist locally only. A future slice wires reputation events
  into the sync-client's outbound path with an explicit opt-in.
- **PWA computed-state surface**: a debug / audit panel that runs
  `computeReputation` over the local log and surfaces the
  resulting `LocalReputationState` to the user (per-subject score
  - band) for transparency.
- **Aggregator-event ingestion** into the persistence layer when a
  subscribed labeler publishes `reputation.aggregator.published`
  events through the bridge. Emit-side ready; ingestion-side
  deferred.
- **Settings surface integration** into the Phase 1.70 root
  trust-safety settings page (today `PwaReputationSettings` is a
  standalone component; wiring it into the parent tree is a
  layout-only change).

## Decision

- [x] accepted as complete

Reason: the PWA reputation track is structurally complete end-to-end.
Persistence (v8 Dexie), emit (five helpers + validator backstop),
view-model (spam-gate clamp + form defaults + subscription list with
reserved-sentinel enforcement), and a functional React surface are
all shipped + pin-tested. Doctrine non-negotiables ("default
privacy = device-local"; "LOCAL ALWAYS priority 0") are surfaced at
both the algorithmic and UI layers.
