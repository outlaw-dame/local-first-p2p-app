# Current Implementation State

This document is the implementation truth layer for the repository. It describes what the code currently does after PR #19 merged, not the complete target architecture.

## Update addendum (2026-05-26)

This addendum preserves the original baseline notes while recording meaningful changes landed after the PR #19 snapshot.

Notable changes since the baseline section above:

- PWA bridge config/transport boundary now includes a dev-only bearer-auth config boundary and transport header injection path under explicit guard.
- PWA now has a read-only outbox delivery planner and a dev-only manual outbox delivery action gate.
- Manual outbox delivery includes a client-side send budget boundary (window, run count, entry reservations, and minimum interval).
- Bridge service primitives now include an optional HTTP bearer-auth boundary for delivery and inbound read handlers.
- A schema and storage versioning policy document now exists at `docs/implementation/schema-and-storage-versioning.md`.
- Apple-first frontend rollout planning and Phase A token hardening are documented and implemented as initial UI-system progress.

Scope reminder:

- These slices improve guardrails and observability.
- They do not enable production automation by themselves.
- They do not replace missing doctrine-level gates such as identity-control ADRs, payload-encryption contracts, and sync checkpoint persistence.

## Current baseline

- Default branch: `master`.
- Latest verified baseline for this documentation pass: merge commit `01b386b59372ccadcbd909635f572c189c3190a3` from PR #19, `Harden malformed bridge response handling`.
- The repo currently implements a PWA-first local-first foundation with signed local events, persistent local device identity, a Dexie local store, a mutation outbox, HTTP bridge transport, bridge service primitives, and bridge store backends.

## Applications

### `apps/pwa`

Current role: first user-facing local-first PWA light peer.

Implemented today:

- Framework7 React + TypeScript + Vite application shell.
- TanStack Query provider for future bridge/server/public-index state.
- Local device identity bootstrap through `@lfp2p/identity`.
- Local signed event creation through `@lfp2p/protocol` and `@lfp2p/crypto`.
- Local event persistence and local materialized event summaries through `@lfp2p/local-store`.
- Mutation outbox enqueueing through `@lfp2p/local-store` and idempotency helpers from `@lfp2p/sync-client`.
- Runtime capability snapshot through `@lfp2p/platform`.

Not implemented yet:

- Real app navigation beyond the first vertical slice.
- Service worker/offline shell policy.
- Contacts, petnames, name-proof UI, or contact cards.
- Private payload encryption for user-facing chat/social payloads.
- Chat, groups, media attachments, social posting, feed UX, or search UX.
- Background/foreground outbox worker wired into the PWA runtime.

### `apps/bridge-service`

Current role: non-authoritative bridge service primitives and request handler.

Implemented today:

- Bridge delivery service abstraction.
- In-memory bridge service wrapper.
- Framework-free request handler for bridge delivery requests.
- Signature verification before accepting bridge deliveries.
- Privacy scope filtering: bridge accepts only bridge-safe scopes, currently `dm`, `group`, and `public`.
- Idempotency conflict detection.
- Duplicate delivery handling.
- Store snapshot support.
- Bridge store backends:
  - in-memory store,
  - JSON file store,
  - PGlite SQL store.

Not implemented yet:

- Production server runtime.
- Authentication, authorization, abuse controls, or rate limiting around the bridge endpoint.
- Durable Streams/WebSocket bridge reader/server.
- Encrypted mailbox actor.
- Persistent peer/full P2P bridge integration.
- Public index service.
- Observability/metrics/log privacy policy for production deployment.

## Packages

### `packages/protocol`

Implemented today:

- Versioned `UnsignedEventEnvelope` / `SignedEventEnvelope`.
- Event kinds:
  - `identity.device.created`,
  - `contact.petname.set`,
  - `note.created`,
  - `outbox.test.created`.
- Privacy scopes:
  - `device-local`,
  - `self`,
  - `dm`,
  - `group`,
  - `public`.
- `SourceRef`.
- JSON canonicalization helper.
- Unsigned/signed event validation helpers.

Not implemented yet:

- Identity control events.
- Capabilities/delegations.
- Room events.
- MLS control records.
- Media manifests.
- Name bindings.
- Search objects.
- Compression descriptors.
- Golden fixture suite for protocol conformance.

### `packages/crypto`

Implemented today:

