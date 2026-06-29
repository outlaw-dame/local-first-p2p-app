# Roadmap Ordering Reference

- Status: Draft
- Date: 2026-06-23
- Scope: local-first hybrid P2P protocol roadmap ordering

## Purpose

This document records the build order after the Phase 0 documentation review. It is an ordering reference, not a claim that later phases are implemented.

> **Relationship to phase-map.md**: This document uses a sequential Phase 1–25 numbering for the full long-run build order. `docs/implementation/phase-map.md` uses a versioned numbering (1.x, 2, 3, 4, 5.x) that tracks implementation status against doctrine. The two numbering schemes do not correspond 1:1. In particular, `phase-map.md` Phase 5 (the User Data Root / Selective Sync / Feeds / Mailbox / Spaces / FROST doctrine sequence — see `docs/implementation/phase-5-foundation-roadmap.md`) spans the portion of this document that runs from Phase 4.7 through approximately Phase 15. When reading this ordering reference, use the phase-map for implementation status and exit criteria.

## Current ordering principle

Build in this order:

```txt
authority and verifier foundations
→ private/account-local encryption envelope
→ MLS decision and group control records
→ bridge resumability
→ adaptive reachability descriptors
→ sync-client transport abstraction
→ bridge capability modules
→ WebRTC signaling
→ WebRTC DataChannel sync/event replication
→ WebRTC media tracks for voice/video
→ MLS-protected group messaging
→ encrypted mailbox
→ optional tunnel adapter
→ super-peer availability
→ P2P runtime adapter doctrine
→ optional content-addressed fetchers
→ temporary infrastructure flow
→ production bridge
→ full-peer/native runtime
→ Holepunch/Bare/Pear adapter
→ Hypercore/Corestore replication substrate
→ local discovery + HyperDHT + peer hints
→ peer-assisted bundle delivery
→ media, rooms, search, public/social runtime
→ semantic discovery protocol
→ semantic runtime evaluation
→ semantic runtime adapter interfaces
→ reference semantic implementation
```

## Phase 0 — documentation alignment

- Cleanly carry adaptive reachability docs on a branch from current `master`.
- Reconcile recent implementation state.
- Keep new docs additive where possible.
- Do not rewrite old docs in a way that makes comparison or rollback difficult.

## Phase 1 — capability proof verifier completion gate

Recent verifier work means native, UCAN, VC, restricted zcap-ld, and bearcap verifier paths exist. Bearcap produces `possession-confirmed`, not `verified`; identity-control-log remains unverified until a future verifier ADR/package exists.

Required next work:

- registry completion summary;
- exact verifier behavior matrix;
- composition tests;
- claimed-but-invalid fail-closed tests;
- unsupported-scheme abstain tests;
- zcap-ld profile/canonicalization boundary documentation.

## Phase 2 — private/account-local encryption envelope

Implement the private payload envelope before private chat, mailbox, account-local reputation sync, or MLS-protected group payloads.

Required work:

- envelope schema;
- fixtures;
- encrypt/decrypt helpers;
- metadata minimization;
- bridge log/privacy enforcement;
- account-local wrapping for reputation events.

## Phase 3 — MLS ADR and dependency decision

MLS is group key management, not transport. It belongs above bridge/WebRTC/mailbox/tunnel delivery paths.

Required work:

- MLS ADR;
- dependency/library decision;
- identity and device binding;
- credential policy;
- membership change policy;
- epoch/checkpoint model;
- delivery-service model;
- threat model.

## Phase 4 — MLS group control records

Add protocol and projection support for group key state.

Required work:

- group created;
- member proposed/added/removed;
- commit published;
- welcome issued;
- epoch advanced;
- projection and fixtures;
- replay equivalence tests.

## Phase 4.5 — production bridge runtime hardening

Close T&S deferral gaps, persistent rate-limiting/token management, and auth audit log before the transport surface widens.

Required order:

