# ADR-008: Adaptive Reachability and Ephemeral Infrastructure v1

- Status: Proposed
- Date: 2026-06-23

This ADR reserves a documentation slot for adaptive reachability. The detailed doctrine is intentionally split across protocol, implementation, and threat-model documents so future work can review each concern independently.

Core decision: infrastructure improves reachability but does not become protocol authority.

Permanent authority remains in local-first primitives: identity, capabilities, signed events, content references, encryption policy, local trust policy, and deterministic apply rules.

Infrastructure surfaces remain replaceable: bridge, relay, and super peer. Handoff, signaling, mailbox, streaming, forwarding, discovery, availability, and replication are capabilities that a surface may advertise.

Durable Streams remain the live-delivery abstraction. WebSocket is the current adapter.

WebRTC is split into signaling, DataChannel sync/event traffic, and media tracks for voice/video.

MLS is group key management, not transport.

Optional tunnel adapters and future full-peer runtimes must remain adapters, not protocol authorities.

IPFS-compatible storage remains optional content-addressed storage, not identity, trust, transport, or latest-state authority.

Final descriptor schemas are not accepted by this ADR. They require fixtures and a separate implementation slice.
