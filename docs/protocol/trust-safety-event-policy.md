# Trust and Safety Event Policy

- Status: Draft
- Date: 2026-05-27
- Related ADRs:
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
  - `docs/adr/001-identity-control-log-v1.md`
  - `docs/adr/002-private-payload-encryption-envelope-v1.md`
  - `docs/adr/005-content-addressing-and-object-references-v1.md`
- Related threat models:
  - `docs/threat-model/trust-safety-and-abuse.md`
  - `docs/threat-model/bridge-compromise.md`
  - `docs/threat-model/content-addressing-abuse.md`

## Purpose

This document defines the trust and safety event policy for the local-first P2P/hybrid architecture.

The policy exists to prevent moderation, curation, bridge self-protection, media safety, and user-local controls from becoming duplicate or contradictory concepts. Every trust and safety object must make its authority, scope, subject, action, reason, policy version, privacy behavior, and appealability explicit.

This document is intentionally protocol-focused. Product UI may expose familiar concepts such as owner, admin, moderator, reviewer, bot, labeler, curator, bridge operator, relay operator, and super-peer operator. The protocol must represent those roles through scoped authority, capability proofs, policy decisions, and audit records.

## Non-negotiable rules

1. **Labels do not enforce themselves.**
   - A label is an advisory statement about a subject.
   - Enforcement requires local policy, trusted authority, scope, and action mapping.

2. **Reports do not enforce themselves.**
   - A report asks an authority to review a subject.
   - Reports can inform queues, labels, or policy decisions.
   - Unknown or untrusted reports must not automatically create high-impact enforcement.

3. **Policy decisions are scoped.**
   - `bridge-local` rejection is not global deletion.
   - `community-local` removal is not account deletion.
   - `device-local` hiding is private UI state.
   - `index-local` exclusion is search/index behavior, not speech removal.

4. **Moderation and curation are separate.**
   - Moderation controls warn, blur, hide, quarantine, reject, remove-local, escalate, and appeal.
   - Curation controls rank, downrank, group, recommend, exclude-from-feed, exclude-from-search, and explain.

5. **Local user controls are private by default.**
   - Mutes, hides, keyword filters, feed preferences, label preferences, and trust preferences are `device-local` or `self` unless explicitly exported.
   - Blocks may affect transport or visibility, but private block graphs must not leak by default.

6. **Bridge/relay/super-peer protection is valid but local.**
   - Infrastructure operators may protect themselves from spam, malware, replay, illegal material risk, resource exhaustion, and policy violations.
   - These decisions are scoped to that infrastructure unless deliberately emitted as advisory labels.

7. **All durable safety objects are versioned.**
   - Unknown major versions fail closed.
   - Unknown optional minor fields may be ignored only if the object explicitly allows extension.
   - Validators must not silently coerce security-sensitive values.

8. **Private report/evidence material must not enter public flows.**
   - Reports and appeals may contain sensitive material.
   - Evidence bundles must use private payload and content-addressing rules before bridge transport.

9. **Tagger agents are advisory unless explicitly authorized.**
   - A Tagger agent may publish labels, reports, annotations, media scan verdicts, or curation tags.
   - High-impact enforcement by automated agents requires explicit scoped authority, audit events, and safe defaults.

10. **W3C Web Annotation is optional interoperability.**
    - Canonical protocol events remain signed local-first events.
    - Web Annotation projection may be used for export/import/tooling but does not prove authority.

## Core object families

### ProductRole

`ProductRole` is a UI/product concept. It is not sufficient authority by itself.

Initial roles:

```ts
type ProductRole =
  | 'owner'
  | 'admin'
  | 'moderator'
  | 'reviewer'
  | 'bot'
  | 'labeler'
  | 'curator'
  | 'bridge-operator'
  | 'relay-operator'
  | 'super-peer-operator';
```

Role behavior:

