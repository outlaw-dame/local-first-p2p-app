# Threat Model: Bridge Compromise and Delivery Integrity

- Status: Reviewed
- Date: 2026-05-27
- Related ADRs: `docs/adr/000-runtime-and-product-surface.md`, `docs/adr/001-identity-control-log-v1.md`, `docs/adr/002-private-payload-encryption-envelope-v1.md`
- Related PRs: #52, #53, #54
- Owners: Protocol and runtime maintainers

## Feature / surface

This threat model covers the current bridge-assisted sync path between local clients and bridge-service.

Included scope:

- inbound bridge delivery acknowledgements and payload handling,
- sync-client response parsing and checkpoint updates,
- bridge-service idempotent delivery behavior,
- local outbox confirmation and retry decisions,
- metadata exposed through bridge request/response envelopes.

Excluded scope:

- production authentication/authorization policy,
- Durable Streams/WebSocket readers,
- public indexing and social outbox flows,
- full-peer replication runtime.

## Assets

- Private payloads: must not leak in bridge logs or error text.
- Private keys: must remain device-local and never bridge-visible.
- Identity/control state: must not be overwritten by forged bridge responses.
- Local database state: outbox/checkpoints must remain internally consistent.
- Derived indexes: must remain rebuildable from signed durable events.
- Metadata: should be minimized and protected from unnecessary exposure.
- Availability: sync path should recover from malformed/hostile bridge behavior.

## Trust boundaries

- client/device boundary: signed events are created and validated on device.
- bridge/server boundary: bridge is transport helper, not protocol authority.
- local storage boundary: durable state belongs to local-store, not bridge responses.
- service worker/cache boundary: optional runtime helper boundary; never canonical.
- peer/super-peer boundary: not in scope for this phase.

## Actors

- honest local user
- honest remote peer
- compromised bridge
- malicious peer
- revoked device attempting continued delivery
- network attacker tampering with bridge traffic
- compromised local device

## Data flow

1. Client signs event locally and persists it to local-store/outbox.
2. Client sends delivery request to bridge.
3. Bridge validates request shape/scope/signature and persists delivery state.
4. Bridge returns status/metadata to client.
5. Client parses response defensively and decides confirm/retry/no-op.
6. Client persists checkpoint/outbox changes atomically with local rules.

## Threats

| Threat | Impact | Existing mitigation | Missing mitigation | Test required |
|---|---|---|---|---|
| Forged bridge confirmations | False outbox confirmation, data loss illusion | Signed-event verification is required before acceptance; defensive response parsing rejects unsupported statuses and malformed success payloads | Authenticated bridge identity and response authenticity proof beyond transport assumptions | Integration test for forged success response attempting confirmation |
| Malformed bridge responses | Parser confusion, invalid state writes | Sync-client rejects malformed 2xx shapes and treats them as retryable failure paths | Structured error taxonomy with explicit protocol error classes and metrics tags | Malformed 2xx/JSON fuzz tests and state invariants |
| Stale confirmations | Regressed local state from old response race | Stale response guard prevents older confirmations from replacing newer local state | Formal freshness token policy per stream/source | Multi-request race tests with out-of-order responses |
| Duplicate delivery | Double-processing and incorrect sequence advancement | Idempotency keys and duplicate handling in bridge stores | Cross-backend consistency guarantees for all future bridge backends | Backend parity tests for duplicate handling |
| Reordered delivery | Misordered state transitions/checkpoints | Safe sequence validation and checkpoint guards in sync-client/local-store | Explicit ordering contract for streaming transports and reconnect resume semantics | Reordered response replay tests |
| Bridge data loss | Events acknowledged by bridge may be unavailable later | Client remains canonical; bridge is non-authoritative by doctrine | Durable mailbox durability SLA and audited retention policy | Data-loss simulation with client reconciliation checks |
| Bridge replay | Reuse of old bridge responses to force wrong local decisions | Retry and stale guards reduce replay impact; identity signature checks protect payload integrity | Replay nonce/window contract and server-side replay cache strategy | Replay corpus tests over prior valid responses |
| Bridge returns events it did not receive | Injection of untrusted events into inbound apply path | Inbound cryptographic verification rejects invalid signatures before persistence | Source attestation and stronger provenance metadata contract | Test injecting bridge-supplied unknown event IDs |
| Metadata exposure | Privacy leaks through identifiers, timing, routing, scope metadata | Local-first design keeps private payload plaintext device-side; bridge-safe scope checks exist | Logging redaction policy, minimization policy, and data retention controls | Logging assertions and redaction snapshot tests |

## Logging and telemetry rules

- Private plaintext allowed in logs: No.
- Private keys allowed in logs: No.
- Sensitive identifiers allowed in logs: only hashed/truncated forms where operationally required.
- Redaction/hash policy: default redact, hash when correlation is needed, never raw private payload/body.
- User-visible error policy: concise failure category; avoid leaking internals or raw bridge payload.

## Required tests before beta

- [x] Invalid signature / forged input rejection on inbound processing.
- [x] Malformed bridge response parsing safety.
- [x] Duplicate delivery/idempotency handling.
- [x] Stale response guard behavior.
- [ ] Replay-window enforcement tests with explicit nonce contract.
- [ ] Metadata redaction tests for production logging policy.
- [ ] Bridge data-loss and reconciliation chaos tests.
- [ ] Authz/rate-limit abuse tests at bridge boundary.

## Residual risk

Current bridge hardening is appropriate for development and controlled environments, but production risk remains high without authenticated bridge responses, explicit replay-window contracts, redaction enforcement tests, and durable mailbox policies.

The bridge must continue to be treated as untrusted transport helper, not canonical truth.

## Review notes

- This document satisfies Step 4 in `docs/implementation/next-development-path.md`.
- Follow-on work should prioritize Step 5 sync offset/cursor ADR and schema contract.
