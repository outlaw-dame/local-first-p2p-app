# Phase 1.63: Local-First Trust Policy Engine Plan

This document defines the implementation plan for Phase 1.63. It is scoped strictly to the `local-first-p2p-app` repository and its local-first hybrid P2P architecture.

This plan does **not** assume Memory, ActivityPods, ActivityPub, ATProto, Mastodon, Solid Pods, RDF, or Fediverse federation. Those systems may remain research references, but they are not protocol authority for this repository.

## Status

- Phase label: **Phase 1.63 - Local-First Trust Policy Engine Core**
- Current status: planning / not implemented
- Depends on:
  - ADR-001 identity control log v1
  - ADR-002 private payload encryption envelope v1
  - ADR-004 trust, safety, moderation, and curation v1
  - ADR-005 content addressing and object references v1
  - ADR-006 local-first trust policy engine v1
  - Phase 1.56 content addressing package
  - Phase 1.61 trust-safety protocol core
  - Phase 1.62 local user controls
- Should precede:
  - production private chat
  - MLS group integration
  - media manifests
  - production bridge deployment
  - relay/super-peer runtime expansion
  - public social surfaces
  - public indexing/search/recommendation expansion

## Purpose

The trust policy engine turns verified evidence into scoped decisions.

It answers questions such as:

- should this device represent this identity?
- should this capability authorize this action on this resource?
- should this Verifiable Credential issuer be trusted for this claim type and scope?
- should this signed object be accepted, displayed, synced, quarantined, or denied?
- should this bridge, relay, or super-peer be used for this transport/storage role?
- should this ML-generated risk signal cause a warning, confirmation prompt, throttle, or quarantine?

The engine must be deterministic, replayable, privacy-preserving, and local-first.

## Non-goals

Phase 1.63 must not implement:

- full ML classifiers,
- blockchain smart contracts,
- public reputation scores,
- global trust scores,
- public trust graph publication,
- public labeler hosting,
- production moderation automation,
- MLS group encryption,
- production chat UX,
- media manifests,
- full Pear/Hypercore runtime integration,
- public transparency logs.

These can be future layers. They should not be hidden inside the first trust-policy engine.

## Core doctrine

### 1. Trust is contextual

The engine must not answer:

```text
Is Alice trustworthy?
```

It must answer scoped questions:

```text
Can this device send this event for this identity?
Can this user invite someone into this group?
Can this relay store encrypted bundles for this room?
Can this labeler issue labels that affect my local UI?
Can this VC issuer be relied on for device-attestation claims?
Can this bridge reject this object for its own infrastructure protection?
```

### 2. Verified facts are not policy decisions

Cryptography proves facts:

- object signature valid,
- digest matches bytes,
- content link parses,
- capability signature valid,
- VC proof valid,
- device key authorized,
- device revoked,
- credential expired,
- policy bundle signed.

Policy decides reliance:

- allow,
- warn,
- require confirmation,
- quarantine,
- deny.

### 3. VCs prove claims, not global trust

A Verifiable Credential may state:

- this device belongs to this controller,
- this person is a member of this group,
- this peer is a relay operator,
- this service is a scanner or labeler,
- this organization issued a role claim,
- this user completed a trusted-introduction flow.

The local policy engine decides whether the issuer is trusted for that claim type, scope, resource, and policy version.

### 4. Object capabilities prove authority

Capabilities answer:

```text
Who can do what, to which resource, under which constraints?
```

Capabilities should cover actions such as:

- `identity/device.authorize`,
- `identity/device.revoke`,
- `room/create`,
- `room/invite`,
- `room/write`,
- `room/moderate`,
- `label/issue`,
- `report/review`,
- `bridge/store`,
- `bridge/forward`,
- `relay/replicate`,
- `super-peer/cache`,
- `bundle/publish`,
- `policy/issue`.

### 5. Content addressing identifies objects, not authority

The protocol object model should use IPLD-style content addressing for object graphs.

Content refs identify exact bytes or structured objects:

- `DigestRef`,
- `ContentLink`,
- `BlockRef`,
- `ObjectRef`,
- `BundleRef`,
- `StorageLocationHint`.

Content addressing does not answer:

- who owns the object,
- who may read it,
- who may replicate it,
- whether it is safe,
- whether it is legal,
- whether it is globally deleted,
- where the authoritative copy lives.

Those remain identity, capability, privacy, safety, and storage-policy questions.

### 6. Hypercore/Pear support is adapter support, not protocol capture

The repository should support future Pear/Hypercore runtimes.

However, Hypercore feed keys, Pear peer keys, Hyperdrive identities, or other storage/runtime keys must not become the universal protocol identity model.

Correct model:

