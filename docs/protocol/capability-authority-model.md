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

### Profile-level enforcement (today)

`authority-profiles.ts` ships single-step delegation enforcement
that does not depend on the full delegation-of-delegation runtime
above. `validateDelegationChain(parent, child)` asserts the three
structural rules of one delegation hop:

1. **No privilege escalation** — `child.childKind ∈ parent.mayDelegateTo`,
   so e.g. a relay cannot mint a super-peer grant regardless of what
   a malformed envelope claims.
2. **Action attenuation** — `child.actions ⊆ parent.allowedActions`,
   so a child can only hold actions the parent itself holds.
3. **Depth monotonic** — `child.depth < parent.maxDelegationDepth`,
   which makes a profile with `maxDelegationDepth === 0` unable to
   re-delegate to anyone, regardless of `mayDelegateTo`.

Each rule throws a stable `CapabilityError` code
(`CAP_INVALID_PARTY` / `CAP_INVALID_ACTION` / `CAP_INVALID_NUMBER`)
so callers can audit privilege-escalation attempts privacy-safely.

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

### Plug-in verifiers

The registry's `verifyProof` takes an *injected*
`CapabilityProofVerifier` and never performs cryptography itself. A
verifier is a pure function `(record) → 'verified' | 'invalid' | undefined`:

- `'verified'` — the verifier confirms the underlying proof's
  cryptographic validity, AND deterministic gates (not revoked, not
  expired) pass.
- `'invalid'` — the verifier rejects the proof (bad signature,
  broken chain, subject mismatch, …).
- `undefined` — the verifier abstains (cannot speak to this scheme,
  or the underlying bytes are not yet available). Resolves to
  `unverified` at the registry — never to a false `verified`.

A verifier abstaining on a scheme it can't assess is the **whole
point** of the injection design: it lets multiple verifiers compose
without any one of them silently promoting a proof. Schemes the
project ships:

- **`@lfp2p/native-proof-verifier`** — fills the slot for
  `native-signed-event` proofs only, using `@lfp2p/crypto`'s
  ed25519 `verifySignedEventEnvelope`. Provides
  `createNativeProofVerifier({ resolveSignedEvent, issuerMatches? })`
  and a `composeVerifiers(...)` helper so future scheme verifiers
  (UCAN, VC, zcap-ld) can be layered without modifying any existing
  ones. The package is intentionally honest: it never claims to
  verify a scheme it does not understand, and abstains rather than
  asserting `invalid` when the caller does not hold the underlying
  event bytes.
- **`@lfp2p/ucan-verifier`** — fills the slot for the `ucan` scheme.
  Provides `createUcanVerifier({ resolveUcanToken, maxChainDepth?, now? })`
  which:
  - parses a JWT-shape UCAN (`header.payload.signature` base64url),
  - resolves `payload.iss` as `did:key:z…` (Ed25519 multicodec
    `0xed01` only — other DID methods and multibase prefixes
    resolve to `'invalid'`),
  - verifies the Ed25519 signature over the on-wire signing input
    via `@lfp2p/crypto`'s new `verifyEd25519` primitive,
  - enforces `payload.iss === record.issuer.id` (the leaf token's
    issuer must equal the registry record's),
  - walks the `prf` delegation chain enforcing
    `child.iss === parent.aud`, `child.exp ≤ parent.exp`, and
    `child.att ⊆ parent.att` for every link,
  - rejects on bounded chain-depth overrun (default 16),
  - rejects any `prf` entry that is not a parseable inline JWT (no
    silent skips on CIDs/IPFS refs in v1).

  Honest v1 scope: Ed25519 only, `did:key` only, inline-JWT
  `prf` only, no CBOR / UCAN 0.10+. The package never returns
  `'verified'` on a token whose scheme it cannot fully assess; for
  every non-UCAN scheme it abstains so it composes cleanly with the
  native verifier via `composeVerifiers(...)`.

- **`@lfp2p/vc-verifier`** — fills the slot for the `vc` scheme
  (W3C Verifiable Credentials).
  Provides `createVcVerifier({ resolveCredential, now? })` which:
  - extracts and matches `credential.issuer` (string DID or
    `{ id }` form) against the registry record's `issuer.id`,
  - extracts and matches `credentialSubject.id` against the
    registry record's `subject.id` (single-subject credentials
    only — multi-subject is out of scope for v1),
  - enforces VC-DM 2.0 (`validFrom`/`validUntil`) AND VC-DM 1.1
    (`issuanceDate`/`expirationDate`) time windows when present,
    with `now === validUntil` treated as expired (fail-closed),
  - accepts ONLY `proof.type === 'DataIntegrityProof'` with
    `cryptosuite === 'eddsa-jcs-2022'` — any other proof type or
    cryptosuite is `'invalid'`, not abstain, because the scheme
    has already been claimed,
  - resolves `proof.verificationMethod` (with any fragment stripped)
    as a `did:key:z…` whose base DID MUST equal the credential
    issuer — preventing a did:key holder from signing credentials
    "as" any other issuer,
  - decodes the multibase `z<base58btc>` `proofValue` to a raw
    64-byte Ed25519 signature,
  - canonicalizes both the credential (sans `proof`) and the proof
    options (sans `proofValue`) via JCS (RFC 8785) using the new
    shared `canonicalizeJcs` helper in `@lfp2p/crypto`, computes
    `sha256(proofConfig) || sha256(unsecuredDoc)` (per the W3C
    VC-DI eddsa-jcs-2022 spec), and verifies the signature via
    `verifyEd25519`.

  Honest v1 scope: `eddsa-jcs-2022` only (deliberately avoids
  JSON-LD URDNA2015 canonicalization), `did:key` only, single-proof
  + single-subject only. Other proof types
  (`Ed25519Signature2020`, `JsonWebSignature2020`,
  `eddsa-rdfc-2022`, `ecdsa-rdfc-2019`, BBS variants) are explicit
  non-goals and resolve to `'invalid'`. Status-list / revocation
  lookup is also out of scope — the proof registry's deterministic
  `revokedAt` gate is the authoritative revocation surface.

