# Spaces

- Status: Draft
- Specification series: 6
- Specification version: 0.x
- Scope: scoped social containers for communities, groups, servers, and shared contexts
- Profiles: Social, Messaging, Availability, Offline
- Related:
  - `docs/specification/01-core/authority-model.md`
  - `docs/specification/02-identity/capabilities.md`
  - `docs/specification/05-mailbox/mailbox.md`

## Purpose

This document defines Spaces as scoped social containers.

A Space can model Discord-like servers, Facebook-like groups, Reddit-like communities, forums, project rooms, private groups, or other shared social contexts.

Users should be able to create Spaces without running infrastructure. A Space may also publish optional infrastructure descriptors when the community wants stronger availability, moderation workflows, search, feed generation, media caching, or administrative control.

## Requirements

- A Space MUST have explicit authority for membership, roles, policy, and infrastructure descriptors.
- A Space MUST NOT require dedicated hosted infrastructure to exist.
- Space infrastructure MUST be capability-bound and non-authoritative unless a specific capability grants a narrow authority role.
- A Space SHOULD support one or more Channels.
- A Space SHOULD define mailbox-compatible delivery semantics even when it does not operate mailbox infrastructure.
- Private Space payloads MUST remain encrypted across untrusted providers and transports.

## Space contents

A Space may define or reference:

- Space identity;
- membership;
- Roles;
- capabilities;
- policy;
- Channels;
- mailbox routes;
- Feed Collections;
- moderation queues;
- reports and appeals;
- media/object references;
- Presence policy;
- optional infrastructure descriptors.

## Space authority

Space authority governs:

- creation;
- membership changes;
- role assignment;
- Channel creation/deletion;
- policy changes;
- moderation authority;
- infrastructure descriptor publication;
- feed generator selection;
- retention rules where applicable.

A Space may be governed by a single controller, delegated capabilities, roles, or future threshold authority.

## Optional infrastructure

A Space may advertise optional providers for:

- mailbox delivery;
- relay/bridge availability;
- super-peer support;
- media cache;
- search index;
- feed generation;
- moderation tooling;
- voice/video signaling.

Provider descriptors MUST NOT become Space authority by themselves.

## Spaces without infrastructure

A Space can operate through:

- direct P2P sync;
- user devices;
- local/nearby exchange;
- Portable Sync Drops;
- participant-hosted replicas;
- ad hoc mailbox routes;
- later optional providers.

The experience may degrade, but Space identity, membership proofs, and small messages should remain usable where peers can exchange valid records.

## Privacy

Private Space membership, Channel membership, and message metadata may be sensitive.

Implementations SHOULD avoid exposing private Space identifiers, membership lists, routes, or policies to providers or peers that do not need them.

## Validation

Before applying a Space record, implementations MUST validate:

- Space authority;
- signer authority;
- capability scope;
- role permissions;
- membership state;
- consistency class;
- replay/idempotency behavior;
- encryption/key epoch where applicable;
- local policy.

## Low-bandwidth behavior

Low-bandwidth sync SHOULD prioritize:

- Space identity;
- membership checkpoints;
- role/capability state;
- Channel heads;
- recent small messages;
- mailbox headers;
- object references.

Large media, history windows, generated feeds, search indexes, and embeddings SHOULD be lazy.

## Security considerations

Implementations MUST guard against:

- provider-controlled Space authority;
- unauthorized role changes;
- stale membership state;
- private membership leakage;
- malicious infrastructure descriptors;
- Space impersonation;
- replayed Channel creation/deletion records;
- moderation authority confusion.

## Open questions

- Canonical Space object shape.
- Whether Space creation is Core Social Profile or optional Social extension.
- Initial role model.
- Whether Space governance supports threshold authority in the first stable profile.
