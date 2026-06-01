# Phase Exit Report: Phase 1.61 — Trust & Safety Protocol Core

- Status: Accepted as foundation-only / partial (see Decision)
- Date: 2026-05-31
- Related ADRs:
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
  - `docs/adr/005-content-addressing-and-object-references-v1.md`
- Related protocol docs:
  - `docs/protocol/trust-safety-event-policy.md`
  - `docs/protocol/content-addressing.md`
- Related threat models:
  - `docs/threat-model/trust-safety-and-abuse.md`
  - `docs/threat-model/content-addressing-abuse.md`
- Related implementation docs:
  - `docs/implementation/trust-safety-phase-plan.md`
- Related PRs: the commit landing this report

## Phase scope

Phase 1.61 was a pure protocol/type/validator phase. It was supposed to:

- Ship `packages/trust-safety` exposing validators for every core trust-and-safety object family declared by the T&S event policy (`SafetyAuthority`, `SafetySubjectRef`, `SafetyAnnotation`, `SafetyLabelDefinition`, `SafetyLabel`, `SafetyLabelerProfile`, `SafetyLabelerSubscription`, `SafetyReport`, `SafetyAppeal`, `SafetyPolicyDecision`, `TransportAdmissionDecision`, `CurationRule`, `CurationExplanation`).
- Build on `@lfp2p/content-addressing` for `ObjectRef`/`BlockRef`/`DigestRef` integration so safety subjects and evidence refs use the shared content-addressing vocabulary rather than inventing parallel hash/blob types.
- Define stable extension points (`CapabilityProofRef`, `CredentialRef`, `ActorRef`, `ReporterRef`) that fail safely when proofs are required but unavailable.
- Provide valid and invalid fixture coverage with adversarial cases including: unknown major version, unsupported enums, missing required fields, malformed object refs, private-subject + public-scope routing, action/scope mismatch (e.g. `reject-transport` outside transport scope), hard-safety downgrade, curation/moderation masquerade.
- Implement zero runtime moderation behavior.

## Completed work

`packages/trust-safety` now contains:

- Stable error codes (29 `TS_*` codes) on `TrustSafetyError` for caller branching, deliberately namespaced so they cannot collide with `CA_*` content-addressing errors.
- Validation helpers: `assertExactVersion` (fail-closed on unknown versions per doctrine), `assertIso8601` with timezone requirement and 2020–2126 sanity window, `assertNotBefore` for chronologically ordered timestamps, `assertOneOf` for enum membership, `assertId`/`assertText` with bounded length and control-character rejection, `assertReadonlyArray` with per-element validator and length caps, `assertFiniteNumberInRange` for confidence-style fields.
- Reserved extension-point refs (`ActorRef`, `ReporterRef`, `CapabilityProofRef`, `CredentialRef`) validated by shape only; runtime authority elevation is the future trust-policy engine's job (ADR-006).
- `SafetyAuthority` with version pinning, scope allowlist (8 scopes), role allowlist (10 product roles), optional `resourceRef` (validated as a content-addressing `ObjectRef`), optional capability proofs / credential refs (count-capped), optional expiry with `createdAt <= expiresAt` cross-check.
- `SafetySubjectRef` as a 14-variant discriminated union; unknown variants fail closed. URL subjects must be http(s) and credentialless (rejects `https://user:pass@…`), oversize URLs rejected, domain subjects validated and lowercased, control characters rejected in opaque ids.
- `SafetyAction` enum split into moderation, curation, and neutral (`allow`) groups with cross-validation (`assertActionScopeCompatible`): `reject-transport` requires a transport scope; curation actions cannot be issued at transport or network-advisory scope.
- `SafetyLabelDefinition` with category/severity/action enums, namespace + label-key regex enforcement, hard-safety downgrade rejection (`hardSafety=true` cannot pair with `defaultAction: allow|downrank`, and cannot be `userConfigurable`).
- `SafetyLabel` with confidence bounded to `[0, 1]` finite, evidence-ref count cap, and **private-by-nature subject + public-scope rejection** (`TS_PRIVATE_LEAK`): a label about a private blob/media/thread cannot be issued at `index-local` or `network-advisory` scope.
- `SafetyLabelerProfile` with service endpoint validated as https with no userinfo (`TS_PRIVATE_LEAK` on credential leak), namespace/label arrays count-capped, `createdAt <= updatedAt` cross-check.
- `SafetyLabelerSubscription` whose `scope` is restricted to local scopes only (no `network-advisory`) and whose action overrides are validated against a known-safe action subset.
- `SafetyAnnotation` with motivation/body/format enums and the same private-subject + public-scope leak guard.
- `SafetyReport` with required `idempotencyKey` (length-capped), reason-code allowlist, reporter privacy enum, target authority validation, and the private-subject + public-scope leak guard.
- `SafetyAppeal` targeting a `decisionId` (not a label), with `idempotencyKey` and `reasonCode` length bounds.
- `SafetyPolicyDecision` with action/scope cross-validation and private-subject leak guard. `appealable` is required and must be a boolean (no `appealable: 'yes'` smuggling).
- `TransportAdmissionDecision` requiring an infrastructure operator authority (rejects `community-local` or any non-transport scope as `operatorAuthority.scope`) and cross-checking surface against scope (bridge surface requires bridge-local scope, etc.).
- `CurationRule` and `CurationExplanation` with `TS_CURATION_MASQUERADE` rejection if a moderation action name appears in either — the protocol cannot silently hide/remove content under a "curation" label.
- Stable reason-code allowlist (`SAFETY_REASON_CODES`, 33 codes) covering abuse, security, media safety, legal risk, quality, context, and system categories.
- 18 valid + 15 invalid fixtures covering every required category from the plan, plus a fixtures loader test that asserts every documented fixture exists and is consumed by the matching validator.
- 137 tests across 12 module test files including adversarial cases: unknown major version, unsupported enums, missing required fields, malformed ObjectRef integration, URL credential injection, javascript: URL rejection, oversize URLs, private-subject + public-scope rejection in labels / annotations / reports / decisions, `reject-transport` at non-transport scope, curation action at transport scope, curation masquerade in rule + explanation, hard-safety + permissive default rejection, hard-safety + userConfigurable rejection, expiry-before-creation, oversize array caps, NaN/Infinity confidence rejection.

