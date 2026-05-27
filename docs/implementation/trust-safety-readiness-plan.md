# Trust & Safety Readiness Plan

This document defines the work that should be completed before trust and safety implementation begins, then identifies the exact point where trust and safety work should start.

The goal is to prevent trust and safety from becoming a late UI feature or moderation dashboard. In this repository, trust and safety must become part of the protocol, local-first storage model, bridge admission model, curation model, and public-surface expansion gates.

## Current repository context

The repository is currently in **Phase 1.5 / 3.5 - doctrine alignment and protocol hardening before feature expansion**.

The implementation already has a strong early foundation:

- PWA-first local-first light peer.
- Signed durable event envelopes.
- Local device identity bootstrap.
- Dexie local event/outbox state.
- HTTP bridge transport primitives.
- Bridge signature verification before delivery acceptance.
- Bridge-safe privacy-scope checks.
- Idempotency and retry/backoff primitives.
- Sync checkpoints and identity-control projection work.

The repository is not ready for production chat, production bridge deployment, media, public social outbox, MLS, public indexing, or recommendation/search expansion. Those surfaces increase abuse risk and should stay blocked until trust and safety doctrine and protocol boundaries exist.

## Why trust and safety must be inserted before feature expansion

Trust and safety is not only moderation. It affects:

- what a client displays,
- what a bridge accepts,
- what a relay or persistent availability peer forwards,
- what a public index stores,
- what a search system returns,
- what a recommendation/curation engine amplifies,
- what media is allowed to replicate,
- how reports and appeals are routed,
- what evidence is preserved,
- how local user preferences remain private,
- how communities enforce policy without pretending to own the whole network.

Because this system is local-first, P2P-capable, bridge-assisted, and eventually dual/hybrid protocol aware, every safety action must explicitly define:

1. the authority making the decision,
2. the scope where the decision applies,
3. the subject of the decision,
4. the policy version used,
5. the reason code,
6. whether the action affects speech, reach, transport, storage, search, ranking, or UI,
7. whether the action is appealable,
8. what private state must not be leaked.

## Work to complete before trust and safety implementation

These items should be completed before writing runtime trust and safety code. They are not optional, because trust and safety will otherwise duplicate concepts already being hardened in protocol, identity, bridge, storage, and encryption work.

### 1. Finish Phase 0 / Phase 1 doctrine guardrails

Complete or confirm the current doctrine-hardening tasks:

- ADR-000 runtime/product-surface decision.
- Explicit schema and storage versioning policy.
- Initial protocol fixture pack.
- Protocol fixture test loader.
- Unknown version behavior.
- Negative fixture suite for malformed protocol objects.
- Exit-report discipline for future phase claims.

Exit criteria:

- New trust and safety durable objects have a versioning rule.
- New trust and safety event kinds have fixture requirements.
- Invalid or unknown trust and safety events fail predictably.
- Future full-peer adapters can implement the same protocol objects.

### 2. Finish identity-control foundations that trust and safety depends on

Trust and safety decisions need stable identity semantics. Before T&S runtime behavior begins, identity-control implementation should be far enough along to support policy authorities, labelers, community actors, bridge actors, and device/account revocation.

Complete or confirm:

- root/controller identity event schemas,
- device authorization/revocation semantics,
- capability grant/revoke semantics,
- identity-control projection fixtures,
- deterministic replay tests,
- authorization helper coverage for trust/device/capability-gated operations,
- clear distinction between local bootstrap identity and authoritative account/controller identity.

Exit criteria:

- A safety authority can be represented without inventing a second identity model.
- Revoked devices cannot continue publishing valid safety decisions.
- Capability-gated moderation actions can be rejected locally before sync.
- Trust and safety code can ask "who had authority to make this decision?" and get a deterministic answer.

### 3. Finish private payload envelope planning before report and moderation payloads

Reports, appeals, moderation notes, and some evidence bundles may contain sensitive material. They cannot reuse plain public event payload assumptions.

Complete or confirm:

- private payload encryption envelope v1,
- encrypted payload metadata rules,
- plaintext metadata exposure rules,
- scope-specific handling for `self`, `dm`, `group`, and future room scopes,
- key wrapping approach before MLS,
- report/evidence encryption constraints,
- tests that prevent private plaintext leakage into public events, bridge logs, search, or curation surfaces.

Exit criteria:

- A report can include private evidence without exposing it to every bridge or peer.
- A moderation appeal can be encrypted to the proper authority.
- Private messages/groups do not get accidentally indexed or labeled through public flows.
- Bridge-safe metadata is explicitly separated from private content.

### 4. Finish bridge compromise and bridge admission planning

The bridge already verifies signatures and checks bridge-safe privacy scopes, but production trust and safety requires a bridge admission model.

Complete or confirm:

- bridge compromise threat model,
- malformed request handling expectations,
- forged confirmation handling,
- replay handling,
- reordered delivery behavior,
- stale confirmation behavior,
- duplicate delivery behavior,
- bridge data-loss behavior,
- metadata exposure limits,
- rate-limit strategy placeholder,
- abuse-control strategy placeholder,
- production observability/log privacy policy placeholder.

