# ADR-000: Runtime and Product Surface

- Status: Accepted
- Date: 2026-05-24

## Decision

The first product surface is a PWA.

The repository remains architecture-first. Browser code is an adapter around shared contracts, not the entire product architecture.

Future runtimes must be able to use the same durable object shapes, validation rules, and compatibility expectations.

## Consequences

- Continue PWA implementation first.
- Keep shared contracts runtime-neutral.
- Keep local database schemas as adapter details.
- Require ADRs before major changes to runtime, durable object shape, storage, identity, sync, media, search, naming, MLS, or compression.

## Exit criteria

- [x] Decision recorded.
- [x] PWA-first path recorded.
- [x] Future runtime compatibility recorded.
