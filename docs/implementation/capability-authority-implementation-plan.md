# Capability Authority Implementation Plan

- Status: Draft implementation plan
- Date: 2026-06-08
- Related ADR: `docs/adr/007-capability-authority-model-v1.md`
- Related protocol doctrine: `docs/protocol/capability-authority-model.md`

## Goal

Implement the project's object-capability authority model without drifting into ACLs, VC-only permissions, or premature CapTP/OCapN runtime work.

The immediate target is a small, deterministic, pure TypeScript capability package that validates and evaluates native capability grants, invocations, revocations, caveats, and proof references. The package must be compatible with future UCAN/zcap import/export and future OCapN/CapTP live-reference runtime profiles, but it must not claim those systems are implemented before they are.

## Current repo state

Already present:

- signed event envelopes;
- identity-control projection;
- direct identity capability grants/revocations;
- content-addressed object refs;
- trust-safety reference types for capability proof refs and credential refs;
- local-first trust-policy ADR;
- explicit doctrine that capabilities are authority and VCs are evidence.

Missing:

- dedicated capability validator package;
- canonical capability grant/invocation/revocation object shapes;
- capability invocation model;
- caveat evaluator;
- native capability decision reason codes;
- revocation tombstone projection for capability package;
- UCAN import/export adapter;
- zcap adapter;
- bearcap helper profile;
- OCapN/CapTP runtime profile.

## Phase CAP-1: Documentation and doctrine alignment

### Scope

- Add `docs/adr/007-capability-authority-model-v1.md`.
- Add `docs/protocol/capability-authority-model.md`.
- Add this implementation plan.

### Exit criteria

- The repo has a single project-native authority doctrine.
- VCs are documented as evidence only.
- Capabilities are documented as action authority.
- Bearcaps are limited to short-lived low-risk flows.
- UCAN/zcap are documented as adapter-compatible formats, not mandatory v1 dependencies.
- OCapN/CapTP is documented as a future live-object runtime, not current implementation.

## Phase CAP-2: `packages/capabilities` package scaffold

### Files

```text
packages/capabilities/package.json
packages/capabilities/tsconfig.json
packages/capabilities/src/index.ts
packages/capabilities/src/errors.ts
packages/capabilities/src/types.ts
packages/capabilities/src/validation.ts
packages/capabilities/src/evaluate.ts
packages/capabilities/src/projection.ts
packages/capabilities/src/__tests__/validation.test.ts
packages/capabilities/src/__tests__/evaluate.test.ts
packages/capabilities/src/__tests__/projection.test.ts
packages/capabilities/fixtures/valid/
packages/capabilities/fixtures/invalid/
```

### Dependencies

Allowed:

- `@lfp2p/protocol` for JSON/digest helpers if required;
- `@lfp2p/content-addressing` for object refs if the package already exposes stable validators.

Forbidden in CAP-2:

- PWA UI;
- bridge-service runtime;
- local-store/Dexie runtime;
- sync-client transport runtime;
- ML/classifier runtime;
- network fetches;
- arbitrary policy-code execution;
- UCAN/zcap/JSON-LD dependencies before native semantics are stable.

### Package requirements

- Pure functions only.
- No side effects at import time.
- No global mutable state.
- No network calls.
- Deterministic output.
- Deep-frozen validated objects.
- Stable project error codes.
- Fail-closed authority decisions.

### Exit criteria

- Package builds under the repo TypeScript project references.
- Tests cover validators and basic evaluation.
- No runtime integration yet.

## Phase CAP-3: Validation objects

### Implement types

```text
CapabilityGrantV1
CapabilityInvocationV1
CapabilityRevocationV1
CapabilityDelegationV1 reserved shape
CapabilityPartyRef
CapabilityResourceRef
CapabilityScopeRef
CapabilityCaveat
CapabilityProofRef
CapabilityBearcapRef
CapabilityDecision
```

### Validation invariants

- version pinning;
- plain object checks;
- forbidden-key checks;
- id bounds;
- enum allowlists;
- action allowlist;
- no wildcard actions;
- no duplicate actions;
- timestamp parsing;
- `notBefore < expiresAt`;
- safe non-negative delegation depth;
- bounded caveat values;
- known caveat kind validation;
- proof-ref scheme allowlist;
- output deep freeze.

