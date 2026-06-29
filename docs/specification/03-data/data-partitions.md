# Data Partitions

- Status: Draft
- Specification series: 3
- Specification version: 0.x
- Scope: User Data Root and Space data partitioning
- Profiles: Core, Messaging, Social, Offline
- Related:
  - `docs/specification/02-identity/user-data-root.md`
  - `docs/specification/02-identity/replica-model.md`
  - `docs/specification/01-core/authority-model.md`

## Purpose

This document defines data partitions as scoped areas of a User Data Root, Space, Channel, mailbox, feed, or object store with explicit authority, privacy, consistency, retention, and replication behavior.

Partitioning is inspired by Willow namespaces/subspaces/paths and Leaf-style structured data, but partition behavior remains subordinate to protocol authority rules.

## Requirements

- A partition MUST declare or inherit its authority and consistency model before records in that partition are accepted.
- A partition MUST NOT override Identity Root, Device, Capability, MLS, moderation, or lifecycle validation rules.
- A partition SHOULD declare privacy scope, allowed writers, allowed readers, replication policy, retention policy, payload eagerness, and low-bandwidth behavior.
- A partition MAY be replicated independently from other partitions.
- A partition MAY contain content-addressed objects, signed events, entity snapshots, mailbox state, feed state, or local-only records.

## Suggested top-level partitions

A User Data Root SHOULD eventually define stable partition identifiers for:

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

These paths are Draft examples until a later registry defines canonical identifiers.

## Partition metadata

A partition descriptor SHOULD define:

- partition identifier;
- parent partition, if any;
- owner or governing authority;
- allowed writer authority;
- allowed reader authority;
- privacy scope;
- consistency class;
- replication policy;
- retention policy;
- payload eagerness;
- mailbox eligibility;
- portable sync drop eligibility;
- provider availability eligibility;
- low-bandwidth priority;
- tombstone/deletion behavior.

## Partition authority

Partition existence does not establish authority.

Records within a partition MUST still validate according to their object/event family.

For example:

- `/devices/` records require device authority rules;
- `/capabilities/` records require capability authority rules;
- `/trust-safety/` records require trust/safety authority rules;
- `/mailbox/inbox/` records require mailbox state-machine rules;
- `/spaces/{spaceId}/` records require Space authority rules;
- `/media/` objects require content integrity and access policy.

## Mutable partitions

Some partitions MAY permit mutable path semantics or LWW-like projection where explicitly specified.

Examples that may be eligible:

- user preferences;
- local UI state;
- cache manifests;
- non-authority profile display fields;
- local-only app configuration.

Mutable partitions MUST NOT be used for authority-sensitive state unless a specification explicitly permits it.

## Authority-sensitive partitions

The following kinds of state MUST NOT use generic LWW, mutable path overwrite, or provider-local database semantics as their authority model:

- identity/controller state;
- device authorization/revocation;
- capability grants/revocations;
- MLS group-control and key-epoch state;
- Space governance and role authority;
- moderation labels where authority matters;
- reports/appeals lifecycle;
- mailbox delivery state machines;
- legal/safety isolation records;
- threshold recovery/governance records.

## Selective replication

Partitions SHOULD support selective replication.

A peer MAY request or offer only specific partitions, subtrees, time windows, object classes, or payload sizes.

Selective replication MUST NOT skip validation for accepted records.

## Privacy considerations

Partition descriptors can reveal sensitive information.

Implementations SHOULD avoid exposing private partition names, Space memberships, mailbox routes, trust/safety state, or contact graphs to providers or peers that do not need them.

## Low-bandwidth behavior

Low-bandwidth sync SHOULD prioritize partitions containing:

- identity state;
- device state;
- revocations;
- capabilities;
- key epochs;
- membership checkpoints;
- mailbox headers;
- recent small text/control records;
- object references and digests.

Large media, embeddings, generated summaries, search indexes, and long history windows SHOULD be lazy or optional.

## Security considerations

Partition confusion is a security risk.

Implementations MUST guard against:

- writing authority records into mutable app-data partitions;
- treating provider-hosted partition state as canonical authority;
- accepting partition descriptors from unauthorized actors;
- leaking private partition metadata;
- importing malicious portable sync drops that claim misleading partition scopes;
- path-prefix deletion affecting unrelated objects.

## Open questions

- Canonical partition registry shape.
- Whether partition descriptors are signed events, entity snapshots, or both.
- Safe path encoding rules.
- Which partitions are Core Profile requirements.
