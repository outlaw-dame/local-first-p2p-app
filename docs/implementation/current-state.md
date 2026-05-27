# Current Implementation State

This document is the implementation truth layer for the repository. It describes what the code currently does, not the complete target architecture.

## Current baseline

- Default branch: `master`.
- Latest verified baseline for this documentation pass: default branch `master` after PR #52, `persist identity projection during inbound apply`.
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
- Local identity trust cues with controller fingerprint display/copy and verification status.
- Local petname editing backed by contact profile persistence.
- Local contact-card editing plus signed JSON export/import flow for local exchange.
- Explicit fingerprint compare flow for anti-phishing verification.

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
  - `identity.controller.created`,
  - `identity.device.authorized`,
  - `identity.device.revoked`,
  - `identity.capability.granted`,
  - `identity.capability.revoked`,
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
- Identity event payload and privacy-scope validation rules.
- Fixture-driven protocol envelope validation.

Not implemented yet:

- Broader capability credential formats and delegation envelope beyond the current identity event payloads.
- Room events.
- MLS control records.
- Media manifests.
- Name bindings.
- Search objects.
- Compression descriptors.
- Comprehensive golden fixture suite for protocol conformance.

### `packages/crypto`

Implemented today:

- Signing key generation.
- Event signing and verification adapter surface.
- AES-GCM protection-key helpers.
- Key material encryption/decryption used by local device identity.
- SHA-256 base64url helper.
- Fixture-backed signed-event signature verification tests with crypto-local fixtures (valid signature acceptance + tampered signature rejection).

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
- Identity control-log projection primitives (`createEmptyIdentityControlState`, `applyIdentityControlEvent`, `seedIdentityControlProjection`).
- Control-log enforcement rules for controller signer, epoch monotonicity, entity existence, and deterministic replay behavior.
- Runtime authorization helper for trust/device/capability-gated identity operations.

Not implemented yet:

- Full account-level identity workflow that migrates local bootstrap into authoritative root/controller lifecycle management.
- Identity recovery/supersession flow.
- Controller key rotation semantics.
- Contact-card import/export.

### `packages/local-store`

Implemented today:

- Dexie database with versioned schema.
- Tables:
  - `signedEvents`,
  - `mutationOutbox`,
  - `eventSummaries`,
  - `deviceIdentities`,
  - `localProtectionKeys`,
  - `syncCheckpoints`,
  - `identityControlProjections`,
  - `contactProfiles`.
- Signed event persistence and retrieval.
- Mutation outbox enqueue, list, due-list, claim, confirm, conflict, fail, retry scheduling, stale-claim recovery, and status counts.
- Local event summary storage.
- Device identity/protection-key storage.
- Sync checkpoints with monotonic advance/rewind policy controls.
- Atomic inbound event + checkpoint persistence helper.
- Identity control projection persistence table and atomic projection update hook.
- Contact profile persistence with normalized petname uniqueness and validation guards.
- Transaction wrapper over known tables.

Not implemented yet:

- Contacts/petnames tables.
- Pending media metadata.
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
- Inbound sync batch processing with checkpoint identity preflight and stale-sequence handling.
- Pull-and-process inbound sync helper with checkpoint-before/after support.
- Cryptographic signature verification for inbound signed events before persistence.
- Identity control event enforcement on inbound apply using `@lfp2p/identity` control-log logic.
- Atomic identity control projection persistence during inbound apply.
- Manual outbox delivery gate can now enforce identity authorization decisions before network sends.

Not implemented yet:

- Durable Stream reader.
- WebSocket transport.
- WebRTC adapter.
- PWA foreground/resume/network-restoration runner.
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
- Threat model coverage is still incomplete for payload encryption, identity recovery, and search privacy.

## Current development posture

The repository is in a strong early foundation state, but it is not ready for private chat, production bridge deployment, or public beta. The next work should focus on doctrine alignment, protocol fixtures, identity-control planning, sync offsets, and explicit privacy/security gates before expanding feature surfaces.

Identity-control planning and private payload envelope planning are now recorded by ADR-001 and ADR-002. The next implementation work is to convert those decisions into protocol schemas, fixture packs, and enforcement logic.
