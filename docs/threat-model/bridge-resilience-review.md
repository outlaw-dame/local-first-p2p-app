# Bridge Resilience Review

- Status: Draft
- Date: 2026-05-24

## Scope

This review covers the current bridge-service and sync-client delivery path.

Current implemented pieces include:

- bridge request handling,
- bridge delivery abstraction,
- in-memory, JSON, and PGlite bridge stores,
- signature verification before accepting delivery requests,
- bridge-safe scope checks,
- idempotency and conflict handling,
- HTTP transport,
- retry and backoff behavior,
- stale response guard,
- defensive bridge response parsing.

This review does not cover production deployment, encrypted mailbox actors, Durable Streams readers, WebSocket readers, WebRTC adapters, public indexing, or full-peer runtime behavior.

## Boundary

The bridge is a delivery helper. It is not canonical state.

Clients must continue to validate signed event content and local application rules instead of treating bridge responses as final protocol truth.

## Reliability and safety requirements

Before the bridge can be considered production-ready, the project needs:

1. request size limits,
2. authorization policy,
3. rate limiting policy,
4. logging and redaction policy,
5. sync offset/checkpoint design,
6. replay window policy,
7. persistent store recovery behavior,
8. operational metrics that avoid sensitive content,
9. integration tests for every bridge store backend,
10. deployment configuration review.

## Required behavior

The bridge and sync-client path must preserve these properties:

- malformed successful responses must not confirm local outbox entries,
- unsupported response statuses must not confirm local outbox entries,
- sequence values must remain safe non-negative integers,
- duplicate deliveries must remain idempotent,
- idempotency conflicts must remain conflicts,
- stale responses must not update newer local state,
- bridge-unsafe scopes must be rejected,
- signatures must be verified before accepted delivery,
- local outbox state must remain recoverable after transient failures,
- derived state must remain rebuildable from durable local events.

## Required next tests

The next bridge-related implementation PR should add or confirm tests for:

- malformed 2xx JSON response remains retryable,
- invalid 2xx response shape remains retryable,
- unsupported status does not confirm an outbox entry,
- invalid signature is rejected by the bridge handler,
- bridge-unsafe scopes are rejected,
- duplicate delivery is idempotent,
- idempotency key conflict is rejected,
- stale response does not update current local state,
- each bridge store backend handles duplicate and conflict cases consistently.

## Current status

The current bridge path has useful early hardening, but it is not production-ready.

Until the missing requirements are implemented, the bridge should be treated as a development primitive rather than a production synchronization service.