### Required tests

- accepts valid grant;
- accepts valid invocation;
- accepts valid revocation;
- rejects unknown versions;
- rejects malformed refs;
- rejects duplicate and wildcard actions;
- rejects invalid timestamps;
- rejects unsafe delegation depth;
- rejects prototype-pollution payloads;
- deep-freezes output.

## Phase CAP-4: Evaluation engine

### Implement API

```ts
export function evaluateCapabilityInvocation(
  input: EvaluateCapabilityInvocationInput
): CapabilityDecision;
```

Suggested input:

```ts
Readonly<{
  grant: CapabilityGrantV1;
  invocation: CapabilityInvocationV1;
  revocations?: readonly CapabilityRevocationV1[];
  now: string;
  replayedInvocationIds?: ReadonlySet<string>;
  verifiedProofIds?: ReadonlySet<string>;
  trustedIssuerIds?: ReadonlySet<string>;
  authorityContext: 'mutation' | 'display' | 'bridge' | 'relay' | 'search' | 'moderation' | 'sync';
}>;
```

### Evaluation rules

Deny when:

- grant is malformed;
- invocation is malformed;
- grant expired;
- grant not yet valid;
- invocation expired;
- matching revocation exists;
- audience mismatch;
- resource mismatch;
- action mismatch;
- scope mismatch;
- unknown caveat;
- unsatisfied caveat;
- proof required but unavailable;
- invocation replay detected;
- issuer untrusted for authority context.

### Decision shape

```ts
Readonly<{
  status: 'allow' | 'warn' | 'require-confirmation' | 'quarantine' | 'deny';
  reasonCodes: readonly string[];
  capabilityId: string;
  invocationId: string;
  createdAt: string;
  expiresAt?: string;
}>;
```

Decisions must not embed private evidence, bearcap secrets, VC bodies, decrypted payloads, or full private object refs.

### Required tests

- allows exact valid grant/invocation;
- denies expired grants;
- denies not-yet-valid grants;
- denies revoked grants;
- denies wrong audience;
- denies wrong resource;
- denies wrong action;
- denies wrong scope;
- denies replayed invocation;
- denies untrusted issuer;
- denies proof-required-but-unverified;
- returns log-safe reason codes.

## Phase CAP-5: Revocation projection

### Implement API

```ts
createEmptyCapabilityProjection();
applyCapabilityGrant(projection, grant);
applyCapabilityRevocation(projection, revocation);
applyCapabilityInvocationRecord(projection, invocation);
```

### Projection rules

- Preserve grants as audit evidence.
- Preserve revocations as tombstones.
- Revocation is idempotent.
- Out-of-order grant after revocation must not resurrect authority without a newer valid grant id.
- Invocation ids are recorded for replay detection when policy requires it.
- Projection output is deep-frozen.

### Required tests

- revocation tombstone survives replay;
- duplicate revocation is idempotent;
- out-of-order grant cannot resurrect revoked capability id;
- invocation id replay is detected;
- projection rebuild is deterministic.

## Phase CAP-6: Identity-control integration

### Scope

Connect `packages/identity` direct controller-signed capability grants/revocations to `packages/capabilities` without breaking current identity-control v1 semantics.

### Rules

- Identity-control remains the account-local source for direct controller grants.
- Dedicated capability package validates richer authority objects.
- No duplicate capability semantics should drift between packages.
- Existing identity fixtures must continue to pass.
- Add migration notes if identity-control events need richer payloads later.

### Required tests

- identity-control direct grant maps to capability grant evidence;
- identity-control revocation maps to capability tombstone;
- revoked device cannot invoke a mapped capability;
- expired identity capability cannot invoke.

## Phase CAP-7: Trust-policy integration

### Scope

Use capability decisions as inputs to the local-first trust-policy engine.

### Rules

- VC-only evidence must deny authority-changing actions.
- ML labels must remain advisory.
- Local policy can be stricter than capability grants.
- Bridge/relay/super-peer policy can protect infrastructure but cannot claim global deletion.

