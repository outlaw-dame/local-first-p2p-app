# Semantic Discovery Protocol

- Status: Draft
- Date: 2026-06-25
- Related ADR: `docs/adr/010-semantic-discovery-protocol-v1.md`
- Related implementation plan: `docs/implementation/semantic-runtime-evaluation-plan.md`

## Purpose

This document defines protocol-level semantics for search and semantic discovery without choosing a search engine.

Semantic discovery is a projection over protocol objects. It is not source of truth.

## Core rule

The protocol defines interoperable records and boundaries.

Implementations choose their runtime engines.

Protocol-level work may define:

- searchable object metadata;
- semantic capability descriptors;
- embedding artifact metadata;
- query intent records;
- privacy and capability filtering rules;
- trust and moderation integration points;
- selective replication rules for semantic artifacts.

Protocol-level work must not require a specific vector database, embedding model, ranking algorithm, or AI SDK.

## Authority boundary

Search indexes, embeddings, rankings, and query results are projections.

They do not replace:

- signed object validation;
- content references;
- capabilities;
- privacy scopes;
- local trust policy;
- moderation policy;
- deterministic apply rules.

## Searchable object metadata

Searchable metadata should identify what can be searched while avoiding unauthorized plaintext exposure.

Candidate metadata includes object ref, bundle ref, object kind, language, modality, privacy scope, capability requirements, provenance, freshness, and safe label/trust inputs.

## Capability descriptors

A peer or service may advertise search capabilities such as lexical, semantic, hybrid, embedding generation, modality-specific search, offline indexing, shared indexing, or public indexing.

Descriptors are hints. They do not grant trust.

## Embedding artifact metadata

Embedding metadata should describe the source object, model id, model version or digest, modality, dimensions, language, creation time, replacement/supersession, privacy scope, capability requirements, and storage hints where safe.

The protocol should describe metadata, not require a model.

## Query intent

Queries should describe intent rather than engine details.

Examples include exact lookup, lexical lookup, semantic lookup, hybrid lookup, nearest-neighbor lookup, metadata filtering, capability filtering, trust filtering, moderation filtering, and modality filtering.

## Privacy rule

Every semantic query path must apply the same authorization rules as object access.

Private object existence, plaintext, embeddings, and account-local indexes must not be exposed without the relevant capability and local policy approval.

## Replication rule

Indexes and embeddings are local-only by default.

They may be regenerated locally, shared for public objects, or replicated under explicit capability. Index availability is not object authorization.

## Engine independence

A conforming implementation may use QVAC, SQLite plus vector extensions, Tantivy/Lucene, LanceDB, another engine, or no semantic engine at all, provided protocol privacy and authorization semantics are preserved.