- Signing key generation.
- Event signing and verification adapter surface.
- AES-GCM protection-key helpers.
- Key material encryption/decryption used by local device identity.
- SHA-256 base64url helper.

Not implemented yet:

- Payload encryption model for private messages/media.
- MLS integration.
- Capability credential binding.
- Hardware-backed/native key adapter path.

### `packages/identity`

Implemented today:

- Local device identity bootstrap and restore.
- Encrypted private signing-key material persisted through `local-store`.
- Local protection-key persistence.
- Single-flight identity bootstrap to avoid duplicate concurrent identity creation.
- Fail-closed restore if an active identity exists but required local protection key is missing.

Not implemented yet:

- Root/controller identity.
- Identity control log.
- Device add/revoke/rotate events.
- Capability grant/revoke model.
- Identity epochs/checkpoints.
- Recovery/supersession flow.
- Contact-card import/export.

### `packages/local-store`

Implemented today:

- Dexie database with versioned schema.
- Tables:
  - `signedEvents`,
  - `mutationOutbox`,
  - `eventSummaries`,
  - `deviceIdentities`,
  - `localProtectionKeys`.
- Signed event persistence and retrieval.
- Mutation outbox enqueue, list, due-list, claim, confirm, conflict, fail, retry scheduling, stale-claim recovery, and status counts.
- Local event summary storage.
- Device identity/protection-key storage.
- Transaction wrapper over known tables.

Not implemented yet:

- Contacts/petnames tables.
- Pending media metadata.
- Sync offsets/checkpoints.
- Full identity-state projection.
- Message/feed materialized views.
- Search rebuild pipeline from signed events.

### `packages/sync-client`

Implemented today:

- Outbox transport contract.
- Idempotency key creation.
- Exponential backoff with jitter.
- Outbox batch processing.
- Retry/conflict/terminal failure handling.
- Stale response guard.
- HTTP bridge transport.
- Endpoint normalization and endpoint credential rejection.
- Bridge response parsing hardening from PR #19:
  - malformed JSON rejected with specific retryable error,
  - invalid successful response shapes rejected without unsafe coercion,
  - unsupported status rejected,
  - permanent 4xx remains non-retryable,
  - malformed/invalid successful bridge responses do not falsely confirm local outbox entries.

Not implemented yet:

- Durable Stream reader.
- WebSocket transport.
- WebRTC adapter.
- PWA foreground/resume/network-restoration runner.
- Sync offsets/cursor persistence.
- Multi-bridge failover.

### `packages/search`

Implemented today:

- PGlite-backed local projection table.
- Basic escaped `LIKE` search over normalized title/body text.
- Search result shape with rank placeholder.

Not implemented yet:

- Proper FTS/BM25-style lexical index.
- Permission-scope partitions.
- Search object provenance model.
- Hybrid fusion.
- Semantic/vector adapter.
- Embedding lifecycle states.
- RAG context assembly.

### `packages/platform`

Implemented today:

- Runtime/platform capability detection surface used by the PWA.

Not implemented yet:

- Full platform-specific feature policy layer.
- Native/Capacitor capability adapters.

### `packages/design-tokens` and `packages/ui`

Implemented today:

- Initial shared design-token and UI package boundaries.
- Local-first status card used by the PWA.

Not implemented yet:

- Full Apple-inspired token system.
- Deep Framework7 component wrapper strategy.
- Accessibility/reduced-motion/dark-mode policy coverage.

## Current security posture

Implemented safety boundaries:

- Durable local app events are signed.
- Bridge verifies signatures before accepting events.
- Bridge rejects non-bridge-safe privacy scopes.
- Local private signing key material is encrypted before persistence.
- Bridge responses are treated as untrusted input and parsed defensively.
- Mutation retries use idempotency keys and backoff with jitter.

Important limitations:

- User-facing private payload encryption is not implemented yet.
- Bridge runtime is not production-hardened.
- Identity revocation/capability semantics are not implemented yet.
- There is no complete threat model document yet for bridge compromise, payload encryption, identity recovery, or search privacy.

## Current development posture

The repository is in a strong early foundation state, but it is not ready for private chat, production bridge deployment, or public beta. The next work should focus on doctrine alignment, protocol fixtures, identity-control planning, sync offsets, and explicit privacy/security gates before expanding feature surfaces.
