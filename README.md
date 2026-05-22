# Local-First P2P Product Monorepo

This repository is the first concrete product/client implementation for the Local-First P2P architecture. The first shipped surface is a **local-first PWA light peer**, but the repo is structured so the same protocol, identity, media, sync, and search contracts can later be implemented by native/Bare/Holepunch full peers and persistent availability peers.

The PWA is not a thin online client. It writes locally first, renders from local materialized views, verifies and decrypts data locally, and syncs opportunistically through bridge/super-peer infrastructure.

## Runtime Strategy

- **First product surface**: Framework7 React PWA.
- **PWA role**: Local-first light peer.
- **Full-peer path**: Future native/Bare/Holepunch-compatible engine.
- **Infrastructure path**: Bridge service and persistent availability peers remain non-authoritative.

The PWA may use bridge services for delivery, search pointers, and sync, but bridges must not become the source of truth for private state.

## Repository Structure

The monorepo is organized into `apps/` and `packages/` to enforce strict boundaries and prevent the PWA from becoming a siloed frontend.

### Applications (`apps/`)

- **pwa/**: Primary user-facing PWA built with Framework7 React, TypeScript, and Vite.
- **bridge-service/**: Placeholder for synchronization and bridge protocols.
- **capacitor-ios/**: Placeholder for future iOS native packaging.
- **capacitor-android/**: Placeholder for future Android native packaging.

### Shared Packages (`packages/`)

- **protocol/**: Runtime-neutral signed event schemas, source references, and validation helpers.
- **crypto/**: Signing and verification adapters; private-key handling must remain platform-aware.
- **local-store/**: Dexie-backed signed event store, mutation outbox, identity/contact state, pending media, sync offsets, and local materialized views.
- **sync-client/**: Bridge transport contracts, retry/backoff, idempotency, and stale-response guards.
- **search/**: PGlite-backed local relational/search projections, full-text search, and future hybrid/semantic search adapters.
- **platform/**: Runtime and capability detection for browser, standalone PWA, future Capacitor, and desktop contexts.
- **design-tokens/**: Apple-inspired design tokens and safe-area/layout primitives.
- **ui/**: Shared UI primitives and Framework7-compatible wrappers.

Planned packages include identity, naming, media, compression, and full-peer adapters. They should be added when implementation requires them, not as empty abstractions.

## Storage Boundary

The app uses a protocol-first local-first model:

- **Protocol events** are canonical local objects.
- **Dexie** stores signed events, outbox entries, contacts, identity state, pending media metadata, and materialized views.
- **PGlite** powers relational/search projections and future hybrid search.
- **TanStack Query** is only for bridge/server/public-index state, not the local-first source of truth.

The browser-local storage implementation is an adapter. It must not define a protocol that future full peers cannot implement.

## Non-Negotiable Rules

- Local writes happen before network synchronization.
- Durable app events must be signed.
- Private payloads must be encrypted before untrusted transport or storage.
- Bridges may deliver data; they must not define identity or private state truth.
- Search indexes and materialized views are derived and rebuildable.
- Mutation retries must use idempotency keys, exponential backoff with jitter, and stale-response protection.
- PWA code must remain compatible with future full-peer adapters.

## Tooling

- **pnpm workspaces** for package boundaries and dependency sharing.
- **TypeScript** with strict settings.
- **Vite** for the PWA build.
- **Vitest** for unit tests.
- **Playwright** placeholder for future end-to-end tests.
- **ESLint and Prettier** for code quality and formatting.

## Initial Build Order

1. Workspace and CI foundation.
2. Framework7 React PWA shell.
3. Design tokens and platform capability detection.
4. Protocol event envelope and source-reference contracts.
5. WebCrypto signing/verification abstraction.
6. Dexie signed-event store and mutation outbox.
7. Sync-client retry/backoff and bridge interfaces.
8. PGlite search projection package.
9. First vertical slice: create local identity, create signed event, store locally, render local view, enqueue outbox.
