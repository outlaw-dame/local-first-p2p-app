# Implementation Doctrine v1
## Local-First P2P Architecture Development Gospel

This document serves as the build-order authority for the first implementation of the local-first P2P architecture.

### 1. Core Decisions
The primary objective is to build a **PWA-first product** with a **hybrid-ready architecture**. While the initial client is a PWA, all underlying systems (engine, data formats, identity model) must remain compatible with future full peers.

### 2. Implementation Rules
The following non-negotiable rules govern the development process:
- **No server-authoritative private state**: Bridges and servers only store/forward signed or encrypted data.
- **Every durable event is signed**: All messages and identity events require verifiable provenance.
- **Private payloads are encrypted**: Plaintext access is restricted to authorized clients.
- **Derived indexes are disposable**: All views and search indexes must be rebuildable from source records.

### 3. Product Roadmap
- **PWA light peer**: User-facing v1 client focusing on local signing and verification.
- **Stateful bridge**: Provides encrypted mailbox and resumable delivery services.
- **Persistent full peer**: Prototype early to ensure long-term availability and DHT participation.
