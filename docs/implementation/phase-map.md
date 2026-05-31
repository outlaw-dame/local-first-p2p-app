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
<<<<<<< HEAD
| Phase 1 - Protocol primitives and canonical fixtures | Partial | `SignedEventEnvelope`, `UnsignedEventEnvelope`, `SourceRef`, canonical JSON helper, validation helpers, and protocol fixture policy. | Initial golden fixtures, independent hash/signature verification paths, unknown-version policy, negative fixture suite. |
| Phase 1.56 - Content addressing and object references | Needs implementation | ADR-005, `docs/protocol/content-addressing.md`, `docs/threat-model/content-addressing-abuse.md`, and `docs/implementation/phase-1.56-content-addressing-plan.md` now define the model. | `packages/content-addressing`, validators, fixtures, tests, and integration into T&S/media/bridge planning. |
| Phase 1.6 - Trust & Safety doctrine and protocol boundaries | Needs implementation | ADR-004, `docs/protocol/trust-safety-event-policy.md`, `docs/threat-model/trust-safety-and-abuse.md`, and `docs/implementation/trust-safety-phase-plan.md` now define the model. | `packages/trust-safety`, validators, fixtures, local user controls, reports/appeals, bridge admission, and curation slices. |
=======
| Phase 1 - Protocol primitives and canonical fixtures | Partial | `SignedEventEnvelope`, `UnsignedEventEnvelope`, `SourceRef`, canonical JSON helper, `@lfp2p/content-addressing` digest primitives (DigestRef, ContentLink, BlockRef, ObjectRef, BundleRef), validation helpers, and protocol fixture policy. | Initial golden fixtures, independent hash/signature verification paths, unknown-version policy, negative fixture suite. |
| Phase 1.56 - Content addressing and object references | Partial | `@lfp2p/content-addressing` package with canonical JSON hashing, digest refs, reference builders, validators, versioning constant, and test coverage. | App-specific schemas, CID wrappers, storage adapters, multi-node location hints, protocol integration with event objects, and fixture golden set. |
| Phase 1.6 - Trust & Safety doctrine and protocol boundaries | Needs implementation | ADR-004, `docs/protocol/trust-safety-event-policy.md`, `docs/threat-model/trust-safety-and-abuse.md`, and `docs/implementation/trust-safety-phase-plan.md` now define the model. | `packages/trust-safety`, validators, fixtures, local user controls, reports/appeals, bridge admission, and curation slices. |
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
- **Phase 1.56 planned**: content-addressing and object-reference docs exist, but the package/fixtures/tests are not implemented yet.
- **Phase 1.6 planned**: trust and safety docs exist, but the protocol package/runtime slices are not implemented yet.
- **Phase 3 foundation complete enough**: the PWA can create signed local events and queue outbox writes.
- **Phase 4 partial**: bridge transport and bridge stores exist, but production infrastructure, sync offsets, and T&S admission controls are not complete.

## Recommended next phase label

Use this working label for the next development cycle:

> **Phase 1.5 / 3.5 - Doctrine alignment and protocol hardening before feature expansion**

This cycle should use the newly added scaffolding and complete the remaining guardrails before adding chat/media/search breadth.

The new content-addressing and trust/safety docs add two explicit gates inside this cycle:

1. **Phase 1.56 - Content Addressing and Object Reference Model**
2. **Phase 1.6 - Trust & Safety Doctrine and Protocol Safety Boundaries**

## Next required gates

1. Record ADR-000 for the runtime/product decision.
2. Add an explicit schema/storage versioning policy.
3. Add initial protocol event fixtures and tests under the fixture policy.
4. Add current bridge compromise threat-model note.
5. Add sync offset/checkpoint design before implementing Durable Streams/WebSocket readers.
6. Expand identity-control implementation from ADR-001 into protocol fixtures and projection logic.
7. Expand payload encryption implementation from ADR-002 into envelope schema, fixtures, and enforcement.
8. Implement Phase 1.56: `packages/content-addressing`, validators, fixtures, and tests.
9. Implement Phase 1.6/1.61: `packages/trust-safety`, validators, fixtures, and tests.
10. Implement local user controls before networked moderation queues or public labelers.
11. Implement report/appeal/evidence refs before public media, search, social outbox, or production bridge deployment.

## Development warning

Do not interpret the current local device identity implementation as the full identity architecture. It is an early local bootstrap slice. The doctrine-level identity model still requires root/controller authority, device delegations, revocation, capabilities, and epochs.

Do not interpret content addressing as IPFS adoption. CIDs/content links are identifier semantics, not network/storage authority.

Do not interpret trust and safety as a centralized global moderation service. T&S decisions are scoped, auditable, and tied to local user policy, community policy, infrastructure self-protection, and future capability/credential authority.