### Required tests

- VC-only moderator claim does not authorize moderation action;
- trusted VC plus valid capability can authorize configured action;
- untrusted issuer VC is preserved as evidence but does not elevate;
- bridge-local denial remains bridge-scoped;
- private evidence is not embedded in decision records.

## Phase CAP-8: Bearcap helper profile

### Scope

Add helper utilities for short-lived bearcap bootstrap/fetch flows only after signed capability validators are stable.

### Allowed uses

- one-time invite bootstrap;
- encrypted bundle pickup;
- temporary encrypted media fetch;
- bridge pickup token;
- recovery handoff bootstrap.

### Forbidden uses

- controller/device authority;
- moderator/admin authority;
- labeler authority;
- relay/super-peer authority;
- long-lived group membership;
- decryption without independent key checks.

### Required tests

- rejects forbidden action classes;
- redacts bearcap secrets in summaries;
- enforces expiry;
- enforces single-use when configured;
- denies public-event embedding.

## Phase CAP-9: UCAN adapter

### Scope

Add UCAN import/export only after the native model has stable semantics and tests.

### Rules

- UCAN maps into native grants/invocations/proofs.
- UCAN proofs do not bypass local trust policy.
- Unknown UCAN caveats fail closed for authority.
- No dependency should be added without review of maintenance status, security history, bundle impact, and deterministic behavior.

### Required tests

- UCAN-like grant maps to native grant;
- UCAN-like proof chain preserves parent restrictions;
- expiry and audience are enforced;
- unknown caveat denies authority;
- malformed token fails predictably.

## Phase CAP-10: zcap-ld adapter

### Scope

Evaluate zcap-ld adapter feasibility after UCAN-compatible native semantics are stable.

### Caution

zcap-ld may require JSON-LD canonicalization, proof suite handling, context control, remote context blocking/caching, delegation-chain verification, and revocation semantics. Do not add it casually.

### Required safeguards

- no remote context fetching during authority evaluation;
- pinned contexts only;
- deterministic canonicalization;
- proof-suite allowlist;
- size and depth limits;
- unknown proof suites deny authority.

## Phase CAP-11: OCapN/CapTP runtime profile

### Scope

Defer until the product has live object surfaces.

Potential triggers:

- real-time collaborative rooms;
- live moderation queues;
- virtual spaces;
- agent/subagent live invocation;
- peer object references that need live method invocation rather than signed event proof.

### Rules

- OCapN/CapTP must not replace the static signed capability model.
- Live references must map back to auditable capability grants/invocations where authority-changing actions occur.
- Runtime must have resource limits, backpressure, cancellation, timeout, and DoS protections.
- Transport errors must fail closed for authority.

## CI expectations

Each code phase must run:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

When a package is added, also verify:

- root TypeScript project references;
- workspace package resolution;
- exports map;
- test discovery;
- no circular dependencies;
- no browser-only APIs in protocol packages;
- no Node-only APIs in PWA-bound packages unless gated.

## Security checklist

- [ ] Deny by default for authority.
- [ ] No ambient role authority.
- [ ] No VC-only authority.
- [ ] No ML-granted authority.
- [ ] No wildcard actions.
- [ ] No unlimited delegation.
- [ ] Unknown caveats fail closed.
- [ ] Revocations are tombstones.
- [ ] Expiry is mandatory for network-visible capabilities.
- [ ] Bearcaps are redacted and short-lived.
- [ ] Private plaintext is never logged.
- [ ] Private object refs are redacted in logs.
- [ ] Decisions contain safe reason codes only.
- [ ] Projection replay is deterministic.
- [ ] Prototype-pollution attempts are rejected.
- [ ] Stale/replayed invocations are denied.

## Immediate next step

Implement Phase CAP-2 and CAP-3 as the first code slice:

1. scaffold `packages/capabilities`;
2. add pure validators and project error codes;
3. add valid/invalid fixtures;
4. add validation tests;
5. add root workspace/project references;
6. run lint, typecheck, tests, and build.
