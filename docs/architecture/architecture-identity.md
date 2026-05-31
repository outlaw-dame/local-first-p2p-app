# Architecture Identity

This document is the contamination firewall for this repository. Read it before writing any protocol code, adding a dependency, or referencing an external system as a model.

## What this system is

This repository is a **local-first trust-centric object network**.

The first product surface is a PWA-first local-first light peer. The architecture is hybrid-ready and designed to remain compatible with future full peers, relays, bridge operators, and persistent availability peers — all running the same protocol.

## Five first-class primitives

Everything in the architecture is built on top of these five primitives. Features (chat, groups, media, social, search) are application layers built on top of them — not the other way around.

1. **Identity** — Controller, Devices, Capabilities, Recovery, Rotation
2. **Capabilities** — who may do what, on what resource, in what scope
3. **Content** — content-addressed objects with integrity proofs
4. **Trust** — scoped decisions derived from verified evidence and local policy
5. **Replication** — signed objects moved between peers, bridges, relays, and stores

## What this system is NOT

The following external systems may be used as reference or inspiration. They are **not** protocol authority for this repository. Do not import their semantics, naming conventions, actor models, or federation contracts unless a specific ADR explicitly adopts a piece of them.

| System | Status |
|---|---|
| ActivityPub / ActivityStreams | Reference only — no actors, inboxes, outboxes, sharedInbox, or federation semantics |
| ActivityPods / Solid Pods | Reference only — no WebIDs, RDF, Jena, or Pod storage model |
| ATProto / Bluesky | Reference only — no AT repositories, DID plc semantics as protocol requirement, or Bluesky moderation contracts |
| Mastodon | Reference only — no Mastodon compatibility requirements |
| IPFS / Filecoin | CID is used as an integrity primitive only — not as a storage network, routing mechanism, or trust mechanism |
| Hypercore / Pear / Hyperbee | Future replication adapter — Hypercore keys are NOT universal account identities |
| Nostr | Reference only — no Nostr relay or event-kind contracts |
| Blockchain / tokens / gas | Not required — deterministic local policy replaces smart contracts |
| Memory (Damon's other AI project) | Separate project — do not import Memory architecture into this repo |

## Three-layer integrity model

Keep these three concerns separate. Conflating them creates hidden authority and protocol drift.

```
Identity Integrity
  Controller signatures, Device signatures, Capability grant/revoke signatures

Object Integrity
  DigestRef, ContentLink, CID, BlockRef, BundleRef

Capability Integrity
  Grant, Revoke, Expiry, Delegation
```

## Capabilities vs VCs

These answer different questions. Do not use one to replace the other.

- **VC = who claims what** (evidence carrier, not authority)
- **Capability = who may do what** (authority carrier)

A valid VC from an untrusted issuer is preserved as evidence. It does not elevate authority.
Local policy — not the VC itself — decides whether a claim matters.

Example capabilities: `room/invite`, `room/write`, `room/moderate`, `bridge/store`, `relay/replicate`, `label/issue`, `report/review`, `policy/issue`.

Example VC claims: "this device belongs to X", "this user is a moderator in community Y", "this relay operator was approved by organization Z".

## Trust is contextual, not global

The trust engine produces scoped decisions. It does not produce a global `trusted` flag for a person or object.

Decisions are scoped by: subject, actor, device, action, resource, community/group, transport surface, and policy version.

ML risk signals are advisory evidence. They may influence warning, throttling, or quarantine behavior when a deterministic policy rule allows it. ML output cannot grant identity authority, decryption authority, membership authority, or bridge admission authority directly.

## Hypercore / Pear as replication adapters

Hypercore, Pear, Hyperbee, and Hyperdrive are future replication runtime adapters. The correct identity chain is:

```
Controller Identity
  → Device Identity
    → Authorized Replication Keys
      → Hypercore / Pear runtime identities
```

A Hypercore key is not an account identity. A Hypercore feed is not a protocol-level object store. Protocol-level objects use `DigestRef`, `ContentLink`, `BlockRef`, `ObjectRef`, and `BundleRef` — not Hypercore-native structures.

## Content addressing semantics

The canonical approach is an IPLD-style content-addressed object graph that is CID-compatible but not IPFS-dependent.

CID is used as an **integrity primitive**: a stable, verifiable identifier for a specific byte sequence. It is not:
- a storage network address
- a routing mechanism
- a trust mechanism
- a protocol authority

## Versioning discipline

All protocol objects are versioned. Examples: `lfp2p.event.v1`, `lfp2p.content-addressing.v1`, `schemaVersion`. Future versioning targets include trust objects, capability objects, content refs, bundle formats, and policy versions.

Never ship a protocol object without a version field.

## Phase order enforcement

The foundational layers must exist before application layers. Do not start chat, MLS, media, public social, or production bridge deployment until the trust engine, content addressing, capabilities, and policy evaluation gates are closed.

Correct sequence:

1. Phase 1.56 — Content Addressing (partial)
2. Phase 1.61 — Trust & Safety Protocol Core
3. Phase 1.62 — Local User Controls
4. Phase 1.63 — Trust Policy Engine
5. MLS, Groups, Chat, Media

See `docs/implementation/phase-map.md` and `docs/implementation/next-development-path.md` for current status.
