# Object References

- Status: Draft
- Specification series: 3
- Specification version: 0.x
- Scope: object references, content references, and storage hints
- Profiles: Core, Messaging, Social, Offline, Availability
- Related:
  - `docs/specification/03-data/entity-component-snapshots.md`
  - `docs/specification/03-data/content-addressing.md`
  - `docs/specification/01-core/authority-model.md`

## Purpose

This document defines Object References as protocol references to signed, content-addressed, encrypted, externally stored, or provider-available data.

Object References separate identity, authorization, integrity, storage location, and payload retrieval.

## Requirements

- Object References MUST NOT be treated as authorization by themselves.
- Object References SHOULD include or point to enough integrity material to verify fetched payloads.
- Object References MAY include storage hints, but storage hints MUST NOT be treated as canonical location authority.
- Private objects MUST remain encrypted when referenced through untrusted providers.
- Implementations MUST validate object type, signature, capability, encryption, and consistency rules where applicable before applying referenced data.

## Reference categories

### Signed record reference

References a signed protocol record.

The record signature and signer authority MUST be validated before authority-sensitive use.

### Content-addressed reference

References data by digest, content identifier, block reference, bundle reference, or equivalent content-addressed identifier.

Content addressing supports integrity. It MUST NOT replace authorization.

### Encrypted object reference

References encrypted payload data.

The reference MAY include encryption envelope metadata, recipient binding, group/MLS epoch, or key information references.

### Provider-location hint

References where bytes might be fetched.

Examples:

- local cache;
- IndexedDB/OPFS/native file store;
- mailbox provider;
- bridge store;
- relay store;
- super-peer cache;
- Hypercore/Corestore location;
- IPFS-compatible provider;
- CDN/media cache;
- portable sync drop.

Provider-location hints MUST be treated as hints.

### External compatibility reference

References a URI or external protocol object for compatibility.

External references MUST NOT bypass local validation, privacy, or safety policy.

## Suggested fields

A future stable Object Reference may include:

- object type;
- digest or content identifier;
- size, if known;
- media type or encoding;
- encryption envelope reference;
- signature reference;
- required capability or access policy;
- storage hints;
- preferred transports;
- expiration or retention hints;
- fallback references;
- Merkle/chunk manifest reference.

## Storage hints

Storage hints MAY improve fetch performance.

Storage hints MUST NOT imply:

- object validity;
- provider authority;
- user consent;
- public visibility;
- durable recipient acceptance;
- latest state;
- moderation approval.

## Object availability

Object availability is operational state.

An unavailable object MAY be retried, deferred, fetched from another provider, or omitted from low-bandwidth projections.

Unavailability MUST NOT invalidate a signed record unless the relevant object is required for validation.

## Object retrieval

When retrieving an object, implementations SHOULD:

1. choose an allowed storage hint or transport;
2. fetch bytes;
3. verify digest/content identifier;
4. verify encryption and access policy;
5. verify signature or containing record if applicable;
6. validate object type and schema;
7. apply only if authority and consistency rules permit.

## Low-bandwidth behavior

Low-bandwidth sync SHOULD prioritize Object References and digests before large payloads.

Implementations MAY display degraded placeholders when payload bytes are unavailable but safe metadata is available.

Large payloads SHOULD be fetched lazily.

## Security considerations

Implementations MUST guard against:

- digest substitution;
- provider equivocation;
- encrypted payload metadata leaks;
- treating a storage hint as authorization;
- fetching unsafe external URIs without policy checks;
- partial payload attacks;
- oversized payload DoS;
- malicious media types;
- stale object references used as latest state.

## Open questions

- Canonical ObjectRef encoding.
- Required digest algorithm set.
- Whether Object References use IPLD-compatible CIDs, protocol-native refs, or both.
- Storage hint registry shape.
- Required behavior for unavailable required objects.
