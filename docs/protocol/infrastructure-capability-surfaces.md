# Infrastructure Capability Surfaces

- Status: Draft
- Date: 2026-06-23
- Related ADR: `docs/adr/008-adaptive-reachability-and-ephemeral-infrastructure-v1.md`
- Extends, does not replace: `docs/protocol/bridge-admission-doctrine.md`

## Purpose

This doctrine clarifies vocabulary for future reachability work. It avoids adding a new server type for every networking task.

## Core rule

Keep these as infrastructure surfaces:

- `bridge`
- `relay`
- `super-peer`

Treat these as capabilities:

- `handoff`
- `signaling`
- `mailbox`
- `streaming`
- `forwarding`
- `discovery`
- `availability`
- `replication`

## Surface definitions

### Bridge

A bridge is protocol-aware helper infrastructure for light peers and constrained peers. It can receive signed envelopes, verify signatures, enforce bridge-local admission, deduplicate retries, store bridge-safe records, provide catch-up reads, and provide live delivery through Durable Streams adapters.

A bridge may later provide handoff, signaling, mailbox, discovery, or limited forwarding capabilities. A bridge must not decrypt private payloads, inspect private content, or become global authority.

### Relay

A relay is reachability infrastructure. It helps traffic reach another peer when a direct path is unavailable or unreliable. A relay should stay narrow and avoid becoming a protocol or storage surface by accident.

Relay success is not replication success. A delivered frame still needs signed-envelope validation, replay checks, capability checks, and deterministic apply.

### Super peer

A super peer is durable or high-availability helper infrastructure. It may keep authorized objects available, help group/public replication, publish storage hints, provide introductions, or expose bridge/relay-compatible capabilities.

A super peer is not a central server and does not own latest state.

## Capability definitions

`handoff` helps peers move from one reachability state to another.

`signaling` exchanges session-establishment metadata.

`mailbox` temporarily stores encrypted/signed deliveries for offline recipients.

`streaming` provides live delivery through Durable Streams adapters. WebSocket is only the current adapter.

`forwarding` moves traffic when direct reachability fails.

`discovery` advertises descriptors for peers or infrastructure surfaces.

`availability` keeps authorized bytes reachable while the origin peer is offline.

`replication` participates in protocol/object replication under normal validation and capability rules.

## WebRTC separation

WebRTC must be documented as three concerns:

- signaling for setup;
- DataChannels for sync/event/control traffic;
- media tracks for voice, video, and screen sharing.

## MLS separation

MLS belongs above delivery paths as group key management. It does not replace bridge, relay, WebRTC, mailbox, or full-peer runtime work.

## Dynamic descriptor principle

Infrastructure descriptors are hints. A valid descriptor only means the surface is eligible to consider. Local policy still decides whether and how to use it.

Unknown infrastructure starts neutral and constrained. Lack of history is not the same as negative evidence.

## IPFS-compatible storage principle

IPFS-compatible locations belong under content-addressed storage hints. They do not define identity, trust, latest state, or transport authority.
