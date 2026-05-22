# Implementation Doctrine v1
## Local-First P2P Architecture Development Gospel

This document serves as the build-order authority for the first implementation of the local-first P2P architecture.

### 1. Core Decisions

The primary objective is to build a **PWA-first product** with a **hybrid-ready architecture**. The initial client is a local-first PWA light peer, but all underlying systems must remain compatible with future full peers.

### 2. Non-Negotiable Rules

- **No server-authoritative private state**: Bridges and servers only store/forward signed or encrypted data.
- **Every durable event is signed**: Messages, identity events, name records, and local actions require verifiable provenance.
- **Private payloads are encrypted**: Plaintext access is restricted to authorized clients.
- **Local-first write path**: User actions write locally before network synchronization.
- **Derived indexes are disposable**: Views and search indexes must be rebuildable from source records.
- **Retries are safe**: Mutation retries require idempotency keys, exponential backoff with jitter, and stale-response protection.
- **No drift**: Protocol types, storage schemas, and UI view models must remain aligned.

### 3. Product Roadmap

1. **PWA light peer**: User-facing v1 client focusing on local signing, local persistence, verification, and outbox sync.
2. **Stateful bridge**: Provides encrypted mailbox, resumable delivery, and public-index streams without becoming authoritative.
3. **Persistent full peer**: Prototype early enough to prove the protocol can migrate to Bare/Holepunch-compatible full peers.
