# Protocol Design Principles

- Status: Draft
- Specification series: 1
- Specification version: 0.x
- Scope: design rules derived from protocol philosophy
- Profiles: all
- Related:
  - `docs/specification/00-philosophy/protocol-philosophy.md`
  - `docs/specification/DESIGN_GOALS.md`
  - `docs/specification/TEMPLATE.md`

## Purpose

This document translates the protocol philosophy into reviewable design rules.

Future protocol specifications SHOULD use these principles when deciding object semantics, authority boundaries, transport behavior, profile requirements, and extension rules.

## Principle 1 — Authority Before Availability

Protocol records MUST be valid by cryptographic and deterministic protocol rules before they are applied to authority-sensitive state.

Availability providers MAY help locate, store, deliver, cache, or index records. They MUST NOT make invalid records valid.

## Principle 2 — Availability Is Plural

The protocol SHOULD support multiple availability paths for the same record or object.

Examples include:

- local device replica;
- another authorized device;
- friend/peer cache;
- bridge backlog;
- mailbox provider;
- super-peer store;
- Hypercore/Corestore-backed availability;
- IPFS-compatible provider;
- local network transfer;
- portable sync drop.

Clients SHOULD treat provider locations as hints or routes, not as canonical truth.

## Principle 3 — Transport Is Replaceable

Transport adapters move bytes.

A protocol feature SHOULD NOT depend on a single transport unless it is explicitly a transport extension.

Where practical, records SHOULD be portable across HTTP bridge transport, direct P2P, WebRTC, HyperDHT/Holepunch, Hypercore replication, local discovery, Bluetooth/local-nearby sync, and file/import export paths.

## Principle 4 — Durable State Is Distinct From Delivery State

Delivery state tracks attempts, acceptance by providers, fetch, ACK, receipt, retry, rejection, expiry, and garbage collection.

Durable state is the user's validated local or replicated protocol state.

Specifications MUST state when a delivery record becomes durable state, if ever.

## Principle 5 — App Projection Is Not Protocol Semantics

An application MAY present the same protocol primitive as a timeline item, channel message, comment, notification, moderation item, or feed candidate.

The projection MUST NOT change the underlying protocol semantics.

## Principle 6 — Every Primitive Has A Consistency Model

Every first-class protocol primitive SHOULD declare its consistency behavior.

Authority-sensitive primitives MUST NOT inherit generic LWW, CRDT, mutable path, or provider-local database semantics by accident.

## Principle 7 — Every Primitive Has Degraded Behavior

Every first-class protocol primitive SHOULD define behavior when:

- no hosted service is reachable;
- the preferred mailbox is unavailable;
- bridges are blocked;
- relays are blocked;
- public indexes disappear;
- search/feed infrastructure is unavailable;
- only local/nearby transfer is available;
- large payloads cannot be fetched.

A feature without degraded behavior SHOULD be treated as an optional extension, not a core survivability feature.

## Principle 8 — Sync Should Be Selective

Implementations SHOULD be able to synchronize subsets of data by identity, device, partition, space, channel, feed, mailbox state, time window, payload size, privacy scope, or sync interest.

The protocol SHOULD avoid requiring full-history replication for ordinary operation.

## Principle 9 — Small Control Data First

Low-bandwidth and degraded modes SHOULD prioritize:

- identity proofs;
- device/capability state;
- revocations;
- key epoch/control records;
- membership checkpoints;
- mailbox headers/receipts;
- small text/control records;
- object references and digests.

Large media, embeddings, search indexes, generated summaries, and long history windows SHOULD be lazy or optional.

## Principle 10 — Providers Declare Capabilities

Providers SHOULD advertise capability descriptors that define what they offer and what they do not offer.

Provider descriptors SHOULD include admission, retention, privacy, rate-limit, profile, extension, and transport information where applicable.

Provider descriptors MUST NOT be treated as proof of authority.

## Principle 11 — Registry Before Drift

New first-class identifiers SHOULD be registered or reserved before they are widely implemented.

This includes object types, event kinds, capability identifiers, transport identifiers, error codes, media types, cryptographic algorithms, and availability surfaces.

## Principle 12 — Security Considerations Are Required Design Work

A feature specification SHOULD NOT be considered complete until it names security, privacy, interoperability, low-bandwidth, and degraded-infrastructure considerations.

Security-sensitive features MUST define safe failure behavior.

## Principle 13 — Extensions Must Be Capability-Gated

Optional behavior SHOULD be advertised and negotiated through capability identifiers or profile declarations.

Extensions MUST NOT silently change core object meaning, authority rules, or validation behavior.

## Principle 14 — Implementation Behavior Is Not Automatically Normative

The reference implementation may contain staging behavior, temporary shortcuts, bridge-specific assumptions, or package-local event families.

A behavior becomes normative only when the specification defines it or an ADR explicitly accepts it as protocol behavior.

## Principle 15 — Review Small, Specify Clearly

Protocol evolution SHOULD happen through small, reviewable specification changes.

Large architecture shifts SHOULD be split into:

1. glossary and registry changes;
2. design/ADR rationale;
3. normative object or state-machine spec;
4. implementation plan;
5. conformance fixtures/tests.

## Conformance impact

These principles are not a standalone conformance profile. Later profile documents SHOULD cite the principles they rely on and convert them into testable requirements where appropriate.