The package depends only on `@lfp2p/content-addressing` and `node:fs`/`node:path` in the test loader. No dependency on UI, bridge runtime, local-store, sync-client, media runtime, or any moderation runtime.

## Tests and verification

```bash
pnpm lint        # clean
pnpm typecheck   # clean
pnpm test        # 522 passing (137 in trust-safety)
pnpm build       # clean
```

Additional verification:

- Cross-package integration verified: T&S validators delegate `ObjectRef`/`BlockRef`/`DigestRef` validation to `@lfp2p/content-addressing`. Adversarial inputs propagate `CA_*` errors with their original codes (verified by the fixtures loader test).
- Privacy cross-checks (private subject in public flow) verified independently in labels, annotations, reports, and policy decisions.
- Action/scope cross-checks verified by direct positive and negative tests in `policy-decisions.test.ts`.

## Acceptance criteria

From `docs/implementation/trust-safety-phase-plan.md` Phase 1.61 exit criteria:

| Criterion | Status | Evidence |
|---|---:|---|
| Validators reject malformed authorities, scopes, labels, reports, decisions, and object refs | ✓ | `authorities.test.ts`, `subjects.test.ts`, `labels.test.ts`, `reports.test.ts`, `policy-decisions.test.ts` |
| Fixtures exist for all core objects | ✓ | 18 valid fixtures under `fixtures/valid/` |
| Invalid fixtures test unknown major versions, missing required fields, unsupported enums, malformed object refs, and unsafe private/public routing | ✓ | 15 invalid fixtures under `fixtures/invalid/`; loader test asserts all are rejected with the appropriate `TS_*` or `CA_*` code |
| No runtime moderation behavior exists yet | ✓ | package is types + validators only; no projection tables, no UI, no bridge runtime |

## Security/privacy checks

- [x] No private plaintext in logs — the package emits no logs; validators throw error messages that include field labels and shape information but never include the rejected value verbatim.
- [x] Remote/untrusted input validation exists — every public `validate*` entry point uses `assertPlainObject` first, then validates each field with explicit branches; unknown enum values, unknown subject types, unknown actions, and unknown major versions all fail closed.
- [x] Malicious/invalid input tests exist — 60+ adversarial tests including URL credential injection, javascript: URL rejection, prototype-pollution attempts (inherited from `@lfp2p/content-addressing`'s canonical JSON), oversized arrays, expiry-before-creation, hard-safety downgrade, curation/moderation masquerade.
- [x] Revocation/permission behavior — extension points (`capabilityProofs`, `credentialRefs`) are reserved with shape-only validation; the package does not elevate authority based on either, satisfying the "fail safely when proofs are required but unavailable" rule. Real revocation depends on identity-control runtime (ADR-001) and trust-policy engine (ADR-006).
- [x] Derived state rebuild/delete behavior — N/A; package is stateless.

## Deviations introduced or resolved

- `SafetyLabel` does not carry an `action` field; the T&S event policy assigns label-level actions to the *definition*, with the label inheriting via `defaultAction`. The validator therefore does not cross-check action/scope on labels themselves — that check lives on `SafetyPolicyDecision` and on label-definition `hardSafety` rules.
- `SafetyLabelerSubscription.scope` is intentionally narrower than the full `EnforcementScope` enum: subscriptions are strictly local concerns (no `network-advisory`).
- The reason-code list is opinionated. Free-form reason text belongs in encrypted body fields (`encryptedBodyRef`), not in the public `reasonCode` slot — this matches the policy doc's "structured, neutral codes" guidance and reduces inadvertent PII in analytics.

## Remaining gaps

The following are out of scope for Phase 1.61 and tracked for later phases per the plan:

- Phase 1.62 (Local user controls): event types like `safety.account.blocked`, projection tables, and private-by-default sync rules.
- Phase 1.63 (Reports/appeals/encrypted evidence): encrypted evidence routing implementation, idempotency-key uniqueness enforcement at the projection layer, target-authority resolution.
- Phase 1.64 (Bridge/relay/super-peer admission runtime): admission decision emission, replay protection at the bridge, DLQ/quarantine surfaces.
- Phase 1.65 (Curation and reach): runtime curation explanation generation, public surface privacy enforcement.
- Trust-policy engine (Phase 1.63 in the larger plan, ADR-006): turns validated evidence into deterministic decisions; this package only ships the evidence shapes.
- Capability/credential verification: shape-only refs today; full UCAN-style verification depends on a future capability ADR.

## Decision

This phase is:

- [ ] accepted as complete,
- [x] accepted as foundation-only / partial,
- [ ] blocked,
- [ ] superseded by another phase.

Reason:

The Phase 1.61 plan deliverables are met: `packages/trust-safety` is shipped with validators for all 15 protocol object families, the fixture suite covers the required categories, the adversarial test suite passes locally (522 tests across the monorepo), and the package consumes `@lfp2p/content-addressing` rather than reinventing object refs.

The phase is marked **foundation-only / partial** rather than fully Complete because runtime behavior (the actual user-controls, report routing, bridge admission, curation enforcement) is intentionally deferred to phases 1.62–1.65. Calling this slice "Complete" would overstate the integration depth. "Foundation-only" matches the doctrine and the plan.
