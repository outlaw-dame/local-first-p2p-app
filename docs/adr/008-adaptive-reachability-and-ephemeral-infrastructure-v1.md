# ADR-008: Adaptive Reachability and Ephemeral Infrastructure v1

- Status: Proposed
- Date: 2026-06-23
- Related ADRs:
  - `docs/adr/003-sync-offsets-and-cursors-v1.md`
  - `docs/adr/005-content-addressing-and-object-references-v1.md`
  - `docs/adr/006-local-first-trust-policy-engine-v1.md`
  - `docs/adr/007-capability-authority-model-v1.md`
- Related protocol docs:
  - `docs/protocol/bridge-admission-doctrine.md`
  - `docs/protocol/content-addressing.md`
  - `docs/protocol/capability-authority-model.md`
- Related implementation docs:
  - `docs/implementation/current-state.md`
  - `docs/implementation/adaptive-reachability-integration-plan.md`

## Context

The repository is a local-first, trust-centric object network. Its canonical layer is identity, capabilities, signed events, content references, local trust policy, and replication. Connectivity infrastructure exists to improve reachability and user experience, but it must not become protocol authority.

The current code implements a PWA-first light peer, local signed events, persistent local device identity, Dexie local store, mutation outbox, HTTP bridge transport, bridge service primitives, bridge store backends, bridge admission, and Durable Streams with a WebSocket adapter. Future work includes full peers, super peers, relay surfaces, alternate stream adapters, WebRTC/DataChannel sync, optional tunnel adapters, and production bridge runtimes.

Recent architecture review clarified that the protocol should preserve the existing bridge / relay / super-peer distinction while treating handoff, signaling, mailbox, forwarding, streaming, discovery, availability, and replication as capabilities that a surface may advertise.

## Decision

Adopt an adaptive reachability model with ephemeral infrastructure.

Permanent protocol authority lives only in local-first protocol primitives:

- identity/control-log state,
- capability authority,
- signed event envelopes,
- content/object references,
- private payload encryption policy,
- local trust policy,
- deterministic replication/apply rules.

Ephemeral infrastructure includes, but is not limited to:

- bridges,
- relays,
- super peers,
- bootstrap registries,
- handoff/signaling services,
- mailbox services,
- Durable Streams brokers,
- WebRTC signaling paths,
- Holesail-like tunnels,
- IPFS-compatible storage providers,
- S3/Filebase/CAR archive locations,
- public indexes.

Ephemeral infrastructure may disappear, be replaced, rotate, degrade, or be quarantined without destroying local user ownership, identity, or canonical object history.

## Surface vocabulary

### Bridge

A bridge is a protocol-aware helper surface.

It may accept signed envelopes, verify signatures, apply bridge-local admission, deduplicate/idempotently store accepted deliveries, provide backlog/catch-up reads, and expose live stream surfaces.

A bridge may provide these capabilities:

- `discovery`,
- `signaling`,
- `handoff`,
- `mailbox`,
- `streaming`,
- `backlog-read`,
- `store-and-forward`,
- `limited-forwarding`.

A bridge is not identity authority, moderation authority, trust authority, object authority, or a global deletion authority.

### Relay

A relay is a reachability/forwarding surface.

It helps peers exchange traffic when direct paths are unavailable or unreliable. A relay should be intentionally narrow: forward encrypted/session traffic, enforce surface-local admission/rate limits, and avoid becoming protocol semantics.

A relay may provide these capabilities:

- `forwarding`,
- `nat-traversal-assist`,
- `session-relay`,
- `limited-buffering` where explicitly designed.

A relay should not decrypt private payloads, inspect private content, define trust, define moderation, or become durable source-of-truth storage.

### Super peer

A super peer is a durable/high-availability peer or helper surface.

It may provide authorized availability, group/public replication assistance, object/block availability, introductions, and optional bridge or relay capabilities.

A super peer may provide these capabilities:

- `availability`,
- `object-replication`,
- `group-replication`,
- `introductions`,
- `bridge-compatible-api`,
- `relay-compatible-forwarding`,
- `storage-hint-provider`.

A super peer is still a protocol participant or operator surface, not central authority.

## Capability vocabulary

The following names are capabilities, not required node types:

- `handoff`: helps peers meet, exchange rendezvous/session data, pass initial messages, or upgrade to a better path.
- `signaling`: exchanges WebRTC or future session-establishment metadata.
- `mailbox`: temporarily stores bridge-safe encrypted/signed deliveries while a recipient is offline.
- `forwarding`: relays traffic when a direct path fails.
- `streaming`: provides live delivery notifications or records through Durable Streams runtime adapters.
- `discovery`: advertises reachable surfaces or peer descriptors.
- `availability`: keeps authorized blocks/events reachable while the origin peer is offline.
- `replication`: participates in protocol/object replication according to scope and capability.

Do not introduce first-class node roles named `handoff server`, `signaling server`, or `mailbox server` unless a later ADR proves the separation is necessary. Prefer capability-bearing bridge/super-peer/relay surfaces.

## Durable Streams rule

Durable Streams are the architectural live-stream primitive for bridge live delivery.

WebSocket is the current adapter. Documentation and implementation should avoid treating WebSocket as the canonical live-stream architecture. Future adapters may include SSE, long-poll, WebTransport, or other bindings if they preserve the same Durable Streams semantics, privacy rules, backpressure behavior, and source-of-truth discipline.

The broker must not become the source of truth. The store remains the source of truth; the stream layer is notification/live-delivery infrastructure.

## Holesail-like tunnel rule

