# ADR-006: Local-First Trust Policy Engine v1

- Status: Proposed
- Date: 2026-05-30
- Deciders: Damon / project maintainers
- Related docs:
  - `docs/adr/001-identity-control-log-v1.md`
  - `docs/adr/002-private-payload-encryption-envelope-v1.md`
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
  - `docs/adr/005-content-addressing-and-object-references-v1.md`
  - `docs/implementation/local-first-trust-policy-engine-plan.md`
  - `docs/protocol/trust-safety-event-policy.md`
  - `docs/protocol/content-addressing.md`
- Related PRs: TBD

## Context

The repository is a local-first hybrid P2P product monorepo. The current implementation has signed event envelopes, local device identity bootstrap, early identity-control projection logic, encrypted local signing-key material, Dexie-backed local state, mutation outbox retry/idempotency behavior, and non-authoritative bridge primitives. The target architecture needs private messaging, groups, secure sync, relays/super-peers, object capabilities, Verifiable Credentials, content addressing, object integrity proofs, versioning, and future MLS integration.

The project needs a concrete decision layer that answers questions such as:

- should this device represent this identity?
- should this object be accepted, displayed, synced, quarantined, or rejected?
- should this capability authorize this action on this resource?
- should this VC issuer be trusted for this claim type and this context?
- should this bridge, relay, or super-peer be used for storage, forwarding, ordering, or discovery?
- should an ML-generated risk signal affect warning/quarantine behavior without becoming hidden authority?

Verifiable Credentials are useful for trusted introductions, group/community membership, device attestation, organization claims, relay/super-peer operator claims, and future reputation/role claims. But a valid VC does not itself prove that the subject is globally trustworthy. The W3C VC Data Model states that verifiability does not imply the truth of encoded claims; verifiers rely on credentials only after evaluating issuer, proof, subject, and claims against verifier policies.

External reference anchors:

- W3C Verifiable Credentials Data Model v2.0: https://www.w3.org/TR/vc-data-model-2.0/
- W3C Verifiable Credential Data Integrity 1.0: https://www.w3.org/TR/vc-data-integrity/
- W3C Controlled Identifiers v1.0: https://www.w3.org/TR/cid/
- IETF MLS RFC 9420: https://datatracker.ietf.org/doc/rfc9420/
- UCAN specification: https://github.com/ucan-wg/spec
- Cedar authorization language: https://docs.cedarpolicy.com/
- Open Policy Agent / Rego: https://www.openpolicyagent.org/docs/policy-language
- Common Expression Language: https://cel.dev/
- IPLD Data Model: https://ipld.io/docs/data-model/
- IPLD CAR transport: https://ipld.io/specs/transport/car/

## Decision

Adopt a **local-first trust policy engine** as a deterministic decision layer that runs inside the client/light peer first, with compatible evaluation semantics for future full peers, bridges, relays, super-peers, and native runtimes.

The trust policy engine evaluates signed evidence and local policy to produce scoped decisions. It is not a global reputation service, not a blockchain consensus system, and not an ML classifier.

## Core principles

1. **Trust is contextual, not global.**
   - The engine must not produce one universal `trusted` flag for a person.
   - Decisions are scoped by subject, actor, device, action, resource, community/group, transport surface, and policy version.
   - Example: a device may be trusted for direct messages but not for group administration; a relay may be trusted for encrypted storage but not for ordering.

2. **Cryptography proves facts; policy decides reliance.**
   - Object signatures, content digests, integrity proofs, VC proofs, and capability signatures are evidence inputs.
   - They do not enforce themselves.
   - The engine turns verified facts into `allow`, `warn`, `require-confirmation`, `quarantine`, or `deny` decisions.

3. **Capabilities decide authority.**
   - Object capabilities are the primary authorization mechanism for actions such as invite, write, moderate, label, bridge-store, relay-forward, and sync.
   - Product roles such as owner, admin, moderator, bot, labeler, curator, bridge operator, relay operator, and super-peer operator resolve to explicit capability bundles.
   - No product role is ambient, unbounded protocol authority.

4. **VCs prove claims, not universal trust.**
   - VCs may attest device ownership, group membership, trusted-introducer status, organization role, moderation role, labeler/scanner authority, relay/super-peer operator status, or review/reputation claims.
   - Local issuer policy decides which issuers are trusted for which credential types, claim types, scopes, and expiration/revocation mechanisms.
   - A valid VC from an untrusted issuer is preserved as evidence but should not elevate authority.

