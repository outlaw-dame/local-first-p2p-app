# P2P Technology Integration Plan

- Status: Draft
- Date: 2026-06-24
- Related ADR: `docs/adr/009-p2p-runtime-adapters-and-selective-replication-v1.md`
- Related protocol doc: `docs/protocol/p2p-runtime-adapter-boundaries.md`

## Purpose

This plan maps previously discussed P2P technologies into the roadmap without making any external system the protocol authority.

The project is not a generic P2P experiment. It is a local-first trust-centric object network. External systems may provide runtime paths and design lessons, but the protocol authority remains identity, capabilities, content refs, trust, encryption, and deterministic replication rules.

## Placement summary

| Technology / pattern | Placement | Decision |
| --- | --- | --- |
| Holepunch / Pear | Phase 20A | Adopt as primary candidate for native/full-peer runtime adapter. Keep below protocol identity. |
| Hypercore / Corestore | Phase 20B | Adopt as candidate replication/storage substrate. Do not make feed keys canonical object IDs. |
| Syncthing | Phase 15A influence | Emulate trusted-device clusters, layered discovery, fingerprint UX, and recovery discipline. Do not embed. |
| Willow | Phase 15A + Phase 15/20 | Emulate capability-scoped selective replication. Strong fit with capability-first protocol authority. |
| MLS | Phase 3/4/12 | Required for group key management. Not a transport and not redundant with WebRTC/Holepunch. |
| Noise | Phase 20A runtime concern | Use where provided by Holepunch/HyperDHT-style secure channels. Do not invent an extra custom secure-channel layer yet. |
| Tox | Phase 15A influence | Study friend-first discovery and relay fallback. Do not adopt protocol semantics. |
| Kademlia | Phase 20C influence | Study conceptually. HyperDHT likely satisfies native DHT role. |
| mDNS / LSD | Phase 6/15A/20C | Add first-class local discovery descriptors for same-network sync. Discovery is not trust. |
| ICE/STUN/TURN | Phase 9-11 | Keep for browser/WebRTC signaling, DataChannels, and media tracks. |
| PeX | Phase 6/20C | Implement as privacy-scoped peer hints. Avoid social-graph leakage. |
| Magnet links | Phase 16/21 | Implement local-first `lfp2p://` or `web+lfp2p://` refs over ObjectRef/BundleRef. Not BitTorrent-compatible magnets. |
| µTP / LEDBAT | Phase 20/21 scheduling | Emulate congestion-aware background replication. Do not require raw µTP. |
| Peer-assisted delivery | Phase 20D/21 | Use for public/cacheable assets and encrypted capability-scoped bundles. Not private plaintext. |

## Phase 15A — P2P runtime adapter doctrine

Add after super-peer availability design and before storage fetchers/full-peer implementation.

Goals:

- define runtime adapter contamination firewall;
- define authorized runtime-key chain;
- define selective replication doctrine;
- define local discovery and peer-hint safety;
- define portable reference direction;
- define peer-assisted delivery boundaries.

Exit criteria:

- runtime keys are documented as subordinate to controller/device authority;
- Hypercore/Pear/Holepunch are documented as adapters;
- peer hints are documented as privacy-scoped hints;
- local discovery is documented as candidate discovery only;
- peer-assisted delivery is documented as byte movement, not authorization.

## Phase 20A — Holepunch / Bare / Pear adapter

Purpose:

Native/full-peer runtime adapter.

Steps:

1. Runtime package boundary.
2. Pear/Bare process boundary decision.
3. Holepunch connection lifecycle design.
4. Runtime identity binding to controller/device-authorized replication keys.
5. Descriptor integration.
6. Secure-channel assumptions and threat model.
7. Direct stream mapping to `PeerTransport` / `PeerSession`.
8. Failure/fallback behavior.
9. Tests for wrong peer key, revoked device, malformed stream, replay, and scope widening.

Non-goals:

- no protocol package imports;
- no account identity replacement;
- no object ID replacement;
- no MLS replacement;
- no trust/moderation authority.

