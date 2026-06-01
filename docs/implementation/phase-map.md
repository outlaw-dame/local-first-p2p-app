# Phase Map

This document reconciles the original Implementation Doctrine with what has actually been built so far.

The doctrine remains the target build-order authority. The code did not follow the doctrine order exactly because the repository first established a PWA/local-store/outbox/bridge foundation. That is acceptable as long as the deviation is explicit and future phases add the missing doctrine gates instead of drifting further.

## Status legend

- **Done for foundation**: enough exists for the current early foundation.
- **Partial**: a first slice exists, but doctrine-level scope is not complete.
- **Not started**: no meaningful implementation yet.
- **Deferred**: intentionally later.
- **Needs ADR**: more code should not proceed until a decision is recorded.

## Doctrine phase mapping

| Doctrine phase | Current status | Evidence in current code/docs | Gap before phase can be called complete |
|---|---:|---|---|
| Phase 0 - Doctrine, repo discipline, ADRs | Partial | Monorepo, CI, lint/typecheck/test/build, planning docs organized, ADR template, threat-model template, exit-report template, and protocol fixture policy added. | Explicit schema/storage versioning policy, ADR-000 runtime decision, and consistent use of exit reports on future phase claims. |
| Phase 1 - Protocol primitives and canonical fixtures | Partial | `SignedEventEnvelope`, `UnsignedEventEnvelope`, `SourceRef`, canonical JSON helper, `@lfp2p/content-addressing` digest primitives (DigestRef, ContentLink, BlockRef, ObjectRef, BundleRef), validation helpers, and protocol fixture policy. | Initial golden fixtures, independent hash/signature verification paths, unknown-version policy, negative fixture suite. |
| Phase 1.56 - Content addressing and object references | Foundation complete (package + parser shipped; integration deferred per plan) | `@lfp2p/content-addressing`: errors module with stable codes, hardened canonical JSON (prototype-pollution-safe, depth-bounded), `DigestRef` with algorithm-pinned length, BLAKE3 reserved in type system (fail-closed locally), CIDv1-only `ContentLink` with real multihash/multicodec binary parsing (varint + base32-lower + base16 decoders, multihash code allowlist with declared-length cross-check, trailing-byte rejection), `StorageLocationHint` with 13-kind enum and URL credential rejection, `BlockRef` with required encryption descriptor for private content and bounded compression descriptor (rejects bombs by ratio and absolute decoded size), `BundleRef` with format/purpose enums and non-empty roots, 12-kind discriminated `ObjectRef`, redaction helpers, 23-file fixture suite (11 valid + 12 invalid), 179 tests including 70+ adversarial cases. Exit report at `docs/implementation/phase-1.56-exit-report.md`. | Downstream integration: BLAKE3 runtime (needs ADR), full multibase decoders for `z` / `k` prefixes, application schemas built on these refs (belongs to 1.6/7/9), storage adapter wiring (belongs to 4/7/13), direct integration into `packages/protocol` envelopes (Step 2 of plan, intentionally deferred). |
| Phase 1.6 - Trust & Safety doctrine and protocol boundaries | Foundation complete (docs shipped; runtime split into 1.62–1.65) | ADR-004, `docs/protocol/trust-safety-event-policy.md`, `docs/threat-model/trust-safety-and-abuse.md`, `docs/implementation/trust-safety-phase-plan.md`. | Runtime slices live in phases 1.62 (local controls), 1.63 (reports/appeals), 1.64 (bridge admission), 1.65 (curation). |
| Phase 1.61 - Trust & Safety protocol core | Foundation complete (package shipped; runtime deferred per plan) | `@lfp2p/trust-safety`: stable `TS_*` errors, version-pinning validators that fail closed on unknown major versions, `SafetyAuthority` with scope/role/expiry cross-checks, 14-variant `SafetySubjectRef` (rejects URL credential injection, javascript: URLs, oversize URLs), `SafetyAction` split into moderation/curation/neutral with action-scope cross-validation (`reject-transport` requires a transport scope; curation actions cannot run at transport/network-advisory scope), `SafetyLabel` with confidence `[0,1]` and private-subject + public-scope leak rejection, `SafetyLabelDefinition` with hard-safety downgrade rejection (hardSafety cannot pair with permissive defaultAction or with userConfigurable), `SafetyLabelerProfile` with https-only credentialless service endpoint, `SafetyReport` with required idempotency key and private-subject + public-scope leak rejection, `SafetyAppeal` targeting decisions, `SafetyPolicyDecision` with action/scope and private-subject cross-checks, `TransportAdmissionDecision` requiring infrastructure operator authority with surface/scope cross-check, `CurationRule` + `CurationExplanation` with `TS_CURATION_MASQUERADE` rejection so moderation actions cannot smuggle in via curation. Consumes `@lfp2p/content-addressing` for `ObjectRef`/`BlockRef`/`DigestRef`. 18 valid + 15 invalid fixtures, 137 tests including adversarial cases. Exit report at `docs/implementation/phase-1.61-exit-report.md`. | Phase 1.62 local user controls, Phase 1.63 reports/appeals runtime, Phase 1.64 bridge admission runtime, Phase 1.65 curation runtime, capability/credential verification, identity-control authority resolution. |
| Phase 2 - Identity control log v1 | Partial/early | Local device identity bootstrap exists with encrypted private-key material. ADR-001 records root/controller identity and identity-control model constraints. | Root/controller identity events, projection, device add/revoke/rotate implementation, capabilities, epochs, contact card. |
| Phase 3 - PWA light peer foundation | Done for foundation | Framework7 PWA shell, Dexie store, local signing, local event append, local view summary, mutation outbox. | Service worker, privacy-safe logging policy, local view rebuild tests, resume/network retry wiring. |
| Phase 4 - Bridge and infrastructure classes v1 | Partial | Bridge service primitives, request handler, signature verification, bridge-safe scope checks, in-memory/JSON/PGlite stores, HTTP sync-client transport. | Production bridge runtime, auth/rate limiting, encrypted mailbox/resumable stream, offsets/cursors, bridge compromise threat model, T&S admission policy. |
| Phase 5 - Chat vertical slice | Not started | Protocol has placeholder event kinds but no room model. | Room metadata/events, deterministic room view, private plaintext prohibition, bridge-delivered room updates, T&S local controls/reporting gates. |
| Phase 6 - MLS private group encryption v1 | Not started | No MLS code. | MLS library evaluation, virtual Delivery Service ADR, control log, fork detection, PWA client constraints, report/evidence path for encrypted groups. |
| Phase 7 - Media manifests and chunked storage v1 | Not started | No media manifest or media package yet. | Manifest v1 built on `BlockRef`/`ObjectRef`, image pipeline, storage abstraction, private/public replication policy, hash/CID validation, media safety/quarantine policy. |
| Phase 8 - Ephemeral presence plane | Not started | No presence model. | TTL events outside durable logs, rate limiting, stale sequence handling, WebRTC/bridge fallback policy. |
| Phase 9 - Social outbox v1 | Not started | Only local outbox test events exist. | Public outbox event model, post/comment/reaction/follow/repost events, backlinks, spam/quarantine buckets, T&S/reach controls. |
| Phase 10 - Human naming and NIP-05-like proofs | Not started | Protocol includes `contact.petname.set`, but no storage/UI/name proof model. | Petname book, contact cards, namespaces, reciprocal claims, expiration/revocation, anti-phishing UI, T&S impersonation handling. |
| Phase 11 - Local search and intelligence v1 | Partial/early | PGlite search projection and basic escaped text search. | SearchObject, source provenance via `ObjectRef`, permissions, proper lexical ranking, semantic adapter, embedding lifecycle, hybrid fusion, curation/exclusion controls. |
| Phase 12 - Compression, chunking, and dedupe | Not started | No compression descriptors. | CompressionDescriptor ADR, zstd/gzip policy, decoded-size limits, dictionary trust rules, dedupe-scope policy, integration with `BlockRef`. |
| Phase 13 - Native/Bare full peer prototype | Deferred | Repo boundaries are future-compatible but no full peer implementation exists. | Corestore/Hypercore/Autobase/Hyperbee/Hyperdrive/Hyperswarm adapter prototype and compatibility fixtures using protocol-level refs, not backend-specific identities. |
| Phase 14 - Hardening and beta readiness | Not started | Some bridge/outbox hardening exists. | Threat models, malicious peer tests, network partition tests, media abuse tests, revocation chaos tests, rollback/migration plan. |

