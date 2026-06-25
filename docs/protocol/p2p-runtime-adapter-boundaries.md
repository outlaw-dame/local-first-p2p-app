# P2P Runtime Adapter Boundaries

- Status: Draft
- Date: 2026-06-24
- Related ADR: `docs/adr/009-p2p-runtime-adapters-and-selective-replication-v1.md`

## Purpose

This document defines the boundary between protocol authority and P2P runtime adapters.

It exists to prevent external runtime systems from contaminating the local-first protocol model.

## Authority layer

These are protocol authority:

- controller identity;
- device identity;
- identity-control events and projections;
- capability grants and verifier registry state;
- signed event envelopes;
- content/object references;
- private payload encryption envelopes;
- future MLS group state;
- trust policy;
- deterministic replication/apply rules.

## Adapter layer

These are adapters or hints:

- Holepunch runtime identity;
- Pear process identity;
- Hypercore keys;
- Corestore storage coordinates;
- HyperDHT records;
- WebRTC fingerprints;
- STUN/TURN/ICE candidates;
- mDNS/LSD advertisements;
- PeX-like peer hints;
- bridge descriptors;
- relay descriptors;
- super-peer descriptors;
- storage provider hints;
- `lfp2p://` reference hints.

Adapter identifiers can be authorized by protocol identity and capabilities, but they do not define protocol identity by themselves.

## Required authorization chain

Every runtime key or runtime endpoint must be subordinate to protocol authority.

```txt
controller
→ device
→ authorized runtime/replication key
→ adapter session/feed/stream
```

A runtime adapter may cache, replicate, stream, or discover protocol data only after local policy confirms that the adapter is authorized for the relevant scope.

## Hypercore/Corestore boundary

Hypercore feeds may store or replicate protocol objects, blocks, or bundles. A Hypercore feed key is not a canonical object ID.

Allowed:

- map a BundleRef to adapter-local Hypercore storage;
- use Corestore for block availability;
- announce feed availability through descriptors;
- use signed protocol envelopes inside replicated streams;
- verify ObjectRef/BundleRef/ContentLink after fetching.

Forbidden:

- treat a Hypercore feed key as account identity;
- treat feed order as deterministic protocol order unless explicitly projected by signed events;
- skip signed-envelope verification because bytes arrived from a known feed;
- let Corestore decide object authorization;
- leak private payloads into public feeds.

## Pear/Holepunch boundary

Pear/Holepunch may provide runtime packaging, peer reachability, NAT traversal, DHT discovery, and native full-peer operation.

Pear/Holepunch must not own:

- controller identity;
- device authorization;
- capability authority;
- trust policy;
- MLS group state;
- object validity;
- moderation policy.

## Local discovery boundary

mDNS/LSD discovery can help same-network devices find each other.

Rules:

- advertisements are candidate descriptors;
- candidates still require validation;
- unknown local peers start neutral/constrained;
- fingerprint comparison/petnames should be used for pairing;
- local discovery must not widen privacy scopes.

## Peer hint boundary

PeX-like peer hints can improve availability and routing but must be privacy-scoped.

Rules:

- peer hints must expire;
- peer hints should be scoped to public, group, object, or bundle context;
- private group membership must not leak through public hints;
- hints are not social-graph truth;
- hints are eligible-to-consider records only.

## Portable reference boundary

`lfp2p://` or `web+lfp2p://` references should point to protocol refs, not adapter-specific truth.

Allowed contents:

- ObjectRef;
- BundleRef;
- ContentLink;
- storage hints;
- optional discovery hints;
- optional expected controller/device refs;
- optional expiration.

Forbidden contents:

- private keys;
- bearer secrets;
- private plaintext;
- claims that bypass capability checks;
- claims that override object freshness/trust policy.

## Peer-assisted delivery boundary

Peer-assisted delivery may move bytes, not authority.

Allowed:

- public/cacheable assets;
- public bundles;
- app/model/emoji assets;
- encrypted private/group bundles when capability and encryption rules allow.

Forbidden:

- private plaintext;
- unauthorized private/group bytes;
- treating byte availability as authorization;
- treating delivery success as deterministic apply success.

## Noise / transport security boundary

Transport security protects sessions. It does not replace signed envelopes, payload encryption, MLS, capabilities, or trust policy.

If a runtime already uses Noise or equivalent secure channels, use that rather than adding a custom second secure-channel layer.

## Implementation rule

Do not import Holepunch, Hypercore, Pear, DHT, WebRTC, or storage-provider runtime dependencies into protocol, identity, trust-safety, or content-addressing packages unless a later ADR explicitly changes the boundary.

Runtime dependencies belong in runtime adapter packages or apps.
