# Adaptive Reachability Integration Plan

- Status: Draft
- Date: 2026-06-23
- Related ADR: `docs/adr/008-adaptive-reachability-and-ephemeral-infrastructure-v1.md`
- Related protocol docs:
  - `docs/protocol/infrastructure-capability-surfaces.md`
  - `docs/protocol/bridge-admission-doctrine.md`
- Source-of-truth caution: this is a future implementation plan. `docs/implementation/current-state.md` remains the truth layer for what code does today.

## Purpose

This plan turns the adaptive reachability doctrine into an implementation sequence that should make the protocol easier to build without introducing redundant infrastructure roles.

The plan is additive. It does not overwrite current bridge, admission, Durable Streams, content-addressing, identity, or trust/safety docs.

## Current baseline to preserve

The current implementation already has:

- PWA-first light peer foundation;
- signed local events;
- persistent local device identity;
- Dexie local store;
- mutation outbox;
- HTTP bridge transport;
- non-authoritative bridge service primitives;
- bridge store backends;
- transport admission integration;
- Durable Streams broker with current WebSocket adapter;
- content-addressing primitives including `StorageLocationHint` kinds for local, bridge, relay, super-peer, S3-compatible, Filebase, IPFS-compatible, CAR archive, Hypercore-compatible, and native file-store locations.

Do not disrupt these boundaries.

## Design constraints

1. Do not turn infrastructure into authority.
2. Preserve the bridge / relay / super-peer admission distinction.
3. Collapse handoff, signaling, mailbox, streaming, discovery, forwarding, availability, and replication into capabilities where possible.
4. Treat unknown infrastructure as neutral/constrained, not malicious by default.
5. Keep Durable Streams as the live-stream architecture; WebSocket is an adapter.
6. Keep Holesail-like functionality as an optional reachability/tunnel adapter only.
7. Keep IPFS-compatible storage as an optional storage hint/fetch location only.
8. Require fixtures before accepting descriptor data from the network.
9. Do not add production deployment or full-peer runtime as part of the first docs-to-code slice.

## Proposed package boundaries

### `packages/protocol`

May eventually define descriptor event kinds after schema ADR acceptance.

Should not import Holesail, libp2p, IPFS clients, WebRTC implementations, HTTP clients, bridge runtimes, or storage SDKs.

Potential future event kinds:

- `infrastructure.descriptor.published`
- `infrastructure.descriptor.revoked`
- `peer.reachability.updated`

Do not add these until descriptor schemas and fixtures are approved.

### `packages/content-addressing`

Already owns `ContentLink`, `BlockRef`, `BundleRef`, and `StorageLocationHint` validation.

Future work:

- add runtime fetcher interfaces outside the validator path;
- keep validators pure and non-fetching;
- add fixtures for IPFS-compatible / Filebase / S3-compatible storage hints if gaps exist;
- add CAR archive fetch/verify plan before media work.

Do not make IPFS mandatory.

### `packages/sync-client`

Primary home for transport abstraction and reachability adapter contracts.

Proposed future layout:

```txt
packages/sync-client/src/
  transports/
    transport-contract.ts
    http-bridge-transport.ts
    durable-stream-transport.ts
    webrtc-datachannel-transport.ts
    holesail-like-transport.ts
    webtransport-transport.ts
  reachability/
    descriptor-types.ts
    descriptor-validation.ts
    descriptor-score.ts
    descriptor-selection.ts
    peer-pairing-descriptor.ts
```

Initial implementation should be contract-only plus validation fixtures. Avoid runtime networking dependencies until threat model and package boundaries are accepted.

### `apps/bridge-service`

Primary home for bridge capabilities that operate on signed envelopes and bridge-safe storage.

Future capability modules may include:

```txt
apps/bridge-service/src/capabilities/
  signaling/
  mailbox/
  durable-streaming/
  backlog-read/
  descriptor-advertisement/
```

Bridge capability modules must continue to reuse bridge admission, auth, privacy-safe logging, idempotency, and store/source-of-truth rules.

### future full-peer / super-peer runtime

Do not add yet.

When added, it should implement the same descriptor and admission contracts, not fork the protocol.

## Phase A — documentation and threat model only

### A1. Add doctrine docs

Completed by this planning branch:

- `docs/adr/008-adaptive-reachability-and-ephemeral-infrastructure-v1.md`
- `docs/protocol/infrastructure-capability-surfaces.md`
- `docs/implementation/adaptive-reachability-integration-plan.md`

### A2. Add threat model

Deliverable:

- `docs/threat-model/adaptive-reachability-and-temporary-infrastructure.md`

