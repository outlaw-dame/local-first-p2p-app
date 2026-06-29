# Conformance

- Status: Draft
- Specification series: 0
- Scope: implementation conformance model

## Purpose

This document defines how implementations claim and evaluate conformance to the protocol specification.

Conformance is profile-based. An implementation does not need to implement every protocol feature to be conformant.

## Implementation classes

### Full peer

A full peer stores local protocol state, validates signed records, participates in sync, and can operate without relying on a hosted authority.

### Light peer

A light peer validates the records required for its profile but may rely on availability providers for some storage, discovery, or delivery.

Light peers MUST NOT delegate protocol authority to providers.

### Availability provider

An availability provider improves reachability, delivery, storage durability, discovery, search, feed generation, or relay behavior.

Availability providers MUST declare supported capabilities and MUST NOT claim authority over identity, membership, trust, moderation, or latest state unless a specific authority role is granted by protocol-defined capability.

### Application projection

An application projection presents protocol state as a product experience.

Applications MAY implement only the primitives required by their supported profiles.

## Conformance claims

A conformance claim SHOULD include:

- implementation name and version;
- specification version;
- supported profiles;
- supported extensions;
- supported transports;
- supported availability capabilities;
- unsupported optional features;
- known deviations;
- experimental features;
- test-suite version, when available.

## Required behavior

An implementation claiming support for a profile MUST satisfy all MUST and MUST NOT requirements for that profile.

An implementation claiming support for an extension MUST satisfy all MUST and MUST NOT requirements for that extension.

A conforming implementation MUST NOT silently reinterpret core semantics.

## Partial conformance

An implementation MAY claim partial support for a Draft or Experimental document if it clearly labels the claim as partial or experimental.

Partial claims MUST NOT be presented as stable profile conformance.

## Testability

Stable requirements SHOULD be testable by at least one of:

- conformance fixtures;
- validator tests;
- interop tests;
- state-machine tests;
- cryptographic test vectors;
- serialization fixtures;
- degraded-mode tests.

## Deviation policy

Known deviations SHOULD be documented.

A deviation from a MUST requirement means the implementation is not conformant for the affected profile or extension.

A deviation from a SHOULD requirement may be acceptable if the implementation documents the reason and consequences.

## Security-sensitive conformance

Implementations MUST NOT claim conformance if they skip required signature verification, capability validation, decryption authorization, consistency-class enforcement, replay protection, or authority-layer validation for the supported profile.

## Provider conformance

Availability providers SHOULD publish capability descriptors that include:

- provider identity;
- supported capabilities;
- retention limits;
- privacy posture;
- admission policy;
- supported profiles/extensions;
- transport endpoints or discovery hints;
- rate-limit policy;
- audit-log commitments where applicable.

Provider descriptors are advertisements, not proof of authority. Clients MUST still validate protocol records.
