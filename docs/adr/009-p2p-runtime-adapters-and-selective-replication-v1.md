# ADR-009: P2P Runtime Adapters and Selective Replication v1

- Status: Proposed
- Date: 2026-06-24
- Related docs:
  - `docs/adr/008-adaptive-reachability-and-ephemeral-infrastructure-v1.md`
  - `docs/protocol/infrastructure-capability-surfaces.md`
  - `docs/implementation/roadmap-ordering.md`
  - `docs/architecture/architecture-identity.md`

## Context

This repository is a local-first, trust-centric object network. External P2P systems may provide excellent runtime, discovery, transport, and replication ideas, but they must not replace the protocol authority layer.

The canonical authority layer remains:

- identity and identity-control state;
- capabilities and verified proof records;
- content references and object references;
- trust policy;
- encryption policy;
- deterministic replication/apply rules.

Runtime systems sit underneath that layer.

## Decision

Adopt P2P technologies as runtime adapters and design influences, not as equal protocol authorities.

Primary runtime target:

- Holepunch / Pear / Hypercore / Corestore for future full-peer/native-peer replication runtime.

Design influences to emulate:

- Syncthing trusted-device sync and layered discovery;
- Willow capability-scoped selective replication;
- mDNS/LSD local discovery;
- Kademlia-style DHT discovery where provided by HyperDHT;
- PeX-like peer hints with privacy scoping;
- magnet-link-style portable object references using `lfp2p://` or `web+lfp2p://`;
- congestion-aware background replication inspired by µTP/LEDBAT;
- peer-assisted delivery for public/cacheable or encrypted capability-scoped bundles.

Technologies to study but not adopt as protocol semantics:

- Tox friend-first discovery and relay fallback;
- Syncthing wire/storage semantics;
- BitTorrent-compatible magnet semantics;
- raw µTP as a required protocol transport.

## Core boundary rule

Runtime identity is not protocol identity.

Hypercore keys, Pear runtime identity, DHT keys, WebRTC fingerprints, bridge tokens, relay IDs, or local-discovery addresses are not controller identity. They may be authorized by controller/device state, but they do not replace it.

Correct chain:

```txt
controller identity
→ device identity
→ authorized replication/runtime keys
→ runtime adapter identity
```

Invalid chain:

```txt
Hypercore/Pear/DHT key
→ account/controller identity
```

## Holepunch / Pear / Hypercore role

Holepunch/Pear may become the primary full-peer/native runtime path.

Allowed roles:

- native full-peer runtime;
- direct peer replication streams;
- NAT traversal and DHT discovery through the Holepunch stack;
- Corestore/Hypercore storage or log substrate;
- super-peer/persistent-availability runtime substrate;
- peer-assisted delivery for authorized bundles.

Forbidden roles:

- account identity authority;
- capability authority;
- latest-state authority;
- moderation/trust authority;
- canonical object ID authority;
- private decryption authority;
- replacement for deterministic protocol apply rules.

ObjectRef, BundleRef, BlockRef, ContentLink, and signed events remain protocol objects. Hypercore keys and feed IDs are adapter-local replication/storage coordinates unless a later ADR explicitly promotes a reference shape.

## Syncthing lessons

Emulate:

- explicit trusted-device clusters;
- local discovery plus global discovery plus relay fallback layering;
- careful sync recovery and conflict handling;
- user-visible device identity/fingerprint comparison;
- conservative defaults for untrusted devices.

Do not embed Syncthing or inherit its folder/filesystem model as protocol storage.

## Willow lessons

Strongly emulate capability-scoped selective replication.

Selective replication should answer:

```txt
Which peer is authorized to receive which object subset, under which capability, for how long?
```

This aligns with the repository's capability-first design. Runtime adapters should filter replication by protocol capabilities, privacy scopes, and local trust policy before bytes are shared.

## Noise and transport security

Use Noise where the selected runtime already provides it, such as through Holepunch/HyperDHT-style secure channels.

Do not invent a second custom transport-security layer unless a later threat model proves it is required.

Transport security is not payload authorization. Signed envelopes, capability checks, encryption policy, and deterministic apply still run above secure channels.

## Local discovery

mDNS/LSD-style discovery should become a first-class local discovery adapter for same-network sync.

Rules:

- local discovery yields descriptors or candidate peer hints;
- local discovery does not grant trust;
- descriptor validation and fingerprint comparison still apply;
- private scope routing still requires capabilities;
- user/device pairing UX should expose fingerprints or petnames where appropriate.

## DHT discovery

Kademlia should be treated conceptually. HyperDHT likely satisfies the native/full-peer DHT role once Holepunch lands.

DHT discovery yields reachability hints, not authorization.

## Browser reachability

ICE/STUN/TURN remain relevant for browser/WebRTC paths. Native/full peers may prefer Holepunch where available, but browser peers still need WebRTC signaling, ICE, TURN fallback, and DataChannels/media-track separation.

## PeX-like peer hints

Implement peer exchange only as privacy-scoped peer hints.

Peer hints must not leak private social graphs or group membership. A hint is eligible to consider, not trusted state.

A future peer hint should include:

- source peer;
- hinted peer/surface descriptor;
- scope or object/bundle context;
- expiry;
- capability reason where safe;
- signature or authenticated channel provenance where available.

## Magnet-like references

Do not implement BitTorrent-compatible magnets as the canonical reference scheme.

Use portable local-first references over existing protocol objects, for example:

```txt
lfp2p://object/<object-ref>
lfp2p://bundle/<bundle-ref>
web+lfp2p://...
```

These references may include content links, bundle refs, storage hints, and optional discovery hints. They must not override object authorization, trust, encryption, or freshness checks.

## Congestion-aware background replication

Emulate µTP/LEDBAT principles for background replication scheduling:

- yield to foreground traffic;
- respect metered/battery-constrained devices;
- cap concurrent transfers;
- resume safely;
- avoid harming local network quality.

Do not require raw µTP unless a future runtime decision makes it necessary.

## Peer-assisted delivery

Peer-assisted delivery is appropriate for:

- public/cacheable media;
- model files;
- emoji/sticker packs;
- app assets;
- public bundles;
- community archives;
- encrypted capability-scoped private/group bundles.

It is not appropriate for private plaintext or unauthorized payloads.

Encrypted private/group bytes may be assisted only when capability, encryption, and storage-hint rules allow the transfer. Hosting encrypted bytes is not decryption authority.

## Non-goals

This ADR does not:

- implement Holepunch/Pear/Hypercore;
- select a concrete Holepunch package boundary;
- add runtime dependencies;
- replace WebRTC;
- replace bridges or Durable Streams;
- replace MLS;
- define final `lfp2p://` URL syntax;
- define final peer hint schemas;
- implement block/bundle storage adapters.

## Required follow-up

- Add `docs/protocol/p2p-runtime-adapter-boundaries.md`.
- Add `docs/implementation/p2p-technology-integration-plan.md`.
- Update `docs/implementation/roadmap-ordering.md` with Phase 15A and expanded Phase 20A-20D.
- Add a future threat model before runtime implementation.
