# Capability Authority Model Protocol

- Status: Draft protocol doctrine
- Date: 2026-06-08
- Related ADR: `docs/adr/007-capability-authority-model-v1.md`
- Intended package: `packages/capabilities`

## Purpose

This document defines the v1 protocol contract for capability authority in the local-first hybrid P2P architecture.

The model is deliberately **not ACL-based**. It does not ask whether an identity appears on a server-side access list. It asks whether a signed, scoped, unexpired, non-revoked capability authorizes a specific invocation for a specific resource, action, actor, and device under local policy.

## Authority stack

```text
signed event envelope
  -> identity/device projection
  -> capability grant/delegation/revocation projection
  -> capability invocation
  -> trust-policy decision
  -> local mutation / display / sync / bridge / relay / moderation effect
```

Each layer must fail closed for authority-changing actions.

## Versions

All capability protocol objects must carry a pinned version string:

```text
lfp2p.capability.grant.v1
lfp2p.capability.invocation.v1
lfp2p.capability.revocation.v1
lfp2p.capability.delegation.v1
lfp2p.capability.bearcap.v1
```

Unknown major versions fail closed. Unknown minor/profile extensions may be preserved as opaque data only when the evaluator can prove they do not affect authority.

## Identifiers

Identifier fields must be:

- non-empty strings;
- bounded length;
- normalized before comparison;
- forbidden from using prototype-pollution keys;
- safe for deterministic replay.

Forbidden object keys and identifier values:

```text
__proto__
prototype
constructor
hasOwnProperty
isPrototypeOf
propertyIsEnumerable
toString
toLocaleString
valueOf
```

## CapabilityGrantV1

A grant delegates authority from an issuer to an audience.

```ts
export type CapabilityGrantV1 = Readonly<{
  version: 'lfp2p.capability.grant.v1';
  capabilityId: string;
  issuer: CapabilityPartyRef;
  audience: CapabilityPartyRef;
  resource: CapabilityResourceRef;
  actions: readonly CapabilityAction[];
  scope: CapabilityScopeRef;
  caveats: readonly CapabilityCaveat[];
  notBefore?: string;
  expiresAt: string;
  delegationDepth: number;
  revocationRef?: CapabilityRevocationRef;
  nonce: string;
  proofRefs: readonly CapabilityProofRef[];
  createdAt: string;
}>;
```

### Grant validation rules

- `version` must equal `lfp2p.capability.grant.v1`.
- `capabilityId` must be non-empty and bounded.
- `issuer` and `audience` must be valid party refs.
- `resource` must be explicit; no implicit global resource.
- `actions` must contain at least one action and no duplicates.
- `actions` must not contain wildcard values in v1.
- `scope` must be explicit.
- `caveats` must be valid and deterministic.
- `expiresAt` is required and must parse as a valid timestamp.
- `notBefore`, when present, must parse as a valid timestamp.
- `notBefore` must be before `expiresAt` when both exist.
- `delegationDepth` must be a safe non-negative integer.
- `nonce` must be non-empty.
- Output must be deeply frozen.

## CapabilityInvocationV1

An invocation records use of a grant. It is the event that says a holder is attempting to do something.

```ts
export type CapabilityInvocationV1 = Readonly<{
  version: 'lfp2p.capability.invocation.v1';
  invocationId: string;
  capabilityId: string;
  invoker: CapabilityPartyRef;
  device?: CapabilityPartyRef;
  resource: CapabilityResourceRef;
  action: CapabilityAction;
  scope: CapabilityScopeRef;
  argumentsDigest?: string;
  nonce: string;
  createdAt: string;
  expiresAt?: string;
  proofRefs: readonly CapabilityProofRef[];
}>;
```

### Invocation validation rules

- `version` must equal `lfp2p.capability.invocation.v1`.
- `invocationId`, `capabilityId`, and `nonce` must be non-empty and bounded.
- `invoker` must be a valid party ref.
- `device`, when present, must be a valid party ref.
- `resource`, `action`, and `scope` must be explicit.
- `argumentsDigest`, when present, must be a supported digest ref.
- `createdAt` must be a valid timestamp.
- `expiresAt`, when present, must be a valid timestamp after `createdAt`.
- Output must be deeply frozen.

## CapabilityRevocationV1

A revocation is a tombstone that prevents future reliance on a grant or delegation.

```ts
export type CapabilityRevocationV1 = Readonly<{
  version: 'lfp2p.capability.revocation.v1';
  revocationId: string;
  capabilityId: string;
  issuer: CapabilityPartyRef;
  audience?: CapabilityPartyRef;
  reasonCode: CapabilityRevocationReason;
  createdAt: string;
  proofRefs: readonly CapabilityProofRef[];
}>;
```

### Revocation validation rules

- `version` must equal `lfp2p.capability.revocation.v1`.
- `revocationId` and `capabilityId` must be non-empty and bounded.
- `issuer` must be valid.
- `audience`, when present, must be valid.
- `reasonCode` must be a known bounded reason code.
- `createdAt` must be a valid timestamp.
- Revocation projection must be idempotent.
- Revocation state must remain visible as a tombstone to prevent resurrection.
- Output must be deeply frozen.

