# Infrastructure Capability Surfaces

- Status: Draft
- Date: 2026-06-23
- Related ADR: `docs/adr/008-adaptive-reachability-and-ephemeral-infrastructure-v1.md`
- Extends, does not replace: `docs/protocol/bridge-admission-doctrine.md`

## Purpose

This doctrine clarifies infrastructure vocabulary so implementation can proceed without node-role drift.

The protocol should not multiply server types for every networking job. Instead, it should preserve a small set of infrastructure surfaces and let each surface advertise explicit capabilities.

## Core rule

Keep these as infrastructure surfaces:

- `bridge`
- `relay`
- `super-peer`

Treat these as capabilities, not standalone node types:

- `handoff`
- `signaling`
- `mailbox`
- `streaming`
- `forwarding`
- `discovery`
- `availability`
- `replication`

This keeps the architecture understandable while preserving the different risk models already recognized by the bridge / relay / super-peer admission doctrine.

## Surface definitions

### Bridge

A bridge is protocol-aware infrastructure for light peers and other constrained peers.

A bridge can:

- receive signed envelopes;
- verify signatures before admission;
- enforce bridge-local admission;
- reject bridge-unsafe privacy scopes;
- deduplicate/idempotently handle retries;
- store bridge-safe records;
- provide catch-up/backlog reads;
- publish live delivery through Durable Streams adapters;
- optionally provide handoff, signaling, mailbox, discovery, or limited forwarding.

A bridge must not:

- decrypt private payloads;
- inspect private payload contents;
- become global deletion/moderation authority;
- treat local quarantine as a network-wide ban;
- define identity, capability, or latest-state authority.

### Relay

A relay is reachability infrastructure.

A relay can:

- forward traffic when direct P2P fails;
- assist NAT traversal/session reachability;
- relay encrypted/session traffic;
- apply local admission/rate limits/quarantine;
- advertise limited forwarding capabilities.

A relay should be as dumb as practical. It may need surface-local admission and abuse controls, but it should avoid protocol semantics beyond what is required to protect the operator and prevent unsafe scope routing.

A relay must not:

- decrypt private payloads;
- own durable object state;
- become a bridge by accident;
- present forwarding success as replication success;
- define trust/moderation authority.

### Super peer

A super peer is a durable or high-availability peer/helper.

A super peer can:

- keep authorized objects available;
- participate in group/public replication;
- help mobile/browser light peers catch up;
- provide trusted introductions;
- advertise storage locations;
- expose optional bridge-compatible APIs;
- expose optional relay-compatible forwarding.

A super peer must still obey protocol authorization, privacy-scope limits, capability checks, trust policy, and admission rules. It is not a central server.

## Capability definitions

### `handoff`

A handoff capability helps peers move from one reachability state to another.

Examples:

- helping Peer A discover Peer B's currently reachable descriptors;
- passing WebRTC signaling metadata;
- handing a local mutation from a light peer to a bridge mailbox;
- upgrading from bridge-mediated delivery to direct DataChannel sync;
- moving from a dead bridge to a healthier bridge descriptor.

Handoff should not be modeled as a separate first-class server unless a later ADR proves the need.

### `signaling`

A signaling capability exchanges session establishment metadata.

For WebRTC, this may include offers, answers, and ICE candidates. For future transports, it may include equivalent rendezvous material.

Signaling data must not be confused with trusted protocol data. It is transport setup material and should be authenticated or bound to expected peer/device fingerprints where practical.

### `mailbox`

A mailbox capability temporarily stores bridge-safe encrypted/signed deliveries while a recipient is offline.

Mailbox storage must be explicitly scoped and bounded:

- retention TTL;
- byte limits;
- privacy-scope allowlist;
- no private payload decryption;
- recipient or group capability binding;
- replay/idempotency handling;
- deletion/expiration behavior.

Mailbox is not the user's durable source of truth.

### `streaming`

A streaming capability provides live delivery notifications or records.