5. **ML is advisory, never authority.**
   - ML risk signals may detect spam, impersonation risk, suspicious device behavior, abusive invite patterns, relay anomaly behavior, attachment/link risk, or classifier-generated labels.
   - ML output must not directly grant decryption, membership, mutation, administrative authority, or bridge admission authority.
   - ML may influence warning, review, throttling, or quarantine when a deterministic policy allows that signal type for that surface.

6. **Smart-contract-like behavior means deterministic local policy, not blockchain by default.**
   - The system may use deterministic policy modules, signed policy bundles, replayable decisions, versioned policy semantics, and auditable inputs/outputs.
   - Public blockchains are not required for early trust decisions and would add privacy, latency, cost, and consensus coupling risks.
   - Later versions may support optional public transparency logs or registries for selected issuer/revocation metadata, but they must not become mandatory protocol authority.

7. **Evidence is stored before scores.**
   - The local store should preserve append-only evidence records so policy decisions can be recomputed as policy versions evolve.
   - Scores, ranks, and labels are derived projections.
   - User overrides must be explicit evidence records with local/private scope by default.

8. **Fail closed for authority; degrade gracefully for UX.**
   - Missing or invalid signatures, revoked capabilities, revoked devices, unsupported major versions, malformed private payload envelopes, or invalid content refs must deny authority-changing actions.
   - For low-risk display/UX cases, the engine may warn or require confirmation instead of hard denial when policy allows.

## Trust engine inputs

The engine evaluates normalized evidence, including:

- signed event validation results,
- object integrity proof results,
- content-addressed object reference validation,
- identity-control projection state,
- device authorization/revocation state,
- capability grant/revoke/expiry state,
- VC / Verifiable Presentation verification results,
- issuer trust policy,
- revocation and status checks,
- local contact verification / fingerprint comparison,
- local petnames/contact-card evidence,
- MLS/group membership state once implemented,
- sync checkpoint / replay / rewind evidence,
- bridge/relay/super-peer behavior evidence,
- report/appeal/quarantine evidence,
- local user overrides,
- ML risk labels when available and policy-authorized.

## Trust engine outputs

The engine returns structured decisions, not bare booleans.

Initial decision statuses:

- `allow`
- `warn`
- `require-confirmation`
- `quarantine`
- `deny`

Every decision must include:

- `decisionId`
- `version`
- `policyRef`
- `subjectRef`
- `actorRef`
- `deviceRef` when applicable
- `resourceRef` when applicable
- `action`
- `scope`
- `status`
- `reasonCodes`
- `evidenceRefs`
- `createdAt`
- `expiresAt` when applicable
- `privacy`

Decision records must be safe to display and log. Private evidence bodies, private user preferences, and decrypted content must not be embedded in public or bridge-visible decision records.

## Policy language direction

The first implementation should use a small typed TypeScript policy evaluator with explicit functions and exhaustive tests. This avoids prematurely embedding a complex policy runtime before protocol evidence types are stable.

The engine should be designed so later policy evaluation can migrate to one of these without changing protocol evidence semantics:

- CEL-like expression evaluation for simple deterministic policies,
- Cedar-like authorization policies for principal/action/resource/context decisions,
- Rego/OPA-like policies for richer local or bridge policy modules,
- signed WASM policy modules only after sandboxing, determinism, resource limits, and compatibility tests exist.

The first implementation must not allow arbitrary user-supplied JavaScript policy execution.

## Scope

This decision applies to:

- `packages/trust-policy` or a `trust-policy` module inside the future `packages/trust-safety`,
- identity/device/capability authorization decisions,
- VC issuer reliance policy,
- local user controls and trust preferences,
- bridge/relay/super-peer admission decisions,
- future ML risk-signal consumption,
- future group/MLS admission decisions,
- test fixtures for valid/invalid trust decisions.

This decision does not apply to:

- implementing full ML classifiers immediately,
- implementing blockchain smart contracts,
- implementing public transparency logs immediately,
- replacing identity-control logic,
- replacing private payload encryption,
- making local user trust decisions public by default,
- giving VCs or ML labels automatic enforcement authority.

## Options considered

### Option A: Global reputation score

Pros:

- easy to explain,
- easy to rank with,
- familiar from platform reputation systems.

Cons:

- conflicts with local-first control,
- leaks social/trust graphs,
- collapses contextual trust into a misleading number,
- easy to game,
- unsafe for device/group/transport authority.

### Option B: ML-first trust classifier

Pros:

- can detect patterns humans miss,
- useful for spam, impersonation, and abuse risk.

