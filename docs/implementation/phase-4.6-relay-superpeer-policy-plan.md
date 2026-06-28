# Phase 4.6 — Relay / Super-peer Policy Runtime

- Status: Draft
- Date: 2026-06-28
- Roadmap position: after Phase 4.5 (Production Bridge Hardening), before Phase 5 (Bridge Resumability)
- Depends on:
  - `docs/implementation/phase-4.5-production-bridge-hardening-plan.md`
  - `docs/implementation/phase-4.2-exit-report.md` — multi-bridge reputation deferral
  - `docs/implementation/phase-1.64-exit-report.md` — transport admission engine
  - `docs/implementation/phase-1.65-exit-report.md` — curation runtime
  - `docs/implementation/phase-1.66-exit-report.md` — labeler runtime
  - `docs/implementation/phase-1.67-exit-report.md` — moderation runtime

## Purpose

Phase 4.5 closes the single-bridge production gaps. Phase 4.6 adds the
operator-level policy layer that separates a bridge from a relay from a
super-peer and lets each surface enforce its own subscribed labeler rules,
operator quarantines, and infrastructure reputation.

Without this phase:
- All bridge deployments run with identical policy regardless of operator intent.
- The per-surface privacy scope enforcement in the admission doctrine exists
  in code but there is no runtime way to configure a bridge to behave as a
  relay (dm+group+public, no storage) or a super-peer (group+public, with
  storage hints).
- The Phase 1.64 deferral for multi-bridge advisory reputation propagation
  has no runtime surface to receive or apply advisory feeds.
- Appeal hooks from Phase 1.67 have no bridge-side integration point.

## Surface model

The bridge admission engine already defines four surfaces with per-surface
privacy scope allowlists:

```
bridge:        dm, group, public
relay:         dm, group, public
super-peer:    group, public
public-index:  public
```

`bridge` and `relay` share the same default scope set (`RELAY_SAFE_PRIVACY_SCOPES`
in `admission.ts`). The Purpose section's claim that relay is `group+public only`
was incorrect — relay forwards DM envelopes by default; operators may narrow that
away via `allowedPrivacyScopes`, but the default is inclusive.

Phase 4.6 makes the surface configurable at runtime (not compile time) and
adds per-surface policy subscriptions.

## Operator surface configuration

Add `OperatorSurfaceConfig` to `BridgeService` / `BridgeAdmissionGateway`:

```typescript
type OperatorSurface = 'bridge' | 'relay' | 'super-peer' | 'public-index';

type OperatorSurfaceConfig = Readonly<{
  surface: OperatorSurface;
  allowedPrivacyScopes: ReadonlyArray<PrivacyScope>; // validated against surface defaults
  allowedKinds?: ReadonlyArray<string>;               // optional kind allowlist
  maxBytesPerEnvelope?: number;                       // surface-specific cap
  description?: string;                               // operator-provided label
}>;
```

Non-negotiable: `allowedPrivacyScopes` may NARROW but never WIDEN beyond the
surface default. A `super-peer` cannot add `dm` to its allowlist. The gateway
validates at construction time and throws if a scope widens the default.

## Operator policy subscriptions

Add a `PolicySubscriptionRuntime` that the gateway consults on each admit:

```typescript
type PolicySubscriptionEntry = Readonly<{
  labelerId: string;
  priority: number;
  algorithm: ReputationAlgorithm;
}>;
```

This is the bridge-operator-level analogue of the PWA user's aggregator
subscription list (Phase 1.8.7). The operator can subscribe to labelers
whose outputs gate admission — a `safety.label.applied` with a
`hard-safety` action and matching `scope: 'transport'` rejects the
subject at the transport level.

Doctrine non-negotiable: labeler decisions are ADVISORY until the operator
explicitly promotes them to enforcement via the policy subscription. An
unlisted labeler CANNOT produce a bridge-level rejection.

Required work:
- `PolicySubscriptionRuntime` class: holds the active subscription list,
  resolves effective label set for a `SafetySubjectRef` against the
  Phase 1.66 `LabelersState` snapshot. Uses `effectiveLabelsForSubject`
  and `mostRestrictiveAction` from the labeler runtime (NOT
  `computeItemRanking`, which operates on curation/feed exclusions and
  does not read transport-scope hard-safety labels).
- Bridge gateway accepts `policyRuntime?: PolicySubscriptionRuntime`.
- When `policyRuntime` is present, after check #8 (rate limit) and
  before check #9 (user-block), run a new check #8.5:
  - Derive `SafetySubjectRef` from the envelope (`event` kind → subject kind).
  - Call `effectiveLabelsForSubject(labelersState, subjectRef)` filtered
    to subscribed labelers. Pass the result to `mostRestrictiveAction`.
  - If the most restrictive action is `hard-safety` with
    `scope: 'transport'` → reject with `policy.operator-label`.
  - No reputation penalty (the subject may be legitimate on other surfaces).
- `LabelersState` is refreshed by the operator from a bridge-side durable
  log. The admission gateway holds a snapshot; the operator calls
  `gateway.refreshLabelersState(newSnapshot)` to update without restart.

## Multi-bridge advisory reputation propagation

Phase 4.2 deferred: "an operator may consume advisory reputation feeds
from other bridges".

Required work:
- `AdvisoryReputationFeed` interface:
  ```typescript
  type AdvisoryReputationEntry = Readonly<{
    peerId: string;
    score: number;     // clamped to [-1, 1] on receive
    updatedAt: string;
    sourceId: string;  // bridge operator identity (not an actorId)
  }>;
  ```