The architecture-level primitive is Durable Streams. WebSocket is currently one adapter. SSE, long-poll, WebTransport, or future bindings may be added later if they preserve source-of-truth and privacy behavior.

The store remains source of truth. The stream broker must not cache record bodies as durable state.

### `forwarding`

A forwarding capability relays traffic when direct reachability fails.

Forwarding does not imply storage, mailbox, trust, or protocol authority. It should be short-lived, bounded, observable in privacy-safe ways, and easy to replace.

### `discovery`

A discovery capability returns or advertises descriptors for peers, bridges, relays, super peers, storage locations, or bootstrap registries.

Discovery output is a hint. It must be validated and scored locally. A discovered descriptor is not automatically trusted.

### `availability`

An availability capability keeps authorized objects/blocks/events reachable while an origin peer is offline.

Availability must respect encryption and capability boundaries. A node may make bytes available without being able to decrypt or interpret them.

### `replication`

A replication capability participates in protocol/object replication.

Replication requires deterministic apply rules, signed-envelope validation, capability checks, privacy-scope checks, and stale/replay behavior. Forwarding traffic is not the same as replication.

## Redundancy guidance

Avoid creating separate packages or runtimes named after every capability. Prefer capability modules behind surface-specific adapters.

Good:

```txt
bridge-service
  capabilities/
    signaling
    mailbox
    durable-streaming

super-peer
  capabilities/
    availability
    group-replication
    introductions

sync-client
  transports/
    http-bridge
    durable-stream
    webrtc-datachannel
    holesail-like
```

Risky:

```txt
handoff-server
signaling-server
mailbox-server
relay-server-that-also-stores-envelopes
bridge-that-silently-acts-as-super-peer
```

## Scope safety

The safe-scope matrix from `bridge-admission-doctrine.md` remains authoritative until replaced by a later ADR:

- `bridge`, `relay`, `media-store`: `dm`, `group`, `public`
- `super-peer`: `group`, `public`
- `public-index`: `public`
- `device-local` and `self` never traverse infrastructure surfaces

Capability advertisements must not widen these scopes. A surface can advertise fewer scopes than the doctrine allows, never more.

## Trust-aware connectivity

Connectivity selection should be trust-aware without creating an incumbency problem.

Unknown infrastructure starts neutral and constrained, not malicious.

Recommended decision states:

- `allow`
- `allow-with-limits`
- `prefer-known-peer`
- `quarantine`
- `deny`

New descriptors with valid signatures, valid expiry, safe scopes, and no negative evidence should normally be eligible for `allow-with-limits`.

Examples of initial constraints:

- lower rate limits;
- smaller backlog windows;
- no privileged routing;
- no private mailbox use without stronger binding;
- no automatic availability delegation;
- shorter descriptor TTL;
- explicit user confirmation for sensitive flows.

## Dynamic descriptors

Infrastructure descriptors are hints, not authority.

Descriptor validation should check:

- known version;
- supported surface type;
- signature validity;
- operator/surface key binding;
- expiration;
- address shape;
- transport allowlist;
- capability allowlist;
- safe-scope subset;
- no URL credentials;
- no private network access unless explicitly allowed by runtime policy;
- key-continuity rules when a prior descriptor exists.

A valid descriptor only means "eligible to consider." Local policy still decides whether and how to use it.

## IPFS-compatible storage

IPFS-compatible storage belongs under content-addressed storage hints. It does not replace bridge, relay, super-peer, or sync-client transports.

Use IPFS-compatible locations for:

- media blobs;
- large blocks;
- bundles;
- CAR archives;
- replicated public/group-authorized content where appropriate.

Do not use IPFS-compatible storage for:

- identity authority;
- latest-state authority;
- trust scores;
- moderation authority;
- private plaintext;
- mandatory transport.

CID/content-link verification proves byte identity only. Availability, authorization, encryption, safety, and relevance are separate protocol decisions.

## Implementation warning

Do not add a new network dependency directly to protocol, identity, trust-safety, or content-addressing packages.

New reachability implementations belong behind sync-client/runtime adapters unless a later ADR explicitly changes the package boundary.
