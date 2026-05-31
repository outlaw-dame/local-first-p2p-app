# Local-First P2P Product Monorepo

This repository is the first concrete product/client implementation for the Local-First P2P architecture. The first user-facing surface is a local-first PWA light peer, while the architecture keeps a path open for future full peers and persistent availability peers.

The architecture is trust-centric and protocol-first: it is built around signed events, identity, capabilities, content objects, trust decisions, and replication. It is not an ActivityPub, ATProto, or Memory protocol authority; those systems may inspire ideas, but they are not the repository's architecture authority.

For the current repository architecture summary, see `docs/implementation/repository-architecture-summary.md`.

## Start here

Read the documentation in this order before changing implementation direction:

1. [`docs/implementation/current-state.md`](docs/implementation/current-state.md) - what the repository implements today.
2. [`docs/implementation/phase-map.md`](docs/implementation/phase-map.md) - how current code maps to the implementation doctrine phases.
3. [`docs/implementation/planning-to-code-alignment.md`](docs/implementation/planning-to-code-alignment.md) - what is implemented, partial, deferred, or intentionally different from the planning docs.
4. [`docs/implementation/known-deviations.md`](docs/implementation/known-deviations.md) - known deviations from the original plan.
5. [`docs/implementation/next-development-path.md`](docs/implementation/next-development-path.md) - the recommended next build sequence.
6. [`docs/architecture/README.md`](docs/architecture/README.md) - index for the original architecture planning set.

The architecture documents are planning and doctrine artifacts created before implementation. They are not claims that every target subsystem already exists. The implementation documents are the current truth layer.

## Repository structure

### Applications

- `apps/pwa` - Framework7 React PWA light peer.
- `apps/bridge-service` - non-authoritative bridge service primitives, request handling, verification, idempotency behavior, and bridge store backends.
- `apps/capacitor-ios` - future iOS native packaging placeholder.
- `apps/capacitor-android` - future Android native packaging placeholder.

### Packages

- `packages/protocol` - signed event schemas, source references, canonicalization, and validation helpers.
- `packages/content-addressing` - content-addressed integrity primitives, canonical JSON hashing, digest refs, and object refs.
- `packages/crypto` - signing, verification, hashing, and local key-material protection helpers.
- `packages/identity` - local device identity bootstrap and restore; not the final account identity-control model.
- `packages/local-store` - Dexie-backed signed event store, mutation outbox, summaries, device identity records, and local protection-key records.
- `packages/sync-client` - bridge transport contracts, retry/backoff, idempotency, stale-response guards, and defensive HTTP bridge response parsing.
- `packages/search` - early PGlite-backed local projection/search package.
- `packages/platform` - runtime and capability detection.
- `packages/design-tokens` - design-token boundary.
- `packages/ui` - shared UI primitives.

## Current development path

The current working phase is:

> Phase 1.5 / 3.5 - Doctrine alignment and protocol hardening before feature expansion

Recommended next work is documented in [`docs/implementation/next-development-path.md`](docs/implementation/next-development-path.md).

## Tooling

- pnpm workspaces
- TypeScript
- Vite
- Vitest
- ESLint and Prettier
- GitHub Actions CI for lint, typecheck, test, and build
