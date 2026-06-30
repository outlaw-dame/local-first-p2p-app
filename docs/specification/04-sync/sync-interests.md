# Sync Interests

- Status: Draft
- Specification series: 4
- Specification version: 0.x
- Scope: scoped sync declarations and privacy-aware synchronization interests
- Profiles: Core, Messaging, Social, Offline, Availability
- Related:
  - `docs/specification/04-sync/selective-replica-sync.md`
  - `docs/specification/03-data/data-partitions.md`
  - `docs/specification/02-identity/replica-model.md`

## Purpose

This document defines Sync Interests as scoped declarations of what a peer wants to synchronize.

Sync Interests allow peers to avoid full-history replication, reduce bandwidth, protect privacy, and support partial replicas.

## Requirements

- Sync Interests MUST NOT grant access by themselves.
- Sync Interests MUST be checked against authorization, privacy, and local policy before data is sent.
- Sync Interests SHOULD be narrow enough to avoid unnecessary metadata exposure.
- Sync Interests SHOULD support low-bandwidth and partial-replica operation.
- Peers MAY reject, narrow, defer, or summarize a Sync Interest according to policy.

## Interest dimensions

A Sync Interest MAY specify:

- Identity Root;
- Device;
- User Data Root partition;
- Space;
- Channel;
- Feed Collection;
- mailbox inbox/outbox scope;
- object type;
- event type;
- consistency class;
- time range;
- checkpoint range;
- maximum payload size;
- headers-only mode;
- payload eagerness;
- privacy scope;
- media policy;
- low-bandwidth priority.

## Interest lifecycle

A Sync Interest may be:

- proposed;
- accepted;
- narrowed;
- rejected;
- expired;
- paused;
- resumed;
- satisfied;
- superseded.

A later sync state-machine specification SHOULD define canonical states.

## Authorization

A peer receiving a Sync Interest MUST verify that the requesting peer is allowed to learn the requested data before sending records or payloads.

A valid Sync Interest does not prove authorization.

Authorization may depend on:

- public visibility;
- Device authority;
- Capability grants;
- Space membership;
- Channel membership;
- mailbox recipient status;
- MLS/group epoch membership;
- local user policy;
- provider admission policy.

## Privacy

Sync Interests can leak sensitive information about what a peer knows, wants, or belongs to.

Implementations SHOULD minimize exposure of:

- private Space membership;
- private Channel membership;
- contact graph details;
- sealed recipient state;
- trust/safety state;
- search or feed preferences;
- sensitive object identifiers;
- missing records that reveal private context.

## Headers-only mode

A Sync Interest MAY request headers, references, digests, or checkpoints without payload bytes.

Headers-only mode is useful for:

- low-bandwidth sync;
- previewing availability;
- safe validation planning;
- deferred media fetch;
- private payload negotiation;
- checkpoint comparison.

## Payload eagerness

A Sync Interest SHOULD be able to indicate whether payloads should be:

- never sent inline;
- sent only below a size threshold;
- sent only when required for validation;
- sent eagerly for small records;
- fetched lazily by Object Reference.

## Provider behavior

Providers MAY support policy-based narrowing of Sync Interests.

Examples:

- cap maximum payload size;
- refuse private partitions;
- provide headers-only responses;
- defer media;
- require capability proof;
- rate-limit broad interests;
- return checkpoint summaries.

Provider narrowing MUST NOT be represented as global data nonexistence.

## Low-bandwidth behavior

Low-bandwidth peers SHOULD advertise narrow Sync Interests and prefer checkpoint/header exchange before payload transfer.

Implementations SHOULD support progressive widening when bandwidth improves.

## Security considerations

Implementations MUST guard against:

- using Sync Interests as access tokens;
- broad-interest scraping;
- metadata leakage;
- denial-of-service via huge ranges;
- private membership inference;
- malicious peers requesting payloads they cannot decrypt;
- provider misrepresentation of narrowed responses.

## Open questions

- Canonical Sync Interest object shape.
- Privacy-preserving interest-overlap negotiation.
- Whether interests are signed records or session-local messages.
- Which interest dimensions are Core Profile requirements.
