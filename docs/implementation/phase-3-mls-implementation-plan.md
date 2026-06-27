# Phase 3 MLS Implementation Plan

- Status: Draft
- Date: 2026-06-27
- Related ADR: `docs/adr/012-mls-dependency-and-group-keying-v1.md`
- Related doctrine: `docs/protocol/mls-group-keying.md`

## Purpose

Phase 3 decides how MLS enters the protocol architecture before group-control records are implemented in Phase 4.

This is a planning and architecture phase. It should not add an MLS dependency until the provider boundary, fixture requirements, and dependency decision are stable.

## Inputs already available

- Phase 2 private/account-local payload envelope exists in `@lfp2p/private-payload`.
- Protocol events already use signed envelopes.
- The roadmap places MLS before group control records, WebRTC group messaging, encrypted mailbox, and super-peer group availability.
- Transport doctrine already treats bridges, Durable Streams, WebRTC, mailbox actors, super peers, Holepunch/Pear, and Hypercore/Corestore as delivery/runtime layers rather than protocol authority.

## Required work

### 1. Dependency evaluation

Evaluate at least:

- Matrix `mls-ts` for TypeScript-native browser/PWA compatibility and tests;
- OpenMLS for mature Rust/native/WASM direction;
- `mls-rs` for Rust/native/WASM direction and provider-boundary fit.

Do not implement a custom MLS cryptographic core.

Evaluation criteria:

- RFC 9420 alignment;
- browser/PWA viability;
- native/full-peer viability;
- WASM viability, binary size, bundle impact, and initialization overhead;
- dependency/license fit;
- key storage abstraction;
- deterministic testability;
- KeyPackage/credential handling;
- group creation/proposal/commit/welcome support;
- exporter/checkpoint support;
- error surfaces for stale, malformed, forked, wrong-recipient, and revoked states;
- compatibility with protocol device identity and capability checks.

### 2. Provider boundary

Define an `MlsProvider` interface before adding runtime code.

Expected capabilities:

- create device KeyPackage;
- validate KeyPackage binding;
- create group;
- propose add/remove/update;
- create commit;
- process commit;
- create/process welcome;
- encrypt group application payload;
- decrypt group application payload;
- export epoch checkpoint;
- report projection-safe diagnostics.

### 3. Identity and credential binding

Document how MLS credential material binds to:

- controller id;
- device id;
- signing key ref;
- device authorization event;
- capability proof;
- expiration/revocation state.

### 4. Membership policy

Define policy for:

- adding members/devices;
- removing members/devices;
- rotating device material;
- rejecting stale epochs;
- rejecting revoked devices;
- accepting or rejecting external joins;
- local diagnostics for forked group state;
- multi-device enrollment, commit responsibility, and secure welcome routing.

### 5. Delivery-service boundary

Document how each delivery layer carries MLS material:

- bridge HTTP;
- Durable Streams;
- WebRTC DataChannel;
- encrypted mailbox actor;
- super peer;
- Holepunch/Pear stream;
- Hypercore/Corestore substrate.

Every delivery path must preserve the rule: delivery services carry encrypted material and signed control records only.

### 6. Group privacy validation compatibility

Current protocol validation treats `group` privacy as requiring a Phase 2 private payload envelope.

Phase 4 must update protocol validation to allow MLS application-message payload envelopes for `group` privacy while preserving strict rejection of plaintext group payloads.

Required validation fixtures:

- group event with Phase 2 private payload envelope remains valid where appropriate;
- group event with MLS application-message payload envelope is valid after Phase 4 schema support;
- group event with plaintext payload remains invalid;
- malformed MLS payload envelope fails closed;
- wrong epoch/group binding fails closed.

### 7. Fork recovery and offline catch-up

MLS requires a linear epoch sequence, but local-first/P2P delivery can surface concurrent commits.

Phase 4 must define deterministic fork handling. Preferred direction:

- detect conflicting commits;
- queue unresolved fork candidates;
- keep current accepted epoch unchanged until resolution;
- require signed recovery/control records from an authorized policy authority;
- expose diagnostics to local policy and UI;
- reject fork candidates that widen scope, include revoked devices, or fail credential checks.

### 8. Fixtures for Phase 4

Prepare fixture requirements for:

- valid group creation;
- valid member add;
- valid member remove;
- stale epoch rejection;
- revoked-device rejection;
- wrong-recipient welcome rejection;
- replay/idempotency behavior;
- fork detection;
- deterministic fork recovery;
- offline catch-up;
- multi-device welcome routing.

## Recommended outcome

Recommended Phase 3 outcome:

```txt
Adopt MLS as mandatory group key-management doctrine.
Use an MLS provider boundary.
Evaluate mls-ts first for TypeScript fixtures and PWA feasibility.
Evaluate OpenMLS/mls-rs for future native/full-peer/WASM providers.
Do not add a final runtime dependency until provider tests and minimal fixtures are ready.
```

## Exit criteria

Phase 3 is complete when:

- ADR-012 is accepted;
- MLS group-keying doctrine is documented;
- dependency candidates and evaluation criteria are documented;
- provider boundary requirements are documented;
- Phase 4 fixture requirements are documented.

## Phase 4 handoff

Phase 4 should implement signed MLS group-control records, protocol validation changes, deterministic fork handling, and projections. It should not revisit whether MLS belongs in the architecture.