- `owner` / `founder`: root or high-level community/space authority.
- `admin`: broad but still scoped authority delegated by owner/root policy.
- `moderator`: scoped enforcement authority.
- `reviewer`: triage or review authority, usually without final enforcement.
- `bot`: automation authority, usually advisory or limited.
- `labeler`: advisory label/annotation publisher unless policy elevates output.
- `curator`: curation/ranking/search/feed authority, not enforcement authority by default.
- infrastructure operators: admission/quarantine/replication policy authorities for their surfaces.

### SafetyAuthority

`SafetyAuthority` identifies who made or is allowed to make a safety decision.

```ts
type SafetyAuthority = {
  version: 'lfp2p.safety-authority.v1';
  authorityId: string;
  actorId: string;
  role?: ProductRole;
  scope:
    | 'device-local'
    | 'account-local'
    | 'community-local'
    | 'bridge-local'
    | 'relay-local'
    | 'super-peer-local'
    | 'index-local'
    | 'network-advisory';
  resourceRef?: ObjectRef;
  capabilityProofs?: readonly CapabilityProofRef[];
  credentialRefs?: readonly CredentialRef[];
  createdAt: string;
  expiresAt?: string;
};
```

Policy:

- `authorityId`, `actorId`, `scope`, and `createdAt` are required.
- Capability proofs are required for delegated community, bridge, relay, super-peer, and index authority once capability primitives exist.
- Credential references are advisory unless local trust policy accepts the issuer for the claim type.
- Authorities must be revocation-aware once identity-control implementation supports revocation.

### EnforcementScope

```ts
type EnforcementScope =
  | 'device-local'
  | 'account-local'
  | 'community-local'
  | 'bridge-local'
  | 'relay-local'
  | 'super-peer-local'
  | 'index-local'
  | 'app-surface-local'
  | 'network-advisory';
```

Scope rules:

- `device-local`: affects one local device only.
- `account-local`: affects the user's account state across devices, subject to private sync policy.
- `community-local`: affects a community/space; not global.
- `bridge-local`: affects one bridge's admission, queueing, or storage behavior.
- `relay-local`: affects one relay's forwarding/storage behavior.
- `super-peer-local`: affects one super-peer's replication/storage behavior.
- `index-local`: affects one index/search provider's inclusion/ranking behavior.
- `app-surface-local`: affects one app's presentation/ranking layer.
- `network-advisory`: advisory signal; no mandatory enforcement.

### SafetySubjectRef

Safety decisions need broad targets, not just posts.

```ts
type SafetySubjectRef =
  | { type: 'event'; eventId: string; objectRef?: ObjectRef }
  | { type: 'actor'; actorId: string }
  | { type: 'device'; deviceId: string; actorId?: string }
  | { type: 'community'; communityId: string }
  | { type: 'thread'; threadId: string; rootEventId?: string }
  | { type: 'media'; mediaId: string; objectRef: ObjectRef }
  | { type: 'blob'; blockRef: BlockRef }
  | { type: 'url'; normalizedUrl: string; digest?: DigestRef }
  | { type: 'domain'; domain: string }
  | { type: 'topic'; value: string }
  | { type: 'bridge'; bridgeId: string }
  | { type: 'relay'; relayId: string }
  | { type: 'super-peer'; superPeerId: string }
  | { type: 'policy-list'; policyListId: string };
```

Rules:

- Media/blob safety should target `ObjectRef` / `BlockRef` from the content-addressing model when available.
- URL/domain decisions must use normalized forms.
- Actor/device decisions must remain identity-control aware.
- Unknown subject types fail closed until explicitly supported.

## Labeling and annotation

### SafetyAnnotation

A `SafetyAnnotation` is a signed statement from an issuer about a target. It may be projected to W3C Web Annotation but the canonical object is this signed protocol event.

```ts
type SafetyAnnotation = {
  version: 'lfp2p.safety-annotation.v1';
  annotationId: string;
  issuer: SafetyAuthority;
  subject: SafetySubjectRef;
  motivation: 'classifying' | 'assessing' | 'commenting' | 'describing' | 'tagging';
  body: SafetyAnnotationBody;
  scope: EnforcementScope;
  policyRef?: string;
  capabilityProofs?: readonly CapabilityProofRef[];
  credentialRefs?: readonly CredentialRef[];
  createdAt: string;
  expiresAt?: string;
};
```

