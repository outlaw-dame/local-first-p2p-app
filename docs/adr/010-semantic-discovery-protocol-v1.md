# ADR-010: Semantic Discovery Protocol v1

- Status: Proposed
- Date: 2026-06-25
- Related docs:
  - `docs/protocol/semantic-discovery.md`
  - `docs/implementation/semantic-runtime-evaluation-plan.md`
  - `docs/implementation/roadmap-ordering.md`

## Context

The protocol needs semantic discovery support, but it must remain engine-agnostic.

Implementations may use QVAC, PGlite, SQLite/FTS/vector extensions, Tantivy/Lucene, LanceDB, custom local indexes, or no semantic engine.

## Decision

Define semantic discovery as a protocol projection layer.

The protocol may define:

- searchable object metadata;
- semantic capability descriptors;
- embedding artifact metadata;
- query intent records;
- privacy and capability rules;
- trust/moderation integration points;
- replication rules for semantic artifacts.

The protocol must not require a specific engine, model, ranking algorithm, cloud service, or peer inference layer.

## Authority boundary

Semantic indexes, embeddings, rankings, and results are not protocol source of truth. They are derived from signed objects, content references, capabilities, privacy scopes, trust policy, and deterministic apply rules.

## Local derived-data boundary

Semantic artifacts derived from scoped objects must inherit the same or stricter storage scope as their sources. They remain local-only by default and must be invalidated when source state or local policy requires it.

## QVAC boundary

QVAC is a candidate runtime/provider for local AI, embeddings, retrieval, optional model sharing, and delegated inference. It is not protocol authority.

## Non-goals

This ADR does not implement semantic search, select a runtime, define final schemas, define final APIs, or add dependencies.
