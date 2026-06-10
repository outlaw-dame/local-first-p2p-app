# Reputation Graph Doctrine (Phase 1.8)

- Status: Draft
- Date: 2026-06-04
- Related ADRs:
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
- Related doctrine:
  - `docs/protocol/bridge-admission-doctrine.md` (Phase 1.64, 4.1–4.4)
  - `docs/protocol/labeler-runtime-doctrine.md` (Phase 1.66)
  - `docs/protocol/curation-doctrine.md` (Phase 1.65)
  - `docs/protocol/privacy-safe-logging.md` (Phase 3.1)
  - `docs/protocol/operation-consistency-classes.md` (Phase 3.2)
  - `docs/protocol/identity-control-log.md` (Phase 2.1–2.3)
- Package: `packages/trust-safety/reputation-graph` (new)

## Purpose

Phase 1.8 introduces a **graph-aware per-user reputation score** that
augments the existing per-peer / per-author trust signals (Phase 1.64
`PeerReputation`, Phase 1.66 labelers, Phase 1.65 curation). It
addresses the one remaining gap in our trust-safety stack: we have
high-quality *local-observation* signals but no way to ask "is this
stranger reachable through a high-quality trust path from me?"

This is the signal that systems like
[Karma3Labs OpenRank](https://docs.openrank.com/the-reputation-stack/openrank-protocol)
ship to Farcaster as a spam-detection layer, leveraging the
[EigenTrust](https://en.wikipedia.org/wiki/EigenTrust) algorithm
(Kamvar, Schlosser, Garcia-Molina, 2003). The algorithm is sound; the
deployment pattern is wrong for a local-first system.

This doctrine specifies how we deliver the **same signal** without
adopting OpenRank as a dependency, and how we **improve on it** in
ways an on-chain reputation marketplace structurally cannot.

## Non-negotiable rules

1. **Reputation is per-user, not global.** Every device computes its
   own personalized EigenTrust eigenvector seeded from its own
   contact graph (Phase 2.3 fingerprint-confirmed contacts +
   petname-set contacts). Two users observing the same network
   produce different scores; there is no "the score" of an account.
   This is the academic fix for the symmetric-reputation-function
   sybil result (Berkeley 2007, Traupman 2007).
2. **Reputation never leaves the device unless the user opts in.**
   The trust graph is local. Observation events default to
   `device-local` privacy. Promotion to `self` or `public` requires
   an explicit Phase 1.62 local-control-state action; the protocol
   layer makes no automatic upgrade.
3. **No on-chain trust assumption.** No EigenLayer AVS, no DA layer,
   no slashing economy. Verifiability comes from local replay
   determinism (Phase 3.2): the user holds the inputs (their event
   log + signed observations) and can re-derive any score at any
   time. A third-party score *can* be consumed via the labeler
   surface but it is one signal among many, never the system's
   source of truth.
4. **No global authority on the seed set.** The pre-trusted-peer
   set is the user's own Phase 2.3 fingerprint-compared contacts,
   weighted by attestation strength. No protocol-level authority
   defines who is trusted to seed anyone else's graph.
5. **Reputation observations never carry payload bytes.** Only
   counts and stable kind tags. Phase 3.1 privacy-safe-logging
   doctrine applies — observation events MUST be auditable
   without inspecting the original content they describe.
6. **Reputation is deterministic, replayable, and bounded.** The
   computation runs as a Phase 3.2 frozen projection: same inputs
   → byte-identical output, every hop. Hard caps on graph size,
   edges per node, iterations, and convergence threshold; degraded
   inputs fail closed (smaller, less confident score; we never
   block waiting for convergence).
7. **Reputation never causes silent deletion.** Like every other
   T&S signal in our stack: low score may downrank, may quarantine,
   may slow admission. It MUST NOT silently drop content the user
   asked for or deny verifiable provenance.
8. **Subscribing to a reputation aggregator is fully revocable.**
   Per Phase 1.66 labeler discipline: a user can unsubscribe at any
   time, the prior scores are removed from their composed view, and
   no aggregator can persist any influence beyond its current
   subscription.

## Threat model

| Adversary capability | Mitigation |
|---|---|
| Sybil cluster around a target (vanilla EigenTrust attack) | Personalized seed vector breaks symmetric-reputation-function premise; sybils unreachable from the user's contact graph score ≈ 0 |
| Feedback clique (closed group rating each other up) | Clustering-coefficient + inbound/outbound asymmetry penalty; clique with no outbound trust pays a multiplicative damping factor |
| Community-structure / eigenvector-centrality attack (positioning near pre-trusted peers) | Path-quality damping per hop α^n means inflated centrality decays geometrically; fingerprint-attested edges cap inflation |
| Compromised pre-trusted peer | Per-user seed set means compromise affects only that user; per-edge time-decay drops the malicious endorsement; explicit revocation via Phase 2.3 fingerprint-compare flow removes it permanently |
| Algorithmic complexity DoS (huge graph submitted by attacker) | Hard caps (`maxNodes`, `maxEdgesPerNode`, `maxIterations`); excess truncated deterministically (alphabetical by stable id) — replayable, not undefined |
| Forged observation event | Phase 1.61 signature verification; observation events are signed envelopes per Phase 2.1 |
| Replay of stale observations | Phase 1.64 replay cache (already in admission); per-observation `createdAt` + time-decayed weight in EigenTrust |
| Privacy leak via graph publication | Default `device-local` privacy; no protocol-level publication; aggregator labeler is opt-in |
| Hostile aggregator labeler publishing biased scores | Phase 1.66 multi-labeler stacking; user can subscribe to N aggregators and the composed view applies their explicit priority; unsubscribe is one event |
| Quorum-of-strangers sybil (many fake accounts collectively endorsing a target) | The eigenvector computation gives all such mutually-endorsing strangers near-zero weight unless they connect back to the user's seed set; the attacker must compromise at least one real contact to seed influence |
| Persistent "trust laundering" via short-lived high-rep accounts | Time-decay + observation-window aggregation: a burst of high ratings from a single window is damped relative to consistent ratings over time |
| Operator-bridge attempts to inject scores | Bridges don't compute or publish scores — they're a transport surface (Phase 4 doctrine). Reputation events are signed by user devices and travel through bridges like any other signed event |
| Reputation-state divergence between devices of the same user | Phase 3.2 replay determinism + Phase 2.2 identity persistence: each device re-runs the same computation from the same event log and produces the same state |

## Wire model

### Event kinds

| Kind | Authoritative | Privacy default | Carries |
|---|---|---|---|
| `reputation.observation.recorded` | author device | `device-local` | `subject` (identity ref), `kind` (stable enum), `satCount`, `unsatCount`, `windowStart`, `windowEnd` |
| `reputation.attestation.published` | author device | `device-local` | `subject`, `valence` (`positive` \| `negative` \| `dispute`), `contextTag`, `strength` (bounded 0–1), optional `expiresAt` |
| `reputation.attestation.revoked` | author device | `device-local` | `attestationId` (the earlier event's id), `revokedAt` |
| `reputation.aggregator.published` | labeler (Phase 1.66 surface) | `public` | `subjects`: list of `{ subject, score, confidence, observationCount, algorithm, computedAt }`. Subjects are identities, not posts. |
| `reputation.aggregator.score.removed` | labeler | `public` | `subject`, `reason` (stable code) |

**Notes:**

- `kind` on observation events is a stable enum (e.g.
  `outbox.useful`, `outbox.spammy`, `bridge.well-behaved`,
  `bridge.misbehaved`, `media.served-corrupt`). Never free-form text.
- `contextTag` on attestation events is similarly bounded
  (e.g. `contact.verified-in-person`, `community.moderator`,
  `commercial.fulfilled-order`). The set is protocol-versioned; a
  forward-compatible event with an unknown tag is ignored
  deterministically (no error, no partial inclusion).
- The aggregator event carries scores for many subjects in one
  signed batch — this is how a third-party (e.g., an
  OpenRank-derived labeler) publishes their global view *into* the
  user's local labeler stack.

### Aggregator labeler kind

Phase 1.66 already defines a labeler runtime where users explicitly
subscribe to labelers with full priority control. Phase 8 adds one
new `labeler.kind`:

- `labeler.kind: reputation-aggregator` — a labeler whose published
  labels are reputation scores rather than category tags. The
  composed view (Phase 1.66) applies the user's priority order: a
  local-personalized EigenTrust score (computed device-side) is
  ALWAYS labeler #0 (the device's own view) and external aggregators
  stack below at user-chosen priorities.

The integration point for OpenRank, if a user wants it, is **exactly
one of these aggregator labelers** — a thin adapter that fetches
OpenRank scores and republishes them as signed
`reputation.aggregator.published` events. Not a protocol dependency.

## Algorithm: local personalized EigenTrust + improvements

### Inputs (frozen per Phase 3.2)

```
ReputationGraphInputs = Readonly<{
  observations:  ReadonlyArray<SignedEnvelope<reputation.observation.recorded>>,
  attestations:  ReadonlyArray<SignedEnvelope<reputation.attestation.published>>,
  revocations:   ReadonlyArray<SignedEnvelope<reputation.attestation.revoked>>,
  seedContacts:  ReadonlyArray<Readonly<{
    subject: IdentityRef,
    strength: number,                       // 1.0 fingerprint-verified, 0.5 petname-only, 0.1 observed-only
    attestedAt: IsoTimestamp
  }>>,
  config: ReputationConfig
}>;

ReputationConfig = Readonly<{
  damping: number,                          // PageRank-style α, default 0.85
  maxNodes: number,                         // default 100_000
  maxEdgesPerNode: number,                  // default 500
  maxIterations: number,                    // default 100
  convergenceThreshold: number,             // default 1e-6
  observationWindowMs: number,              // default 30 days
  timeDecayHalfLifeMs: number,              // default 14 days
  cliquePenaltyExponent: number,            // default 0.5
  pathQualityDamping: number                // default 0.7 per non-attested hop
}>;
```

### Normalization (Kamvar et al.)

For each observer `i` and subject `j`, raw local trust:

```
sᵢⱼ = max(0, satᵢⱼ − unsatᵢⱼ) × timeDecay(observationAge)
cᵢⱼ = sᵢⱼ / Σⱼ sᵢⱼ                    // row-normalize so Σⱼ cᵢⱼ = 1
```

`timeDecay(age) = 2^(−age / halfLife)`. An observation older than
`observationWindowMs` is dropped (Phase 3.2 deterministic floor).
Negative net observations contribute zero (Kamvar's original
formulation — explicit "distrust" is handled by negative attestations
in our model, not by signed local trust values).

### Personalized seed vector (the sybil-resistance fix)

Vanilla EigenTrust uses a uniform start vector `ē` — the result is
the same for every observer, which is why it is provably not
sybil-proof. We use a **per-user seed vector** `p` keyed by the
user's own contact graph:

```
pₖ = (strengthₖ × timeDecay(attestationAgeₖ)) / Σ strengths
```

For peers not in the seed set, `pₖ = 0` initially. The eigenvector
update becomes the **personalized** form:

```
t̄^(k+1) = (1 − α) · p  +  α · Cᵀ · t̄^(k)
```

This is the same equation form used by Page–Brin's personalized
PageRank. It is the academic standard fix and the closest natural
form to ship in code.

### Sybil-resistance hardening layers

These run as post-processing on the raw eigenvector and on the input
graph respectively:

1. **Clique-detection penalty.** For each strongly-connected
   component with no outbound edges to the rest of the graph,
   multiply every member's score by
   `(1 / size)^cliquePenaltyExponent`. Closes the feedback-clique
   attack — N mutually-rating accounts pay a `1/√N` penalty by
   default.
2. **Path-quality damping.** Edges through non-attested peers
   contribute a factor of `pathQualityDamping^n` where `n` is the
   number of non-attested hops on the path. Implemented as edge
   re-weighting before the matrix `C` is built. Closes the
   community-structure / eigenvector-centrality attack.
3. **Attestation amplifier.** A Phase 2.3 fingerprint-compare
   ceremony between the user and a target permanently boosts the
   path weight to that target (until explicit revocation). This is
   the one signal an on-chain protocol structurally cannot
   replicate — it requires real out-of-band human contact.
4. **Time-windowed observation aggregation.** Observations are
   aggregated per `observationWindowMs`; a single burst from one
   window contributes less than the same volume spread across many
   windows. Resists "trust laundering" via short-lived hot accounts.

### Output (frozen per Phase 3.2)

```
LocalReputationState = Readonly<{
  version: 'lfp2p.reputation-graph.v1',
  computedAt: IsoTimestamp,
  scores: ReadonlyMap<IdentityRef, Readonly<{
    score: number,                          // ∈ [0, 1], sums to 1 over all subjects
    confidence: number,                     // ∈ [0, 1] — function of observation count + iterations to converge
    iterations: number,
    seedDistance: number                    // # hops to nearest seed (∞ if unreachable)
  }>>,
  truncated: boolean,                       // true if input exceeded maxNodes
  convergedWithinIterations: boolean
}>;
```

State is deep-frozen on construction per the Phase 3.2 frozen-walk
test. Replay equivalence is pinned by tests covering: same-log →
same-bytes, iteration cap behaviour, truncation determinism (by
stable id sort), and commutativity (event order within a window
doesn't change the eigenvector).

## Surface integration

### Admission engine (Phase 1.64 / 4.1)

Per-peer rate-limit-bucket parameters are modulated by the score of
the peer's authoritative identity:

| Score band | Bucket capacity | Refill rate | Cooldown growth |
|---|---|---|---|
| `≥ 0.5` (high) | 2× baseline | 2× baseline | 0.5× exponent |
| `[0.1, 0.5)` (mid) | 1× baseline | 1× baseline | 1× exponent |
| `[0.01, 0.1)` (low) | 0.5× baseline | 0.5× baseline | 1.5× exponent |
| `< 0.01` or unknown | 0.25× baseline | 0.25× baseline | 2× exponent |

Engine math is unchanged — only the parameter is dialed. Reputation
state advance and persistence ride the Phase 4.2 fail-closed save
path. Decision audit log records the *band* (privacy-safe) but not
the raw score (which is recoverable by recomputation if needed).

### Curation surface (Phase 1.65)

Per-source surface score becomes one input to the curation gate.
Low-score sources are downranked rather than hidden — preserves the
"no centralized truth" principle. The user's local-controls (Phase
1.62) still override; an explicit subscribe / mute beats any
algorithmic signal.

### Spam gate (new)

The Farcaster-style use case. A subject is flagged as `spam` if:

```
score < spamThreshold
AND seedDistance > spamSeedDistanceMax
AND noPositiveAttestation
```

All three thresholds are user-tunable; defaults are conservative.
Output is a Phase 1.66 label (`spam.likely`) emitted by the device's
own labeler at priority #0. Other aggregator labelers may override
at lower priority per the user's stack.

### Future Phase 7 (block-store) integration

The block-store fetch path consults the score of the publishing
identity before auto-fetching media. Low-score / unknown publishers
require explicit user opt-in to fetch (defaults configurable).

## Why this is structurally better than adopting OpenRank

| Axis | OpenRank | Phase 8 |
|---|---|---|
| Trust root | Pre-trusted-peer seed set chosen by aggregator | Per-user fingerprint-attested contact graph (Phase 2.3) |
| Sybil resistance | Symmetric reputation function — provably not sybil-proof | Personalized PageRank form — closes the proven attack |
| Privacy | Reputation graph published to DA layer | Reputation graph stays on the device |
| Verifiability | EigenLayer restake + slashing + on-chain commitments | Local replay determinism (Phase 3.2) — user has the inputs |
| Composability | One algorithm per context | Phase 1.66 labeler stack — N algorithms simultaneously, user-prioritized |
| Phase numbering note | n/a | Phase 1.8 sits in the 1.x trust-safety family alongside 1.61–1.71; the existing Phase 8 in the top-level plan (Ephemeral presence plane) is unrelated |
| Out-of-band attestation | Not modelled | Phase 2.3 fingerprint-compare amplifies trust paths permanently |
| Personalization | Limited (context selection) | Every user gets a different ranking |
| Revocation | Algorithm-bound | Phase 1.66 labeler unsubscribe + Phase 2.3 contact revocation; both event-level |
| Dependency surface | EigenLayer AVS + DA layer + Karma3Labs early-stage stack | Pure compute over our existing event log |
| OpenRank-style scores still available | n/a | Yes — as a `reputation-aggregator` labeler, optional and revocable |

## Acceptance criteria (per planned phase)

### Phase 1.8.1 — Reputation observation events (protocol)

| Criterion |
|---|
| New event kinds added with bounded enums for `kind` / `contextTag` / `valence` |
| Validation rejects free-form text, unknown enums (forward-compatible: ignored deterministically, not partial), windows that violate `windowStart ≤ windowEnd`, strengths outside `[0, 1]` |
| Default privacy = `device-local` for observation + attestation; `public` only for aggregator-labeler kind |
| Phase 3.2 frozen-walk + replay-equivalence tests pinned |
| Fixtures: 4 valid + 2 invalid per kind |

### Phase 1.8.2 — Local personalized EigenTrust computer

| Criterion |
|---|
| `packages/trust-safety/reputation-graph` package created |
| Pure function `computeReputation(inputs) -> LocalReputationState` with all defaults from doctrine |
| Personalized seed vector seeded from Phase 2.3 contacts with documented strength bands |
| Hard caps enforced (`maxNodes`, `maxEdgesPerNode`, `maxIterations`); truncation is deterministic by stable id sort |
| Convergence threshold + iteration cap + graceful failure when not converged (`convergedWithinIterations: false`) |
| Deep-freeze on construction per Phase 3.2 |
| Adversarial tests: replay equivalence, byte-identical across runs, NaN / Infinity rejection, empty graph, single-seed graph |

### Phase 1.8.3 — Surface integration

| Criterion |
|---|
| Admission engine rate-limit bucket parameter table wired and unit-tested per band |
| Curation surface input documented + integration test |
| Spam gate emits `spam.likely` label via Phase 1.66 path |
| Audit log records band, NOT raw score (privacy-safe per Phase 3.1) |
| User-overrides (explicit subscribe/mute) beat algorithmic signal — pinned by test |

### Phase 1.8.4 — Aggregator labeler kind (OpenRank integration point)

| Criterion |
|---|
| `labeler.kind: reputation-aggregator` declared (extends Phase 1.66 capabilities) |
| `reputation.aggregator.published` event validated; subjects bounded; per-event subject cap enforced deterministically |
| Optional external adapter package (NOT in protocol core) demonstrates fetch-OpenRank-republish-as-labeler-events |
| Adapter is opt-in via Phase 1.66 subscribe flow; revocation is one event |
| Local-personalized score is always labeler #0; external aggregators stack below |

### Phase 1.8.5 — Sybil hardening

| Criterion |
|---|
| Clique-detection penalty implemented; test pinned with N=10 closed-clique scenario showing rank suppression |
| Path-quality damping implemented; test pinned with attested-vs-unattested path scenario |
| Time-windowed aggregation pinned with burst-vs-spread test |
| Fingerprint amplifier verified against Phase 2.3 contact-verification events |
| Threat-model row from `threat-model.md` updated with each mitigation citing the test |

## Default labeler registry (Phase 1.8.15)

The non-negotiable made executable: **no external party is privileged
out of the box.**

`@lfp2p/trust-safety` ships `DEFAULT_LABELER_REGISTRY` — and its
`entries` array is **empty**. A brand-new device consults ONLY its
own local personalized-EigenTrust computer (Phase 1.8.2), which wins
priority 0 structurally inside `computeAggregatedReputation`. There is
no shipped seed-set, no mandatory aggregator, no global trust
authority that every user inherits. A test
(`reputation-graph-labeler-registry.test.ts`) pins
`DEFAULT_LABELER_REGISTRY.entries.length === 0` so a future edit that
smuggles a mandatory external labeler into the shipped default fails
CI.

What the registry *mechanism* provides is an explicit, opt-out-able
way to add external labelers:

- A **distributor** (e.g. a fork that wants to ship a curated bundle)
  constructs its OWN `DefaultLabelerRegistry` and passes it to
  `resolveActiveLabelerSet`. It does not mutate the shipped constant.
- A **user** adds subscriptions explicitly; their entries override a
  distributor default for the same `labelerId` (the user is sovereign
  over their own stack).
- `resolveActiveLabelerSet({ registry?, userSubscriptions?, mutedLabelerIds? })`
  composes the three into the effective `AggregatorSubscription[]`
  that feeds the Phase 1.8.4 runtime. Structural guarantees: the
  `__local__` sentinel can never become a subscription; priority 0 is
  reserved (entries claiming it are rejected, not silently bumped into
  a live slot); a muted `labelerId` is excluded even if a default
  lists it (opt-out always wins); output is deterministic + deep-frozen
  per Phase 3.2; every active entry carries an audit-friendly
  `'distributor' | 'user'` origin per Phase 3.1.

Why local-only and not a curated default bundle: shipping N
independent labelers pre-subscribed would give a brand-new user (with
no contacts yet) immediate signal — but at the cost of making whoever
curates that bundle a de-facto trust authority every user inherits
until they mute it. That trades away non-negotiable #1. The chosen
posture keeps the trust root strictly on-device; a distributor fork
that wants different defaults can supply its own registry, openly, as
an explicit product decision rather than a hidden one.

## Deferred work (post-Phase 1.8)

- **Cross-device reputation state sharing** within one user's identity
  cluster. Today each device computes independently; a future slice
  could share the eigenvector via the existing Phase 2 identity-event
  control log so a fresh device boots warm.
- **Mutual-attestation challenge protocol** — an interactive protocol
  where two devices exchange signed observations + recompute together
  to detect inconsistent observation reporting. Not in scope for v1.
- **Differential-privacy noise injection** on observation events
  promoted to `public`. Reduces a subtle deanonymization vector
  (observation-pattern fingerprinting). Worth a separate doctrine.
- **OpenRank verifiable-compute adapter** as a reference labeler in
  the external-adapter package. Demonstrates the labeler integration
  path concretely; not required for Phase 1.8 acceptance.
- **Native graph-store backing** if local computation outgrows the
  Phase 3.2 frozen projection model for very large local graphs
  (>1M edges). Today the cap is 100k nodes × 500 edges = 50M edges
  upper bound which the projection model handles fine.

## References

- Kamvar, Schlosser, Garcia-Molina. *The EigenTrust Algorithm for
  Reputation Management in P2P Networks.* WWW 2003.
- Cheng, Friedman. *Sybilproof Reputation Mechanisms.* P2PECON 2005
  (the formal result that symmetric reputation functions are not
  sybil-proof).
- Page, Brin, Motwani, Winograd. *The PageRank Citation Ranking.*
  Stanford 1998 (personalization vector form).
- Karma3Labs OpenRank documentation:
  https://docs.openrank.com/the-reputation-stack/openrank-protocol
- EigenCloud OpenRank verifiable-compute writeup:
  https://blog.eigencloud.xyz/unlocking-verifiable-reputation-with-openrank-and-eigencloud/
- *The Effects of Pre-trusted Peers Misbehaviour on EigenTrust*
  (Springer IFIPTM 2012).
- *Personalizing EigenTrust in the Face of Communities and Centrality
  Attack* (2007).
- *HonestPeer: An Enhanced EigenTrust Algorithm for Reputation
  Management in P2P Systems* (2014).
