# Adaptive Reachability Integration Plan

- Status: Draft
- Date: 2026-06-23
- Related ADR: `docs/adr/008-adaptive-reachability-and-ephemeral-infrastructure-v1.md`
- Related protocol doc: `docs/protocol/infrastructure-capability-surfaces.md`

## Purpose

This plan turns the adaptive reachability doctrine into an ordered implementation path. It is future-facing. `docs/implementation/current-state.md` remains the truth layer for what code does today.

## Current baseline to preserve

The repository already has a PWA light peer, signed local events, local identity, Dexie local state, mutation outbox, HTTP bridge transport, bridge primitives, bridge stores, transport admission, and Durable Streams with a WebSocket adapter.

Do not disrupt those boundaries.

## Constraints

1. Infrastructure must not become protocol authority.
2. Bridge, relay, and super peer remain distinct surfaces.
3. Handoff, signaling, mailbox, streaming, forwarding, discovery, availability, and replication are capabilities.
4. Durable Streams is the live-delivery architecture; WebSocket is an adapter.
5. WebRTC signaling, DataChannels, and media tracks must remain separate concerns.
6. MLS is group key management, not transport.
7. Optional tunnel adapters remain reachability adapters.
8. Future Holepunch/Bare work belongs under full-peer runtime.
9. IPFS-compatible storage remains optional storage/fetch infrastructure.
10. Runtime descriptor acceptance requires fixtures first.

## Phase A — documentation gate

Deliverables:

- `docs/adr/008-adaptive-reachability-and-ephemeral-infrastructure-v1.md`
- `docs/protocol/infrastructure-capability-surfaces.md`
- `docs/implementation/adaptive-reachability-integration-plan.md`
- `docs/threat-model/adaptive-reachability-and-temporary-infrastructure.md`
- `docs/implementation/roadmap-ordering.md`

Exit criteria:

- docs are additive;
- no current implementation is claimed where code does not exist;
- existing bridge admission doctrine is preserved.

## Phase B — descriptor schema planning

Define an infrastructure descriptor model with:

- version;
- surface kind;
- operator ref;
- surface ref;
- addresses;
- capabilities;
- safe scopes;
- created-at timestamp;
- expiration timestamp;
- optional key-continuity reference;
- signature.

Add valid and invalid fixtures before runtime use.

Initial invalid cases should include expired descriptor, no expiry, unsupported version, URL credentials, scope widening, unsupported transport, malformed signature, and key-continuity mismatch.

## Phase C — sync-client transport contracts

Add contract-only transport boundaries before adding new runtimes:

- `PeerTransport`;
- `PeerSession`;
- privacy-safe transport errors;
- HTTP bridge adapter;
- Durable Streams adapter;
- descriptor-based selection.

Transport success must not mean replication success. Protocol acceptance still requires signed-envelope validation and deterministic apply.

## Phase D — bridge capability modules

Add bridge capabilities modularly:

- descriptor advertisement;
- backlog read after cursor reads exist;
- Durable Streams metadata;
- signaling;
- handoff orchestration;
- mailbox only after private encryption and mailbox doctrine.

Every capability must reuse bridge admission, auth, privacy-safe logging, idempotency, and source-of-truth rules.

## Phase E — WebRTC path

Order:

1. signaling;
2. DataChannel transport for sync/event replication;
3. media tracks for voice/video/screen sharing;
4. session orchestration.

Do not treat WebRTC as one monolithic feature.

## Phase F — optional tunnel path

Add an optional tunnel transport kind only after descriptor validation and transport contracts exist.

First runtime experiment should be bridge-over-tunnel, not direct full-peer replication. Existing bridge validation/admission rules must remain in the path.

## Phase G — full-peer runtime path

Future Holepunch/Bare work belongs under the full-peer/native-peer runtime phase. It should implement existing protocol contracts rather than redefining protocol semantics.

## Phase H — optional content-addressed fetchers

IPFS-compatible, S3-compatible, Filebase, HTTPS, CAR archive, local-cache, and OPFS/IndexedDB fetchers should be runtime fetchers for storage hints. Fetched bytes are not trusted until verified by digest/content link and checked against local policy.

## Phase I — temporary infrastructure flow

Manual descriptor export/import should come before UI automation. A UI button for temporary infrastructure should only arrive after descriptor validation, constrained policy, expiration, revocation, and failover behavior are implemented.

## Do-not-build-yet list

Do not implement these before their gates:

- production temporary infrastructure automation;
- direct full-peer tunnel replication;
- mailbox plaintext inspection;
- trust-score hard blocking for new unknown services;
- descriptor acceptance without signatures/expiry;
- WebSocket-only live-stream architecture;
- IPFS as mandatory storage;
- Holepunch/Bare imports in protocol, identity, trust-safety, or content-addressing packages.
