# Specification Document Template

- Status: Draft
- Specification series: 0
- Scope: template for future specification documents

Use this template for new normative specification documents.

```md
# Title

- Status: Draft
- Specification version: 0.x
- Scope: ...
- Profiles: ...
- Updates: ...
- Supersedes: ...
- Related: ...

## Purpose

What problem this document solves.

## Scope

What this document covers and does not cover.

## Terminology

Definitions specific to this document. Shared definitions belong in `GLOSSARY.md`.

## Design goals

Which goals from `DESIGN_GOALS.md` this document supports and any tradeoffs it introduces.

## Requirements

Normative requirements using MUST, SHOULD, and MAY.

## Object model

Protocol objects, fields, references, identifiers, and serialization expectations.

## State machine

State transitions, legal/illegal transitions, terminal states, idempotency, retries, expiry, and tombstones.

Omit this section only if the feature has no state machine.

## Validation

Required validation steps before records are accepted, projected, stored, forwarded, indexed, or displayed.

## Consistency model

Applicable operation consistency class, merge/apply rules, conflict handling, replay behavior, and projection behavior.

## Replication and sync behavior

How the feature participates in selective sync, checkpoints, local-first operation, mailbox delivery, portable sync drops, or availability providers.

## Privacy considerations

Private payloads, metadata exposure, sealed recipients, local discovery, logs, provider visibility, and user controls.

## Security considerations

Threats, verification requirements, replay/downgrade concerns, key handling, abuse resistance, and safe failure behavior.

## Interoperability considerations

How independent implementations should behave and what must be stable for compatibility.

## Performance considerations

Payload size, batching, caching, indexing, storage pressure, CPU/memory costs, and network behavior.

## Low-bandwidth behavior

Headers-first behavior, lazy payload fetch, media deferral, chunking, sync interest narrowing, and degraded-mode expectations.

## Censorship-resilience behavior

How the feature behaves when hosted infrastructure is unavailable or blocked.

## Provider behavior

If providers are involved, define what they may do, what they must not do, and what authority they do not have.

## Examples

Concrete examples. These are informative unless normative terms are used intentionally.

## Registry impact

Object types, event types, capability identifiers, transport identifiers, error codes, media types, or cryptographic identifiers that must be registered.

## Conformance impact

Profiles affected by this document and required test/fixture expectations.

## Open questions

Unresolved questions that must be settled before Candidate or Stable status.

## Future extensions

Possible future work that is explicitly out of scope for the current document.
```

## Template rules

- Do not introduce a new first-class term without updating `GLOSSARY.md`.
- Do not introduce a new protocol identifier without checking `REGISTRIES.md`.
- Do not introduce a new required behavior without conformance impact.
- Do not introduce a new security-sensitive behavior without security considerations.
- Do not introduce a new availability provider behavior without authority-boundary language.
- Do not introduce a new sync behavior without low-bandwidth and degraded-infrastructure behavior.