1. Wire `decideUserBlockTransport` into admission gateway as check #9 (opt-in `localControlStateLookup`).
2. Add `acceptReportDelivery` type contract (no HTTP route yet).
3. `HttpRateLimitStore` interface + `JsonFileHttpRateLimitStore` (atomic temp-rename).
4. `BridgeHttpRateLimiter` persistence: seed from store on construction, save after every mutation.
5. `TokenRegistryStore` interface + `JsonFileTokenRegistryStore`.
6. `addToken` / `revokeToken` hot rotation without process restart.
7. `gateway.rotateOperatorAuthority` — persists + takes effect immediately.
8. `AuthAuditRecord` + bounded FIFO `AuthAuditLog` (10 000 entries, Phase 3.1 redaction).

See: `docs/implementation/phase-4.5-production-bridge-hardening-plan.md`

## Phase 4.6 — relay / super-peer policy runtime

Runtime-configurable operator surface model, policy subscription runtime, advisory reputation feeds, operator quarantine API, and appeal hooks.

Required order:

1. `OperatorSurface` + `OperatorSurfaceConfig` (narrowing enforced, widening throws at construction).
2. `PolicySubscriptionRuntime` as check #8.5 (after rate limit, before user-block).
3. `refreshLabelersState` for live updates without restart.
4. `AdvisoryReputationFeed` + `ingestAdvisoryFeed` (lower-only, clamped to [-1, 1]).
5. `quarantinePeer(peerId, reason, durationMs)` + `liftQuarantine(peerId, reason)` with audit events.
6. `registerAppealHook` — best-effort, payload-free, per-kind allowlist.

See: `docs/implementation/phase-4.6-relay-superpeer-policy-plan.md`

## Phase 4.7 — bridge resumability hardening

> **Numbering note**: This document uses a sequential Phase 1–25 numbering that does not correspond directly to the versioned phase numbering in `docs/implementation/phase-map.md`. What `phase-map.md` calls "Phase 5" is the User Data Root and Protocol Foundations sequence (Phase 5.1–5.10 per `docs/implementation/phase-5-foundation-roadmap.md`). This section covers bridge stream resumability work that belongs to the bridge/infrastructure track rather than the Phase 5 doctrine sequence.

Current Durable Streams work exists, but resumable backlog and alternate stream adapters still need work.

Required order:

1. GET-with-cursor backlog read.
2. Cursor/checkpoint tests.
3. Persistent per-token streaming rate limits.
4. Persistent token registry.
5. Hot rotation.
6. SSE adapter.
7. Long-poll adapter.
8. Durable Streams adapter conformance tests.

## Phase 6 — adaptive reachability descriptor schemas

Descriptors are hints, not authority.

Required work:

- surface enum;
- capability enum;
- transport/address enum;
- safe-scope validation;
- expiry validation;
- signature validation;
- URL credential rejection;
- key-continuity behavior;
- valid and invalid fixtures.

## Phase 7 — sync-client transport abstraction

Add transport contracts before new runtime dependencies.

Required work:

- `PeerTransport`;
- `PeerSession`;
- privacy-safe transport errors;
- HTTP bridge adapter;
- Durable Streams adapter;
- descriptor-based selection;
- policy-aware filtering;
- health metadata;
- tests proving delivery is not replication success.

## Phase 8 — bridge capability modules

Add bridge capabilities modularly.

Required work:

- descriptor advertisement;
- backlog-read capability;
- Durable Streams metadata;
- signaling capability;
- handoff orchestration;
- mailbox capability only after private encryption and mailbox doctrine.

## Phase 9 — WebRTC signaling

Signaling establishes sessions. It does not sync state or carry media.

Required work:

- signaling message schema;
- offer/answer exchange;
- ICE candidate exchange;
- session expiry;
- replay protection;
- fingerprint binding;
- bounded payloads;
- failure tests.

## Phase 10 — WebRTC DataChannel sync/event replication

DataChannels carry signed protocol envelopes and sync/control traffic.

Required work:

- DataChannel transport;
- reliable ordered channel;
- optional ephemeral channel later;
- envelope framing;
- chunking;
- backpressure;
- reconnect;
- bridge checkpoint fallback;
- replay and malformed-frame tests.

