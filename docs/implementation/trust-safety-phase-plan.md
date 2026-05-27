# Trust and Safety Phase Plan

- Status: Draft implementation plan
- Date: 2026-05-27
- Related ADRs:
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
  - `docs/adr/005-content-addressing-and-object-references-v1.md`
- Related protocol docs:
  - `docs/protocol/trust-safety-event-policy.md`
  - `docs/protocol/content-addressing.md`
- Related threat models:
  - `docs/threat-model/trust-safety-and-abuse.md`
  - `docs/threat-model/content-addressing-abuse.md`
  - `docs/threat-model/bridge-compromise.md`

## Summary

This document defines the implementation sequence for the trust and safety system.

Trust and safety in this repository is not a late moderation dashboard. It is a protocol and runtime boundary that affects local display, bridge admission, relay/super-peer self-protection, community governance, reports, appeals, media safety, public search, public recommendation, and curation.

The system is tailored to the current architecture:

- PWA-first local-first light peer,
- signed durable event envelopes,
- identity-control and revocation model,
- private payload envelope planning,
- bridge-assisted sync,
- future full-peer/super-peer path,
- content-addressed object refs,
- local/private user preferences,
- community-scoped governance,
- composable labelers/Tagger agents,
- future capability and credential authority.

## Phase placement

Trust and safety implementation starts after the following prerequisites are stable enough that T&S does not invent duplicate concepts:

1. schema/storage versioning policy,
2. protocol fixture discipline,
3. identity-control authority/revocation model,
4. private payload envelope model,
5. sync checkpoint correctness,
6. bridge compromise/admission planning,
7. **Phase 1.56 content-addressing and object refs**.

Recommended order:

```text
Phase 1.5 / 3.5 - Doctrine alignment and protocol hardening
Phase 1.56      - Content addressing and object reference model
Phase 1.6       - Trust & Safety doctrine and protocol safety boundaries
Phase 1.61      - Trust & Safety protocol core
Phase 1.62      - Local user controls
Phase 1.63      - Reports, appeals, and encrypted evidence refs
Phase 1.64      - Bridge/relay/super-peer admission policy
Phase 1.65      - Curation and reach controls
```

## Phase 1.6 - Doctrine and protocol safety boundaries

### Deliverables

- `docs/adr/004-trust-safety-moderation-curation-v1.md`
- `docs/protocol/trust-safety-event-policy.md`
- `docs/threat-model/trust-safety-and-abuse.md`
- `docs/implementation/trust-safety-phase-plan.md`

### Scope

This phase decides and documents:

- owner/admin/moderator/reviewer/bot/labeler/curator role model,
- role-to-capability principle,
- labeler and Tagger-agent model,
- W3C Web Annotation interoperability boundary,
- moderation vs curation distinction,
- speech/reach/transport/storage/search/ranking/UI action distinction,
- safety authority and enforcement scope model,
- report and appeal model,
- transport admission model,
- bridge/relay/super-peer self-protection model,
- local-private user controls,
- object refs for safety subjects/evidence,
- fixture and threat-model requirements.

### Exit criteria

- Product roles are documented as real UX concepts backed by scoped protocol authority.
- Tagger agents are documented as signed advisory label/annotation/report/curation publishers by default.
- W3C Web Annotation is documented as an optional projection, not the canonical enforcement model.
- Bridge-local refusal is documented as infrastructure self-protection, not global deletion.
- Curation/reach controls are documented separately from moderation enforcement.

## Phase 1.61 - Trust and safety protocol core

### Goal

Create a pure protocol package with types, validators, fixtures, and tests. Do not implement runtime enforcement yet.

### Package

```text
packages/trust-safety/
```

### Initial files

```text
packages/trust-safety/package.json
packages/trust-safety/src/index.ts
packages/trust-safety/src/authorities.ts
packages/trust-safety/src/subjects.ts
packages/trust-safety/src/annotations.ts
packages/trust-safety/src/labels.ts
packages/trust-safety/src/labelers.ts
packages/trust-safety/src/reports.ts
packages/trust-safety/src/appeals.ts
packages/trust-safety/src/policy-decisions.ts
packages/trust-safety/src/transport-admission.ts
packages/trust-safety/src/curation.ts
packages/trust-safety/src/errors.ts
packages/trust-safety/src/validation.ts
packages/trust-safety/src/index.test.ts
packages/trust-safety/fixtures/valid/
packages/trust-safety/fixtures/invalid/
```