Must cover:

- malicious bridge descriptor;
- malicious relay descriptor;
- malicious super-peer descriptor;
- stale descriptor replay;
- key-continuity downgrade;
- descriptor flood / discovery spam;
- private-network URL abuse;
- tunnel endpoint confusion;
- WebRTC signaling impersonation;
- mailbox retention abuse;
- relay traffic correlation;
- super-peer availability overclaim;
- IPFS-compatible storage poisoning/unavailability;
- Relay Button operator mistakes;
- trust-score incumbency risk;
- new-service neutral probation.

Exit criteria:

- threat model is reviewed before descriptor runtime implementation;
- no network-discovered descriptor is trusted without validation rules.

## Phase B — descriptor schema planning

### B1. Define descriptor schemas

Deliverable:

- ADR or protocol doc for `InfrastructureDescriptorV1`.

Required fields:

- version;
- surface type;
- operator ref;
- surface ref;
- address list;
- transport kinds;
- capability list;
- safe scope list;
- creation timestamp;
- expiration timestamp;
- key-continuity ref when applicable;
- signature.

Rejected fields/behaviors:

- URL credentials;
- unbounded capability arrays;
- unsupported private-network targets unless runtime policy explicitly permits them;
- unknown major versions;
- descriptors without expiry;
- descriptors that advertise scopes wider than the surface doctrine allows.

### B2. Add fixtures

Deliverables:

```txt
packages/sync-client/fixtures/infrastructure-descriptors/valid/
packages/sync-client/fixtures/infrastructure-descriptors/invalid/
```

Initial valid fixtures:

- bridge descriptor with HTTP delivery + Durable Streams capability;
- relay descriptor with forwarding only;
- super-peer descriptor with group/public availability;
- local peer descriptor for LAN or manual pairing;
- Holesail-like opaque tunnel descriptor;
- IPFS-compatible storage hint descriptor if descriptor model includes storage surfaces.

Initial invalid fixtures:

- expired descriptor;
- descriptor without expiry;
- unsupported major version;
- URL with credentials;
- bridge advertising `device-local` or `self`;
- super-peer advertising `dm` without a later explicit ADR allowing it;
- relay claiming moderation authority;
- descriptor with too many addresses;
- descriptor with unsupported transport;
- descriptor with key-continuity mismatch;
- malformed signature.

Exit criteria:

- validators fail closed;
- tests cover all fixtures;
- no runtime fetch/connect occurs during validation.

## Phase C — sync-client reachability contracts

### C1. Transport contract

Draft target:

```ts
export type PeerTransportKind =
  | 'http-bridge'
  | 'durable-stream'
  | 'webrtc-datachannel'
  | 'webtransport'
  | 'holesail-like'
  | 'lan'
  | 'native-full-peer'

export interface PeerTransport {
  readonly kind: PeerTransportKind
  connect(target: PeerTarget, options: PeerTransportOptions): Promise<PeerSession>
}

export interface PeerSession {
  sendEnvelope(envelope: SignedEventEnvelope): Promise<void>
  readEnvelopes(cursor?: string): AsyncIterable<SignedEventEnvelope>
  close(): Promise<void>
}
```

Rules:

- contract must use signed envelopes, not transport-specific payload semantics;
- transports must surface privacy-safe errors;
- transports must not downgrade validation;
- transport success is not replication success until the protocol apply path confirms it.

### C2. Descriptor selection

Selection must be policy-driven:

- validate descriptor;
- filter by required capability;
- filter by safe scope;
- filter by local policy;
- score by health/history/introduction/key-continuity;
- apply neutral probation constraints for new infrastructure;
- choose primary/fallback candidates;
- persist non-sensitive health metadata.

Unknown infrastructure can be eligible for `allow-with-limits` if it validates and has no negative evidence.

## Phase D — bridge capability modules

### D1. Descriptor advertisement

Bridge may advertise its current capabilities through signed descriptor publication.

Current bridge capabilities likely include:

- `http-delivery`;
- `durable-streaming`;
- `backlog-read` only after GET-with-cursor exists;
- `mailbox` only after encrypted mailbox actor exists;
- `signaling` only after signaling handler exists.

Do not advertise unimplemented capabilities.

### D2. Durable Streams adapter discipline

Current WebSocket adapter remains an adapter.

Future work can add:

- SSE adapter;
- long-poll adapter;
- WebTransport adapter if it preserves the same semantics.

Required invariants:

- store is source of truth;
- broker does not durably cache record bodies;
- subscribe-vs-backlog race remains closed;
- auth and rate limits remain enforced;
- frames remain bounded;
- errors remain privacy-safe.

