# Capabilities

- Status: Draft
- Specification series: 2
- Specification version: 0.x
- Scope: scoped authority and feature/provider capability model
- Profiles: Core, Messaging, Social, Availability, Offline, Security
- Related:
  - `docs/specification/01-core/authority-model.md`
  - `docs/specification/REGISTRIES.md`

## Purpose

This document defines capabilities as scoped, verifiable permissions or advertised abilities.

Capabilities are used for authority delegation, provider behavior, feature negotiation, and optional extension support.

## Capability categories

### Authority capabilities

Authority capabilities grant scoped permission to act.

Examples:

- device write scope;
- mailbox route administration;
- Space moderation role;
- Space infrastructure descriptor publication;
- feed generator administration;
- recovery action;
- high-risk key rotation.

### Provider capabilities

Provider capabilities advertise what a service or peer offers.

Examples:

- bridge submission;
- mailbox hosting;
- relay forwarding;
- super-peer availability;
- search indexing;
- feed generation;
- media caching;
- portable sync drop import/export.

### Feature capabilities

Feature capabilities declare supported protocol features.

Examples:

- `core.identity`;
- `core.sync`;
- `core.mailbox`;
- `social.space`;
- `social.feed`;
- `security.mls`;
- `security.frost`;
- `transport.webrtc`;
- `transport.bluetooth`.

## Requirements

- Capabilities MUST be scoped.
- Capabilities MUST NOT imply unrelated authority.
- Authority capabilities MUST be cryptographically verifiable.
- Provider capabilities MUST be treated as advertisements unless bound to explicit authority.
- Extensions SHOULD be capability-gated.
- Capability identifiers SHOULD be registered or namespaced.

## Capability contents

A later stable capability object SHOULD define fields such as:

- capability identifier;
- issuer;
- subject;
- scope;
- allowed actions;
- constraints;
- issuance time or sequence marker;
- expiration, if any;
- revocation reference;
- proof/signature;
- profile or extension applicability.

## Least privilege

Capabilities SHOULD grant the narrowest practical authority.

Examples:

- A mailbox host capability should not imply Space moderation authority.
- A feed generator capability should not imply canonical feed ownership.
- A bridge capability should not imply identity authority.
- A device write capability should not imply recovery authority unless explicitly granted.

## Revocation

Capability revocation is authority-sensitive state.

Revocation MUST be validated before accepting new actions that depend on the capability when applicable revocation state is known.

Revocation MUST NOT be implemented as provider-local deletion alone.

## Provider capability descriptors

Availability providers SHOULD publish descriptors that include:

- provider identity;
- advertised capabilities;
- supported profiles/extensions;
- retention policy;
- privacy posture;
- admission policy;
- transport endpoints or discovery hints;
- rate-limit policy;
- audit/checkpoint commitments where applicable.

A provider descriptor MUST NOT be treated as proof of authority.

## Feature negotiation

Peers MAY use capability identifiers to negotiate optional features.

If a peer does not support a capability, the other peer SHOULD fall back to a lower profile or degraded behavior where safe.

## Validation

Capability-dependent actions MUST validate:

- capability issuer authority;
- subject binding;
- scope;
- action permission;
- constraints;
- expiration;
- revocation state;
- replay/idempotency rules;
- consistency class.

## Low-bandwidth behavior

Capability grants and revocations that affect safety or write authority SHOULD be prioritized in constrained sync.

Provider feature descriptors MAY be summarized or fetched lazily when they are not needed for immediate validation.

## Security considerations

Capability confusion is a major risk.

Implementations MUST guard against:

- treating provider capability as user authority;
- treating transport reachability as capability grant;
- accepting stale capabilities after revocation;
- overbroad capability scopes;
- unregistered extension identifiers redefining core behavior;
- cross-Space or cross-user capability reuse without binding checks.

## Open questions

- Initial canonical capability object shape.
- Which capability identifiers become Core Profile requirements.
- Whether provider descriptors require signed audit checkpoints in the first Availability Profile.