```text
Controller identity
  -> authorizes devices
  -> devices may authorize or use replication keys
  -> replication keys may identify Hypercore/Pear feeds or peer runtime identities
  -> content refs identify objects inside or outside those feeds
```

A Hypercore key may be evidence for a replication source or peer runtime identity. It is not automatically the account identity, group identity, content identity, or trust authority.

### 7. ML is advisory

ML may provide risk signals, labels, or anomaly scores.

ML must not directly grant:

- decryption authority,
- identity authority,
- device authority,
- group membership,
- object mutation rights,
- moderation authority,
- bridge/relay/super-peer operator authority.

ML signals may influence warnings, review prompts, quarantine, throttling, or local curation when deterministic policy allows that signal type.

### 8. Smart-contract-like behavior means deterministic policy execution

Phase 1.63 should use typed TypeScript policy evaluation first.

Future versions may evaluate signed policy bundles using CEL-like, Cedar-like, Rego-like, or WASM-based deterministic runtimes. Public blockchains are not required for the first engine and should not become mandatory infrastructure for private local-first trust decisions.

## Proposed package

Create:

```text
packages/trust-policy
```

Initial package role:

- pure TypeScript types,
- deterministic evaluator,
- no network access,
- no storage access,
- no ML runtime,
- no arbitrary code execution,
- no browser-only APIs,
- fixture-driven tests.

### Proposed package layout

```text
packages/trust-policy/
  package.json
  tsconfig.json
  src/
    index.ts
    types.ts
    decisions.ts
    evidence.ts
    policy.ts
    evaluator.ts
    reason-codes.ts
    issuer-policy.ts
    capability-policy.ts
    device-policy.ts
    relay-policy.ts
    ml-risk-policy.ts
    versioning.ts
  fixtures/
    valid/
    invalid/
  tests/
    evaluator.test.ts
    device-policy.test.ts
    capability-policy.test.ts
    issuer-policy.test.ts
    ml-risk-policy.test.ts
    replay-determinism.test.ts
```

## Initial public API sketch

```ts
export type TrustDecisionStatus =
  | 'allow'
  | 'warn'
  | 'require-confirmation'
  | 'quarantine'
  | 'deny';

export type TrustDecision = Readonly<{
  version: 'lfp2p.trust-decision.v1';
  decisionId: string;
  policyRef: string;
  subjectRef: string;
  actorRef?: string;
  deviceRef?: string;
  resourceRef?: string;
  action: string;
  scope: string;
  status: TrustDecisionStatus;
  reasonCodes: readonly string[];
  evidenceRefs: readonly string[];
  createdAt: string;
  expiresAt?: string;
  privacy: 'device-local' | 'self' | 'dm' | 'group' | 'public';
}>;

export type TrustEvaluationInput = Readonly<{
  version: 'lfp2p.trust-evaluation-input.v1';
  action: string;
  scope: string;
  subjectRef: string;
  actorRef?: string;
  deviceRef?: string;
  resourceRef?: string;
  policy: TrustPolicy;
  evidence: readonly TrustEvidence[];
  now: string;
}>;

export function evaluateTrustDecision(input: TrustEvaluationInput): TrustDecision;
```

## Evidence model

The first implementation should normalize evidence into typed records.

Initial evidence categories:

```ts
export type TrustEvidence =
  | ObjectIntegrityEvidence
  | IdentityDeviceEvidence
  | CapabilityEvidence
  | VerifiableCredentialEvidence
  | IssuerTrustEvidence
  | LocalUserOverrideEvidence
  | BridgeRelayBehaviorEvidence
  | MlRiskSignalEvidence;
```

### Object integrity evidence

Purpose:

- prove a signed object or content-addressed object passed/fails validation.

Examples:

- signature valid,
- signature invalid,
- digest matched,
- digest mismatch,
- unsupported codec,
- oversized block,
- malformed content link,
- private/public dedupe violation.

### Identity device evidence

Purpose:

- represent identity-control projection facts.

Examples:

- device active,
- device unknown,
- device revoked,
- controller mismatch,
- epoch stale,
- replay detected.

### Capability evidence

Purpose:

- represent scoped authority facts.

Examples:

- capability granted,
- capability expired,
- capability revoked,
- capability wrong action,
- capability wrong resource,
- capability issuer not authorized,
- capability chain invalid.

### Verifiable Credential evidence

Purpose:

- represent claims and proof-validation results.

Examples:

- VC proof valid,
- VC proof invalid,
- issuer trusted for device attestation,
- issuer not trusted for moderation role,
- credential expired,
- credential revoked,
- unsupported credential type,
- subject mismatch.

### Issuer trust evidence

Purpose:

- represent local policy about which issuers are trusted for which claims.

Examples:

- issuer trusted for `device-attestation`,
- issuer trusted for `relay-operator`,
- issuer trusted for `group-membership`,
- issuer blocked,
- issuer trust expired,
- issuer trust local-only.

### Local user override evidence

Purpose:

- represent private local choices.

Examples:

- user manually verified fingerprint,
- user marked contact trusted,
- user blocked identity,
- user muted peer,
- user distrusts issuer,
- user allows a relay for encrypted storage only.

Default privacy should be `device-local` or `self`.

### Bridge/relay/super-peer behavior evidence

Purpose:

- represent infrastructure trust behavior.

Examples:

- bridge accepted valid object,
- bridge rejected malformed object,
- relay dropped messages repeatedly,
- super-peer served invalid block,
- peer replayed stale sequence,
- bridge quarantined object locally.

### ML risk-signal evidence

Purpose:

- represent advisory classifier/anomaly output.

Examples:

- spam risk high,
- impersonation risk medium,
- attachment malware risk high,
- invite-abuse risk high,
- relay anomaly risk high.

ML risk evidence must include:

- model or rule identifier,
- model version,
- input class, not raw private input,
- risk label,
- confidence bucket,
- createdAt,
- privacy scope,
- reason codes safe for display.

It must not embed decrypted private content.

## Policy model

The first policy model should be explicit, small, and deterministic.

```ts
export type TrustPolicy = Readonly<{
  version: 'lfp2p.trust-policy.v1';
  policyId: string;
  issuerRules: readonly IssuerTrustRule[];
  actionRules: readonly ActionTrustRule[];
  mlRiskRules: readonly MlRiskRule[];
  defaultDecision: TrustDecisionStatus;
}>;
```

### Initial policy defaults

Recommended defaults:

- invalid object integrity -> `deny`,
- revoked device -> `deny`,
- controller mismatch -> `deny`,
- expired/revoked capability -> `deny`,
- missing capability for authority-changing action -> `deny`,
- valid VC from unknown issuer -> no authority elevation,
- trusted issuer claim with matching scope -> may satisfy configured claim requirement,
- high ML risk on low-risk display -> `warn` or `require-confirmation`,
- high ML risk on bridge admission -> `quarantine`,
- bridge-local quarantine -> scoped to bridge, never global deletion.

## Decision scopes

Initial action/scope categories:

### Identity/device

- `identity/device.use`
- `identity/device.authorize`
- `identity/device.revoke`
- `identity/capability.grant`
- `identity/capability.revoke`

### Object/sync

- `object/accept`
- `object/display`
- `object/store-local`
- `object/sync-outbound`
- `object/sync-inbound`

### Room/group

- `room/create`
- `room/invite`
- `room/join`
- `room/write`
- `room/admin`
- `room/moderate`

### Trust and safety

- `label/issue`
- `label/apply-local`
- `report/create`
- `report/review`
- `appeal/create`
- `policy/decision.issue`

### Transport/infrastructure

- `bridge/store`
- `bridge/forward`
- `bridge/quarantine`
- `relay/replicate`
- `super-peer/cache`
- `hypercore/feed.replicate`
- `pear/peer.sync`

## Storage plan

Phase 1.63 should eventually add local-store tables, but the first code slice should keep the package pure.

Later local-store tables:

```text
trustEvidence
trustDecisions
trustIssuerPolicies
trustPolicyBundles
trustProjectionCheckpoints
```

Design rules:

- evidence records are append-only,
- decisions are derived projections,
- user overrides are private by default,
- old evidence remains available for policy replay,
- private content is never embedded in public decision records,
- bridge/relay/super-peer decisions are scoped to their infrastructure surface.

## Versioning plan

Every durable trust object must include explicit versioning.

Initial versions:

- `lfp2p.trust-policy.v1`
- `lfp2p.trust-evidence.v1`
- `lfp2p.trust-decision.v1`
- `lfp2p.issuer-policy.v1`
- `lfp2p.ml-risk-signal.v1`

Unknown major versions must fail closed for authority-changing actions.

Unknown minor-compatible fields may be ignored only when explicitly allowed by the schema/versioning policy.

## IPLD/content-addressing integration

Phase 1.63 should reference content objects through the Phase 1.56 model.

Trust evidence should use:

- `ObjectRef` for protocol objects,
- `BlockRef` for exact bytes/media/blob references,
- `BundleRef` for evidence bundles,
- `ContentLink` for IPLD-style links,
- `StorageLocationHint` only as non-authoritative retrieval metadata.

Do not create duplicate hash/CID concepts inside `packages/trust-policy`.

## Hypercore/Pear integration boundary

The trust policy package may define action strings and evidence shapes for future Hypercore/Pear support, but it must not depend on Hypercore/Pear packages.