## CapabilityDelegationV1

Delegation-of-delegation is not active in the current identity-control v1 model. The protocol reserves a shape so that future UCAN/zcap-style proof chains can map cleanly without rewriting authority semantics.

Rules for future implementation:

- parent grant must allow delegation;
- delegation depth must decrease or terminate;
- delegated actions must be a subset of parent actions;
- delegated resource must be equal to or narrower than parent resource;
- delegated caveats must be equal to or stricter than parent caveats;
- expiry must be no later than parent expiry;
- unknown caveats in a parent chain fail closed.

## Party refs

```ts
export type CapabilityPartyKind =
  | 'actor'
  | 'device'
  | 'controller'
  | 'service'
  | 'bridge'
  | 'relay'
  | 'super-peer'
  | 'labeler'
  | 'bot'
  | 'pseudonym';
```

A party ref must include:

```ts
kind
id
```

Optional fields:

```ts
digest
publicKeyRef
```

Rules:

- `kind` must be allowlisted.
- `id` must be bounded and non-empty.
- `digest`, when present, must be a supported digest ref.
- `publicKeyRef`, when present, must be bounded and non-empty.

## Resource refs

```ts
export type CapabilityResourceKind =
  | 'identity'
  | 'device'
  | 'community'
  | 'group'
  | 'room'
  | 'object'
  | 'bundle'
  | 'bridge'
  | 'relay'
  | 'super-peer'
  | 'label-namespace'
  | 'report-queue'
  | 'appeal-queue'
  | 'search-surface'
  | 'media-pipeline'
  | 'sync-stream';
```

A resource ref must include:

```ts
kind
id
```

Optional fields:

```ts
digest
scopeHint
```

Rules:

- `kind` must be allowlisted.
- `id` must be bounded and non-empty.
- `digest`, when present, must be a supported digest ref.
- `scopeHint`, when present, must not be treated as authority.

## Actions

Actions are explicit strings from a project allowlist. Initial actions:

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

Rules:

- no wildcard actions in v1;
- no generic `admin` action;
- no generic `write-everything` action;
- unknown action strings fail validation unless a future extension explicitly allows opaque action refs in non-authority contexts.

## Scope refs

A scope ref must include:

```ts
kind
id
```

Initial scope kinds:

```text
self
local-device
identity
community
group
room
bridge
relay
super-peer
public-index
private-envelope
```

Rules:

- `scope.kind` must be allowlisted.
- `scope.id` must be bounded and non-empty.
- local/private scopes must not be exported to public search, public labels, or bridge analytics by default.

## Caveats

Initial caveat kinds:

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

A caveat must include:

```ts
kind
value
```

Rules:

- unknown caveat kinds fail closed for authority-changing actions;
- `value` must be JSON-safe, bounded, and deterministic;
- caveats cannot expand parent authority;
- caveats cannot depend on nondeterministic runtime state unless represented as an explicit evidence ref;
- caveats must not require decrypted private content in public decision records.

## Proof refs

Proof refs point to verification evidence. They do not verify themselves.

Initial proof schemes:

```text
native-signed-event
identity-control-log
ucan
zcap-ld
vc
bearcap
manual-local-policy
```

Rules:

- proof refs are evidence pointers;
- proof refs do not elevate authority without successful verification and trust-policy reliance;
- unknown proof schemes may be preserved but must not authorize actions.

## Proof registry

A `CapabilityProofRef` is only a pointer. The **proof registry**
(`proof-registry.ts`) is the canonical place that records *what a
proof actually is* and *whether it can be relied upon*. It turns the
blanket `capability.unverified-proof` deny into a real verification
outcome.

`CapabilityProofRecord`:

```ts
proofId
scheme
issuer            // party that issued the underlying proof
subject           // party the proof vouches for
issuedAt
expiresAt
revokedAt?        // present iff revoked
digest            // content digest of the proof bytes (sha-256:…)
verificationState
```

Verification states:

```text
unverified   recorded but not cryptographically checked (honest default)
verified     an injected verifier confirmed validity, not expired, not revoked
expired      now >= expiresAt
revoked      explicitly revoked (carries revokedAt)
invalid      an injected verifier rejected it (bad signature / chain / subject)
```

Registry operations (all pure; every op returns a NEW frozen
registry + record, Phase 3.2 replay discipline):

```text
createProofRegistry()
registerProof(registry, input)         immutable: duplicate proofId throws
getProof(registry, proofId)
verifyProof(registry, proofId, opts)   computes + persists the live state
revokeProof(registry, proofId, opts)   monotonic; first revocation wins
summarizeProofStates(registry, refs)   worst-case fold for the reliance gate
```

Non-negotiable rules:

