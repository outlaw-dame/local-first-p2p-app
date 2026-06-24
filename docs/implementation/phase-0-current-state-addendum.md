# Phase 0 Current-State Addendum

- Status: Draft
- Date: 2026-06-23
- Scope: documentation reconciliation after Issue #84 completion and adaptive reachability planning

## Purpose

`docs/implementation/current-state.md` remains the main implementation truth layer. This addendum records Phase 0 corrections without rewriting the larger truth document in place, so earlier documentation remains easy to compare and revert if needed.

## Recent verifier state

Issue #84 has been closed. The capability proof verifier track now has these live verifier schemes:

- native signed-event proof verifier;
- UCAN verifier;
- VC verifier.

The UCAN verifier supports the bounded v1 UCAN path documented in its PR. The VC verifier supports the deliberately narrow `DataIntegrityProof` + `eddsa-jcs-2022` path. zcap-ld and bearcap remain intentionally unsupported/abstaining unless future ADRs decide otherwise.

Documentation and implementation work should not describe capability credential verification as purely shape-only anymore. Shape-only reserved refs still exist in older trust/safety types, but the capability proof verifier registry now has multiple concrete implementations.

## Reputation graph state

Phase 1.8 is complete. The local personalized reputation graph, sybil-hardening layers, aggregator runtime, PWA settings/view surfaces, OpenRank adapter boundary, inbound reputation ingestion, cross-device sync policy, protocol event kinds, and default local-only labeler registry are documented as complete in the current implementation state.

Remaining related dependency:

- account-local envelope wrapping for reputation events depends on the future private/account-local payload envelope work.

## Durable Streams wording

Use this wording:

```txt
Durable Streams = architecture-level live-delivery primitive
WebSocket = current runtime adapter
```

Avoid wording that implies WebSocket itself is the architecture.

Future SSE, long-poll, WebTransport, or other adapters must preserve Durable Streams semantics rather than define a parallel live-stream model.

## Adaptive reachability state

Adaptive reachability is planned, not implemented.

The Phase 0 documentation adds proposed doctrine and ordering for:

- bridge / relay / super-peer surface vocabulary;
- handoff, signaling, mailbox, streaming, forwarding, discovery, availability, and replication as capabilities;
- WebRTC signaling vs DataChannel sync vs media tracks;
- MLS as group key management;
- optional tunnel adapters;
- future Holepunch/Bare full-peer runtime;
- optional content-addressed storage providers;
- temporary infrastructure flows.

None of those docs should be read as runtime implementation until descriptor schemas, fixtures, transport contracts, and runtime adapters are added in later phases.

## Current immediate ordering

The next implementation order should be:

1. finish documentation reconciliation;
2. capability proof verifier completion summary and any zcap-ld decision;
3. private/account-local payload envelope;
4. MLS ADR and dependency decision;
5. MLS group control records;
6. bridge resumability hardening;
7. adaptive reachability descriptor schemas;
8. transport abstraction;
9. bridge capability modules;
10. WebRTC signaling;
11. WebRTC DataChannel sync;
12. WebRTC media tracks;
13. MLS-protected group messaging;
14. encrypted mailbox;
15. optional tunnel adapter;
16. super-peer availability design;
17. optional content-addressed fetchers;
18. temporary infrastructure flow;
19. production bridge;
20. full-peer/native runtime;
21. Holepunch/Bare adapter under full-peer runtime.

## Documentation warning

Older roadmap docs may still contain stale statements because this addendum avoids destructive rewrites. When implementation changes land, update `current-state.md` directly with exact PR references and test counts.
