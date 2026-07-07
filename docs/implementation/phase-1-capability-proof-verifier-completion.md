# Phase 1 Capability Proof Verifier Completion

- Status: Draft
- Date: 2026-06-24
- Scope: capability proof verifier registry completion state after PRs #79, #85, #86, #87, and #89

## Purpose

This document records the current verifier registry state so future protocol work can rely on accurate scheme behavior instead of stale roadmap assumptions.

Phase 0 originally captured the native + UCAN + VC state, but later verifier work also added zcap-ld and bearcap support. This document supersedes that narrow Phase 0 verifier snapshot.

## Current scheme matrix

| Scheme                 | Package                        | Current verdict behavior                                    | Authority strength                     | Notes                                                                                                                                                                                                                                |
| ---------------------- | ------------------------------ | ----------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `native-signed-event`  | `@lfp2p/native-proof-verifier` | `verified`, `invalid`, or abstain                           | Cryptographic authority when verified  | Uses caller-resolved signed event bytes and verifies the signed event envelope. Other schemes abstain. Missing bytes abstain rather than poison native proofs.                                                                       |
| `ucan`                 | `@lfp2p/ucan-verifier`         | `verified`, `invalid`, or abstain                           | Cryptographic authority when verified  | Supports bounded JWT-shape UCAN with Ed25519 `did:key` issuers and inline JWT proof chains. Unsupported algorithms, DID methods, malformed chains, or missing claimed bytes fail closed as invalid.                                  |
| `vc`                   | `@lfp2p/vc-verifier`           | `verified`, `invalid`, or abstain                           | Cryptographic authority when verified  | Supports W3C VC `DataIntegrityProof` with `eddsa-jcs-2022`, `did:key` issuers/verification methods, JCS canonicalization, and no network status-list lookup. Other VC proof types fail closed as invalid.                            |
| `zcap-ld`              | `@lfp2p/zcap-ld-verifier`      | `verified`, `invalid`, or abstain                           | Cryptographic authority when verified  | Supports a deliberately narrow zcap-ld path: inline parent capability chain, `DataIntegrityProof`, `eddsa-jcs-2022`, `did:key`, bounded depth, and no URDNA2015/context resolver. Other zcap-ld proof shapes fail closed as invalid. |
| `bearcap`              | `@lfp2p/bearcap-verifier`      | `possession-confirmed`, `invalid`, or abstain               | Not cryptographic authority            | Digest-match possession proof only. It must never return `verified`; the reliance gate must continue to treat `possession-confirmed` as insufficient for authority decisions.                                                        |
| `identity-control-log` | none                           | abstain / remains unverified                                | Planned / identity-control policy only | Valid proof scheme but no Phase 1 verifier package. Do not promote identity-control-log proofs to verified until a future ADR defines the verifier, replay bounds, and identity-control log binding rules.                           |
| `manual-local-policy`  | none                           | abstain / remains unverified unless handled by local policy | Local policy only                      | Registry should not promote this to cryptographic verification without a later doctrine.                                                                                                                                             |

## Registry invariants

The proof registry remains the canonical state machine for proof verification records.

Important invariants:

1. Registration does not imply verification.
2. Revocation and expiration are deterministic gates and win before cryptographic verification.
3. Unsupported schemes or non-owned schemes should abstain rather than falsely verify.
4. Once a verifier claims a scheme, malformed or unsupported data inside that scheme should fail closed as `invalid`.
5. `verified` must remain reserved for cryptographic identity-binding proof verification.
6. `possession-confirmed` is deliberately weaker than `verified` and must not satisfy authority reliance gates.
7. Verifier composition should use first non-`undefined` verdict wins.
8. Verifiers must stay synchronous and pure on inputs; no network lookup or context resolution in the verifier slot.

## zcap-ld decision

zcap-ld is implemented, but only for a restricted JCS-based profile.

The project should continue to avoid URDNA2015 / remote JSON-LD context resolution inside the current verifier slot. Supporting RDF dataset canonicalization or remote context loading would require a separate ADR because it changes the dependency, caching, availability, and determinism model.

Current zcap-ld support should be described as:

```txt
zcap-ld DataIntegrityProof + eddsa-jcs-2022 only
```

not as:

```txt
full zcap-ld / all Linked Data proof suites
```

## bearcap decision

Bearcap support exists, but it is intentionally not authority verification.

Bearcap verifier output is `possession-confirmed` only when the caller presents bytes matching the registry digest. That proves possession of the registered bytes, not identity binding or delegation authority.

The reliance gate must not treat `possession-confirmed` as equivalent to `verified`.

## identity-control-log decision

`identity-control-log` is a valid proof scheme, but it does not have a Phase 1 verifier package.

Keep it unverified until a future ADR defines exactly how identity-control log material is resolved, replayed, bounded, and bound to the proof registry record. That future work must not silently treat existence of an identity-control event as authority without checking identity state, device-key status, revocation, rotation, and replay ordering.

## Documentation corrections from Phase 0

Any docs saying `zcap-ld` and `bearcap` are merely abstaining are stale after PRs #87 and #89.

Correct wording:

```txt
native, UCAN, VC, and restricted zcap-ld can reach `verified`.
bearcap can reach `possession-confirmed`, never `verified`.
identity-control-log remains unverified until a future verifier ADR/package exists.
manual-local-policy remains local-policy-only unless a future ADR changes it.
```

## What is complete

Phase 1 verifier registry completion can be considered documented when:

- this scheme matrix is merged;
- current-state addendum is updated or superseded;
- tests remain green for native, UCAN, VC, zcap-ld, and bearcap verifier packages;
- reliance gates continue to require `verified` for authority decisions.

## Follow-up checks

Before Phase 2 starts, confirm:

1. `summarizeProofStates` still treats any non-`verified` state as weaker than authority-grade verification.
2. Bearcap-backed proofs remain forbidden or constrained for high-privilege action prefixes.
3. zcap-ld docs do not imply URDNA2015 support.
4. VC docs do not imply remote `credentialStatus` lookup.
5. UCAN docs do not imply CBOR / UCAN 0.10+ support.
6. Identity-control-log docs do not imply a verifier exists yet.
7. Verifier package exports do not leak network/client dependencies into `@lfp2p/capabilities`.

## Next phase

After this Phase 1 documentation lands, proceed to Phase 2: private/account-local payload envelope.