## Practical current phase

The repository is effectively between:

- **Phase 0 partial**: process scaffolding now exists, but ADR-000 and explicit versioning policy still need to be written.
- **Phase 1 partial**: protocol primitives exist but initial fixture discipline is not yet implemented in tests.
- **Phase 1.56 foundation complete**: `@lfp2p/content-addressing` shipped with errors, hardened canonical JSON, algorithm-pinned `DigestRef`, BLAKE3 reservation, CIDv1 binary parsing (multibase decode → version → multicodec → multihash with declared-length cross-check → no trailing bytes), `StorageLocationHint`, `BlockRef`, `BundleRef`, 12-kind `ObjectRef`, redaction. 179 tests including 70+ adversarial cases; 23-file fixture suite. Exit report: `docs/implementation/phase-1.56-exit-report.md`. Downstream integration (BLAKE3 runtime, protocol-envelope wiring, T&S/media/bridge consumption) is intentionally deferred to later phases per the plan's integration sequence.
- **Phase 1.6 / 1.61 foundation complete**: `@lfp2p/trust-safety` shipped with stable `TS_*` errors, version-pinning validators (fail-closed on unknown major versions), `SafetyAuthority` with scope/role/expiry cross-checks, 14-variant `SafetySubjectRef` (rejects URL credential injection / javascript: URLs / oversize URLs), `SafetyAction` split into moderation vs curation with action/scope cross-validation, hardened `SafetyLabel`/`SafetyLabelDefinition`/`SafetyLabelerProfile`/`SafetyLabelerSubscription`/`SafetyAnnotation`/`SafetyReport`/`SafetyAppeal`/`SafetyPolicyDecision`/`TransportAdmissionDecision`/`CurationRule`/`CurationExplanation`. Privacy guards reject private-by-nature subjects at public scopes. Curation masquerade guard prevents moderation actions sneaking in via curation. 18 valid + 15 invalid fixtures; 137 tests including adversarial cases. Exit report: `docs/implementation/phase-1.61-exit-report.md`. Runtime slices (1.62 local controls, 1.63 reports/appeals, 1.64 bridge admission, 1.65 curation) intentionally deferred per the plan.
- **Phase 3 foundation complete enough**: the PWA can create signed local events and queue outbox writes.
- **Phase 4 partial**: bridge transport and bridge stores exist, but production infrastructure, sync offsets, and T&S admission controls are not complete.