## Phase 20B — Hypercore / Corestore replication substrate

Purpose:

Map protocol objects and bundles into a native/full-peer replication substrate.

Steps:

1. Define mapping from ObjectRef/BundleRef/BlockRef to adapter-local storage.
2. Define feed/key authorization records.
3. Define feed lifecycle and rotation behavior.
4. Define deterministic apply after feed read.
5. Define encrypted/private payload handling.
6. Define public/group/private storage separation.
7. Define garbage collection and retention policy.
8. Add fixtures mapping protocol refs to substrate coordinates.

Rules:

- Hypercore feed keys are not canonical object IDs;
- feed order is not protocol order unless projected by signed events;
- Corestore availability is not authorization;
- fetched bytes must be verified against protocol refs.

## Phase 20C — Local discovery + DHT + PeX-like peer hints

Purpose:

Add discovery layers without leaking private topology or granting trust.

Steps:

1. mDNS/LSD descriptor advertisement for local peers.
2. HyperDHT descriptor discovery for native/full peers.
3. Privacy-scoped PeX-like peer hints.
4. Descriptor expiry and revocation behavior.
5. Fingerprint/petname pairing UX integration.
6. Unknown peer neutral/constrained policy.
7. Abuse controls for hint flooding.
8. Tests for private-scope leakage prevention.

Rules:

- discovery returns candidates;
- candidates require descriptor validation;
- peer hints expire;
- group/private hints must not leak public membership graphs.

## Phase 20D — Peer-assisted bundle delivery

Purpose:

Use peers to assist delivery of safe byte classes.

Allowed byte classes:

- public/cacheable media;
- public bundles;
- community archives;
- app assets;
- model files;
- emoji/sticker packs;
- encrypted capability-scoped private/group bundles.

Forbidden byte classes:

- private plaintext;
- unauthorized group/private bytes;
- mutable latest-state claims without protocol verification.

Steps:

1. Define eligible content classes.
2. Define capability checks for encrypted private/group bundles.
3. Define bandwidth and device constraints.
4. Define congestion-aware scheduling inspired by µTP/LEDBAT.
5. Define verification after fetch.
6. Define failover to bridge/super-peer/storage hints.
7. Add tests for byte verification and private plaintext exclusion.

## `lfp2p://` portable references

Portable references should be introduced after content-addressed fetcher discipline is stable.

Candidate shapes:

```txt
lfp2p://object/<object-ref>
lfp2p://bundle/<bundle-ref>
web+lfp2p://object/<object-ref>
web+lfp2p://bundle/<bundle-ref>
```

References may include storage/discovery hints, but they cannot bypass authorization or freshness checks.

## Syncthing-inspired device trust

Use in pairing and device management:

- explicit device approval;
- fingerprint comparison;
- local/global/relay discovery separation;
- user-visible device names/petnames;
- conservative recovery behavior.

Do not inherit Syncthing's folder/filesystem model.

## Willow-inspired selective replication

Use in replication filters:

- capability-scoped data subsets;
- namespace/range-style replication planning where useful;
- local policy controls what leaves a device;
- revoked capabilities stop future sharing;
- encrypted bytes can replicate without plaintext access.

## Tox-inspired lessons

Study only:

- friend-first peer discovery;
- relay fallback;
- offline messaging considerations;
- simple user mental model.

Do not adopt Tox identity, DHT, messaging, or group semantics as protocol authority.

## Immediate documentation follow-up

Patch roadmap docs to add:

- Phase 15A: P2P runtime adapter doctrine;
- Phase 20B: Hypercore/Corestore replication substrate;
- Phase 20C: local discovery + HyperDHT + PeX-like peer hints;
- Phase 20D: peer-assisted bundle delivery.

## Implementation warning

Do not start runtime dependency work until after:

- private payload envelope;
- MLS ADR/control records;
- bridge resumability;
- adaptive descriptors;
- sync-client transport abstraction;
- WebRTC signaling/DataChannel baseline;
- super-peer availability design;
- P2P runtime adapter doctrine.