- `BridgeAdmissionGateway.ingestAdvisoryFeed(entries)`: validates each
  entry, clamps scores, merges into a separate `advisoryScores` map (keyed
  by `peerId`, value is the effective advisory score) that MODULATES (does
  not replace) the engine's per-peer reputation tracker.
  The advisory channel can only LOWER effective reputation, never raise it
  above the peer's locally-observed score.
  Multi-source merging: when multiple sources report scores for the same
  peer, use the **minimum** (most restrictive) score. A single advisory
  source cannot unilaterally elevate a score already lowered by another.
  Staleness and pruning: each entry carries `updatedAt`. On every ingest
  call, entries older than the configured advisory TTL (default 24 h) are
  dropped before merging. A periodic background timer (default every 6 h)
  also evicts stale entries from the in-memory map to prevent unbounded
  growth. Without pruning a long-lived bridge accumulates advisory records
  for peers it will never see again, with risk of OOM under sustained feed
  ingestion.
- Doctrine non-negotiable: advisory feeds are infrastructure-scoped (rule
  #4 of `bridge-admission-doctrine.md`). An advisory quarantine from bridge
  A does NOT auto-quarantine the peer at bridge B. The gateway uses it
  only as a soft-weight input to the rate-limit band lookup.

## Operator quarantine coordination

Today an operator can quarantine a peer through the admission engine's
reputation tracker, but there is no explicit operator-facing quarantine
API — it only happens via score decay crossing the `quarantineThreshold`.

Required work:
- `BridgeAdmissionGateway.quarantinePeer(peerId, reason, durationMs)`:
  directly sets the peer's reputation to a score floor that triggers
  quarantine regardless of the configured `quarantineThreshold`. Writes
  a `transport.peer.quarantined` event to the admission state.
- `BridgeAdmissionGateway.liftQuarantine(peerId, reason)`: removes the
  manual quarantine floor and writes `transport.peer.rate_limited` (reset
  to `'recovering'` status).
- Both methods are operator-only (guarded by the existing authority check).
- Neither method triggers advisory propagation automatically — the operator
  decides whether to publish the decision to an advisory feed.

## Moderation appeal hooks

Phase 1.67 shipped a moderation queue projection but no bridge integration.

Required work:
- `BridgeAdmissionGateway.registerAppealHook(hook: AppealHook)`:
  ```typescript
  type AppealHook = (decision: TransportAdmissionDecision) => Promise<void>;
  ```
  Called after a `reject` or `quarantine` outcome when the rejected
  envelope's kind is in `appealableKinds` (operator-configured set;
  default empty).
- The hook executes in a **non-blocking, fire-and-forget** fashion:
  `void hook(decision).catch(err => operatorAuditLog.warn(err))`.
  The admission result is returned to the caller immediately; the hook
  runs after the response is committed. This ensures the appeal hook
  cannot add latency to the hot admission path and that unhandled
  rejections from the hook do not crash the process.
- The hook is best-effort: a throwing hook is caught, logged at the
  operator-audit level (no plaintext), and does NOT reverse the admission
  decision.
- The hook receives the `TransportAdmissionDecision` only — never the
  envelope bytes or decrypted content. This matches the Phase 1.63
  non-negotiable that the bridge MUST NOT decrypt to perform checks.
- Practical first use: the hook creates a `moderation.queue.item.created`
  event in the operator's moderation queue projection (Phase 1.67),
  enabling a human moderator to review bridge-level rejections.

## Required tests

- Surface config: super-peer surface rejects dm-privacy envelope (not in default scope); relay surface accepts dm-privacy envelope (in default scope); operator-narrowed relay with dm removed rejects dm-privacy envelope; narrowing allowed-kinds works; widening allowedPrivacyScopes beyond surface default throws at construction.
- Policy subscription runtime: unlisted labeler cannot reject; listed labeler with `hard-safety` transport-scope label rejects with `policy.operator-label`; no reputation penalty on operator-label reject.
- `refreshLabelersState` takes effect immediately without restart.
- Advisory reputation feed: ingestAdvisoryFeed clamps scores; advisory can lower effective rate-limit band; advisory CANNOT raise a peer's locally-observed score above its current value; non-numeric or NaN scores are dropped.
- `quarantinePeer` / `liftQuarantine`: direct quarantine floor independent of score threshold; lifted quarantine allows admits again; audit event written for each.
- Appeal hook: called after reject; hook exception does not reverse decision; hook receives TransportAdmissionDecision only (no payload bytes); non-appealable kinds do not trigger hook.
- All pre-4.6 admission outputs byte-identical when new options are omitted.

## Non-goals

- Full super-peer storage availability (Phase 15 in roadmap-ordering.md).
- Hypercore/Corestore replication substrate (Phase 20B).
- HyperDHT peer hints (Phase 20C).
- Networked moderation queues with human UI (Phase 21).
- mTLS / OAuth2 inter-bridge trust (Phase 19).

## Exit criteria

- `OperatorSurface` is runtime-configurable; scope narrowing enforced; widening rejected at construction.
- `PolicySubscriptionRuntime` wired into admission check order as check #8.5.
- Multi-bridge advisory reputation feed ingestion with fail-closed clamping.
- `quarantinePeer` / `liftQuarantine` operator API with audit events.
- Appeal hook with best-effort, payload-free invocation.
- All pre-4.6 admission behaviour unchanged when new options are omitted.
