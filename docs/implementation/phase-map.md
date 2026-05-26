# Phase Map

This document reconciles the original Implementation Doctrine with what has actually been built so far.

The doctrine remains the target build-order authority. The code did not follow the doctrine order exactly because the repository first established a PWA/local-store/outbox/bridge foundation. That is acceptable as long as the deviation is explicit and future phases add the missing doctrine gates instead of drifting further.

## Update addendum (2026-05-26)

The table below remains valid as the original reconciliation snapshot. Since then, additional controlled slices landed and should be considered when planning the next cycle:

- Phase 3/4 boundary progressed with a dev-only manual outbox delivery gate in PWA.
- Phase 3/4 boundary progressed with a client-side send budget guard for manual delivery attempts.
- Phase 4 boundary progressed with optional HTTP bearer-auth boundaries in bridge request handlers and corresponding PWA dev-auth config/transport support.
- UI-system work progressed with Apple-first Phase A token hardening.
- Phase 0 governance progressed with an explicit schema/storage versioning policy doc.
- Phase 1 guardrails progressed with an initial protocol fixture pack and negative fixture tests.
- Phase 4 guardrails progressed with a dedicated bridge compromise threat-model note.

These updates shift the highest-leverage next implementation focus to durable sync offsets/checkpoints before broader feature expansion.

## Status legend

- **Done for foundation**: enough exists for the current early foundation.
- **Partial**: a first slice exists, but doctrine-level scope is not complete.
- **Not started**: no meaningful implementation yet.
- **Deferred**: intentionally later.
- **Needs ADR**: more code should not proceed until a decision is recorded.

## Doctrine phase mapping

| Doctrine phase | Current status | Evidence in current code | Gap before phase can be called complete |
|---|---:|---|---|
| Phase 0 - Doctrine, repo discipline, ADRs | Partial | Monorepo, CI, lint/typecheck/test/build, planning docs organized, ADR template, threat-model template, exit-report template, and protocol fixture policy added. | Explicit schema/storage versioning policy, ADR-000 runtime decision, and consistent use of exit reports on future phase claims. |
| Phase 1 - Protocol primitives and canonical fixtures | Partial | `SignedEventEnvelope`, `UnsignedEventEnvelope`, `SourceRef`, canonical JSON helper, validation helpers, and protocol fixture policy. | Initial golden fixtures, independent hash/signature verification paths, unknown-version policy, negative fixture suite. |
| Phase 2 - Identity control log v1 | Partial/early | Local device identity bootstrap exists with encrypted private-key material. | Root/controller identity, identity control log, device add/revoke/rotate, capabilities, epochs, contact card. Needs ADR. |
| Phase 3 - PWA light peer foundation | Done for foundation | Framework7 PWA shell, Dexie store, local signing, local event append, local view summary, mutation outbox. | Service worker, privacy-safe logging policy, local view rebuild tests, resume/network retry wiring. |
| Phase 4 - Bridge and infrastructure classes v1 | Partial | Bridge service primitives, request handler, signature verification, bridge-safe scope checks, in-memory/JSON/PGlite stores, HTTP sync-client transport. | Production bridge runtime, auth/rate limiting, encrypted mailbox/resumable stream, offsets/cursors, bridge compromise threat model. |
| Phase 5 - Chat vertical slice | Not started | Protocol has placeholder event kinds but no room model. | Room metadata/events, deterministic room view, private plaintext prohibition, bridge-delivered room updates. |
| Phase 6 - MLS private group encryption v1 | Not started | No MLS code. | MLS library evaluation, virtual Delivery Service ADR, control log, fork detection, PWA client constraints. |
| Phase 7 - Media manifests and chunked storage v1 | Not started | No media manifest or media package yet. | Manifest v1, image pipeline, storage abstraction, private/public replication policy, hash validation. |
| Phase 8 - Ephemeral presence plane | Not started | No presence model. | TTL events outside durable logs, rate limiting, stale sequence handling, WebRTC/bridge fallback policy. |
| Phase 9 - Social outbox v1 | Not started | Only local outbox test events exist. | Public outbox event model, post/comment/reaction/follow/repost events, backlinks, spam/quarantine buckets. |
| Phase 10 - Human naming and NIP-05-like proofs | Not started | Protocol includes `contact.petname.set`, but no storage/UI/name proof model. | Petname book, contact cards, namespaces, reciprocal claims, expiration/revocation, anti-phishing UI. |
| Phase 11 - Local search and intelligence v1 | Partial/early | PGlite search projection and basic escaped text search. | SearchObject, source provenance, permissions, proper lexical ranking, semantic adapter, embedding lifecycle, hybrid fusion. |
| Phase 12 - Compression, chunking, and dedupe | Not started | No compression descriptors. | CompressionDescriptor ADR, zstd/gzip policy, decoded-size limits, dictionary trust rules, dedupe-scope policy. |
| Phase 13 - Native/Bare full peer prototype | Deferred | Repo boundaries are future-compatible but no full peer implementation exists. | Corestore/Hypercore/Autobase/Hyperbee/Hyperdrive/Hyperswarm adapter prototype and compatibility fixtures. |
| Phase 14 - Hardening and beta readiness | Not started | Some bridge/outbox hardening exists. | Threat models, malicious peer tests, network partition tests, media abuse tests, revocation chaos tests, rollback/migration plan. |

## Practical current phase

The repository is effectively between:

- **Phase 0 partial**: process scaffolding now exists, but ADR-000 and explicit versioning policy still need to be written.
- **Phase 1 partial**: protocol primitives exist but initial fixture discipline is not yet implemented in tests.
- **Phase 3 foundation complete enough**: the PWA can create signed local events and queue outbox writes.
- **Phase 4 partial**: bridge transport and bridge stores exist, but production infrastructure and sync offsets do not.

## Recommended next phase label

Use this working label for the next development cycle:

> **Phase 1.5 / 3.5 - Doctrine alignment and protocol hardening before feature expansion**

This cycle should use the newly added scaffolding and complete the remaining guardrails before adding chat/media/search breadth.

## Next required gates

1. Record ADR-000 for the runtime/product decision.
2. Add an explicit schema/storage versioning policy.
3. Add initial protocol event fixtures and tests under the fixture policy.
4. Add current bridge compromise threat-model note.
5. Add sync offset/checkpoint design before implementing Durable Streams/WebSocket readers.
6. Add identity-control ADR before expanding `packages/identity` beyond local device bootstrap.
7. Add payload encryption ADR before user-facing private chat or DM/group data can ship.

## Development warning

Do not interpret the current local device identity implementation as the full identity architecture. It is an early local bootstrap slice. The doctrine-level identity model still requires root/controller authority, device delegations, revocation, capabilities, and epochs.
