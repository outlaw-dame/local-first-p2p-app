# ADR-012: MLS Dependency and Group Keying v1

- Status: Proposed
- Date: 2026-06-27
- Roadmap phase: Phase 3 — MLS ADR and dependency decision
- Related docs:
  - `docs/implementation/roadmap-ordering.md`
  - `docs/implementation/phase-3-mls-implementation-plan.md`
  - `docs/protocol/mls-group-keying.md`
  - `docs/protocol/adaptive-reachability-and-ephemeral-infrastructure.md`
- Depends on:
  - Phase 2 private/account-local payload envelope
  - `@lfp2p/private-payload`

## Context

The protocol needs group confidentiality and dynamic membership before private group chat, encrypted rooms, encrypted mailbox catch-up, and MLS-protected group payloads.

MLS is group key management, not a transport. Bridge HTTP, Durable Streams, WebRTC DataChannels, future mailbox actors, super peers, Holepunch/Pear streams, and Hypercore/Corestore replication paths may deliver MLS control records and protected application messages, but none of those transports becomes the cryptographic authority for the group.

RFC 9420 defines MLS as an asynchronous group key establishment protocol with forward secrecy and post-compromise security for groups ranging from two members to thousands. It also defines clients, groups, epochs, proposals, commits, KeyPackages, GroupInfo, PublicMessage, PrivateMessage, handshake messages, and application messages.

## Decision

Adopt MLS as the required group key-management model for encrypted group payloads.

Use an adapter boundary instead of binding protocol authority to one MLS runtime.

Initial dependency decision:

1. Evaluate `mls-ts` as the first TypeScript-native candidate for browser/PWA and TypeScript test fixtures.
2. Evaluate OpenMLS or `mls-rs` through a native/WASM boundary for stronger long-term full-peer/native runtime needs.
3. Do not implement an in-house MLS cryptographic stack.
4. Do not expose MLS library internals as canonical protocol objects.

The protocol should define signed MLS control records and stable local projections. The selected library is an implementation detail behind an MLS provider interface.

## Authority boundary

Protocol authority remains:

```txt
controller identity
→ device identity
→ capability and membership policy
→ signed group-control records
→ MLS provider state
→ encrypted group payload delivery
```

MLS group state is important cryptographic state, but it does not replace controller identity, device authorization, capabilities, trust policy, labels, moderation policy, object references, or signed protocol events.

## Identity and device binding

An MLS client maps to a protocol-authorized device identity, not only to a user account.

KeyPackages and credentials must bind to:

- controller identity;
- device identity;
- current device authorization state;
- signing key reference;
- supported ciphersuite/capability set;
- expiration and revocation state.

A removed, revoked, or rotated device must not continue to publish valid group commits or application messages for future epochs.

## Credential policy

Phase 3 does not select final credential encoding.

Required direction:

- keep MLS credentials minimal;
- bind them to signed protocol identity/device records;
- avoid leaking unnecessary social graph or profile metadata;
- allow future credential profiles for browser, native, and full-peer runtimes;
- fail closed on unknown, expired, revoked, or mismatched device credentials.

## Membership policy

Membership changes are signed protocol events that authorize MLS proposals/commits.

Required semantics:

- add member/device;
- remove member/device;
- update device leaf/key material;
- rotate group epoch;
- publish welcome material only to authorized recipients;
- reject stale epoch messages;
- reject commits from non-members or revoked devices;
- preserve replay/idempotency behavior.

## Epoch and checkpoint model

Each group has a linear MLS epoch sequence.

Protocol projections should track:

- group id;
- epoch number;
- epoch authenticator or equivalent checkpoint;
- commit object reference;
- membership set digest;
- local device membership state;
- last applied control record;
- stale/forked state diagnostics.

Forks must be visible to local diagnostics and policy rather than silently healed by accepting arbitrary remote state.

The protocol must define deterministic fork recovery in Phase 4. The preferred direction is to queue conflicting commits, surface the fork, and require a signed recovery control record from an authorized controller/admin device or deterministic policy authority before advancing the local projection. Any tie-breaker must be auditable, signed, replay-safe, and incapable of silently accepting a scope-widening commit.

## Delivery-service model

Bridges, Durable Streams, mailbox actors, super peers, full peers, and future runtime adapters are delivery services only.

They may store and forward encrypted MLS messages and signed control records, subject to scope, retention, byte caps, rate limits, and abuse policy. They must not receive plaintext group payloads or become membership authorities.

## Private payload dependency

Phase 2 private payload envelopes remain useful for account-local and non-MLS private payloads.

MLS-protected group messages should use MLS application messages for group payload confidentiality. The protocol's envelope validation rules, including `validatePayloadPrivacyScope` for `group` privacy, must be updated to support MLS application-message payloads alongside Phase 2 private payload envelopes. When metadata or out-of-band payload references are needed, they must still follow the private payload and content-addressing privacy rules.

## Threat model

Phase 3 must explicitly account for:

- compromised bridge/delivery service;
- malicious or stale member device;
- revoked device replay;
- stale epoch delivery;
- welcome replay or wrong-recipient delivery;
- group fork attempts;
- metadata leakage through group id, epoch, message timing, or membership changes;
- malicious insiders fragmenting group state;
- dependency bugs and runtime mismatch across browser/native/full-peer providers.

## Non-goals

This ADR does not implement MLS, add a dependency, define final group-control event schemas, implement encrypted group chat, implement mailbox catch-up, or select final UI flows.

## Follow-up

Phase 3 follow-up:

- complete dependency evaluation;
- define MLS provider interface;
- define test-fixture expectations;
- document credential profile options;
- document bridge/mailbox/delivery boundaries.

Phase 4 follow-up:

- add group-control records;
- add projection behavior;
- add replay-equivalence fixtures;
- add stale epoch and revoked-device rejection tests;
- add protocol validation support for MLS group payload envelopes;
- add deterministic fork recovery records/tests.

## References

- RFC 9420: The Messaging Layer Security (MLS) Protocol.
- OpenMLS documentation.
- Matrix `mls-ts` project.
- AWS Labs `mls-rs` project.