Holesail-like functionality may be integrated only as an optional reachability/tunnel transport adapter.

It may help with:

- NAT traversal,
- no-port-forwarding access to a local bridge/full-peer surface,
- encrypted tunnel reachability,
- device pairing or temporary private access,
- bridge-over-tunnel delivery,
- full-peer stream reachability after the full-peer runtime exists.

It must not define:

- identity,
- trust,
- capabilities,
- replication semantics,
- moderation decisions,
- object integrity,
- storage authority,
- latest-state authority.

The first safe integration shape is bridge-over-tunnel: expose an already-admitted bridge API over the tunnel, preserving existing signed-envelope, admission, idempotency, privacy-scope, and rate-limit behavior. Direct full-peer envelope streams are a later phase.

## Relay Button / temporary infrastructure rule

The protocol should support a future "Relay Button" or "Start Temporary Bridge" style operator flow.

The principle is not tied to any specific provider. A user, group, organization, or community may start a temporary bridge/relay/super-peer-like helper when connectivity is poor, and stop it when it is no longer needed.

Rules:

- temporary infrastructure must advertise signed, expiring descriptors;
- clients must treat descriptors as hints, not authority;
- capability checks and admission still apply;
- users must not lose local data when the helper disappears;
- clients should be able to fail over to other descriptors or continue offline;
- the helper must not gain decryption authority unless a separate explicit capability grants it.

## Dynamic descriptor rule

Do not hardcode canonical relays, bridges, or super peers into protocol semantics.

Reachability should be discovered from signed, expiring descriptors. A descriptor may describe a bridge, relay, super peer, local peer, storage location, or bootstrap registry entry.

A future descriptor model should include at least:

```ts
interface InfrastructureDescriptorV1 {
  version: 'lfp2p.infrastructure-descriptor.v1'
  surface: 'bridge' | 'relay' | 'super-peer' | 'storage' | 'bootstrap' | 'local-peer'
  operatorRef: string
  surfaceRef: string
  addresses: Array<{
    transport: 'https' | 'durable-stream' | 'websocket' | 'webrtc-signaling' | 'webrtc-datachannel' | 'webtransport' | 'holesail-like' | 'lan' | 'native'
    url?: string
    opaqueAddress?: string
  }>
  capabilities: string[]
  safeScopes: Array<'dm' | 'group' | 'public'>
  createdAt: string
  expiresAt: string
  keyContinuityRef?: string
  operatorSignature: string
}
```

The exact schema is not accepted by this ADR. This shape is a planning target for the implementation plan and must be finalized with fixtures before runtime use.

## Trust-aware connectivity rule

Unknown infrastructure is neutral, not bad.

A new bridge, relay, tunnel, or super peer should not be excluded merely because it lacks history. New surfaces should start in a constrained neutral state such as `allow-with-limits` when their descriptor, signatures, scopes, and capabilities validate.

Negative trust should come from observed or reported behavior such as:

- invalid signatures,
- malformed descriptors,
- expired descriptors,
- replay behavior,
- privacy-scope violations,
- rate-limit abuse,
- key-continuity mismatch,
- unsafe logging/decryption claims,
- operator policy violations.

Positive trust may come from:

- successful sync history,
- stable key continuity,
- mutually trusted introductions,
- transparent operator metadata,
- healthy availability history,
- low-error delivery history.

Low history must not be treated as malicious history.

## IPFS-compatible storage rule

IPFS-compatible storage is an optional content-addressed storage/fetch location. It is not the protocol's identity layer, transport authority, trust authority, latest-state source, or mandatory storage backend.

The existing content-addressing layer already separates `ContentLink`, `BlockRef`, `BundleRef`, and `StorageLocationHint`. IPFS-compatible locations should remain storage hints for blocks, media, bundles, and archives.

A CID can help verify what bytes are. It does not prove that bytes are authorized, safe, decryptable, current, relevant, or available. Pinning/replication decisions are separate from object authorization and trust policy.

## Consequences

### Positive

- Reduces node-role explosion by turning handoff/signaling/mailbox into capabilities.
- Preserves the existing bridge/relay/super-peer admission distinction.
- Keeps infrastructure replaceable and disposable.
- Leaves room for Holesail-like tunnels without coupling the protocol to Holesail.
- Leaves room for IPFS-compatible storage without coupling the protocol to IPFS.
- Prevents old services from gaining unfair incumbency solely through trust-score history.
- Keeps Durable Streams as the canonical live stream abstraction instead of over-specifying WebSockets.

### Negative / costs

- Requires descriptor schemas, fixtures, and signature validation before dynamic infrastructure can be trusted.
- Requires careful UI copy so users understand temporary infrastructure is a helper, not an account/data host.
- Requires per-surface threat models for bridge, relay, super-peer, tunnel, and storage-provider behavior.
- Requires capability-aware selection logic to avoid accidental private-scope routing.

## Non-goals

This ADR does not:

- implement Holesail,
- select libp2p, Holepunch, IPFS, WebRTC, WebTransport, or any other runtime as canonical,
- replace the bridge admission doctrine,
- change current bridge-safe privacy scopes,
- add production bridge deployment,
- add full-peer runtime,
- add media manifests,
- add private chat,
- add public index infrastructure,
- define final descriptor schemas.

## Required follow-up

- Add `docs/implementation/adaptive-reachability-integration-plan.md`.
- Add a threat model for adaptive reachability and temporary infrastructure before implementation.
- Add descriptor fixtures before runtime descriptor acceptance.
- Update current-state/planning-to-code docs later only after this ADR is accepted and implementation lands.
