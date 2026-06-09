# ADR-007: Capability Authority Model v1

- Status: Proposed
- Date: 2026-06-08
- Deciders: Damon / project maintainers
- Related docs:
  - `docs/adr/001-identity-control-log-v1.md`
  - `docs/adr/006-local-first-trust-policy-engine-v1.md`
  - `docs/protocol/identity-control-log.md`
  - `docs/threat-model/trust-safety-and-abuse.md`
  - `docs/implementation/repository-architecture-summary.md`
- External reference anchors:
  - UCAN specification: https://github.com/ucan-wg/spec
  - Spritely OCapN introduction: https://spritely.institute/news/introducing-ocapn-interoperable-capabilities-over-the-network.html
  - Spritely CapTP overview: https://spritelyproject.org/news/what-is-captp.html
  - W3C Verifiable Credentials Data Model v2.0: https://www.w3.org/TR/vc-data-model-2.0/
  - Authorization Capabilities for Linked Data: https://w3c-ccg.github.io/zcap-spec/

## Context

This repository is a local-first hybrid P2P object network. The current architecture already treats capabilities as the primary authority primitive, while Verifiable Credentials are evidence-bearing claims and the trust-policy engine decides reliance. The identity-control log currently supports direct controller-signed capability grant and revoke events, but the full capability algebra, capability invocation layer, delegation chains, proof-chain import/export, and OCapN/CapTP live-reference runtime are not yet implemented.

Christopher Lemmer Webber's Fediverse/ocap comments are relevant but should not be interpreted as a mandate to implement CapTP immediately. The useful architectural takeaway is adoption sequencing:

1. simple possession-oriented capabilities and short-lived bearcaps are easiest to integrate with present HTTP-like infrastructure;
2. certificate/token capabilities such as zcap-ld or UCAN add stronger delegation and proof semantics;
3. CapTP/OCapN live references are powerful for distributed live objects, agents, virtual worlds, collaborative rooms, and interactive peer objects, but they are a larger runtime commitment.

For this project, the immediate need is a deterministic, local-first, signed capability model that can authorize offline/local actions and bridge/super-peer decisions without ACLs, ambient roles, or centralized policy servers. CapTP/OCapN should remain a future runtime profile until the product has live object surfaces that justify it.

## Decision

Adopt a project-native **Capability Authority Model v1** with UCAN-compatible semantics and explicit future adapter boundaries for zcap-ld, bearcaps, and OCapN/CapTP.

The canonical rule is:

```text
VCs prove claims.
Capabilities grant authority.
Policy decides reliance.
Invocations record use.
Content addressing proves object integrity.
Encryption protects confidentiality.
```

The capability model is the source of authority for protocol actions. Product roles such as owner, admin, moderator, labeler, bot, bridge operator, relay operator, and super-peer operator must resolve to scoped capability bundles. No role is ambient protocol authority.

## Non-goals

This ADR does not implement:

- full CapTP/OCapN networking;
- a UCAN dependency or JWT/IPLD token runtime in v1;
- zcap-ld JSON-LD canonicalization and proof verification;
- blockchain or global consensus authorization;
- ACLs as canonical authorization state;
- authorization through Verifiable Credentials alone;
- arbitrary user-supplied policy code.

## Core model

### Capability grant

A capability grant says that an issuer delegates narrowly scoped authority to an audience.

Minimum v1 fields:

```text
capabilityId
issuer
subjectAudience
resource
allowedActions
scope
caveats
notBefore
expiresAt
delegationDepth
revocationRef
nonce
proofRefs
createdAt
signatureRef
```

Rules:

- `capabilityId` must be stable, unique, and collision-resistant within issuer scope.
- `issuer` must resolve to a verified controller, device, service, or delegated authority.
- `subjectAudience` must bind the grant to a specific actor, device, service, or pseudonymous authority target.
- `resource` must be explicit: identity, device, community, group, room, object, bundle, bridge, relay, super-peer, label namespace, report queue, search surface, or media pipeline.
- `allowedActions` must be an allowlist; wildcard actions are prohibited in v1.
- `scope` must be explicit and machine-checkable.
- `caveats` constrain authority; they do not expand it.
- `expiresAt` is required for every network-visible or infrastructure-visible capability.
- `delegationDepth` defaults to `0`; subdelegation is denied unless explicitly allowed.
- `revocationRef` links to a replayable revocation/status source when the action risk requires freshness.
- `nonce` prevents accidental duplicate grants and supports replay analysis.

