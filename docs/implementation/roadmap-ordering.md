# Roadmap Ordering Reference

- Status: Draft
- Date: 2026-06-23
- Scope: local-first hybrid P2P protocol roadmap ordering

## Purpose

This document records the build order after the Phase 0 documentation review. It is an ordering reference, not a claim that later phases are implemented.

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
→ optional content-addressed fetchers
→ temporary infrastructure flow
→ production bridge
→ full-peer/native runtime
→ Holepunch/Bare adapter under full-peer runtime
→ media, rooms, search, public/social runtime
```

## Phase 0 — documentation alignment

- Cleanly carry adaptive reachability docs on a branch from current `master`.
- Reconcile recent implementation state.
- Keep new docs additive where possible.
- Do not rewrite old docs in a way that makes comparison or rollback difficult.

## Phase 1 — capability proof verifier completion gate

Recent verifier work means native, UCAN, and VC verifier paths are live. zcap-ld and bearcap remain intentionally unsupported/abstaining unless future ADRs decide otherwise.

Required next work:

- registry completion summary;
- exact verifier behavior matrix;
- composition tests;
- claimed-but-invalid fail-closed tests;
- unsupported-scheme abstain tests;
- zcap-ld dependency/canonicalization decision.

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

## Phase 5 — bridge resumability hardening

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

## Phase 20A — Holepunch/Bare adapter

Holepunch/Bare belongs under full-peer runtime. It is a runtime substrate and adapter path, not protocol authority.

Required work:

- package boundary outside protocol packages;
- descriptor integration;
- storage/runtime mapping;
- direct stream mapping to `PeerTransport` / `PeerSession`;
- super-peer compatibility;
- security tests for wrong peer key, malformed stream, replay, revoked device, scope widening, and private payload encryption.

## Later phases

After these foundations:

- media manifests and attachment pipeline;
- rooms/groups UX;
- search objects and local-first search;
- public/social/feed runtime.
