# Phase 4.6 — Operator Policy Runtime: Exit Report

- Status: Complete
- Date: 2026-06-29
- PR: #119
- Depends on: Phase 4.5 exit report, Phase 3.1 privacy-safe logging doctrine

## What shipped

### `OperatorSurfaceConfig` — narrowing-only enforcement

New `operator-surface.ts` module defines the canonical infrastructure surface model. Doctrine: operators may only **narrow** the default scope; widening is rejected at config-load time so a misconfiguration cannot silently grant more scope than intended.

- `OperatorSurface` — `'bridge' | 'relay' | 'super-peer'`.
- `SURFACE_DEFAULT_SCOPES` — read-only map from surface to its full default scope set (`bridge`/`relay` = `{dm, group, public}`; `super-peer` = `{group, public}`; `public-index` = `{public}`).
- `OperatorSurfaceConfig = { surface: OperatorSurface; allowedScopes: ReadonlySet<string> }`.
- `OperatorSurfaceWidenError` — thrown (not returned) by `validateOperatorSurfaceConfig` when `allowedScopes` contains a scope not in the default set for that surface.
- `validateOperatorSurfaceConfig(config)` — also guards for null config and unknown surface.
- `defaultOperatorSurfaceConfig(surface)` — returns the full default scope set as a frozen config (safe starting point).

Exported from `apps/bridge-service/src/index.ts`.

### `PolicySubscriptionRuntime` — check #8.5 (unlisted-labeler labeler guard)

New `policy-subscription.ts` module implements check #8.5 from the admission gate spec. Doctrine: a labeler that the bridge operator has **not** subscribed to cannot produce a bridge-level rejection, regardless of what score the labeler assigns.

- `PolicySubscriptionEntry = { labelerId: string; subscribedAt: number }` — each labeler the operator has explicitly subscribed to.
- `PolicySubscriptionRuntime` options: `{ subscribedLabelerIds: ReadonlyArray<string>; quarantineAction?: string }` (default quarantine action = `'quarantine'`).
- `refreshLabelersState(newSnapshot)` — atomically replaces the subscribed-labeler set; takes effect on the next `checkProducerLabels` call without a restart.
- `checkProducerLabels(producerActorId, labelerEntries)` — filters `labelerEntries` by `subscribedLabelerIds`; within the subscribed set, picks the most restrictive `StackedAction` (by priority); returns `{ result: 'quarantine', reason: 'policy.operator-label' }` when the most restrictive action is the configured quarantine action, otherwise `{ result: 'allow' }`.

Wired into `BridgeAdmissionGateway`: `AdmissionGatewayOptions.policyRuntime?: PolicySubscriptionRuntime`. When present, `admitAndPersist` runs the check **after** the reputation engine but **before** persisting the admission record. This ordering is semantically important: check #8.5 runs post-engine so it can inspect enriched state, and persistence only happens for allowed records.

`'policy.operator-label'` added to `SAFETY_REASON_CODES` in `packages/trust-safety/src/reason-codes.ts`.

### Advisory reputation feeds — infrastructure-scoped, can only lower score

`ingestAdvisoryFeed(feedEntries, sourceId)` on `BridgeAdmissionGateway` accepts third-party advisory intelligence. Doctrine:

- Advisory feeds are **infrastructure-scoped** — an advisory quarantine from bridge A does NOT auto-quarantine at bridge B. Each bridge maintains its own advisory dataset.
- Advisory feeds can only **lower** a peer's reputation score, never raise it. This is a hard invariant in `#recomputeAdvisoryScore`.
- Each entry has a 24 h TTL. A background eviction timer (6 h interval) clears expired entries; a targeted check runs on each admission.
- `AdvisoryReputationEntry = { peerId, score, reason, expiresAt, sourceId }`. Multiple sources for the same peer are stored independently: `Map<peerId, Map<sourceId, AdvisoryReputationEntry>>`. The recomputed advisory score is the **minimum** across all active sources (most restrictive).
- Exported `AdvisoryReputationEntry` type.

### `quarantinePeer` / `liftQuarantine` — direct operator quarantine API

Operator-initiated quarantine bypass the advisory reputation system and write directly to the reputation store.

- `quarantinePeer(peerId, reason, durationMs)` — validates `durationMs > 0` and `durationMs <= maxQuarantineMs` (configurable, default 30 days); sets `quarantineUntil = Date.now() + durationMs`.
- `liftQuarantine(peerId, reason)` — atomically removes the `quarantineUntil` key from the reputation record (required by `exactOptionalPropertyTypes: true`; implemented via destructure-and-omit with an intentional eslint-disable comment explaining the constraint).