### Package boundaries

The package must not depend on:

- PWA UI,
- bridge-service runtime,
- local-store/Dexie runtime,
- sync-client transport,
- media runtime,
- ML/classifier runtime.

It may depend on:

- `packages/content-addressing` for `ObjectRef` and `BlockRef`,
- protocol-safe validation helpers,
- identity/capability types only after those package boundaries are stable.

### Required protocol objects

- `ProductRole`
- `SafetyAuthority`
- `EnforcementScope`
- `SafetySubjectRef`
- `SafetyAnnotation`
- `SafetyLabelDefinition`
- `SafetyLabel`
- `SafetyLabelerProfile`
- `SafetyLabelerSubscription`
- `SafetyReport`
- `SafetyAppeal`
- `SafetyPolicyDecision`
- `TransportAdmissionDecision`
- `CurationRule`
- `CurationExplanation`

### Exit criteria

- Validators reject malformed authorities, scopes, labels, reports, decisions, and object refs.
- Fixtures exist for all core objects.
- Invalid fixtures test unknown major versions, missing required fields, unsupported enums, malformed object refs, and unsafe private/public routing.
- No runtime moderation behavior exists yet.

## Phase 1.62 - Local user controls

### Goal

Implement user-local safety controls before networked moderation queues or public labelers.

### Initial events

- `safety.account.blocked`
- `safety.account.muted`
- `safety.domain.blocked`
- `safety.keyword.muted`
- `safety.thread.muted`
- `safety.post.hidden`
- `safety.label.preference.set`

### Projection tables

- `blockedActors`
- `mutedActors`
- `blockedDomains`
- `mutedKeywords`
- `hiddenPosts`
- `safetyLabelPreferences`

### Privacy rules

- Local user controls are private by default.
- Mutes, hides, keyword filters, feed preferences, label preferences, and trust settings are not bridge analytics.
- Blocks may have transport consequences, but private block graphs must not be public by default.

### Exit criteria

- Local controls are applied deterministically in local views.
- Local controls survive store reopen and projection rebuild.
- Private preference state is not sent to public sync/search/curation flows.
- Tests cover malformed local safety events and private/public leakage.

## Phase 1.63 - Reports, appeals, and encrypted evidence refs

### Goal

Add report and appeal schemas and projections using private payload and content-addressing rules.

### Initial events

- `safety.report.created`
- `safety.report.acknowledged`
- `safety.report.resolved`
- `safety.appeal.created`
- `safety.appeal.resolved`

### Required dependencies

- private payload envelope rules,
- `ObjectRef` / `BlockRef` evidence refs,
- idempotency keys,
- target authority resolution,
- bridge log privacy rules.

### Privacy rules

- Report bodies are encrypted when they contain sensitive details.
- Evidence bundles are encrypted by default.
- Bridges may deliver encrypted report/evidence packages without decrypting them.
- Reports about private `dm`/`group` content do not enter public label/search/curation flows.

### Exit criteria

- Reports require subject, reason, authority, idempotency, and scope.
- Appeals target policy decisions.
- Public labels cannot expose private evidence refs.
- Tests cover duplicate reports, private evidence routing, and malformed encrypted refs.

## Phase 1.64 - Bridge, relay, and super-peer admission policy

### Goal

Give infrastructure operators explicit self-protection tools without turning them into global moderators.

### Initial objects/events

- `TransportAdmissionDecision`
- `transport.event.accepted`
- `transport.event.rejected`
- `transport.event.quarantined`
- `transport.peer.rate_limited`
- `transport.peer.quarantined`
- `transport.media.rejected`

### Admission checks

- valid signature,
- valid schema,
- supported event kind,
- bridge-safe privacy scope,
- safe byte size,
- safe decoded size where applicable,
- idempotency/replay state,
- revocation state,
- object/content ref validation,
- local policy and rate limits.