- **The registry performs no cryptography itself.** `@lfp2p/capabilities`
  has zero dependencies; `verifyProof` takes an *injected*
  `CapabilityProofVerifier` supplied by a caller that holds the crypto
  (e.g. `@lfp2p/crypto` for `native-signed-event`). A verifier that
  cannot assess a scheme returns `undefined` → `unverified`. The
  registry **never** reports `verified` on its own.
- **Honest verification scope.** UCAN, VC, zcap-ld, bearcap, and
  manual-local-policy proofs stay `unverified` until a dedicated
  verifier exists. The registry does not pretend to validate a
  credential format it cannot check.
- **Deterministic gates beat cryptography.** `verifyProof` precedence
  is: `revoked` → `expired` → verifier verdict (`invalid` /
  `verified`) → `unverified`. A revoked or expired proof can never be
  reported `verified`.
- **Fail-closed aggregation.** `summarizeProofStates` folds a
  capability's `proofRefs` to the *worst* (least trustworthy) state —
  severity `revoked > invalid > expired > unverified > verified`. An
  empty ref list, or a ref pointing at a proof not in the registry,
  is `unverified`.

### Reliance gate

`evaluateCapabilityReliance` accepts an optional `proofsState` (the
output of `summarizeProofStates`). When supplied and not `verified`,
it overrides an otherwise-allowing decision and denies:
`revoked → capability.revoked`, `expired → capability.expired`,
`invalid`/`unverified → capability.unverified-proof`. Omitting
`proofsState` preserves the pre-registry behaviour exactly — the
provenance gate is opt-in, never a silent behaviour change.

### Proof record vs grant

A grant *carries* `proofRefs`; the registry *resolves* them. The grant
is the authority claim; the proof record is the evidence ledger that
says whether the claim's evidence holds. They are deliberately
separate: a grant is immutable once issued, but a proof's
`verificationState` is time-relative and revocable, so it lives in the
mutable-by-replay registry, not baked into the grant.

## Bearcap profile

Bearcaps are possession URLs or tokens. They are explicitly weaker than signed capability grants and must be limited to short-lived low-risk flows.

A bearcap ref may include:

```ts
version
bearcapId
audienceHint
purpose
expiresAt
singleUse
maxUses
createdAt
redactionDigest
```

Rules:

- bearcap secrets must never be stored in public events;
- logs must contain only redacted ids or digests;
- bearcaps must expire quickly;
- identity-control, moderator/admin, labeler, relay, and super-peer authority cannot be bearcap-only;
- access to confidential content still depends on encryption keys, not URL possession alone.

## Evaluation algorithm

For an invocation against a grant:

1. Validate grant shape.
2. Validate invocation shape.
3. Validate relevant revocation projection.
4. Confirm invocation `capabilityId` matches grant.
5. Confirm invocation time is within grant validity.
6. Confirm invocation audience/device matches grant audience and caveats.
7. Confirm invocation resource is equal to or narrower than grant resource.
8. Confirm invocation action appears in grant actions.
9. Confirm invocation scope is equal to or narrower than grant scope.
10. Evaluate all caveats.
11. Check replay/idempotency state.
12. Evaluate proof refs and local trust-policy reliance.
13. Return a structured decision, never a bare boolean.

Authority-changing failures return `deny` with safe reason codes. Low-risk display failures may return `warn` or `require-confirmation` only when local policy explicitly permits.

## Required reason codes

Initial reason codes:

```text
capability.valid
capability.malformed
capability.unsupported-version
capability.expired
capability.not-yet-valid
capability.revoked
capability.wrong-audience
capability.wrong-device
capability.wrong-resource
capability.wrong-action
capability.wrong-scope
capability.unknown-caveat
capability.unsatisfied-caveat
capability.replayed-invocation
capability.stale-revocation-state
capability.untrusted-issuer
capability.unverified-proof
capability.vc-only-authority-denied
capability.bearcap-forbidden-for-action
capability.private-data-leak-risk
```

Reason codes must be safe to log and display. They must not embed private plaintext, full private refs, bearcap secrets, credential bodies, or decrypted evidence.

## Test requirements

The first package implementation must include tests for:

- valid grant validation;
- valid invocation validation;
- valid revocation validation;
- unknown version rejection;
- empty and overlong identifiers;
- prototype-pollution keys;
- duplicate action rejection;
- wildcard action rejection;
- invalid timestamps;
- `notBefore >= expiresAt` rejection;
- unsafe delegation depth rejection;
- unknown caveat rejection in authority context;
- malformed proof ref rejection;
- deep-freeze output;
- revoked tombstone preservation;
- wrong audience/resource/action/scope denial;
- expired capability denial;
- VC-only authority denial;
- bearcap forbidden-action denial;
- replayed invocation denial.

## Current implementation boundary

The existing identity-control log has direct capability grant/revoke projection. This document does not replace it. The next implementation should add a dedicated `packages/capabilities` package and later connect it to identity-control and trust-policy evaluation.

Until that package lands, any `CapabilityProofRef` or `CredentialRef` in trust-safety code remains shape-only evidence and must not elevate authority.
