# Trust & Safety Readiness Plan

This document defines the work that should be completed before trust and safety implementation begins, then identifies the exact point where trust and safety work should start.

The goal is to prevent trust and safety from becoming a late UI feature or moderation dashboard. In this repository, trust and safety must become part of the protocol, local-first storage model, content-addressing model, bridge admission model, curation model, and public-surface expansion gates.

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

The repository is not ready for production chat, production bridge deployment, media, public social outbox, MLS, public indexing, or recommendation/search expansion. Those surfaces increase abuse risk and should stay blocked until content-addressing, trust and safety doctrine, and protocol boundaries exist.

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
- how content-addressed objects are quarantined or refused,
- how local user preferences remain private,
- how communities enforce policy without pretending to own the whole network.

Because this system is local-first, P2P-capable, bridge-assisted, and eventually dual/hybrid protocol aware, every safety action must explicitly define:

1. the authority making the decision,
2. the scope where the decision applies,
3. the subject of the decision,
4. the exact object/content reference when content-backed,
5. the policy version used,
6. the reason code,
7. whether the action affects speech, reach, transport, storage, search, ranking, or UI,
8. whether the action is appealable,
9. what private state must not be leaked.

## Corrected role and labeler model

The product may expose familiar roles:

- owner/founder,
- admin,
- moderator,
- reviewer,
- bot,
- labeler,
- curator,
- bridge operator,
- relay operator,
- super-peer operator.

These roles are valid and expected. Communities often have owners/admins/moderators. The protocol rule is not "communities cannot have admins." The rule is:

> Product roles must resolve to scoped, revocable capability/policy authority. No role is ambient global authority.

A community admin may be powerful inside that community, but cannot delete global identity, read encrypted DMs, override unrelated bridges, or impersonate users unless a future explicit capability grants a narrowly scoped operation.

Labeler and Tagger-agent outputs are advisory by default. A Tagger agent may be a bot, human-run service, community account, media scanner, bridge-local classifier, or curator that publishes signed labels, reports, annotations, or curation tags. Enforcement requires local policy, trusted labeler subscription, capability proof where applicable, and scoped policy decision logic.

W3C Web Annotation may be used as an interoperability projection for annotations/classifications/context notes, but canonical enforcement remains signed protocol events with authority, scope, reason code, policy version, object refs, and appealability.

## Content-addressing dependency

Trust and safety must not invent one-off hash fields for evidence, media, quarantine, search, or reports.

Before T&S protocol core implementation, Phase 1.56 should define and implement shared content-addressing/object-reference primitives:

- `DigestRef`
- `ContentLink`
- `BlockRef`
- `ObjectRef`
- `BundleRef`
- `StorageLocationHint`

These are CID-compatible but not IPFS-dependent. A CID/content link is an identifier, not a storage backend, routing protocol, authority claim, read permission, safety claim, or availability guarantee.

T&S uses object refs for:

- safety subjects,
- report evidence,
- appeal evidence,
- media labels,
- bridge quarantine records,
- transport admission decisions,
- curation provenance,
- search/recommendation exclusion state.

## Work to complete before trust and safety implementation

These items should be completed before writing runtime trust and safety code. They are not optional, because trust and safety will otherwise duplicate concepts already being hardened in protocol, identity, bridge, storage, encryption, and content-addressing work.

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
- New content-addressing durable objects have a versioning rule.
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
- production observability/log privacy policy placeholder,
- transport admission decision scope rules.

Exit criteria:

- A future `transport.event.rejected` or `transport.event.quarantined` decision has a defined place in the bridge model.
- Bridge refusal is not confused with global deletion.
- Bridge abuse controls do not grant the bridge authority over private canonical state.
- Bridge logs cannot leak private report/evidence payloads.

### 5. Finish sync checkpoint and inbound apply correctness

Trust and safety state will include labels, revocations, report status changes, policy decisions, curation rules, quarantine decisions, and transport admission decisions. Those cannot be applied twice, skipped silently, or rewound accidentally.

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
- no full private content refs or location URLs in shared telemetry,
- redacted reason-code logging,
- audit-event boundaries,
- local-only debug handling,
- production bridge logging constraints,
- panic/error serialization rules for malformed safety payloads.

Exit criteria:

- T&S implementation can log decisions without logging sensitive content.
- Report and appeal bodies remain encrypted or redacted outside intended authorities.
- User-local preferences do not become bridge/server analytics data.
- Content-addressed private refs do not become cross-service correlation tokens.

### 7. Define durable-object versioning for trust and safety before code

Trust and safety will introduce durable object families. Their versioning must be explicit before implementation.

Durable families likely include:

- safety annotations,
- safety labels,
- label definitions,
- labeler profiles,
- labeler subscriptions,
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

### 8. Complete Phase 1.56 content-addressing and object references

Trust and safety should not start protocol-core implementation until the content-addressing object model is stable enough to avoid one-off evidence/media/quarantine refs.

Required docs:

- `docs/adr/005-content-addressing-and-object-references-v1.md`
- `docs/protocol/content-addressing.md`
- `docs/threat-model/content-addressing-abuse.md`
- `docs/implementation/phase-1.56-content-addressing-plan.md`

Required implementation:

- `packages/content-addressing`
- validators for `DigestRef`, `ContentLink`, `BlockRef`, `ObjectRef`, `BundleRef`, and `StorageLocationHint`
- valid and invalid fixtures
- tests for malformed digests, unsupported codecs, unsafe sizes, unsafe compression, unsafe location hints, empty bundle roots, private/public dedupe policy, and no-network validation