### Operator tools

- allow/deny/quarantine/rate-limit decisions,
- policy-list subscriptions,
- trusted labeler subscriptions,
- media scanner verdicts,
- peer reputation records,
- redacted audit events,
- DLQ/quarantine review surfaces.

### Exit criteria

- Bridge-local rejection is not treated as global deletion.
- Rate limits and quarantine are scoped to the infrastructure operator.
- Admission decisions can cite exact `ObjectRef` / `BlockRef` values.
- Private payloads are not logged.
- Tests cover malformed requests, replay, duplicate delivery, stale confirmations, and unsafe scope acceptance.

## Phase 1.65 - Curation and reach controls

### Goal

Add curation/ranking/search/recommendation safety controls before public feed/search/recommendation expansion.

### Initial events

- `curation.rule.created`
- `curation.rule.disabled`
- `curation.item.boosted`
- `curation.item.downranked`
- `curation.item.excluded`
- `curation.explanation.recorded`

### Required distinctions

- Downranking is not hiding.
- Search exclusion is not global deletion.
- Recommendation exclusion is not account suspension.
- Feed grouping is not moderation.
- Topic labels are not safety labels unless policy maps them that way.

### Exit criteria

- Curation actions are separate from moderation actions.
- Explanation records avoid private signal leakage.
- User-local curation preferences remain private by default.
- Public search/recommendation surfaces reject private scope objects.
- Tests cover downrank vs hide, search exclusion vs deletion, and private curation signal leakage.

## Tagger-agent model

A Tagger agent is any account, bot, service, scanner, reviewer, or hybrid human/automation actor that publishes signed labels, reports, annotations, media verdicts, or curation tags.

Tagger agents are useful for:

- spam labels,
- malware/phishing labels,
- content warnings,
- topic classification,
- sports/team/game tags,
- duplicate detection,
- media safety verdicts,
- community note/context annotations,
- feed/search curation tags.

Rules:

- Tagger output is advisory by default.
- Users/communities/bridges/indexes choose which Tagger agents to trust and for which namespaces.
- Automated high-impact enforcement requires scoped capability and audit records.
- Unknown Tagger labels should be ignored, displayed as untrusted context, or sandboxed according to local policy.

## W3C Web Annotation boundary

The protocol may provide `toWebAnnotation()` / `fromWebAnnotation()` helpers later.

Rules:

- W3C Web Annotation is an interoperability projection.
- Canonical enforcement uses signed protocol events.
- Web Annotation bodies do not prove authority.
- Imported annotations must pass local validation and trust policy before affecting UI, moderation, or curation.

## Capability and credential boundary

T&S should reserve fields for:

- capability proofs,
- credential refs,
- issuer trust policy,
- revocation checks.

But the first T&S protocol core should not block on full OCapN/VC implementation. It should define stable extension points and fail safely when proofs are required but unavailable.

## Blocked until these phases are complete

Do not begin the following production surfaces until the relevant T&S slices exist:

- production chat,
- MLS group encryption UX,
- media manifests and replication,
- public social outbox,
- public comments/replies/reposts/reactions,
- public search indexing,
- semantic/vector recommendation expansion,
- public feed generation,
- naming/discovery UX,
- production bridge deployment,
- WebSocket/Durable Streams public readers,
- persistent availability peers,
- cross-protocol public import/export.

## Overall acceptance criteria

The T&S system is ready to unblock later feature work only when:

- [ ] Phase 1.56 content-addressing package exists and is tested.
- [ ] T&S protocol core exists and is tested.
- [ ] Local user controls exist and are private by default.
- [ ] Reports/appeals can reference encrypted evidence safely.
- [ ] Bridge/relay/super-peer admission decisions are scoped and audited.
- [ ] Curation/reach controls are separate from moderation enforcement.
- [ ] Public search/recommendation cannot ingest private scopes.
- [ ] Media manifest planning consumes `BlockRef` / `ObjectRef`.
- [ ] Fixtures cover valid and invalid safety objects.
- [ ] Threat models are updated for implemented code.