Future adapter evidence may include:

- feed key authorized by controller/device,
- feed key revoked,
- feed sequence accepted,
- feed fork detected,
- feed served invalid block,
- Pear peer identity bound to local controller/device,
- replication key authorized for room/bundle scope.

The canonical identity model remains controller/device/capability-based. Hypercore/Pear keys are adapter/runtime identities that can be authorized, revoked, and policy-evaluated.

## ML integration boundary

The trust policy engine can consume ML risk signals but must not run models in Phase 1.63.

ML risk signals should be shaped as evidence:

```ts
export type MlRiskSignalEvidence = Readonly<{
  version: 'lfp2p.ml-risk-signal.v1';
  evidenceId: string;
  subjectRef: string;
  modelRef: string;
  modelVersion: string;
  riskType: 'spam' | 'impersonation' | 'malware' | 'abuse' | 'relay-anomaly' | 'invite-abuse';
  confidence: 'low' | 'medium' | 'high';
  recommendation: 'none' | 'warn' | 'review' | 'quarantine';
  createdAt: string;
  privacy: 'device-local' | 'self' | 'dm' | 'group' | 'public';
}>;
```

The deterministic policy decides what to do with the signal.

## Test requirements

Required tests for the first implementation:

1. valid object integrity evidence can support `allow`,
2. invalid object integrity evidence forces `deny`,
3. revoked device evidence forces `deny`,
4. missing capability denies authority-changing action,
5. expired capability denies authority-changing action,
6. valid capability allows matching action/resource/scope,
7. valid VC from unknown issuer does not elevate authority,
8. valid VC from trusted issuer can satisfy configured claim requirement,
9. ML high-risk signal cannot grant authority,
10. ML high-risk signal can trigger warning/quarantine when policy allows,
11. local user block overrides otherwise positive evidence,
12. bridge-local quarantine does not become global deletion,
13. same evidence + same policy + same time produces deterministic same decision,
14. unsupported major versions fail closed for authority-changing actions,
15. private evidence bodies are not copied into public decision objects.

## Implementation slices

### Slice A - Pure types and reason codes

Deliverables:

- `packages/trust-policy` package,
- trust decision status type,
- trust evidence union,
- reason-code constants,
- version constants,
- no evaluator yet.

Exit criteria:

- package builds,
- types exported,
- no storage/network dependencies.

### Slice B - Deterministic evaluator MVP

Deliverables:

- `evaluateTrustDecision`,
- basic action rules,
- default deny/warn/allow behavior,
- deterministic decision IDs or deterministic test mode.

Exit criteria:

- malicious/invalid evidence fails closed,
- same input produces same output.

### Slice C - Capability policy

Deliverables:

- capability evidence interpretation,
- action/resource/scope checks,
- expiry/revocation behavior.

Exit criteria:

- no authority-changing action is allowed without matching active capability unless a specific bootstrap policy permits it.

### Slice D - VC issuer policy

Deliverables:

- issuer trust rules,
- credential claim reliance rules,
- unknown issuer behavior,
- revoked/expired credential behavior.

Exit criteria:

- valid proof alone is insufficient for authority elevation.

### Slice E - Local override and bridge/relay policy

Deliverables:

- local block/mute/trust override evidence,
- bridge/relay/super-peer behavior evidence,
- scoped infrastructure decisions.

Exit criteria:

- bridge-local decisions cannot masquerade as global deletion.

### Slice F - ML advisory signal support

Deliverables:

- ML risk evidence shape,
- policy handling for warn/review/quarantine,
- tests proving ML cannot grant authority.

Exit criteria:

- ML is advisory-only.

### Slice G - Local-store integration plan

Deliverables:

- storage migration design,
- evidence/projection table proposal,
- privacy rules for local-only trust state.

Exit criteria:

- no storage migration is merged without schema version and replay plan.

## Exit criteria for Phase 1.63

Phase 1.63 is complete when:

- [ ] `packages/trust-policy` exists as a pure TypeScript package.
- [ ] Typed trust evidence and decision models exist.
- [ ] Deterministic evaluator exists.
- [ ] Device/capability/issuer/VC/local-override/bridge/ML advisory evidence are represented.
- [ ] Valid and invalid fixtures exist.
- [ ] Tests prove fail-closed authority behavior.
- [ ] Tests prove replay determinism.
- [ ] Tests prove valid VCs do not imply global trust.
- [ ] Tests prove object/content refs are referenced through Phase 1.56 types rather than duplicate hash fields.
- [ ] Tests prove Hypercore/Pear identities are adapter/runtime identities, not account identity replacements.
- [ ] Docs clearly distinguish trust decisions, object integrity, capabilities, VCs, content addressing, and storage/replication adapters.