- zcap-ld, bearcap, manual-local-policy verifiers — not shipped.
  Until a dedicated verifier exists for those schemes, proofs of
  those schemes stay `unverified`. The proof registry's
  `summarizeProofStates` worst-case fold ensures that surfaces as
  `capability.unverified-proof` at the reliance gate (fail closed).
  See issue #84 for the design notes on each.

## VC authority bindings

A Verifiable Credential is one possible proof scheme
(`scheme: 'vc'`). The VC authority binding (`vc-authority-binding.ts`)
records that a *specific* VC, already in the proof registry, was the
claimed evidence behind a *specific* capability.

`VcAuthorityBindingV1`:

```ts
version            // lfp2p.capability.vc-authority-binding.v1
bindingId
vcProofId          // points at a proof registry record with scheme: 'vc'
capabilityId       // the grant this VC supports as evidence
claimSubject
claimType          // free-form bounded string (VC vocabularies differ)
claimDigest        // pins the exact claim payload bytes
recordedAt
```

Registry operations (pure, immutable, frozen):

```text
createVcBindingRegistry()
registerVcBinding(registry, input)         immutable: duplicate bindingId throws
getBinding(registry, bindingId)
getBindingsForCapability(registry, capId)  sorted ascending by bindingId
getBindingsForVc(registry, vcProofId)      sorted ascending by bindingId
resolveVcBindings(bindings, proofs, capId) joins with the proof registry
```

Non-negotiable rules:

- **A binding is EVIDENCE, never authority.** Registering a binding
  cannot grant or upgrade authority. The existing
  `capability.vc-only-authority-denied` gate in `reliance.ts` stays
  unchanged — authority comes only from a capability decision.
- **Scope-creep prevention.** A VC supports only the capabilities a
  binding explicitly names. The same VC cannot be silently reused as
  evidence for unrelated capabilities — a caller must register a NEW
  binding, leaving an audit trail.
- **Honest audit posture.** `resolveVcBindings` joins the binding
  registry with the proof registry and surfaces the proof's live
  `verificationState`. Fail-closed in three places:
  - A binding whose `vcProofId` is **not** in the proof registry
    resolves to `unverified` (never silently assumed verified).
  - A binding whose referenced proof has `scheme !== 'vc'` is dropped
    — a non-VC proof is never silently re-interpreted as VC evidence.
  - A binding whose referenced proof has a `subject` that differs
    from the binding's `claimSubject` is dropped — a verified
    credential about one party MUST NOT be reported as verified
    evidence about another (confused-deputy defense).
  Mismatches drop quietly so a single bad row cannot poison the audit
  surface for the others.

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
