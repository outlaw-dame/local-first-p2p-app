# ADR-002: Private Payload Encryption Envelope v1

- Status: Accepted
- Date: 2026-05-26
- Deciders: local-first-p2p-app maintainers
- Related docs:
  - docs/implementation/next-development-path.md
  - docs/implementation/known-deviations.md
  - docs/implementation/schema-and-storage-versioning.md
- Related PRs:

## Context

The project currently signs durable events and encrypts local private key material, but private user payloads are not yet encrypted for dm/group/private social use cases. The doctrine requires encrypted private payloads before untrusted storage or transport.

## Decision

Adopt a private payload encryption envelope for private scopes.

1. Scope policy:
- self, dm, and group payload content must be encrypted.
- public payload content remains plaintext by design.
- device-local payload content may remain local plaintext unless future policy tightens this.

2. Envelope policy:
- encrypted payloads use an explicit envelope object with algorithm and key reference metadata.
- the plaintext payload field is replaced by ciphertext plus authenticated metadata fields.
- envelope versioning follows protocol versioning policy and fixture discipline.

3. Metadata policy:
- minimal routing metadata remains visible (event id, kind, author/device ids, timestamps, refs, privacy scope, envelope headers).
- private content fields are never logged in plaintext.

4. Key wrapping policy before MLS:
- dm/group payload keys are wrapped per recipient device capability using controller-authorized device keys.
- this pre-MLS wrapping strategy is transitional and must compose with future MLS by treating MLS-managed keys as the payload-key source.

## Scope

This decision applies to:

- protocol objects: encrypted payload envelope fields,
- storage schemas: persisted encrypted payload representation,
- runtime adapters: PWA and bridge handling of encrypted payload events,
- security/privacy boundaries: plaintext minimization and log hygiene,
- tests/fixtures: encryption envelope valid and invalid cases.

This decision does not apply to:

- MLS group key schedule internals,
- media chunk encryption format,
- search indexing policy for encrypted payloads.

## Options considered

### Option A: Keep private payload plaintext until MLS

Pros:

- lower short-term complexity,
- easier debugging.

Cons:

- violates doctrine privacy requirement,
- allows plaintext leakage in untrusted systems,
- increases migration risk later.

### Option B: Add envelope now and compose with MLS later (chosen)

Pros:

- immediate privacy boundary improvement,
- compatible transitional model for dm/group before MLS,
- clear fixture/test path for malformed envelope rejection.

Cons:

- requires new protocol fields and validation,
- requires careful metadata minimization decisions.

## Consequences

Positive consequences:

- private payload leakage risk is reduced,
- bridge and storage remain non-authoritative and content-opaque for private data,
- MLS adoption path is clearer.

Negative consequences / tradeoffs:

- payload inspection tooling becomes more limited by design,
- key distribution and wrap failures must be surfaced explicitly.

## Security and privacy impact

- Private data affected: message/social payload bodies for self, dm, and group scopes.
- Metadata exposed: routing and identity headers plus envelope headers.
- New trust assumptions: recipient key resolution and wrap integrity are correct.
- Abuse/failure modes: ciphertext replay, key-wrap mismatch, stale recipient keys, malformed envelope fields.
- Required tests:
  - reject private-scope events with plaintext payloads,
  - reject malformed envelope versions/algorithms/nonce/tag fields,
  - verify only intended recipients can decrypt,
  - ensure logs do not emit private plaintext.

## Migration and compatibility

- Existing code affected: packages/protocol, packages/crypto, packages/local-store, packages/sync-client.
- Storage migration needed: yes, private payload rows must support encrypted envelope representation.
- Fixture updates needed: yes, valid and invalid encrypted payload fixtures.
- Full-peer compatibility notes: envelope object must be runtime-neutral and reusable by full-peer adapters.

## Exit criteria

This ADR is implemented when:

- [ ] Encrypted payload envelope schema and validators are added.
- [ ] Scope policy enforcement rejects private plaintext payloads.
- [ ] Fixture pack includes valid and malformed envelope cases.
- [ ] Bridge/client tests show private payloads stay ciphertext across transport/storage.
- [ ] Logging policy tests prevent private plaintext emission.
