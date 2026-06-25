# P2P Technology Integration Plan

- Status: Draft
- Date: 2026-06-24
- Related ADR: `docs/adr/009-p2p-runtime-adapters-and-selective-replication-v1.md`
- Related protocol doc: `docs/protocol/p2p-runtime-adapter-boundaries.md`

## Purpose

This plan maps the discussed P2P technologies into the roadmap without making any external system the protocol authority.

The protocol authority remains identity, capabilities, content references, trust policy, encryption policy, and deterministic apply rules.

## Placement summary

| Technology / pattern | Placement | Decision |
| --- | --- | --- |
| Holepunch / Pear | Phase 20A | Primary candidate for native/full-peer runtime adapter. |
| Hypercore / Corestore | Phase 20B | Candidate replication/storage substrate. Feed keys are not object IDs. |
| Syncthing | Phase 15A influence | Emulate trusted-device UX, layered discovery, and recovery discipline. Do not embed. |
| Willow | Phase 15A + Phase 15/20 | Emulate capability-scoped selective replication. |
| MLS | Phase 3/4/12 | Required group key management. Not transport. |
| Noise | Phase 20A runtime concern | Use where provided by selected runtime. Do not add a custom layer yet. |
| Tox | Phase 15A influence | Study friend-first discovery and fallback ideas only. |
| Kademlia | Phase 20C influence | Conceptual model; HyperDHT likely covers the native DHT role. |
| mDNS / LSD | Phase 6/15A/20C | Local discovery descriptors for same-network sync. |
| ICE/STUN/TURN | Phase 9-11 | Browser/WebRTC path. |
| PeX | Phase 6/20C | Privacy-scoped peer hints. |
| Magnet-style references | Phase 16 / Later phases | Local-first `lfp2p://` / `web+lfp2p://` refs over ObjectRef/BundleRef. |
| µTP / LEDBAT ideas | Phase 20D / Later phases | Background transfer scheduling inspiration. |
| Peer-assisted delivery | Phase 20D / Later phases | Public/cacheable and encrypted capability-scoped bundles only. |

## Phase 15A — P2P runtime adapter doctrine

Add after super-peer availability design and before storage fetchers/full-peer implementation.

Goals:

- define the runtime adapter boundary;
- define the authorized runtime-key chain;
- define selective replication doctrine;
- define local discovery and peer-hint safety;
- define portable reference direction;
- define peer-assisted delivery boundaries.

Exit criteria:

- runtime keys are documented as subordinate to controller/device authority;
- Hypercore, Pear, and Holepunch are documented as adapters;
- peer hints are documented as privacy-scoped hints;
- local discovery is documented as candidate discovery only;
- peer-assisted delivery is documented as byte movement, not authorization.

## Phase 20A — Holepunch / Bare / Pear adapter

Purpose: native/full-peer runtime adapter.

Steps:

1. Runtime package boundary.
2. Pear/Bare process boundary decision.
3. Holepunch connection lifecycle design.
4. Runtime identity binding to controller/device-authorized replication keys.
5. Descriptor integration.
6. Secure-channel assumptions and threat model.
7. Direct stream mapping to `PeerTransport` / `PeerSession`.
8. Failure and fallback behavior.
9. Tests for wrong peer key, revoked device, malformed stream, replay, and scope widening.

Non-goals:

- no protocol package imports;
- no account identity replacement;
- no object ID replacement;
- no MLS replacement;
- no trust or moderation authority.

## Phase 20B — Hypercore / Corestore replication substrate

Purpose: map protocol objects and bundles into a native/full-peer replication substrate.

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

## Phase 20C — local discovery + HyperDHT + peer hints

Purpose: add discovery layers without granting trust.

Steps:

1. mDNS/LSD descriptor advertisement for local peers.
2. HyperDHT descriptor discovery for native/full peers.
3. Privacy-scoped peer hints.
4. Descriptor expiry and revocation behavior.
5. Fingerprint/petname pairing UX integration.
6. Unknown peer neutral/constrained policy.
7. Abuse controls for hint flooding.
8. Tests for private-scope leakage prevention.

Rules:

- discovery returns candidates;
- candidates require descriptor validation;
- peer hints expire;
- private/group hints must not leak public membership graphs.

## Phase 20D — peer-assisted bundle delivery

Purpose: use peers to assist delivery of safe byte classes.

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

## Portable references

Portable references should be introduced after content-addressed fetcher discipline is stable.

Candidate shapes:

```txt
lfp2p://object/<object-ref>
lfp2p://bundle/<bundle-ref>
web+lfp2p://object/<object-ref>
web+lfp2p://bundle/<bundle-ref>
```

References may include storage/discovery hints, but they cannot bypass authorization or freshness checks.

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