### D3. Handoff/signaling

Signaling may be bridge-hosted, but signaling must be separated from signed-event acceptance.

Required rules:

- signaling messages must be bounded;
- signaling sessions must expire;
- signaling must bind expected peer/device fingerprints where possible;
- signaling must not grant replication/capability authority;
- failed signaling must not mutate protocol state.

### D4. Mailbox

Mailbox must wait for private payload encryption policy and encrypted mailbox actor design.

Required rules:

- encrypted bodies only for private user payloads;
- no bridge plaintext visibility;
- retention TTL;
- recipient/group capability binding;
- deletion/expiry semantics;
- replay/idempotency discipline.

## Phase E — Holesail-like tunnel adapter

### E1. Contract-only stub

Add a `holesail-like` transport kind and descriptor address type without adding a runtime dependency.

Purpose:

- reserve the boundary;
- prevent direct imports into protocol packages;
- clarify that tunnel adapters are reachability only.

### E2. Bridge-over-tunnel proof

First runtime experiment should expose existing bridge APIs over the tunnel.

Why:

- bridge admission already exists;
- signed-envelope validation already exists;
- privacy-scope filtering already exists;
- idempotency and store behavior already exist;
- errors and logs are already privacy-safe.

Do not start with direct full-peer replication over a tunnel. That belongs after full-peer runtime contracts exist.

### E3. Pairing descriptor

Future pairing descriptor shape:

```ts
interface PeerPairingDescriptorV1 {
  version: 'lfp2p.peer-pairing.v1'
  transport: 'holesail-like' | 'webrtc-datachannel' | 'lan' | 'native'
  connectionRef: string
  expectedControllerFingerprint: string
  expectedDeviceFingerprint?: string
  allowedScopes: Array<'dm' | 'group' | 'public'>
  createdAt: string
  expiresAt: string
  signature: string
}
```

Rules:

- connection material enables reachability only;
- trust still requires identity/capability verification;
- pairing descriptors must expire;
- descriptors must be safe for QR/manual transfer;
- never include private keys or bearer secrets.

## Phase F — Relay Button / temporary infrastructure

### F1. Manual operator flow first

Before automation, document and implement manual descriptor import/export:

- start temporary bridge/relay outside the app;
- generate signed expiring descriptor;
- share descriptor with peers/group;
- clients validate and use with constrained policy;
- operator shuts helper down;
- clients fail over or continue offline.

### F2. User-facing button later

Only after manual flow is safe, add a UI such as:

- Start Temporary Bridge
- Start Temporary Relay
- Share Temporary Reachability

Requirements:

- explicit expiry;
- visible operator identity/fingerprint;
- scope/capability explanation;
- resource/cost warning if applicable;
- stop/revoke action;
- no implication that the helper owns user data.

## Phase G — IPFS-compatible storage path

### G1. Keep as storage hint

IPFS-compatible storage should be reachable through `StorageLocationHint` / content-addressed fetchers, not sync-client transport.

### G2. Fetcher safety

Future runtime fetchers must:

- verify digest/content-link after fetch;
- enforce byte caps;
- enforce compression caps;
- reject URL credentials;
- avoid leaking private identifiers in logs;
- treat unavailability as normal;
- never trust fetched bytes until verified;
- never fetch private encrypted blocks unless local policy authorizes the attempt.

### G3. Pinning/availability

Pinning is availability, not authority.

Super peers, user devices, bridges, or external IPFS-compatible providers may help keep bytes available. The protocol still decides whether those bytes are authorized and relevant.

## Phase H — docs reconciliation after implementation

Only after the above contracts land should existing docs be updated in place.

Candidates for later reconciliation:

- `docs/implementation/current-state.md` once implementation changes;
- `docs/implementation/planning-to-code-alignment.md`, especially the older Durable Streams row;
- `docs/protocol/bridge-admission-doctrine.md` if descriptor/surface policy changes safe scopes;
- `docs/implementation/next-development-path.md` if adaptive reachability becomes the next phase gate.

Until then, keep these new docs as additive planning/ADR material so old documentation remains available for comparison and rollback.

## Do-not-build-yet list

Do not implement these until the relevant ADR/threat model/fixtures exist:

- production Relay Button automation;
- automatic cloud provider provisioning;
- direct full-peer tunnel replication;
- IPFS gateway fetchers for private objects;
- mailbox plaintext inspection;
- trust-score hard blocking for unknown new services;
- descriptor acceptance without signatures/expiry;
- bridge descriptors that advertise capabilities not implemented by code;
- WebSocket-only documentation that ignores Durable Streams.