## Recommended next phase label

Use this working label for the next development cycle:

> **Phase 1.5 / 3.5 - Doctrine alignment and protocol hardening before feature expansion**

This cycle should use the newly added scaffolding and complete the remaining guardrails before adding chat/media/search breadth.

The content-addressing and trust/safety docs define two explicit gates inside this cycle:

1. **Phase 1.56 - Content Addressing and Object Reference Model** (foundation complete — package done, downstream integration deferred)
2. **Phase 1.6 / 1.61 - Trust & Safety Protocol Core** (foundation complete — package done, runtime deferred to 1.62–1.65)

## Next required gates

1. Record ADR-000 for the runtime/product decision.
2. Add an explicit schema/storage versioning policy.
3. Add initial protocol event fixtures and tests under the fixture policy.
4. Add current bridge compromise threat-model note.
5. Add sync offset/checkpoint design before implementing Durable Streams/WebSocket readers.
6. Expand identity-control implementation from ADR-001 into protocol fixtures and projection logic.
7. Expand payload encryption implementation from ADR-002 into envelope schema, fixtures, and enforcement.
8. Complete Phase 1.56: app-specific schemas, CID wrappers, storage adapters, protocol event integration, and golden fixture set. (`packages/content-addressing` core is done.)
9. ~~Implement Phase 1.6/1.61: `packages/trust-safety`, validators, fixtures, and tests.~~ Done — see `docs/implementation/phase-1.61-exit-report.md`.
10. Implement Phase 1.62 local user controls before networked moderation queues or public labelers.
11. Implement Phase 1.63 report/appeal/evidence refs before public media, search, social outbox, or production bridge deployment.

## Development warning

Do not interpret the current local device identity implementation as the full identity architecture. It is an early local bootstrap slice. The doctrine-level identity model still requires root/controller authority, device delegations, revocation, capabilities, and epochs.

Do not interpret content addressing as IPFS adoption. CIDs/content links are identifier semantics, not network/storage authority.

Do not interpret trust and safety as a centralized global moderation service. T&S decisions are scoped, auditable, and tied to local user policy, community policy, infrastructure self-protection, and future capability/credential authority.