### SafetyLabelDefinition

Defines what a label means and how it may be interpreted.

```ts
type SafetyLabelDefinition = {
  version: 'lfp2p.safety-label-definition.v1';
  labelKey: string;
  namespace: string;
  displayName: string;
  description: string;
  category:
    | 'abuse'
    | 'security'
    | 'media-safety'
    | 'legal-risk'
    | 'age-sensitivity'
    | 'quality'
    | 'topic'
    | 'curation'
    | 'context'
    | 'system';
  defaultSeverity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  defaultAction: SafetyAction;
  userConfigurable: boolean;
  hardSafety?: boolean;
  adultOnly?: boolean;
  createdBy: SafetyAuthority;
  createdAt: string;
};
```

### SafetyLabel

```ts
type SafetyLabel = {
  version: 'lfp2p.safety-label.v1';
  labelId: string;
  issuer: SafetyAuthority;
  subject: SafetySubjectRef;
  labelKey: string;
  namespace: string;
  severity?: 'info' | 'low' | 'medium' | 'high' | 'critical';
  confidence?: number;
  evidenceRefs?: readonly ObjectRef[];
  negatesLabelId?: string;
  scope: EnforcementScope;
  createdAt: string;
  expiresAt?: string;
};
```

Label rules:

- `confidence` must be a finite number in `[0, 1]` when present.
- `negatesLabelId` revokes/negates only the issuer's own label unless policy permits cross-issuer negation.
- Hard-safety labels cannot be silently downgraded by unsafe defaults.
- A label must not include private evidence directly.
- Evidence refs must obey private payload and content-addressing rules.

### SafetyLabelerProfile

```ts
type SafetyLabelerProfile = {
  version: 'lfp2p.safety-labeler-profile.v1';
  labelerId: string;
  actorId: string;
  displayName: string;
  description?: string;
  supportedNamespaces: readonly string[];
  supportedLabels: readonly string[];
  serviceEndpoint?: string;
  policyRef?: string;
  credentialRefs?: readonly CredentialRef[];
  createdAt: string;
  updatedAt: string;
};
```

### SafetyLabelerSubscription

```ts
type SafetyLabelerSubscription = {
  version: 'lfp2p.safety-labeler-subscription.v1';
  subscriptionId: string;
  subscriberActorId: string;
  labelerId: string;
  trustedNamespaces: readonly string[];
  trustedLabels?: readonly string[];
  scope:
    | 'device-local'
    | 'account-local'
    | 'community-local'
    | 'bridge-local'
    | 'relay-local'
    | 'super-peer-local'
    | 'index-local';
  actionOverrides?: readonly SafetyLabelActionOverride[];
  createdAt: string;
  disabledAt?: string;
};
```

Subscription rules:

- User subscriptions default to private local/account state.
- Bridge/relay/super-peer subscriptions are infrastructure-local policy.
- A subscription to a labeler is not consent to leak private events to that labeler.

## Reports and appeals

### SafetyReport

```ts
type SafetyReport = {
  version: 'lfp2p.safety-report.v1';
  reportId: string;
  reporter: ReporterRef;
  subject: SafetySubjectRef;
  targetAuthority: SafetyAuthority;
  reasonCode: SafetyReasonCode;
  scope: EnforcementScope;
  idempotencyKey: string;
  createdAt: string;
  encryptedBodyRef?: ObjectRef;
  evidenceRefs?: readonly ObjectRef[];
  reporterPrivacy:
    | 'identified-to-authority'
    | 'pseudonymous-to-authority'
    | 'anonymous-to-authority-if-supported';
};
```

Rules:

- Reports require `reportId`, `reporter`, `subject`, `targetAuthority`, `reasonCode`, `scope`, `idempotencyKey`, and `createdAt`.
- Reports do not enforce directly.
- Reports that include sensitive details must use `encryptedBodyRef` or encrypted evidence bundles.
- Bridges must not inspect encrypted report body or evidence unless explicitly authorized.
- Reports about private `dm` or `group` content must not be routed into public label/search/curation flows.

### SafetyAppeal

```ts
type SafetyAppeal = {
  version: 'lfp2p.safety-appeal.v1';
  appealId: string;
  appellant: ActorRef;
  decisionId: string;
  targetAuthority: SafetyAuthority;
  reasonCode: string;
  idempotencyKey: string;
  createdAt: string;
  encryptedBodyRef?: ObjectRef;
  evidenceRefs?: readonly ObjectRef[];
};
```

Rules:

- Appeals target policy decisions, not labels alone.
- Appeal visibility must match or be narrower than the original decision's scope unless the appellant explicitly exports it.
- Appeal resolution must create a new policy decision or appeal resolution object.

## Policy decisions

### SafetyAction

```ts
type SafetyAction =
  | 'allow'
  | 'warn'
  | 'blur-media'
  | 'collapse'
  | 'hide'
  | 'quarantine'
  | 'remove-local'
  | 'reject-transport'
  | 'rate-limit'
  | 'escalate-review'
  | 'downrank'
  | 'exclude-from-feed'
  | 'exclude-from-search'
  | 'exclude-from-recommendations';
```

### SafetyPolicyDecision

```ts
type SafetyPolicyDecision = {
  version: 'lfp2p.safety-policy-decision.v1';
  decisionId: string;
  authority: SafetyAuthority;
  subject: SafetySubjectRef;
  action: SafetyAction;
  scope: EnforcementScope;
  policyVersion: string;
  reasonCode: SafetyReasonCode;
  sourceLabels?: readonly string[];
  sourceReports?: readonly string[];
  capabilityProofs?: readonly CapabilityProofRef[];
  evidenceRefs?: readonly ObjectRef[];
  createdAt: string;
  expiresAt?: string;
  appealable: boolean;
  supersedesDecisionId?: string;
};
```

Decision rules:

- Requires authority, subject, action, scope, policy version, reason code, timestamp, and appealability.
- `reject-transport` is valid only for bridge/relay/super-peer/app-surface admission scopes.
- `downrank`, `exclude-from-feed`, `exclude-from-search`, and `exclude-from-recommendations` are curation/reach actions and must not be rendered as deletion.
- `remove-local` must specify the local/community/index/bridge scope.
- Decisions based on private reports must not expose private report contents in public fields.

## Transport admission

### TransportAdmissionDecision

```ts
type TransportAdmissionDecision = {
  version: 'lfp2p.transport-admission-decision.v1';
  decisionId: string;
  operatorAuthority: SafetyAuthority;
  subject: SafetySubjectRef;
  surface: 'bridge' | 'relay' | 'super-peer' | 'public-index' | 'media-store';
  action: 'accept' | 'accept-limited' | 'quarantine' | 'reject' | 'rate-limit' | 'drop-duplicate';
  reasonCode: SafetyReasonCode;
  policyVersion: string;
  idempotencyKey?: string;
  evidenceRefs?: readonly ObjectRef[];
  createdAt: string;
  expiresAt?: string;
};
```

Admission rules:

- Admission decisions are local to the infrastructure surface.
- They must not be interpreted as global deletion.
- Reasons should be redacted and structured.
- Private payloads must not be logged or exposed.
- Replay, invalid signatures, malformed schemas, impossible timestamps, oversized payloads, unsupported event kinds, and disallowed privacy scopes should fail closed.

## Curation and reach

### CurationRule

```ts
type CurationRule = {
  version: 'lfp2p.curation-rule.v1';
  ruleId: string;
  owner: SafetyAuthority;
  surface:
    | 'local-feed'
    | 'community-feed'
    | 'public-feed'
    | 'search'
    | 'recommendation'
    | 'notification';
  subjectMatcher: CurationSubjectMatcher;
  action: 'boost' | 'downrank' | 'exclude' | 'group' | 'annotate' | 'require-warning';
  reasonCode: string;
  createdAt: string;
  disabledAt?: string;
};
```

