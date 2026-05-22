# Frontend Architecture for the First PWA
## Local-First Light Peer Strategy

This document outlines the frontend architecture for the initial PWA target.

### 1. Technology Stack

The frontend is built on a modern, local-first stack:

- **Shell**: Framework7 React + TypeScript + Vite.
- **Operational storage**: Dexie for signed events, mutation outbox, contacts, identity state, pending media metadata, and local materialized views.
- **Search and relational projections**: PGlite for local full-text search, relational projections, and future hybrid/semantic search.
- **Bridge state**: TanStack Query only for bridge/server/public-index state.
- **Sync**: Custom sync client for signed protocol events, retry/backoff, idempotency, and stale-response protection.

### 2. Mental Model

The PWA is not a thin client; it is a **local-first protocol client**. It owns local app state, writes locally first, verifies data locally, decrypts locally where authorized, and syncs opportunistically through bridge/super-peer infrastructure.

It is also a light peer. It is not expected to provide always-on seeding, DHT participation, large media serving, or durable group sequencing. Those roles belong to future full peers and persistent availability peers.

### 3. Data Flow

1. **User action**: Triggered in the Framework7 UI.
2. **Local validation**: Checked against protocol rules.
3. **Signed event**: Created locally by the device/session key.
4. **Local write**: Stored in Dexie before network sync.
5. **Immediate UI update**: Rendered from local materialized views.
6. **Outbox enqueue**: Mutation queued with idempotency metadata.
7. **Bridge sync**: Opportunistic synchronization with infrastructure peers.
8. **Confirmation or retry**: Outbox state updates; failures remain visible and recoverable.

### 4. Storage Boundary

Dexie is the operational local-first store. PGlite is the local query/search projection engine. Neither replaces the protocol. The canonical application units remain signed protocol events, source references, identity records, namespace records, media manifests, and future full-peer log records.
