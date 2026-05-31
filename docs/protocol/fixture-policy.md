# Protocol Fixture Policy

Protocol fixtures are required before a protocol object is considered implemented.

Fixtures protect the project from accidental wire-format drift, duplicate protocol concepts, unsafe coercion, unsafe trust assumptions, and future incompatibility between PWA-light-peer and full-peer adapters.

## Scope

This policy applies to durable or security-sensitive objects, including:

- signed events,
- source references,
- identity events,
- capabilities,
- credential/trust-policy objects,
- content-addressing refs,
- object refs,
- bundle refs,
- trust and safety objects,
- transport admission decisions,
- curation decisions/explanations,
- room events,
- MLS control records,
- media manifests,
- name bindings,
- search objects,
- recommendation/search provenance objects,
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
   - malformed source/object/content reference,
   - invalid signature/hash where applicable,
   - invalid digest/CID/content-link where applicable,
   - unsafe URL/location hint where applicable,
   - unsafe size/compression metadata where applicable,
   - invalid authority/scope where applicable,
   - private/public scope violation where applicable,
   - non-canonical or unsafe JSON where applicable,
   - replay/stale/revoked state where applicable.

3. **Canonicalization fixtures**
   - expected canonical serialized form,
   - expected hash/signature input,
   - deterministic ordering expectations,
   - expected digest/content-link input where applicable.

4. **Round-trip fixtures**
   - parse -> validate -> canonicalize -> hash/sign -> verify where applicable,
   - parse -> validate -> redacted display/log form where applicable,
   - parse -> validate -> reject unsafe private/public routing where applicable.

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

Content-addressing fixtures should live under:

```text
packages/content-addressing/fixtures/
  valid/
  invalid/
```

Trust and safety fixtures should live under:

```text
packages/trust-safety/fixtures/
  valid/
  invalid/
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
- Content-addressing and trust/safety fixtures must include private/public scope behavior where applicable.

## Validation rules

Validators must not silently coerce security-sensitive values.

Examples of unsafe coercion:

- accepting `"7"` as numeric sequence `7`,
- accepting `123` as reason string `"123"`,
- accepting blank strings as absent values,
- accepting non-finite numbers,
- accepting unsupported status values as generic failures,
- accepting malformed digest strings,
- treating a location hint as authority,
- treating a CID/content link as an IPFS URL,
- treating a label/report as an enforcement decision,
- treating bridge-local rejection as global deletion.

## Content-addressing fixture expectations

When a PR adds `DigestRef`, `ContentLink`, `BlockRef`, `ObjectRef`, `BundleRef`, or `StorageLocationHint` shapes, fixtures must cover:

- valid SHA-256 digest refs,
- unsupported digest algorithms,
- malformed digest encodings,
- wrong digest lengths,
- CIDv1 content-link shape,
- unsupported CID version for new objects,
- unsupported codecs,
- raw public block refs,
- encrypted private block refs,
- unsafe byte lengths,
- unsafe compression metadata,
- URL/location hints with embedded credentials,
- empty bundle roots,
- malformed object refs,
- private/public dedupe or routing violations where applicable.

## Trust and safety fixture expectations

When a PR adds trust and safety object shapes, fixtures must cover:

- valid/invalid `SafetyAuthority`,
- valid/invalid `EnforcementScope`,
- valid/invalid `SafetySubjectRef`,
- valid/invalid `SafetyAnnotation`,
- valid/invalid `SafetyLabelDefinition`,
- valid/invalid `SafetyLabel`,
- valid/invalid `SafetyLabelerProfile`,
- valid/invalid `SafetyLabelerSubscription`,
- valid/invalid `SafetyReport`,
- valid/invalid `SafetyAppeal`,
- valid/invalid `SafetyPolicyDecision`,
- valid/invalid `TransportAdmissionDecision`,
- valid/invalid `CurationRule`,
- valid/invalid `CurationExplanation`,
- private evidence in public flow rejection,
- unknown labeler advisory/default behavior,
- invalid authority/capability scope where applicable,
- bridge-local rejection not treated as global deletion,
- curation downrank not treated as moderation hide.

## Test expectations

Every protocol fixture suite should include tests for:

- valid fixture acceptance,
- invalid fixture rejection with predictable errors,
- canonical output stability,
- signature/hash verification where applicable,
- no unsafe coercion,
- unknown-version handling,
- private/public scope enforcement where applicable,
- redacted logging/display behavior where applicable.

## Pull request rule

A PR that adds or changes protocol object shape must state one of the following:

- fixtures added/updated, or
- no fixture update needed because the change is internal and does not affect protocol shape.

If neither is true, the PR is incomplete.
