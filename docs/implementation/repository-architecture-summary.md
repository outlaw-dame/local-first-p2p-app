# Repository Architecture Summary

This repository is a local-first trust-centric object network.
The first product is a PWA-first local-first light peer, but the architecture is designed to remain hybrid-ready and compatible with future full peers, relays, and persistent availability peers.

## What this repository is

- Local-first
- PWA-first initially
- Hybrid P2P
- Bridge-assisted
- Eventually full peer capable
- Secure messaging first as an application layer
- Groups and content sharing later
- Social features later
- Protocol-first architecture

## Canonical model

The repository is built around a protocol-first object model with the following core primitives:

- Signed Events
- Identity
- Capabilities
- Content Objects
- Trust Decisions
- Replication

These are the first-class architectural concerns.

## What this is not

This repo is not a project authority for:

- ActivityPub
- ActivityPods
- ATProto
- Memory
- ActivityStreams
- WebIDs / Solid Pods
- Mastodon compatibility
- RDF / Jena
- Bluesky moderation semantics as protocol requirements

Those systems may inspire ideas, but they are not the architecture authority for this repository.

## Content addressing

The canonical approach is an IPLD-style content-addressed object graph that is CID-compatible but not IPFS dependent.

Protocol primitives include:

- `DigestRef`
- `ContentLink`
- `BlockRef`
- `ObjectRef`
- `BundleRef`
- `StorageLocationHint`

This is about object integrity, not storage network authority, routing, or trust.

## Capabilities vs VCs

Capabilities are the primary primitive for authority in this architecture.

- VCs answer: who claims what?
- Capabilities answer: who can do what?

Examples of capabilities:

- `invite user`
- `create room`
- `moderate room`
- `issue labels`
- `approve join request`
- `operate relay`
- `store bundle`
- `publish bridge admission decision`

VCs can support capabilities, but they do not replace them.

## VC semantics

A verifiable credential (VC) in this repo is a signed claim, not a source of automatic trust.

Examples:

- This device belongs to Damon
- This relay operator was approved by Organization X
- This user is a moderator in Community Y
- This scanner service passed audit Z

Local policy decides whether any of those claims matter.

## Trust and safety

Trust is evaluated through scoped authority and local policy, not centralized global moderation.
The trust and safety model includes:

- Local controls
- Community controls
- Bridge controls
- Relay controls
- Super-peer controls
- Labelers
- Reports
- Appeals
- Annotations

Authority is scoped, not global.

## Integrity separation

The architecture separates three integrity concerns:

- Identity integrity (`Controller` signatures, `Device` signatures, capability signatures)
- Object integrity (`DigestRef`, `ContentLink`, `CID`, `BlockRef`, `BundleRef`)
- Capability integrity (`Grant`, `Revoke`, `Expiry`, `Delegation`)

Keeping these concerns separate keeps the architecture cleaner.

## Versioning discipline

The repo is already enforcing versioning discipline at the protocol layer (for example `lfp2p.event.v1` and `schemaVersion`).
Additional versioning targets include:

- Trust objects
- Capability objects
- Content refs
- Bundle formats
- Policy versions

## Recommended sequence

The most correct order for the next foundational work is:

1. Phase 1.56: Content Addressing
2. Phase 1.61: Trust & Safety Protocol Core
3. Phase 1.62: Local User Controls
4. Phase 1.63: Trust Policy Engine
5. MLS, Groups, Chat, Media

The architecture is strongest when the trust engine, content addressing, capabilities, and policy evaluation are established before adding MLS/chat/media/public social features.

## Non-goals for architecture authority

This repo deliberately avoids treating the following as protocol authorities:

- Messaging first
- Social first
- Fediverse first
- Blockchain first

Those are application layers built on top of the foundational primitives above.