## Phase 11 — WebRTC media tracks for voice/video

Media tracks carry microphone, camera, and screen sharing. This is separate from DataChannel replication.

Required work:

- call/session model;
- audio track;
- video track;
- screen share;
- device switching;
- mute/camera state;
- ICE restart;
- TURN policy;
- bandwidth adaptation;
- media permission UX;
- media privacy diagnostics.

## Phase 12 — MLS-protected group messaging

Use MLS-managed group state to protect group payloads across bridge, Durable Streams, DataChannel, future mailbox, and future super-peer paths.

Required work:

- encrypted group message payload shape;
- MLS group id and epoch binding;
- stale epoch rejection;
- removed-member rejection;
- replay/idempotency tests;
- offline catch-up behavior;
- no bridge/super-peer plaintext access.

## Phase 13 — encrypted mailbox actor

Mailbox is temporary delivery infrastructure, not durable user-owned truth.

Required work:

- mailbox doctrine/threat model;
- encrypted mailbox record schema;
- retention TTL;
- byte caps;
- recipient/group capability binding;
- expiry semantics;
- fetch/catch-up path;
- wrong-recipient and expired-record tests.

## Phase 14 — optional tunnel adapter

Optional tunnel adapters improve reachability. They do not define trust, identity, storage, MLS, or replication authority.

Required order:

1. transport kind;
2. descriptor fixture;
3. contract-only stub;
4. pairing descriptor;
5. fingerprint binding;
6. bridge-over-tunnel proof;
7. tests preserving bridge admission and signed-envelope validation.

## Phase 15 — super-peer and persistent availability design

Super peers help availability without becoming central servers.

Required work:

- super-peer ADR/design note;
- descriptor;
- availability capability;
- object/block availability rules;
- scope restrictions;
- storage hint publication;
- group replication boundaries;
- no-latest-state-authority rule.

## Phase 15A — P2P runtime adapter doctrine

Document how external P2P systems fit below protocol authority before adding runtime dependencies.

Required work:

- P2P runtime adapter ADR;
- runtime adapter boundary doctrine;
- selective replication doctrine inspired by Willow;
- trusted-device/discovery lessons inspired by Syncthing;
- local discovery and PeX-like peer hint safety;
- `lfp2p://` portable reference direction;
- peer-assisted delivery boundaries;
- explicit rule that runtime keys are subordinate to controller/device-authorized replication keys.

## Phase 16 — optional content-addressed fetchers

IPFS-compatible storage remains optional storage/fetch infrastructure.

Required work:

- block/bundle fetcher interface;
- local-cache fetcher;
- IndexedDB/OPFS fetcher;
- HTTPS fetcher;
- S3/Filebase-compatible fetcher;
- IPFS-compatible fetcher;
- CAR archive fetch/verify;
- digest/CID verification after fetch;
- byte and compression caps.

## Phase 17 — manual temporary infrastructure flow

Manual descriptor flow before UI automation.

Required work:

- start temporary bridge/relay outside app;
- generate signed expiring descriptor;
- manual import;
- constrained policy;
- expiration/failover;
- revoke/stop flow;
- diagnostics.

## Phase 18 — UI temporary infrastructure flow

Only after manual flow is safe.

Required work:

- start temporary bridge UI;
- start temporary relay UI;
- scope/capability explanation;
- expiry display;
- operator fingerprint display;
- stop/revoke button;
- descriptor share flow;
- constrained defaults.

## Phase 19 — production bridge runtime

Required work:

- production runtime wrapper;
- deployment config;
- persistent token registry;
- hot rotation;
- mTLS/OAuth2/JWT decision;
- metrics and privacy-safe observability;
- abuse/load tests;
- bridge compromise drill.

## Phase 20 — full-peer/native runtime

Required work:

- full-peer runtime ADR;
- native/Bare runtime decision;
- local block store integration;
- direct peer discovery;
- direct replication streams;
- super-peer compatibility;
- offline replay;
- snapshot/checkpoint policy;
- cross-device identity event sync;
- hardware-backed key adapter path.

