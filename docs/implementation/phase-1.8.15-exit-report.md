# Phase Exit Report: Phase 1.8.15 — Default labeler registry (LOCAL-ONLY default)

- Status: Accepted as complete
- Date: 2026-06-10

## Phase scope

Resolves the open question raised after Phase 1.8.11/1.8.14: should
any external labeler (e.g. an OpenRank-derived aggregator) be
mandatory or pre-subscribed out of the box? The user chose the
strictest, doctrine-safest posture: **ship the registry mechanism,
but pre-subscribe NOTHING external.** This phase delivers that.

The deliverable is a thin formalizing layer over the existing Phase
1.8.4 `computeAggregatedReputation` / `AggregatorSubscription`
machinery — NOT new scoring machinery and NOT a duplicate of the
PWA's `buildAggregatorSubscriptionList` input sanitizer.

## Completed work

### `packages/trust-safety/src/reputation-graph/labeler-registry.ts` (new)

- `LABELER_REGISTRY_VERSION = 'lfp2p.labeler-registry.v1'`.
- `DefaultLabelerEntry` / `DefaultLabelerRegistry` types.
- **`DEFAULT_LABELER_REGISTRY`** — THE doctrinal constant. `entries`
  is an empty frozen array: zero external labelers privileged out of
  the box. The local personalized-EigenTrust computer (Phase 1.8.2)
  is the only day-one signal, and it wins priority 0 structurally
  inside `computeAggregatedReputation` — it is never a registry
  entry.
- `resolveActiveLabelerSet({ registry?, userSubscriptions?, mutedLabelerIds? })`
  composes a distributor registry + the user's own subscriptions +
  the user's mute list into the effective `AggregatorSubscription[]`
  that feeds the Phase 1.8.4 runtime. Structural guarantees:
  - **Local is never a subscription.** Any entry claiming the
    `__local__` sentinel is rejected.
  - **Priority 0 is reserved.** Entries claiming priority ≤ 0 are
    rejected — NOT silently bumped — so a distributor cannot smuggle
    an entry into the local slot.
  - **Opt-out wins.** A muted `labelerId` is excluded even if a
    registry default lists it.
  - **User intent overrides distributor default** for the same
    `labelerId` (priority + algorithm + origin all taken from the
    user entry).
  - **Deterministic + deep-frozen** output (sorted ascending by
    priority, ties by ascending labelerId) per Phase 3.2.
  - **Audit-friendly `origin` map** (`'distributor' | 'user'`) per
    Phase 3.1 — no scoring math leaks.
  - Malformed entries are dropped with a warning, never thrown — a
    single bad registry row cannot brick the reputation surface.
    Structurally-invalid input (non-array collections, bad registry
    object, non-Set mute list) throws `TrustSafetyError`.
- Exported from `reputation-graph/index.ts`.

### `packages/trust-safety/src/__tests__/reputation-graph-labeler-registry.test.ts` (new)

22 adversarial tests:

- **THE doctrine pin**: `DEFAULT_LABELER_REGISTRY.entries.length === 0`
  + frozen + version sentinel + local-only resolution yields an empty
  active set.
- Local-source protection: `__local__` rejected from both registry
  and user entries; local never appears in produced subscriptions.
- Priority-0-reserved: rejects 0 / negative / non-integer; accepts ≥ 1.
- Mute (opt-out) wins over both distributor default and user
  subscription; non-Set mute list throws.
- User overrides distributor default; origin provenance tagged
  correctly.
- Determinism: priority+id sort, array-reorder yields identical
  output, deep-frozen output, malformed-row drops, empty-id / unknown
  algorithm drops, structurally-invalid input throws.
- End-to-end with `computeAggregatedReputation`: local-only default
  keeps local as the sole contributor; a distributor-populated
  registry's subscriptions feed the runtime while local STILL wins
  for local-scored subjects (doctrine non-negotiable preserved
  through the registry path).

### Documentation

- `docs/protocol/reputation-graph-doctrine.md` — new "Default labeler
  registry (Phase 1.8.15)" section documenting the local-only default,
  the mechanism for distributors/users to add labelers explicitly, the
  structural guarantees, and the explicit rationale for choosing
  local-only over a curated default bundle (a bundle curator becomes a
  de-facto trust authority — trades away non-negotiable #1).

### Verification

```bash
pnpm typecheck   # clean
pnpm lint        # clean
pnpm test        # 1654 passing (master baseline + 22 new)
```

## Acceptance criteria

| Criterion | Status | Evidence |
|---|:---:|---|
| Shipped default registry has ZERO external entries | ✓ | `DEFAULT_LABELER_REGISTRY.entries.length === 0` pinned by test |
| Local source is structural, never a registry subscription | ✓ | `__local__` rejection tests (registry + user) |
| Priority 0 reserved (rejected, not bumped) | ✓ | dedicated tests |
| Opt-out (mute) always wins | ✓ | mute-over-default + mute-over-user tests |
| User intent overrides distributor default | ✓ | dedicated test + origin provenance test |
| Deterministic + deep-frozen output | ✓ | sort + reorder + frozen-walk tests |
| Malformed rows dropped, structural-invalid input throws | ✓ | dedicated tests |
| Local-always-#0 preserved through the registry → runtime path | ✓ | end-to-end test with `computeAggregatedReputation` |
| Doctrine documents the local-only decision + rationale | ✓ | doctrine "Default labeler registry" section |

## What remains conditionally deferred

- **A distributor-facing "find a labeler" discovery surface** in the
  PWA. The mechanism is in place; a browse/add UI is a separate UX
  slice if/when a real external labeler ecosystem exists.
- **Persistence + settings wiring** of a user's chosen registry /
  mute list in the PWA. The pure resolver is ready to consume a
  loaded preference; the localStorage + UI layer mirrors the existing
  Phase 1.8.7 / 1.8.13 patterns and can be added when there is a
  concrete labeler to subscribe to.

## Decision

- [x] accepted as complete

Reason: the user's underlying trust-&-safety concern — that no
external party should silently become an authority for all users —
is now structurally guaranteed and CI-pinned. The shipped default is
local-only; the mechanism to add external labelers exists but requires
an explicit, auditable act by a distributor or the user. Doctrine
non-negotiable #1 (no global trust authority) holds by construction.
