# Conformance Profiles

- Status: Draft
- Specification series: 0
- Scope: profile taxonomy for protocol implementations

## Purpose

Profiles let implementations support coherent subsets of the protocol without needing to implement every feature.

A profile defines a group of required primitives, behaviors, and interoperability expectations.

## Profile rules

An implementation MAY support multiple profiles.

A profile MAY depend on another profile.

A profile MUST define:

- required primitives;
- required validation behavior;
- required storage/sync behavior;
- required privacy behavior;
- required degraded-mode behavior;
- optional extensions;
- unsupported or out-of-scope features.

## Core Profile

The Core Profile is the minimum interoperable protocol foundation.

Expected scope:

- controller identity;
- authorized devices;
- signed event envelopes;
- object/content references;
- capability validation;
- consistency classes;
- local storage;
- basic selective sync;
- basic portable export/import expectations;
- authority vs availability separation.

The Core Profile MUST NOT require hosted infrastructure.

## Messaging Profile

The Messaging Profile builds on Core.

Expected scope:

- private payload envelopes;
- mailbox delivery semantics;
- inbox/outbox state;
- acknowledgements;
- receipts;
- forwarding;
- attachments by content/object reference;
- MLS integration for group/private channel payloads where applicable.

The Messaging Profile SHOULD support offline delivery through mailbox-compatible semantics.

## Social Profile

The Social Profile builds on Core and may build on Messaging for private/community features.

Expected scope:

- spaces;
- channels;
- posts/messages/comments;
- threads;
- reactions;
- roles/membership;
- feeds;
- collections;
- presence/rich activity where supported;
- moderation labels and local controls;
- reports/appeals where supported.

The Social Profile SHOULD support multiple application projections over shared primitives.

## Availability Profile

The Availability Profile defines provider-side capabilities.

Expected scope:

- bridges;
- relays;
- super-peer capability surfaces;
- hosted mailbox capability;
- search/index capability;
- feed-generator capability;
- storage-hint publication;
- provider admission policy;
- provider audit/retention expectations.

Availability Profile implementations MUST remain non-authoritative unless a separate protocol capability grants a specific authority role.

## Offline Profile

The Offline Profile builds on Core and supports constrained or degraded environments.

Expected scope:

- low-bandwidth sync profile;
- headers-first sync;
- lazy payload fetch;
- portable encrypted sync drops;
- nearby/local discovery;
- Bluetooth/local-network transfer guidance;
- import/export validation;
- delayed sync and catch-up behavior.

The Offline Profile SHOULD make communication and sync possible when hosted infrastructure is blocked or unavailable.

## Security Profile

The Security Profile covers optional advanced security mechanisms.

Expected scope:

- threshold authority;
- FROST-based recovery or governance;
- advanced key rotation;
- high-risk capability grants;
- security audit requirements;
- recovery flows;
- MLS hardening requirements beyond the Messaging Profile.

Security Profile features MUST be explicit and capability-gated.

## Extension profiles

Extensions MAY define additional profiles, such as:

- semantic search profile;
- AI summary profile;
- media streaming profile;
- voice/video profile;
- organization governance profile;
- moderation service profile.

Extension profiles MUST NOT redefine Core semantics.

## Future work

Each profile will receive a dedicated specification document under `09-profiles/` in a later specification series.
