# Schema and Storage Versioning Policy

- Status: Accepted
- Date: 2026-05-24
- Related docs:
  - `docs/protocol/fixture-policy.md`
  - `docs/implementation/phase-map.md`
  - `docs/implementation/current-state.md`
  - `docs/adr/000-runtime-and-product-surface.md`

## Purpose

This policy defines how durable protocol objects, local database schemas, bridge records, and search projections should evolve without creating drift between the PWA implementation and future runtimes.

The main goals are:

- predictable compatibility behavior,
- no silent shape changes,
- no unsafe coercion,
- no browser-only durable formats,
- no untested migrations,
- no hidden data-loss behavior.

## Versioning layers

The project has three different versioning layers. Do not collapse them into one.

### 1. Protocol object versioning

Applies to durable objects that may be signed, referenced, replicated, bridged, indexed, or consumed by future runtimes.

Examples:

- signed event envelopes,
- source references,
- identity events,
- capabilities,
- room events,
- media manifests,
- name bindings,
- search objects,
- compression descriptors.

Rules:

1. Protocol objects must include explicit version information.
2. Unknown major versions must be rejected.
3. Minor-compatible optional fields may be ignored only when the object type explicitly permits extension.
4. Security-sensitive values must not be silently coerced.
5. Canonicalized bytes used for hash/signature input must remain stable for a version.
6. Version changes must update protocol fixtures in the same PR.
7. A protocol object cannot be considered implemented until valid and invalid fixtures exist.

#### Protocol version token format

Current signed event envelopes use this format:

```text
lfp2p.<object-family>.v<major>
```

The current event envelope version is:

```text
lfp2p.event.v1
```

Parsing rule:

1. Split the version token on `.`.
2. Require exactly three parts.
3. Require part 1 to be `lfp2p`.
4. Treat part 2 as the object family, such as `event`.
5. Require part 3 to match `v<positive-safe-integer>`, such as `v1`.
6. The integer after `v` is the major version.
7. Reject missing, malformed, zero, negative, non-integer, or unsafe major versions.

Compatibility rule:

- `lfp2p.event.v1` validators must reject any event envelope whose family is not `event` or whose major version is not `1`.
- Future object families may define their own accepted major versions, but they must use the same token parsing rule unless an ADR replaces this policy.
- A future `lfp2p.event.v2` is a new major event envelope version and must be rejected by v1 validators until v2 support is explicitly implemented.

#### Optional extension permission

Optional extension handling must be explicit per object type.

An object type permits extension only when its specification documents one of these mechanisms:

1. A reserved `extensions` object whose keys and value limits are validated.
2. A named optional field listed in that object type's schema as ignorable by older readers.
3. An ADR-approved extension point with fixtures covering both recognized and ignored extension values.

If none of those mechanisms is documented for the object type, validators must reject unknown top-level fields instead of ignoring them.

Extension fields must not alter the meaning of required fields, signature input, source references, identity authority, privacy scope, or ordering semantics unless the object version changes.

### 2. Adapter storage schema versioning

Applies to implementation databases such as Dexie and PGlite.

Examples:

- `signedEvents`,
- `mutationOutbox`,
- `eventSummaries`,
- `deviceIdentities`,
- `localProtectionKeys`,
- future sync checkpoints,
- future search projections.

Rules:

1. Adapter schemas may evolve independently from protocol object versions.
2. Adapter schema changes must not redefine protocol semantics.
3. Every schema change must include tests for new installs and upgrades from the previous version when practical.
4. Migrations must be idempotent or safely guarded by the database version mechanism.
5. Migrations must not silently discard durable protocol objects.
6. Derived tables may be rebuilt, but the rebuild behavior must be documented.
7. Durable local queues, identity records, and key records must not be dropped without an explicit migration plan.

### 3. Derived projection versioning

Applies to rebuildable views and indexes.

Examples:

- local event summaries,
- PGlite search rows,
- future feed projections,
- future message views,
- future embedding/vector rows.

Rules:

1. Derived projections must track enough metadata to know whether they are current.
2. Projection schema updates should prefer rebuilds from durable source events when possible.
3. Rebuild logic must preserve permission boundaries.
4. Deletion and revocation handling must be documented before private or shared projections are added.
5. Search and intelligence projections must not become source-of-truth state.

## Naming rules

Use precise names to avoid duplicate concepts.

- `mutationOutbox` means the local retry and delivery queue.
- A future public/social outbox must use a distinct name.
- `device identity` means the current local bootstrap identity unless an identity-control ADR expands the model.
- `protocol event` means the durable signed event envelope, not a database row.
- `projection` means derived local state that can be rebuilt.

## Bridge metadata rule

Bridge or server acknowledgements may report delivery metadata, such as a bridge-assigned sequence, accepted timestamp, retry hint, or conflict reason.

That metadata is transport state. It must not override or validate the internal state of a signed event.

Specifically, bridge-provided metadata must not change or prove:

- `eventId`,
- `kind`,
- `author`,
- `deviceId`,
- `createdAt`,
- `lamport`,
- `privacy`,
- `schemaVersion`,
- `payload`,
- `refs`,
- `signature`.

Components such as stale-response guards may use bridge-assigned sequence values to order local delivery attempts or ignore obsolete responses. They must not use those sequence values to rewrite signed event content or to decide whether the event itself is valid.

## Change requirements

A PR that changes durable object shape must include:

- protocol fixture updates,
- validator updates,
- tests for invalid input,
- documentation update or explicit note that docs are unaffected.

A PR that changes local-store schema must include:

- schema version change,
- migration or explicit new-install-only rationale,
- tests for existing data where practical,
- rollback/rebuild notes for derived data.

A PR that changes search projection schema must include:

- projection version or rebuild strategy,
- source event provenance preservation,
- permission-boundary statement,
- tests for stale or missing projection rows where practical.

## Rejection rules

Reject changes that:

- accept string numbers where numbers are required,
- accept empty strings for required identifiers,
- silently drop unknown required fields,
- treat bridge/server acknowledgements as proof of signed event validity,
- let bridge/server metadata rewrite signed event content,
- store browser-only durable shapes with no future-runtime mapping,
- add overlapping concepts without updating known deviations or adding an ADR.

## Required future work

The next protocol-hardening PR should add the first fixture pack under `packages/protocol` and enforce this policy with tests.

The next storage-related code PR should add sync checkpoint schema tests before implementing richer bridge readers.