Exit criteria:

- T&S subjects/evidence can reference exact `ObjectRef` / `BlockRef` values.
- Media manifest planning can consume the same refs.
- Bridge admission/quarantine can target exact refs.
- Search/recommendation provenance can use stable refs without leaking private scopes.
- CIDs/content links are documented and implemented as identifier semantics, not IPFS assumptions.

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

The reason is not that these features are wrong. The reason is that they create public reach, content replication, abuse surfaces, identity impersonation risk, spam vectors, infrastructure risk, and moderation obligations.

## Where trust and safety should start

Trust and safety should start immediately after the current doctrine/protocol/identity/encryption/sync/content-addressing guardrails are stable enough that T&S does not duplicate or contradict them.

Recommended insertion points:

> **Phase 1.56 - Content Addressing and Object Reference Model**

Then:

> **Phase 1.6 - Trust & Safety Doctrine and Protocol Safety Boundaries**

These should happen before chat, MLS, media manifests, social outbox, naming/discovery, public search, recommendation intelligence, production bridge deployment, or public beta.

## Phase 1.6 scope: Trust & Safety Doctrine and Protocol Safety Boundaries

### Deliverables

Documentation first:

- `docs/adr/004-trust-safety-moderation-curation-v1.md`
- `docs/threat-model/trust-safety-and-abuse.md`
- `docs/protocol/trust-safety-event-policy.md`
- `docs/implementation/trust-safety-phase-plan.md`

The ADR decides:

- owner/admin/moderator/reviewer/bot/labeler/curator role model,
- role-to-capability principle,
- Tagger-agent and labeler model,
- W3C Web Annotation projection boundary,
- distinction between moderation and curation,
- distinction between speech, reach, transport, storage, search, ranking, and UI actions,
- safety authority model,
- enforcement scope model,
- label model,
- report/appeal model,
- bridge/relay/super-peer admission decision model,
- user-local control model,
- privacy model for blocks, mutes, reports, appeals, and evidence,
- fixture requirements,
- how T&S composes with identity-control, private payload envelopes, and content-addressing refs.

### Initial protocol concepts

Define these before runtime enforcement:

- `ProductRole`
- `SafetyAuthority`
- `EnforcementScope`
- `SafetySubjectRef`
- `SafetyAnnotation`
- `SafetyLabelDefinition`
- `SafetyLabel`
- `SafetyLabelerProfile`
- `SafetyLabelerSubscription`
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
- `safety.annotation.created`
- `safety.label.applied`
- `safety.label.revoked`
- `safety.label.preference.set`
- `safety.labeler.profile.published`
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
- `transport.event.accepted`
- `transport.event.rejected`
- `transport.event.quarantined`
- `transport.peer.rate_limited`
- `transport.peer.quarantined`
- `transport.media.rejected`
- `curation.rule.created`
- `curation.rule.disabled`
- `curation.item.boosted`
- `curation.item.downranked`
- `curation.item.excluded`
- `curation.explanation.recorded`

### Initial local-store projections

Plan, then implement only after schemas are stable:

- `safetyLabels`
- `safetyLabelDefinitions`
- `safetyLabelerProfiles`
- `safetyLabelerSubscriptions`
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
- `transportAdmissionDecisions`

### Initial tests

Minimum test coverage before merging T&S protocol core:

- invalid label values rejected,
- invalid authorities rejected,
- invalid enforcement scopes rejected,
- hard-safety labels cannot be silently downgraded by unsafe defaults,
- user mutes/blocks are private by default,
- reports require subject, reason, authority, scope, and idempotency fields,
- report evidence cannot be forced into public plaintext payloads,
- moderation decisions require action, scope, authority, policy version, reason, and appealability,
- bridge rejection decisions cannot masquerade as global deletion,
- curation downranking remains separate from moderation hiding,
- private `dm`/`group` events cannot be routed into public search/curation safety flows by default,
- malformed safety events fail closed,
- fixtures cover valid and invalid safety objects,
- Tagger-agent labels remain advisory unless local policy/capability elevates them,
- W3C Web Annotation imports cannot bypass authority validation.

## First trust and safety implementation slice

After Phase 1.6 docs/ADR/threat-model are accepted and Phase 1.56 is implemented, the first code slice should be narrow:

> **Trust & safety protocol core without runtime moderation enforcement.**

Suggested package:

- `packages/trust-safety`

Suggested files are defined in `docs/implementation/trust-safety-phase-plan.md`.

The first implementation slice should not add:

- classifier automation,
- public labeler hosting,
- report routing over bridges,
- public moderation queues,
- media scanner integration,
- public search/recommendation enforcement.

## Follow-on slices

1. Local user controls.
2. Reports, appeals, and encrypted evidence refs.
3. Bridge/relay/super-peer admission policy.
4. Curation and reach controls.
5. Media manifest safety integration.
6. Public search/recommendation safety integration.

## Final readiness rule

Trust and safety is ready to unblock later product surfaces only when:

- Phase 1.56 content-addressing package exists and is tested,
- T&S protocol package exists and is tested,
- local user controls are private by default,
- reports/appeals can reference encrypted evidence safely,
- bridge/relay/super-peer admission is scoped and audited,
- curation/reach controls are separate from moderation,
- public search/recommendation cannot ingest private scopes,
- media manifest planning consumes `BlockRef` / `ObjectRef`,
- fixtures cover valid and invalid safety/content-addressing objects,
- threat models are updated for implemented code.
