# User Data Root

- Status: Draft
- Specification series: 2
- Specification version: 0.x
- Scope: logical portable user-owned data root
- Profiles: Core, Messaging, Social, Offline
- Related:
  - `docs/specification/02-identity/identity-root.md`
  - `docs/specification/02-identity/device-model.md`
  - `docs/specification/01-core/protocol-layers.md`

## Purpose

This document defines the User Data Root as the logical portable user-owned data space.

It fills the architectural role that a repository, pod, or account store might fill in other systems, without requiring one physical server, provider, or storage backend to become canonical.

## Core doctrine

```txt
Identity Root = authority anchor
User Data Root = durable portable user state
Mailbox = delivery/catch-up infrastructure
Replica = copy of some portion of state
Provider = optional availability surface
Transport = byte movement
```

## Requirements

- A User Data Root MUST be logical, not tied to one physical provider.
- A User Data Root SHOULD be replicable across authorized devices.
- A User Data Root MAY be partially replicated by optional providers, peers, super-peers, portable sync drops, or local stores.
- A User Data Root MUST remain subordinate to Identity Root and authority-layer validation.
- A User Data Root MUST NOT treat mailbox provider acceptance as durable state acceptance.
- A User Data Root MUST NOT use one hosted provider as the sole canonical authority.

## Expected contents

A User Data Root may contain or reference:

- identity/control state;
- device registry state;
- capability grants/revocations;
- local/private records;
- contacts and petnames;
- preferences;
- trust/safety settings;
- mailbox inbox/outbox state;
- feed subscriptions;
- space/channel memberships;
- content/object references;
- entity/component/snapshot data;
- sync checkpoints;
- portable export/import metadata;
- local audit or rejection state where policy permits.

## Partitioning

A later data specification SHOULD define partitions such as:

```txt
/identity/
/devices/
/capabilities/
/personal/
/contacts/
/preferences/
/mailbox/inbox/
/mailbox/outbox/
/spaces/{spaceId}/
/spaces/{spaceId}/channels/{channelId}/
/feeds/
/media/
/trust-safety/
/sync/checkpoints/
```

Each partition SHOULD declare privacy scope, consistency class, replication policy, retention policy, payload eagerness, allowed writers, allowed readers, mailbox eligibility, and portable-drop eligibility.

## User Data Root vs Mailbox

Mailbox delivers encrypted records and tracks delivery state.

User Data Root persists validated user state.

A mailbox may help transfer User Data Root updates between devices. It MUST NOT become the User Data Root authority.

## User Data Root vs ATProto repository

A User Data Root may provide repository-like portability, but the protocol does not require one global commit chain or one AppView architecture.

## User Data Root vs Solid Pod

A User Data Root may provide pod-like ownership and portability, but the protocol does not require one Solid server, RDF model, or storage server as the canonical data holder.

## User Data Root vs Willow/Leaf subspaces

Willow-inspired partitions and Leaf-inspired entity/component/snapshot modeling may help organize User Data Root data.

Those organization models MUST NOT replace authority-layer validation for identity, device, capability, revocation, MLS, moderation, or report/appeal state.

## Cross-device behavior

Authorized devices SHOULD be able to converge on User Data Root state through selective sync and deterministic projection.

A device may hold a complete or partial local replica.

A newly authorized device SHOULD be able to reconstruct needed User Data Root state through one or more of:

- another authorized device;
- local backup;
- portable sync drop;
- mailbox catch-up;
- provider-hosted replica;
- peer/super-peer cache;
- direct P2P sync.

## Validation

Before accepting a User Data Root update, implementations MUST validate:

- record signature;
- signer authority;
- device authorization;
- capability scope;
- revocation state;
- applicable consistency class;
- object/content integrity;
- encryption/key epoch where applicable;
- replay/idempotency behavior.

## Export/import

The User Data Root SHOULD support portable export/import.

Exports MUST preserve enough authority, integrity, and checkpoint information to validate imported records.

Exports SHOULD support bounded partial export for low-bandwidth and privacy-sensitive cases.

## Low-bandwidth behavior

Low-bandwidth sync SHOULD prioritize authority and control partitions before rich app data.

Examples:

- identity;
- devices;
- revocations;
- capabilities;
- key epochs;
- membership checkpoints;
- recent mailbox headers;
- recent small text/control records;
- object refs/digests.

## Security considerations

User Data Root compromise can expose private data or enable confusing stale state.

Implementations SHOULD protect private partitions with encryption, minimize provider-visible metadata, validate imports defensively, and surface stale authority state when it affects safety.

## Open questions

- Final stable name for User Data Root.
- Minimum Core Profile portable state.
- Export/import encoding.
- Partition registry shape.
- Which partitions may use mutable path semantics versus signed-event lifecycle semantics.
