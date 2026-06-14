# Trust Boundaries — the three kinds of trust

## Purpose

The proposed "Identity Trust Registry" (a `trust-registry.ts` in
`@lfp2p/capabilities` that answers *"can I trust this authority?"*)
is **blocked on this document.** The reason: the system already
contains three distinct, deliberately-separated trust models, and a
new registry that blurs them would create a competing/duplicate trust
system — the exact drift the project forbids.

This doc draws the boundary so any future trust-registry slice has a
foundation: it states what each existing model *is*, what a trust
registry **may** do, and what it **must not** do.

## The three kinds of trust

These are not three implementations of one idea. They answer three
*different questions*, derive from *different inputs*, and have
*different failure semantics*. Conflating them is a security bug, not
a refactor opportunity.

### 1. Capability-authority trust — "Is this action authorized?"

- **Question**: Does party P hold a valid, unexpired, unrevoked,
  sufficiently-verified capability to perform action A on resource R
  within scope S?
- **Source of truth**: `@lfp2p/capabilities` — `CapabilityGrantV1`,
  the delegation graph, the proof registry (`verificationState`), and
  `evaluateCapabilityReliance`.
- **Shape**: a binary-ish *decision* (`allow` / `warn` /
  `require-confirmation` / `quarantine` / `deny`) about a *specific
  action*, not a standing score about a party.
- **Derives from**: cryptographic proof verification + delegation
  lineage + caveats. **Authority comes from a grant, never from
  identity alone** — this is the object-capability invariant.
- **Failure mode**: fail-closed. Absent/expired/revoked/unverified
  proof ⇒ deny.

### 2. Reputation trust — "How much signal does this party carry?"

- **Question**: Given my personal trust graph, how reputable is this
  actor / device / community / relay? Is this likely spam?
- **Source of truth**: `@lfp2p/trust-safety` Phase 1.8 — the local
  personalized-EigenTrust reputation graph, the aggregator runtime,
  the spam gate, and the default labeler registry (local-only).
- **Shape**: a *continuous, per-user, subjective* score / band
  (`high` / `mid` / `low` / `untrusted`) — never a global verdict.
- **Derives from**: observations, attestations, the seed contact
  graph, sybil-hardening. **Per-user, never global; never leaves the
  device by default.**
- **Failure mode**: fail-open for surfacing (a missing score must not
  manufacture a spam label), fail-closed only where the doctrine says
  so (admission throttling).

### 3. Identity-control trust — "Is this key still the controller?"

- **Question**: Is this device key currently authorized by the
  controller identity? Has it been rotated or revoked?
- **Source of truth**: `@lfp2p/identity` Phase 2 — the identity
  control log (`controller.created`, `device.authorized`,
  `device.revoked`, `device.rotated`) and its projection.
- **Shape**: a *membership/epoch* fact — a device is `active` or
  `revoked` at a given epoch. Deterministic, replayable, not a score.
- **Derives from**: the signed identity-control event log.
- **Failure mode**: fail-closed. A revoked device key authorizes
  nothing, regardless of reputation or capabilities.

## The boundary rules

```text
                 authorizes a specific action
capability  ───────────────────────────────────────►  ACTION DECISION
authority         (proof + delegation + caveats)

                 weights / ranks a party (subjective)
reputation  ───────────────────────────────────────►  SCORE / BAND
trust             (personal graph; never global)

                 is this key the controller right now
identity    ───────────────────────────────────────►  ACTIVE / REVOKED
control           (signed control log; deterministic)
```

1. **Authority is never derived from reputation.** A high reputation
   score MUST NOT grant a capability. Reputation may *inform* a
   `warn` / `require-confirmation` UX, or throttle admission, but it
   can never substitute for a verified capability proof.

2. **Authority is never derived from identity alone.** Being the
   controller does not, by itself, authorize an action — the
   controller still issues/holds capabilities. (This is already
   enforced: `capability.vc-only-authority-denied` rejects
   identity-assertion-only authority.)

3. **Reputation is never global, never an authority.** The reputation
   graph is per-user and subjective; it produces signal, not
   permission. No reputation value is ever an ACL entry.

4. **Each model owns its own revocation.** Capability revocation
   (proof registry / revocation events), reputation removal
   (`reputation.aggregator.score.removed`), and device revocation
   (identity control log) are independent. A future trust registry
   MUST NOT collapse them into one revocation surface.

## What a future trust registry MAY do

A trust registry, *if* built, is allowed to be a **read-only
composition / projection layer** that *references* the three sources
without re-deriving them:

- Present a unified, audit-friendly view: "for authority X, here is
  its capability-authority decision basis, its reputation band, and
  its identity-control status" — each clearly labelled by source.
- Cache the *worst-case* posture across the three for a fast
  fail-closed pre-check (e.g. "device revoked ⇒ stop, don't even
  evaluate the capability").
- Hold trust-*policy* the user configures (e.g. "require `verified`
  proofs for `label.*` actions", "treat `untrusted` reputation as
  `require-confirmation` for first contact") — policy, not new trust
  facts.

## What a future trust registry MUST NOT do

- **MUST NOT introduce a new `trustLevel` that becomes an authority
  input.** Authority stays with capabilities. A trust level may gate
  UX or admission, never grant permission.
- **MUST NOT re-implement reputation.** No scoring, no graph, no
  decay — those belong to `@lfp2p/trust-safety`. The registry
  *references* a reputation band; it never computes one.
- **MUST NOT re-implement identity control.** Device active/revoked
  state is owned by `@lfp2p/identity`. The registry *reads* it.
- **MUST NOT become a global trust authority.** Like the labeler
  registry, any default trust posture ships local-only / fail-closed;
  no shipped entry privileges an external party.
- **MUST NOT collapse the three revocation surfaces** into one.

## Status

- **Capability-authority trust**: implemented (grants, delegation
  graph, **proof registry**, reliance).
- **Reputation trust**: implemented (Phase 1.8, complete).
- **Identity-control trust**: implemented (Phase 2.1–2.3).
- **Trust registry**: implemented as a **read-only composition
  layer** in `packages/capabilities/src/trust-registry.ts`. The
  module exposes a single function `composeAuthorityView({ authority,
  now, resolveCapabilityPosture?, resolveReputationPosture?,
  resolveIdentityPosture? }) → AuthorityTrustView`. Each posture is
  *labelled by source*; the layer mints no trust facts of its own;
  there is no `setAuthorityTrust`, no `trustState` field, and no
  boolean trust predicate (the doctrine-forbidden ACL-style surface).
  A `worstCasePrecheck: 'block' | 'continue'` field caches the
  fail-closed pre-check from the doctrine: `'block'` iff at least one
  source surfaced a hard signal (`capability-deny` /
  `reputation-untrusted` / `identity-revoked`). A `'continue'`
  pre-check is **never** a positive trust signal — it just means the
  fast path found no hard-fail and the caller must still run the
  normal capability gate.

## References

- `capability-authority-model.md` — capability grants + proof registry.
- `reputation-graph-doctrine.md` — per-user reputation + labeler registry.
- `identity-control-log.md` — device authorization + revocation.
