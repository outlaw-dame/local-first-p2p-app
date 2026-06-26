# Semantic Runtime Evaluation Plan

- Status: Draft
- Date: 2026-06-25
- Related ADR: `docs/adr/010-semantic-discovery-protocol-v1.md`
- Related protocol doc: `docs/protocol/semantic-discovery.md`

## Purpose

This plan defines how to evaluate semantic retrieval engines after the protocol-level semantic discovery doctrine exists.

The protocol stays engine-agnostic. The evaluation chooses reference implementations or provider adapters.

## Candidate runtimes

Initial candidates:

- QVAC SDK;
- SQLite + FTS5 + sqlite-vec or equivalent vector extension;
- Tantivy/Lucene-style lexical engines;
- LanceDB or similar embedded vector store;
- custom local-only index for minimal clients.

An implementation may support more than one engine.

## QVAC evaluation notes

QVAC is relevant because its SDK is positioned for local-first decentralized AI, supports JavaScript runtimes such as Node.js, Expo, Bare, and Bun, includes embeddings and RAG APIs, supports optional peer-to-peer model sharing and delegated inference, and can run models locally/offline after download.

These traits align with the local-first protocol direction, but QVAC remains a provider candidate rather than protocol authority.

## Evaluation criteria

Evaluate each candidate against:

- local-first operation;
- offline operation;
- browser viability;
- native/mobile viability;
- desktop/server viability;
- WASM or JS runtime compatibility;
- incremental indexing;
- deletion and tombstone handling;
- schema migration handling;
- model/version upgrade handling;
- memory footprint;
- disk footprint;
- indexing throughput;
- query latency;
- hybrid lexical plus semantic retrieval;
- metadata filtering;
- capability-aware filtering;
- account-local index support;
- public index support;
- encrypted/private object handling;
- provenance/explainability support;
- deterministic testability;
- dependency and license fit;
- runtime isolation boundary;
- P2P/delegated inference safety.

## Required benchmark fixtures

Use protocol-shaped fixtures rather than generic documents:

- public text objects;
- account-local objects;
- group-scoped objects;
- deleted/tombstoned objects;
- superseded objects;
- labeled/moderated objects;
- multilingual objects;
- media metadata;
- bundle/object refs;
- large batches;
- incremental updates.

## Outcome options

The evaluation may conclude:

- SQLite + FTS5 + sqlite-vec remains the reference local implementation;
- QVAC becomes the preferred AI/provider adapter;
- QVAC and SQLite-based search coexist for different workloads;
- another engine is better suited;
- semantic discovery remains optional with no reference implementation yet.

## Non-goals

This plan does not implement QVAC, add a vector database, select an embedding model, define final query APIs, or make semantic search mandatory.

## Follow-up

After evaluation, define semantic runtime adapter interfaces in Phase 24 and a reference implementation in Phase 25.
