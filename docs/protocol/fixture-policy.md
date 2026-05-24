# Protocol Fixture Policy

Protocol fixtures are required before a protocol object is considered implemented.

Fixtures protect the project from accidental wire-format drift, duplicate protocol concepts, unsafe coercion, and future incompatibility between PWA-light-peer and full-peer adapters.

## Scope

This policy applies to durable or security-sensitive objects, including:

- signed events,
- source references,
- identity events,
- capabilities,
- room events,
- MLS control records,
- media manifests,
- name bindings,
- search objects,
- compression descriptors,
- bridge delivery records or confirmations when treated as protocol-level objects.

## Required fixture classes

Every protocol object needs:

1. **Valid fixtures**
   - minimal valid object,
   - representative full object,
   - object with optional fields omitted,
   - object with extension fields if extension is allowed.

2. **Invalid fixtures**
   - unknown major version,
   - missing required field,
   - wrong field type,
   - unsupported enum value,
   - malformed source reference,
   - invalid signature/hash where applicable,
   - non-canonical or unsafe JSON where applicable,
   - replay/stale/revoked state where applicable.

3. **Canonicalization fixtures**
   - expected canonical serialized form,
   - expected hash/signature input,
   - deterministic ordering expectations.

4. **Round-trip fixtures**
   - parse -> validate -> canonicalize -> hash/sign -> verify where applicable.

## Directory convention

Use package-local fixtures unless a fixture spans multiple packages.

Example:

```text
packages/protocol/fixtures/
  signed-event/
    valid/
    invalid/
    canonical/
```

Cross-package fixtures may live under:

```text
test-fixtures/protocol/
```

Only add a shared top-level fixture directory when more than one package consumes the same fixtures.

## Versioning rules

- Unknown major versions must be rejected.
- Unknown optional fields may be ignored only if the object explicitly permits extension.
- Security-sensitive objects must be canonicalized before hashing/signing.
- Fixture updates must be included in the same PR as protocol shape changes.
- Schema migrations must include old and new fixture coverage where compatibility matters.

## Validation rules

Validators must not silently coerce security-sensitive values.

Examples of unsafe coercion:

- accepting `"7"` as numeric sequence `7`,
- accepting `123` as reason string `"123"`,
- accepting blank strings as absent values,
- accepting non-finite numbers,
- accepting unsupported status values as generic failures.

## Test expectations

Every protocol fixture suite should include tests for:

- valid fixture acceptance,
- invalid fixture rejection with predictable errors,
- canonical output stability,
- signature/hash verification where applicable,
- no unsafe coercion,
- unknown-version handling.

## Pull request rule

A PR that adds or changes protocol object shape must state one of the following:

- fixtures added/updated, or
- no fixture update needed because the change is internal and does not affect protocol shape.

If neither is true, the PR is incomplete.