### Capability invocation

A capability invocation records use of a capability for an action. It is separate from the grant.

Minimum v1 fields:

```text
invocationId
capabilityId
invoker
deviceRef
resourceRef
action
scope
argumentsDigest
createdAt
expiresAt
nonce
proofRefs
signatureRef
```

Rules:

- A grant is not an action. A grant only makes an invocation eligible for evaluation.
- Every authority-changing action must have an invocation or a signed event that is equivalent to an invocation.
- `argumentsDigest` commits to the action parameters without embedding private plaintext.
- Invocations must be idempotent by `invocationId` and replay-checked by `(capabilityId, nonce, action, resourceRef)`.
- Expired, revoked, malformed, wrong-audience, wrong-resource, wrong-action, or stale-freshness invocations deny authority.

### Capability revocation

A capability revocation removes or narrows future reliance on a grant.

Minimum v1 fields:

```text
revocationId
capabilityId
issuer
subjectAudience
reasonCode
createdAt
signatureRef
```

Rules:

- Revocation is idempotent.
- Revocation must not delete the historical grant or invocation log.
- Local projection must preserve revoked state to prevent out-of-order resurrection.
- High-impact actions must consult a freshness checkpoint or local revocation projection before allowing invocation.

### Capability caveats

Caveats are restrictions attached to grants or invocations.

Initial caveat types:

```text
expires-before
not-before
audience-is
device-is
resource-is
action-is
scope-is
issuer-is
requires-freshness-check
requires-human-review
requires-private-envelope
requires-encrypted-evidence
max-uses
max-delegation-depth
network-surface-is
bridge-is
label-namespace-is
```

Rules:

- Unknown caveat types fail closed for authority-changing actions.
- Caveats must be deterministic and side-effect free.
- Caveats must not require private plaintext to be embedded in public events.
- Caveats must be evaluated before any mutation, bridge admission, moderation action, label issuance, media quarantine, or private object fetch.

## Relationship to UCAN

The internal model should remain UCAN-compatible without making UCAN the mandatory wire format in v1.

Mapping direction:

```text
UCAN issuer        -> capability issuer
UCAN audience      -> subjectAudience
UCAN capabilities  -> resource + allowedActions + scope
UCAN facts/proofs  -> proofRefs + caveats
UCAN expiration    -> expiresAt
UCAN not-before    -> notBefore
UCAN proofs        -> proof chain
```

The repository may later add UCAN import/export and verification. Until then, UCAN-like `CapabilityProofRef` values are references only and must not elevate authority without a verified local capability projection or trust-policy decision.

## Relationship to zcap-ld

zcap-ld remains a useful Linked Data / Solid-adjacent capability certificate format. It is not the v1 canonical implementation because JSON-LD proof handling, canonicalization, delegation verification, and revocation handling would add tooling before the repository's native capability runtime is stable.

A future zcap adapter may map zcap-ld certificates into the same internal grant/delegation/invocation/revocation model.

## Relationship to bearcaps

Bearcaps, or sufficiently unguessable capability URLs, are allowed only for low-risk, short-lived bootstrap and fetch flows.

Allowed v1 bearcap uses:

- one-time invite bootstrap;
- short-lived encrypted bundle pickup;
- temporary encrypted media fetch;
- bridge pickup tokens;
- recovery handoff bootstrap before stronger proofs are established.

Forbidden v1 bearcap uses:

- identity controller authority;
- device authorization;
- moderator/admin authority;
- labeler authority;
- relay or super-peer operator authority;
- long-lived group membership;
- decryption authority without independent encryption-key checks.

Bearcap requirements:

- high entropy;
- short expiry;
- audience or channel binding where possible;
- single-use or bounded-use for bootstrap flows;
- log redaction;
- no embedding in public events;
- revocation or invalidation path where feasible.

## Relationship to OCapN / CapTP

OCapN/CapTP is a future runtime profile, not a Phase 1 capability requirement.

Use OCapN/CapTP later when the product needs:

- live distributed object references;
- real-time collaborative rooms;
- virtual-world-like spaces;
- agent/subagent invocation across mutually suspicious peers;
- live moderation work queues;
- object references that must be invoked rather than merely proven as signed data.

Do not use CapTP/OCapN as the early authority model for signed events, local storage, bridge admission, or basic group operations. Those should use static signed capabilities and deterministic local policy first.