### CurationExplanation

```ts
type CurationExplanation = {
  version: 'lfp2p.curation-explanation.v1';
  explanationId: string;
  surface: string;
  subject: SafetySubjectRef;
  action: 'boost' | 'downrank' | 'exclude' | 'group' | 'annotate' | 'require-warning';
  reasonCodes: readonly string[];
  policyVersion: string;
  createdAt: string;
};
```

Curation rules:

- Curation is not moderation.
- Explanation records must avoid leaking private signals.
- User-local curation preferences are private by default.
- Public feed/search/recommendation curation must respect hard safety constraints and user blocks/mutes where applicable.

## Event family reservations

The following event families are reserved for future implementation. They should not all be implemented in one PR.

### User-local controls

- `safety.account.blocked`
- `safety.account.muted`
- `safety.domain.blocked`
- `safety.keyword.muted`
- `safety.thread.muted`
- `safety.post.hidden`
- `safety.label.preference.set`

### Labeling / Tagger agents

- `safety.annotation.created`
- `safety.label.applied`
- `safety.label.revoked`
- `safety.labeler.profile.published`
- `safety.labeler.subscribed`
- `safety.labeler.unsubscribed`

### Reports and appeals

- `safety.report.created`
- `safety.report.acknowledged`
- `safety.report.resolved`
- `safety.appeal.created`
- `safety.appeal.resolved`

### Policy and moderation decisions

- `safety.policy.created`
- `safety.policy.updated`
- `safety.policy.deprecated`
- `safety.policy.decision.recorded`
- `moderation.queue.item.created`
- `moderation.queue.item.assigned`
- `moderation.queue.item.resolved`

### Bridge / relay / super-peer self-protection

- `transport.event.accepted`
- `transport.event.rejected`
- `transport.event.quarantined`
- `transport.peer.rate_limited`
- `transport.peer.quarantined`
- `transport.media.rejected`

### Curation

- `curation.rule.created`
- `curation.rule.disabled`
- `curation.item.boosted`
- `curation.item.downranked`
- `curation.item.excluded`
- `curation.explanation.recorded`

## Local-store projection plan

Initial projection tables should be planned before code:

- `safetyLabels`
- `safetyLabelDefinitions`
- `safetyLabelerProfiles`
- `safetyLabelerSubscriptions`
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

Projection rules:

- Projections are rebuildable from signed events where possible.
- Private user controls must remain in private scopes.
- Bridge/relay/super-peer admission decisions are local to their infrastructure scope.
- Public index/search projections must not ingest private `dm` or `group` payloads.

## Required fixture coverage

Before implementation is considered complete for the protocol core:

- valid/invalid `SafetyAuthority`,
- valid/invalid `SafetySubjectRef`,
- valid/invalid `SafetyAnnotation`,
- valid/invalid `SafetyLabelDefinition`,
- valid/invalid `SafetyLabel`,
- valid/invalid `SafetyReport`,
- valid/invalid `SafetyAppeal`,
- valid/invalid `SafetyPolicyDecision`,
- valid/invalid `TransportAdmissionDecision`,
- valid/invalid `CurationRule`,
- malformed version rejection,
- unsupported enum rejection,
- private evidence in public flow rejection,
- bridge-local rejection not treated as global deletion,
- curation downrank not treated as moderation hide,
- report/replay/idempotency behavior,
- revoked/unauthorized authority behavior once identity-control support exists.

## Implementation order

1. Add docs and ADRs.
2. Add pure `packages/trust-safety` protocol types and validators.
3. Add fixtures and tests.
4. Add local user-control events and projections.
5. Add report/appeal schemas with encrypted evidence support.
6. Add bridge/relay/super-peer admission decisions.
7. Add curation/reach controls and explanations.
8. Only then proceed to chat, media, public social outbox, public search, semantic recommendation, and production bridge/public beta.