Both methods are synchronous mutations on the in-memory store; persistence (if a store is configured) happens on the next flush cycle.

### Appeal hooks — fire-and-forget, silenced per Phase 3.1

`AppealHook = (decision: AdmissionDecision) => Promise<void>` — a callback the operator registers to observe rejections and potentially queue manual review.

- `registerAppealHook(hook)` — replaces any existing hook.
- `appealableKinds` — set of rejection reasons that trigger the hook (operator-configured; defaults to content-policy reasons).
- `#maybeFireAppealHook(decision)` — fires when the outcome is a rejection AND the reason is in `appealableKinds`.
- Fire-and-forget: `void hook(decision).catch(() => undefined)`. A broken hook must not reverse the decision, crash the process, or log anything. Silenced per Phase 3.1 privacy-safe logging doctrine — the exception thrown by a hook is attacker-influenced (the hook callback is user code; the exception message could contain private data) and must never reach any log surface.

## New files

| File                                             | Purpose                                                                |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| `apps/bridge-service/src/operator-surface.ts`    | `OperatorSurface`, `OperatorSurfaceConfig`, validation/default helpers |
| `apps/bridge-service/src/policy-subscription.ts` | `PolicySubscriptionRuntime`, check #8.5                                |
| `apps/bridge-service/src/phase-4.6.test.ts`      | 38 adversarial tests                                                   |

## Modified files

| File                                           | Change                                                                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/bridge-service/src/admission-gateway.ts` | `ingestAdvisoryFeed`, `quarantinePeer`, `liftQuarantine`, `registerAppealHook`, appeal hook fire, check #8.5 in `admitAndPersist`, `AdvisoryReputationEntry` type |
| `apps/bridge-service/src/index.ts`             | Re-exports for `operator-surface.ts`, `policy-subscription.ts`                                                                                                    |
| `packages/trust-safety/src/reason-codes.ts`    | `'policy.operator-label'` added to `SAFETY_REASON_CODES`                                                                                                          |

## Test coverage (38 new tests)

- `OperatorSurfaceConfig`: default config for each surface; unknown scope is rejected with `OperatorSurfaceWidenError`; null config rejected; unknown surface rejected; same-scope config accepted (no widen).
- `PolicySubscriptionRuntime`: unsubscribed labeler cannot quarantine; subscribed labeler with `quarantine` action quarantines; subscribed labeler with non-quarantine action allows; `refreshLabelersState` takes effect immediately; empty subscriber list always allows.
- Advisory feed: advisory entry lowers score; advisory entry cannot raise score (hard invariant); expired entry is ignored; multiple sources take minimum; eviction removes expired entries; feed from bridge A does not affect bridge B.
- `quarantinePeer` / `liftQuarantine`: quarantined peer is rejected; lifted peer is admitted; zero durationMs rejected; negative durationMs rejected; durationMs > maxQuarantineMs rejected.
- Appeal hooks: hook fires on rejection; hook does not fire on admission; hook exception does NOT reverse the decision (no unhandled rejection surfaces); hook fires only for appealable kinds; second `registerAppealHook` replaces first.
- Check #8.5 wiring in `admitAndPersist`: check runs after engine, before persist; unlisted labeler is transparent; listed labeler with quarantine action rejects.

## Doctrine notes

- **`policy.local-preference` vs `policy.operator-label`**: `policy.local-preference` (check #9) has NO reputation penalty — it is a recipient's preference. `policy.operator-label` (check #8.5) blocks the message but the reputation impact is determined by the policy engine, not hard-coded here.
- **Advisory authority boundary**: advisory feeds from an external bridge are advisory data, not operator authority. The local bridge's operator decides whether to ingest a feed and how much weight to give it.
- **`exactOptionalPropertyTypes` in `liftQuarantine`**: the destructure-and-omit pattern (`const { quarantineUntil: _removed, ...rest } = existing`) is required because setting `quarantineUntil: undefined` on a `quarantineUntil?: number` property is rejected by the compiler. The eslint-disable comment on `_removed` is intentional and carries an explanation.

## Deferred

- HTTP surface for `ingestAdvisoryFeed` (Phase 5 boundary).
- Persistent advisory store (currently in-memory; eviction survives restart but entries do not).
- Multi-bridge advisory propagation gossip protocol (not in scope for Phase 4.x).
- PGlite-backed reputation store (Phase 8+).