## Relationship to Verifiable Credentials

VCs are evidence, not automatic authority.

Examples:

```text
A VC may say: this DID is a moderator of Community X.
A capability must say: this device may issue spam labels in Community X until time Y.
A policy decision must say: this issuer, claim, capability, device, action, and resource are acceptable now.
```

Rules:

- A valid VC from an untrusted issuer does not elevate authority.
- A valid VC from a trusted issuer may satisfy an eligibility condition.
- Eligibility does not equal invocation authority.
- VC verification output must be preserved as evidence, not collapsed into a global trust flag.

## Trust-policy integration

The trust-policy engine evaluates capability evidence and returns structured decisions:

```text
allow
warn
require-confirmation
quarantine
deny
```

Authority-changing decisions must deny when:

- grant proof is missing;
- issuer is not trusted for the action/scope;
- audience does not match the invoker/device;
- resource does not match;
- action is not allowed;
- caveat is unknown or unsatisfied;
- grant is expired;
- grant is revoked;
- invocation is stale or replayed;
- required freshness state is unavailable;
- proof version is unsupported;
- private evidence would leak into public records.

## Security invariants

- Deny by default for authority.
- No ambient role authority.
- No VC-only authority.
- No ML-granted authority.
- No public plaintext capability secrets.
- No public logging of bearcaps, private capability URLs, private evidence, or private object refs.
- No wildcard grants in v1.
- No unlimited delegation in v1.
- No subdelegation unless explicitly modeled and tested.
- Revoked capabilities remain tombstones in projection state.
- Expired capabilities remain audit evidence but cannot authorize new invocations.
- Bridges/relays/super-peers may enforce stricter local policy for self-protection but must not present their local refusal as global deletion.

## Initial action taxonomy

Initial action names should be narrow and explicit:

```text
identity.device.authorize
identity.device.revoke
identity.capability.grant
identity.capability.revoke
community.member.invite
community.member.approve
community.member.remove
community.role.assign
community.role.revoke
room.create
room.moderate
label.issue
label.revoke
report.read-encrypted
report.resolve
appeal.resolve
bridge.store-bundle
bridge.forward-envelope
bridge.publish-admission-decision
relay.forward-envelope
relay.cache-object
super-peer.store-bundle
search.index-public-object
media.quarantine
media.release
sync.pull
sync.push
```

Do not collapse these into generic `admin`, `write`, or `moderate` permissions.

## Implementation sequence

1. Add a protocol doctrine document for capability grant/invocation/revocation shapes.
2. Add `packages/capabilities` with pure validators and fixtures.
3. Keep the package independent of PWA, bridge runtime, local-store runtime, sync runtime, and ML runtime.
4. Add tests for valid/invalid grants, invocations, revocations, caveats, expiry, replay ids, malformed fields, unknown versions, unknown caveats, and prototype-pollution attempts.
5. Add trust-policy integration only after the validator package is stable.
6. Add UCAN import/export only after native capability semantics are test-covered.
7. Add bearcap helper only for short-lived bootstrap/fetch flows.
8. Defer OCapN/CapTP until live object surfaces exist.

## Consequences

Positive:

- Keeps the project object-capability-first without adopting ACL assumptions.
- Matches local-first and hybrid P2P constraints.
- Preserves a clean UCAN/zcap/OCapN adapter path.
- Avoids premature CapTP runtime complexity.
- Makes authority auditable, replayable, and testable.
- Prevents VCs, roles, or ML labels from becoming hidden authorization systems.

Negative / costs:

- More schema and validator work up front.
- Requires careful action taxonomy discipline.
- Requires revocation realism and freshness rules.
- Requires UI language that distinguishes eligibility, authority, invocation, local refusal, and global deletion.

## Exit criteria

This ADR is implemented when:

- `docs/protocol/capability-authority-model.md` exists;
- `packages/capabilities` exists with grant/invocation/revocation/caveat validators;
- valid and invalid fixtures cover the v1 authority model;
- tests prove fail-closed behavior for malformed, expired, revoked, stale, wrong-audience, wrong-resource, wrong-action, unknown-caveat, and prototype-pollution inputs;
- trust-policy integration denies authority from VC-only evidence;
- bearcap usage is limited to documented low-risk short-lived flows;
- OCapN/CapTP remains documented as a future runtime profile, not falsely claimed as implemented.