## Phase 20A — Holepunch / Bare / Pear adapter

Holepunch/Bare/Pear belongs under full-peer runtime. It is a runtime substrate and adapter path, not protocol authority.

Required work:

- package boundary outside protocol packages;
- Pear/Bare process boundary decision;
- Holepunch connection lifecycle design;
- runtime identity binding to controller/device-authorized replication keys;
- descriptor integration;
- secure-channel assumptions and threat model;
- direct stream mapping to `PeerTransport` / `PeerSession`;
- fallback behavior;
- security tests for wrong peer key, malformed stream, replay, revoked device, scope widening, and private payload encryption.

## Phase 20B — Hypercore / Corestore replication substrate

Hypercore/Corestore may provide storage and replication substrate for full peers. It must not become protocol authority.

Required work:

- mapping from ObjectRef/BundleRef/BlockRef to adapter-local storage;
- feed/key authorization records;
- feed lifecycle and rotation behavior;
- deterministic apply after feed read;
- encrypted/private payload handling;
- public/group/private storage separation;
- garbage collection and retention policy;
- fixtures mapping protocol refs to substrate coordinates.

## Phase 20C — local discovery + HyperDHT + PeX-like peer hints

Discovery yields candidates, not trust.

Required work:

- mDNS/LSD descriptor advertisement for local peers;
- HyperDHT descriptor discovery for native/full peers;
- privacy-scoped PeX-like peer hints;
- descriptor expiry and revocation behavior;
- fingerprint/petname pairing UX integration;
- unknown peer neutral/constrained policy;
- abuse controls for hint flooding;
- tests for private-scope leakage prevention.

## Phase 20D — peer-assisted bundle delivery

Peer-assisted delivery moves bytes, not authority.

Required work:

- eligible content classes;
- capability checks for encrypted private/group bundles;
- bandwidth and device constraints;
- congestion-aware scheduling inspired by µTP/LEDBAT;
- verification after fetch;
- failover to bridge/super-peer/storage hints;
- tests for byte verification and private plaintext exclusion.

## Phase 21 — media, rooms, search, and public/social runtime foundations

After the runtime and delivery foundations, define higher-level application-facing object families and projections.

Required work:

- media manifests and attachment pipeline;
- rooms/groups UX;
- search objects and local-first search foundations;
- public/social/feed runtime.

## Phase 22 — semantic discovery protocol

Define engine-agnostic semantic discovery primitives for implementations built on the protocol.

Required work:

- semantic discovery ADR;
- searchable object metadata;
- semantic capability descriptors;
- embedding artifact metadata;
- query intent records;
- privacy and capability filtering rules;
- trust/moderation integration points;
- selective replication rules for semantic artifacts;
- explicit rule that semantic indexes are projections, not source of truth.

## Phase 23 — semantic runtime evaluation

Evaluate candidate semantic runtimes against protocol requirements before selecting reference adapters.

Required work:

- QVAC evaluation;
- SQLite + FTS5 + vector-extension baseline evaluation;
- embedded/native/browser compatibility comparison;
- incremental indexing and deletion handling benchmarks;
- capability-aware filtering benchmarks;
- local-only/account-local/public index behavior;
- dependency/license review;
- offline and local-first behavior review;
- P2P/delegated inference safety review where applicable.

## Phase 24 — semantic runtime adapter interfaces

Define swappable runtime interfaces after protocol semantics and evaluation criteria are stable.

Required work:

- semantic index provider interface;
- embedding provider interface;
- lexical search provider interface;
- hybrid retrieval provider interface;
- query planner interface;
- result authorization filter interface;
- index lifecycle hooks;
- migration/versioning hooks;
- test fixtures that engines must pass.

## Phase 25 — reference semantic implementation

Build a reference implementation using the selected runtime strategy while preserving engine independence.

Required work:

- reference local index implementation;
- reference embedding pipeline;
- reference hybrid retrieval path;
- protocol-shaped benchmark fixtures;
- privacy/capability regression tests;
- deletion/tombstone invalidation tests;
- documentation for alternate engine implementations.