Exit criteria:

- A future `transport.event.rejected` or `transport.event.quarantined` decision has a defined place in the bridge model.
- Bridge refusal is not confused with global deletion.
- Bridge abuse controls do not grant the bridge authority over private canonical state.
- Bridge logs cannot leak private report/evidence payloads.

### 5. Finish sync checkpoint and inbound apply correctness

Trust and safety state will include labels, revocations, report status changes, policy decisions, curation rules, and quarantine decisions. Those cannot be applied twice, skipped silently, or rewound accidentally.

Complete or confirm:

- sync checkpoints by source/stream/scope,
- monotonic checkpoint advance rules,
- explicit rewind policy,
- inbound signature verification before persistence,
- atomic event + checkpoint persistence,
- stale sequence handling,
- replay behavior,
- local-store transaction coverage for projected state.

Exit criteria:

- A safety label revocation cannot be lost or applied out of order without detection.
- A policy decision projection can be rebuilt deterministically from signed events.
- A report resolution does not get duplicated across reconnect/resume.
- Quarantine/release transitions remain idempotent.

### 6. Establish privacy-safe logging and observability policy

Trust and safety requires observability, but observability is also a privacy risk.

Complete or confirm:

- no private plaintext in logs,
- no raw report evidence in logs,
- no private mute/block graph leakage,
- redacted reason-code logging,
- audit-event boundaries,
- local-only debug handling,
- production bridge logging constraints,
- panic/error serialization rules for malformed safety payloads.

Exit criteria:

- T&S implementation can log decisions without logging sensitive content.
- Report and appeal bodies remain encrypted or redacted outside intended authorities.
- User-local preferences do not become bridge/server analytics data.

### 7. Define durable-object versioning for trust and safety before code

Trust and safety will introduce durable object families. Their versioning must be explicit before implementation.

Durable families likely include:

- safety labels,
- label definitions,
- label preferences,
- reports,
- appeals,
- policy decisions,
- authorities,
- moderation queue items,
- quarantine records,
- curation rules,
- curation explanations,
- transport admission decisions,
- relay reputation records.

Exit criteria:

- Every durable T&S object has `version` or `schemaVersion` semantics.
- Unknown major versions fail closed.
- Unknown minor fields can be ignored only where explicitly safe.
- Fixtures exist before broad implementation.

## Work that must stay blocked until trust and safety starts

Do not expand these feature surfaces before T&S doctrine and initial protocol schemas exist:

- production chat,
- MLS private group encryption,
- media manifests and replication,
- public social outbox,
- public comments/replies/reposts/reactions,
- public search indexing,
- semantic/vector recommendation expansion,
- public feed generation,
- naming/namespace discovery UX,
- production bridge deployment,
- WebSocket/Durable Streams public readers,
- persistent availability peers,
- cross-protocol public import/export.

The reason is not that these features are wrong. The reason is that they create public reach, content replication, abuse surfaces, identity impersonation risk, spam vectors, and moderation obligations.

## Where trust and safety should start

Trust and safety should start immediately after the current doctrine/protocol/identity/encryption/sync guardrails are stable enough that T&S does not duplicate or contradict them.

Recommended insertion point:

> **Phase 1.6 - Trust & Safety Doctrine and Protocol Safety Boundaries**

This should happen before chat, MLS, media manifests, social outbox, naming/discovery, public search, recommendation intelligence, production bridge deployment, or public beta.

## Phase 1.6 scope: Trust & Safety Doctrine and Protocol Safety Boundaries

### Deliverables

Add documentation first:

- `docs/adr/004-trust-safety-moderation-curation-v1.md`
- `docs/threat-model/trust-safety-and-abuse.md`
- `docs/protocol/trust-safety-event-policy.md`
- `docs/implementation/trust-safety-phase-plan.md`

The ADR should decide:

- distinction between moderation and curation,
- distinction between speech, reach, transport, storage, search, ranking, and UI actions,
- safety authority model,
- enforcement scope model,
- label model,
- report/appeal model,
- bridge/relay admission decision model,
- user-local control model,
- privacy model for blocks, mutes, reports, appeals, and evidence,
- fixture requirements,
- how T&S composes with identity-control and private payload envelopes.

### Initial protocol concepts

Define these before runtime enforcement:

- `SafetyAuthority`
- `EnforcementScope`
- `SafetySubjectRef`
- `SafetyLabelDefinition`
- `SafetyLabel`
- `SafetyLabelPreference`
- `SafetyReport`
- `SafetyAppeal`
- `SafetyPolicyDecision`
- `TransportAdmissionDecision`
- `CurationRule`
- `CurationExplanation`

### Initial event families

Do not implement every event at once, but reserve the model cleanly.

Candidate event families:

- `safety.account.blocked`
- `safety.account.muted`
- `safety.domain.blocked`
- `safety.keyword.muted`
- `safety.thread.muted`
- `safety.post.hidden`
- `safety.label.applied`
- `safety.label.revoked`
- `safety.label.preference.set`
- `safety.labeler.subscribed`
- `safety.labeler.unsubscribed`
- `safety.report.created`
- `safety.report.acknowledged`
- `safety.report.resolved`
- `safety.appeal.created`
- `safety.appeal.resolved`
- `safety.policy.created`
- `safety.policy.updated`
- `safety.policy.deprecated`
- `safety.policy.decision.recorded`
- `transport.event.rejected`
- `transport.event.quarantined`
- `transport.peer.rate_limited`
- `transport.peer.quarantined`
- `transport.media.rejected`
- `curation.rule.created`
- `curation.rule.disabled`
- `curation.item.downranked`
- `curation.item.excluded`
- `curation.explanation.recorded`

### Initial local-store projections

Plan, then implement only after schemas are stable:

- `safetyLabels`
- `safetyLabelDefinitions`
- `safetyLabelPreferences`
- `safetyReports`
- `safetyAppeals`
- `safetyPolicyDecisions`
- `safetyAuthorities`
- `safetyAuditLog`
- `moderationQueue`
- `quarantinedEvents`
- `quarantinedMedia`
- `blockedActors`
- `mutedActors`
- `blockedDomains`
- `mutedKeywords`
- `trustedPeers`
- `relayReputation`
- `curationRules`
- `curationExplanations`

### Initial tests

Minimum test coverage before merging T&S protocol core:

- invalid label values rejected,
- invalid authorities rejected,
- invalid enforcement scopes rejected,
- hard-safety labels cannot be silently downgraded by unsafe defaults,
- user mutes/blocks are private by default,
- reports require subject, reason, authority, and idempotency fields,
- report evidence cannot be forced into public plaintext payloads,
- moderation decisions require action, scope, authority, policy version, and reason,
- bridge rejection decisions cannot masquerade as global deletion,
- curation downranking remains separate from moderation hiding,
- private `dm`/`group` events cannot be routed into public search/curation safety flows by default,
- malformed safety events fail closed,
- fixtures cover valid and invalid safety objects.

## First trust and safety implementation slice

After Phase 1.6 docs/ADR/threat-model are accepted, the first code slice should be narrow:

> **Trust & safety protocol core without runtime moderation enforcement.**

Suggested package:

- `packages/trust-safety`

Suggested files:

- `packages/trust-safety/package.json`
- `packages/trust-safety/src/index.ts`
- `packages/trust-safety/src/authorities.ts`
- `packages/trust-safety/src/subjects.ts`
- `packages/trust-safety/src/labels.ts`
- `packages/trust-safety/src/reports.ts`
- `packages/trust-safety/src/policy-decisions.ts`
- `packages/trust-safety/src/curation.ts`
- `packages/trust-safety/src/validation.ts`
- `packages/trust-safety/src/index.test.ts`

This package should be pure TypeScript with no bridge, UI, or local-store dependency at first. That keeps protocol semantics portable to PWA, native, full-peer, bridge, and future cross-protocol runtimes.

## Second trust and safety implementation slice

After protocol core exists, integrate only local user controls:

- block actor,
- mute actor,
- mute keyword,
- hide post,
- label preference set.

Do not yet implement networked moderation queues, public labelers, automated classifiers, or public feed ranking.

Reason:

- user-local controls are the safest T&S starting point,
- they fit local-first architecture,
- they do not require global governance,
- they avoid premature centralized moderation assumptions,
- they give the PWA immediate safety behavior before public expansion.

## Third trust and safety implementation slice

Add report and appeal schemas with encrypted/private evidence support.

Do not send reports across bridge infrastructure until:

- private payload envelope enforcement exists,
- bridge log privacy policy exists,
- target authority resolution exists,
- report routing capability checks exist.

## Fourth trust and safety implementation slice

Add bridge/relay admission policy:

- reject malformed signed events,
- reject invalid safety event schemas,
- quarantine suspicious public events,
- rate-limit abusive fanout,
- reject known-disallowed media once media manifests exist,
- record local transport admission decisions,
- keep bridge-local enforcement separate from global deletion.

## Fifth trust and safety implementation slice

Add curation and reach controls:

- local feed preference rules,
- non-personalized feed mode,
- downrank/exclude explanation records,
- safety-aware feed filtering,
- search/recommendation exclusion boundaries.

This should happen before public social outbox and search/recommendation expansion.

## Phase gate summary

Before T&S:

- finish protocol/schema/versioning guardrails,
- finish identity-control basics needed for authorities,
- finish private payload envelope planning needed for reports/evidence,
- finish bridge compromise/admission planning,
- finish sync checkpoint correctness,
- define privacy-safe logging rules.

Start T&S:

- Phase 1.6 docs, ADR, threat model, protocol event policy.

First T&S code:

- `packages/trust-safety` protocol core only.

Then:

- local user controls,
- reports/appeals,
- bridge/relay admission,
- curation/reach controls.

Only after that should the project proceed into:

- chat,
- MLS,
- media manifests,
- social outbox,
- naming/discovery,
- public search,
- semantic recommendation intelligence,
- production bridge/public beta.
