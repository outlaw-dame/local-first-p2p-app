# Local-First P2P Protocol Specification

- Status: Draft
- Specification series: 0
- Scope: implementation-independent protocol specification framework

## Purpose

This directory contains the implementation-independent specification for the local-first hybrid P2P protocol.

The specification is separate from:

- the reference implementation in this repository;
- implementation notes under `docs/implementation/`;
- existing protocol design notes under `docs/protocol/`;
- architecture decision records that explain why decisions were made.

The specification defines what interoperable implementations MUST, SHOULD, and MAY do. The reference implementation is expected to conform to this specification, but the specification is not limited to this TypeScript codebase.

## Relationship to existing docs

Existing docs remain valid as design notes, implementation notes, or historical planning material. This specification tree will gradually absorb normative protocol requirements as they become stable enough to define implementation-independent behavior.

When a specification document conflicts with an implementation note, the implementation note should be updated or the conflict should be resolved by an ADR. Do not silently treat implementation behavior as normative protocol behavior.

For the current inventory of older shipped/planned slices that need to be mapped into this specification tree, see `docs/implementation/specification-reconciliation.md`.

## Specification goals

The protocol is designed for:

- local-first operation;
- P2P survivability;
- user-owned portable data;
- cryptographic authority;
- infrastructure that improves UX/DX without becoming authority;
- efficient operation over constrained networks;
- optional hosted infrastructure;
- strong interoperability across different app shapes;
- graceful degradation under outages, blocking, or censorship;
- extensibility without fragmentation.

See `DESIGN_GOALS.md` for the complete goal and non-goal set.

## Normative language

Specification documents use RFC-style normative terms:

- MUST / MUST NOT
- SHOULD / SHOULD NOT
- MAY
- REQUIRED
- RECOMMENDED
- OPTIONAL

See `RFC2119.md` for how these terms are used in this specification.

## Status levels

Each specification document should declare one status:

- Draft
- Experimental
- Review
- Candidate
- Stable
- Deprecated
- Superseded

See `SPEC_STATUS.md`.

## Specification structure

```txt
docs/specification/
  README.md
  DESIGN_GOALS.md
  VERSIONING.md
  CONFORMANCE.md
  CHANGELOG.md
  GLOSSARY.md
  RFC2119.md
  PROFILES.md
  REGISTRIES.md
  SECURITY_MODEL.md
  SPEC_STATUS.md
  TEMPLATE.md

  00-philosophy/
  01-core/
  02-identity/
  03-data/
  04-sync/
  05-mailbox/
  06-social/
  07-availability/
  08-security/
  09-profiles/
  adr/
```

The numbered directories are reserved for follow-up specification series.

## Series roadmap

- Series 0: specification framework, vocabulary, versioning, conformance, registries, status model.
- Series 1: protocol philosophy, authority model, layer model, design principles.
- Series 2: identity, devices, capabilities, User Data Root, replica model.
- Series 3: data model, partitions, entities, components, snapshots, object refs, content addressing.
- Series 4: selective sync, low-bandwidth profile, portable sync drops, checkpoints.
- Series 5: mailbox, delivery envelopes, inbox/outbox, receipts, acknowledgements, forwarding, retention.
- Series 6: social primitives, spaces, channels, feeds, threads, collections, presence, roles.
- Series 7: availability providers, bridges, relays, super-peers, search, feed generators.
- Series 8: security, MLS integration, threshold authority, FROST, recovery.
- Series 9: conformance profiles and extension registry maturation.

## No undocumented primitive rule

No new first-class protocol primitive should be implemented without:

1. a specification section or tracked draft;
2. a glossary entry;
3. registry impact review;
4. conformance impact review;
5. security and privacy considerations;
6. interoperability considerations;
7. low-bandwidth and degraded-infrastructure behavior.

This rule applies to protocol objects, authority types, transport capabilities, social constructs, synchronization mechanisms, availability surfaces, and security models.
