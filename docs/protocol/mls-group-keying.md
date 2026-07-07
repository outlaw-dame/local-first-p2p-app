# MLS Group Keying Doctrine

- Status: Superseded — retained as design history
- Date: 2026-06-27
- Related ADR: `docs/adr/012-mls-dependency-and-group-keying-v1.md`
- Roadmap phase: Phase 3

> **Normative home:** this design doctrine has been promoted into the specification tree. The current normative documents are `docs/specification/08-security/mls-group-keying.md`, `docs/specification/08-security/mls-virtual-delivery-service.md`, and `docs/specification/08-security/mls-fork-detection-and-recovery.md`. Read those for MUST/SHOULD requirements; this file is preserved for design rationale only. See `docs/implementation/mls-group-control-spec-promotion.md` for the mapping.

## Purpose

This document defines how MLS fits into the local-first hybrid P2P protocol without making MLS a transport, identity system, moderation system, storage system, or object authority.

## Core rule

MLS manages group cryptographic state.

The protocol still owns:

- controller identity;
- device authorization;
- capabilities;
- signed event envelopes;
- content references;
- trust and moderation policy;
- replication policy;
- accessibility and annotation policy;
- transport/runtime adapter boundaries.

## Layering

```txt
application object / group message
→ protocol signed event envelope
→ MLS group state and epoch
→ encrypted MLS application message
→ delivery over bridge, Durable Streams, WebRTC DataChannel, mailbox, super peer, or full-peer runtime
```

Transport success is not replication success, and delivery success is not cryptographic authorization.

## MLS provider boundary

Implementations should use an `MlsProvider`-style boundary.

Provider responsibilities:

- generate KeyPackages for authorized devices;
- create groups;
- process proposals;
- create commits;
- process commits;
- issue welcomes;
- encrypt application messages;
- decrypt application messages;
- export epoch checkpoints/projection-safe state;
- report stale, forked, revoked, malformed, or wrong-recipient states.

Provider non-responsibilities:

- deciding protocol identity;
- deciding social trust;
- deciding moderation action;
- bypassing capability checks;
- writing directly to transport-specific stores;
- exposing private group plaintext to bridges or super peers.

## Identity binding

Each MLS client corresponds to a protocol device.

A valid MLS participant must resolve to:

- controller id;
- device id;
- signing key ref;
- current authorization state;
- local trust/moderation constraints;
- capability to participate in the group.

## Control records

MLS control activity should be mirrored by signed protocol records.

Phase 4 will define the final schemas, but expected control families include:

- group created;
- member/device proposed;
- member/device added;
- member/device removed;
- device key updated;
- commit published;
- welcome issued;
- epoch advanced;
- group fork detected;
- fork recovery/control record;
- stale epoch rejected.

## Delivery services

A delivery service may carry:

- signed group-control records;
- MLS handshake messages;
- MLS application messages;
- encrypted mailbox records;
- content refs for encrypted attachments.

A delivery service must not become:

- the latest-state authority;
- a plaintext group message processor;
- a membership authority;
- a trust authority;
- a moderation authority.

## Local-first behavior

Clients must be able to retain local group state, apply signed records deterministically, and resume after offline periods.

Offline catch-up must reject or quarantine:

- commits from non-members;
- commits from revoked devices;
- stale epochs;
- malformed welcomes;
- messages for unknown groups;
- wrong-recipient material;
- scope-widening attempts;
- concurrent commits or unresolvable epoch forks, which must be queued or surfaced for resolution policy.

## Fork handling

MLS requires a linear epoch sequence. Local-first/P2P delivery can still expose concurrent commits from partitioned devices.

Phase 4 must define deterministic fork handling. Until a fork is resolved, implementations should keep the last accepted epoch stable, queue conflicting candidates, and surface diagnostics. Resolution must be represented by signed protocol control records from an authorized policy authority and must not silently accept arbitrary remote state.

## Group payload validation

Current group privacy validation is based on Phase 2 private payload envelopes.

Phase 4 must add explicit protocol validation for MLS application-message envelopes so group-scoped MLS payloads can be valid without allowing plaintext group payloads. MLS payload envelopes must bind to group id, epoch, sender device, and target object/event metadata closely enough to reject wrong-group, wrong-epoch, malformed, replayed, or scope-widening payloads.

## Metadata caution

MLS protects message contents, but it does not automatically hide all metadata.

Implementations should treat group id, epoch, membership changes, message frequency, delivery path, and attachment availability as potentially sensitive metadata.

## Relationship to Phase 2

The private payload envelope remains the non-MLS private payload primitive.

MLS is used for group cryptographic state and group application messages. Non-group private metadata, account-local payloads, and device-local payloads continue to use Phase 2 rules where appropriate.

## Relationship to Phase 4

Phase 3 decides the MLS architecture and provider boundary.

Phase 4 implements signed MLS group-control records, projection behavior, group payload validation changes, and deterministic fork handling.
