# Content Reference Model

- Status: Draft
- Specification series: 3
- Specification version: 0.x
- Scope: digest-based payload integrity and provider-independent payload references
- Profiles: Core, Messaging, Social, Offline, Availability
- Related:
  - `docs/specification/03-data/object-references.md`
  - `docs/specification/01-core/authority-model.md`

## Purpose

This document defines how digest-based content references support payload integrity, deduplication, chunking, provider independence, and portable sync.

A content reference is an integrity mechanism, not an authority mechanism.

## Requirements

- Content references MUST NOT be treated as proof of authorization.
- Content references MUST NOT replace signatures, capabilities, key-epoch validation, consistency-class validation, or access policy.
- Referenced payloads SHOULD be verifiable from bytes alone using the declared digest or content identifier.
- Private payloads referenced by digest MUST remain encrypted when stored by untrusted providers.

## Appropriate uses

Content references are appropriate for media payloads, attachments, encrypted message bodies, Entity Components, Portable Sync Drop payloads, Content Bundles, mailbox payload references, feed candidate payloads, large object chunks, provider dedupe, and transport integrity checks.

## Inappropriate uses

Content references MUST NOT be used as the sole basis for Identity Root authority, Device authorization, Capability grants, revocation, Space membership, moderation authority, report/appeal lifecycle, key epoch state, latest-state selection, or user consent.

## Content identifier behavior

A content identifier SHOULD bind digest algorithm, digest bytes, encoding or codec where applicable, and chunking or bundle manifest where applicable.

A future registry MUST define allowed digest algorithms and encodings.

## Encrypted content

For private content, the content reference may identify ciphertext rather than plaintext.

Ciphertext references can improve provider independence while preserving privacy.

Implementations MUST ensure that encryption metadata, recipient metadata, and storage hints do not leak more information than the relevant privacy policy permits.

## Chunking

Large payloads SHOULD support chunking or bundle manifests.

Chunked content SHOULD allow partial verification, resume, range fetch, low-bandwidth deferral, dedupe, alternative providers, and Portable Sync Drop inclusion.

## Provider independence

A payload may be available from many providers or peers.

Clients SHOULD verify content by digest rather than trusting the provider.

Provider unavailability SHOULD degrade payload retrieval, not invalidate the Object Reference unless the payload is required for validation.

## Low-bandwidth behavior

Low-bandwidth sync SHOULD exchange content identifiers, sizes, small manifests, and required metadata before payload bytes.

Large payload bytes SHOULD be lazy or explicitly requested.

## Security considerations

Implementations MUST guard against digest confusion, algorithm downgrade, unsafe codec interpretation, partial chunk substitution, storage hint poisoning, encrypted metadata leakage, treating public availability as permission, and storage-exhaustion attacks.

## Open questions

- Initial digest algorithm set.
- Whether external content identifier formats are mandatory, optional, or compatibility-layer only.
- Canonical bundle manifest format.
- Maximum inline object size.
- Required chunking strategy for Offline Profile.
