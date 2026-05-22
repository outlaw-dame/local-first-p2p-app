# Frontend Architecture for the First PWA
## Local-First Light Peer Strategy

This document outlines the frontend architecture for the initial PWA target.

### 1. Technology Stack
The frontend is built on a modern, local-first stack:
- **Shell**: Framework7 React + TypeScript + Vite.
- **Storage**: Dexie for signed event storage and mutation outbox.
- **Search**: PGlite for relational projections and local full-text search.
- **Sync**: TanStack Query for bridge state; custom sync client for protocol events.

### 2. Mental Model
The PWA is not a thin client; it is a **local-first protocol client**. It owns the local app state, writes locally first, and verifies data locally before synchronization.

### 3. Data Flow
1. **User Action**: Triggered in the UI.
2. **Local Validation**: Verified against protocol rules.
3. **Signed Event**: Created and written to Dexie.
4. **Immediate UI Update**: Rendered from local materialized views.
5. **Outbox Enqueue**: Mutation queued for background sync.
6. **Bridge Sync**: Opportunistic synchronization with infrastructure peers.