Cons:

- hard to explain,
- brittle under adversarial input,
- unsuitable for granting authority,
- can hide policy decisions inside model behavior,
- difficult to reproduce across offline/local peers.

### Option C: Blockchain/smart-contract-first trust system

Pros:

- deterministic execution,
- public auditability for selected use cases,
- shared state when global consensus is truly needed.

Cons:

- adds latency, cost, privacy leakage, public metadata, operational dependency, and global-consensus assumptions,
- poor fit for private local-first messaging and private user trust controls,
- not needed for first implementation.

### Option D: Deterministic local policy engine with signed evidence and optional ML risk signals (chosen)

Pros:

- matches local-first and hybrid P2P architecture,
- keeps authority explainable and testable,
- supports VCs without treating credentials as magic trust,
- supports object capabilities as scoped authorization,
- lets bridges/relays/super-peers protect themselves without becoming global authorities,
- can evolve toward portable signed policy bundles or WASM modules later.

Cons:

- more schema work up front,
- requires careful reason codes and UI explanations,
- requires fixture discipline and projection tests,
- requires strict privacy separation between local decisions and shared evidence.

## Security and privacy impact

Private data affected:

- user trust preferences,
- issuer trust lists,
- local overrides,
- contact verification state,
- local block/mute/hide state,
- private report/evidence references,
- device trust state,
- relay/super-peer usage history.

Metadata exposed when shared:

- decision reason codes,
- policy version refs,
- subject refs,
- authority refs,
- redacted evidence refs,
- expiration timestamps,
- transport-admission status.

New trust assumptions:

- local policy code is correct and deterministic,
- issuer trust configuration is not poisoned,
- capability and revocation projections are current enough for the decision context,
- ML risk signals are treated as advisory only,
- bridge/relay/super-peer policy decisions are scoped to their own infrastructure.

Abuse/failure modes:

- policy poisoning,
- malicious issuer trust configuration,
- stale revocation state,
- replayed decisions,
- confusing local quarantine with global deletion,
- ML risk label overreach,
- report brigading,
- compromised moderator/admin device,
- relay/super-peer self-protection misrepresented as universal judgment,
- private trust graph leakage.

Required tests:

- deny invalid object signatures,
- deny revoked device actions,
- deny expired/revoked capabilities,
- ignore valid VCs from untrusted issuers for authority elevation,
- accept trusted issuer claims only for configured claim/scope pairs,
- preserve ML risk as advisory only,
- keep local trust preferences private by default,
- prevent bridge-local decisions from being interpreted as global deletion,
- ensure deterministic replay of decisions from the same evidence and policy version,
- reject unsupported policy/evidence major versions.

## Migration and compatibility

Existing code affected:

- `packages/identity` for reusing device/capability authorization evidence,
- `packages/protocol` for trust-policy event kinds and decision records,
- `packages/local-store` for trust evidence and projection tables,
- `packages/sync-client` for applying trust gates before outbound delivery and inbound persistence/display,
- `apps/bridge-service` for scoped admission/quarantine decisions,
- future `packages/trust-safety` for labels/reports/curation objects,
- future `packages/content-addressing` for evidence refs and object refs,
- future VC/credential package or module.

Storage migration needed:

- yes, when implementing local trust evidence/projection tables.

Fixture updates needed:

- valid/invalid trust evidence fixtures,
- valid/invalid policy decision fixtures,
- issuer trust policy fixtures,
- VC reliance fixtures,
- ML advisory signal fixtures,
- bridge-local admission fixtures.

Full-peer compatibility notes:

- full peers must be able to evaluate the same policy inputs locally,
- bridges/relays/super-peers may run stricter local policies for self-protection,
- local user trust state must remain private unless explicitly exported,
- policy decisions must not depend on browser-only APIs.

## Exit criteria

This ADR is implemented when:

- [ ] `docs/implementation/local-first-trust-policy-engine-plan.md` exists.
- [ ] A pure trust-policy package or module exists with typed inputs and outputs.
- [ ] The engine evaluates identity/device/capability evidence deterministically.
- [ ] Issuer trust policy exists for VC reliance decisions.
- [ ] Valid and invalid fixtures cover device, capability, issuer, VC, ML advisory, and bridge-local decisions.
- [ ] Local-store tables preserve trust evidence and derived projections separately.
- [ ] Sync/bridge gates consume trust decisions without treating bridge decisions as global state.
- [ ] Tests prove replay determinism and fail-closed authority behavior.
