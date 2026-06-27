# ADR-010: Semantic Discovery Protocol v1

- Status: Proposed
- Date: 2026-06-25
- Related docs:
  - `docs/implementation/roadmap-ordering.md`
  - `docs/protocol/semantic-discovery.md`
  - `docs/implementation/semantic-runtime-evaluation-plan.md`
  - `docs/adr/009-p2p-runtime-adapters-and-selective-replication-v1.md`

## Context

The protocol needs semantic discovery support, but it must not standardize one search engine or embedding runtime.

Applications built on the protocol may use different local or server-side implementations: SQLite + FTS5 + sqlite-vec, QVAC, PGlite, Tantivy/Lucene, LanceDB, custom local indexes, or no semantic search at all.

The protocol should define interoperable metadata, descriptors, query intent, privacy boundaries, and replication rules. Implementations choose engines.

## Decision

Define a semantic discovery protocol layer that is engine-agnostic.

The protocol may define:

- searchable object metadata;
- semantic capability descriptors;
- embedding artifact metadata;
- query intent records;
- index privacy and capability filtering rules;
- trust/moderation integration points;
- selective replication rules for semantic artifacts;
- provenance and explanation metadata.

The protocol must not require:

- QVAC;
- sqlite-vec;
- a specific vector database;
- a specific embedding model;
- a specific ranking algorithm;
- cloud inference;
- peer-to-peer inference.

## Authority boundary

Semantic search is a projection layer.

Search indexes, embeddings, rankings, and query results are not protocol source of truth. They must be derived from signed objects, content references, capabilities, privacy scopes, trust policy, and deterministic apply rules.

A search result is eligible to display only when the responder is authorized to expose the referenced object or metadata.

## Local derived-data boundary

Semantic artifacts derived from scoped objects must inherit the same or stricter storage scope as their sources. They remain local-only by default and must be invalidated when source state, tombstones, capabilities, model version, or local policy requires it.

## Privacy rule

Implementations must not expose private, account-local, group, or encrypted object metadata through semantic discovery unless the querying peer has the required capability and local policy allows it.

For encrypted objects, implementations may:

- skip indexing;
- index only local plaintext after decryption on an authorized device;
- index encrypted-safe metadata;
- regenerate embeddings locally after authorized decryption.

Implementations must not publish embeddings that leak private plaintext unless the embedding artifact itself is scoped, encrypted, and authorized.

## Descriptor rule

Peers and services may advertise semantic capabilities through descriptors. A descriptor says what the node can do, not that the node is trusted.

Capabilities may include lexical search, semantic search, hybrid search, embedding generation, image/audio/video embeddings, local-only indexing, shared indexes, or provider-backed inference.

## Query rule

Queries should express intent, not engine-specific implementation details.

Examples:

- exact object lookup;
- lexical lookup;
- semantic lookup;
- hybrid lookup;
- nearest-neighbor lookup;
- capability-filtered lookup;
- trust-filtered lookup;
- modality-filtered lookup.

## Replication rule

Semantic artifacts are optional protocol-adjacent projections.

An implementation may keep embeddings/indexes local-only, regenerate them locally, replicate them under capability, or publish public indexes. The default should be local-only unless an object is public or a capability explicitly allows sharing.

## QVAC boundary

QVAC is a candidate runtime/provider for local AI, embeddings, retrieval, optional peer-assisted model sharing, and delegated inference. It is not protocol authority and should be evaluated alongside other embedded search/retrieval options.

## Non-goals

This ADR does not implement semantic search, select a runtime, define final embedding schemas, define final query APIs, or add runtime dependencies.

## Required follow-up

- Add `docs/protocol/semantic-discovery.md`.
- Add `docs/implementation/semantic-runtime-evaluation-plan.md`.
- Extend `docs/implementation/roadmap-ordering.md` after Phase 21 with semantic discovery phases.
