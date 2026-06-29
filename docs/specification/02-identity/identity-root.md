# Identity Root

- Status: Draft
- Specification series: 2
- Specification version: 0.x
- Scope: portable identity root and controller authority
- Profiles: Core, Messaging, Social, Offline, Security
- Related:
  - `docs/specification/01-core/authority-model.md`
  - `docs/specification/01-core/protocol-layers.md`
  - `docs/specification/SECURITY_MODEL.md`

## Purpose

This document defines the Identity Root as the protocol authority anchor for a user or governed actor.

The Identity Root is the portable cryptographic basis for controller authority, device authorization, capability issuance, revocation, recovery, and cross-device continuity.

## Requirements

- An implementation claiming Core Profile identity support MUST distinguish Identity Root authority from transport identity, provider account identity, mailbox identity, app-view identity, and storage location.
- An Identity Root MUST be cryptographically verifiable.
- Identity continuity MUST NOT depend on one hosted provider, app view, bridge, relay, mailbox, super-peer, storage provider, or transport.
- Identity Root state MUST be projected through deterministic authority rules.
- Identity Root state MUST NOT use generic LWW, mutable path overwrite, provider-local database state, or transport-local state as its authority model.

## Conceptual model

```txt
Identity Root
  ↓
Controller authority
  ↓
Authorized devices
  ↓
Scoped capabilities
  ↓
Signed records
  ↓
Deterministic projections
```

## Identity Root vs Controller

The Identity Root is the durable protocol identity anchor.

The Controller is the active authority that exercises or delegates control for the Identity Root.

A simple implementation MAY use one controller key as the active root controller. A later Security Profile MAY define threshold controllers, delegated recovery controllers, or FROST-backed controller authority.

## Identity Root vs User Data Root

Identity Root answers: "Who is this actor, and which authority controls it?"

User Data Root answers: "What is this actor's portable durable state?"

The two are related but MUST NOT be conflated.

A User Data Root replica may be hosted or copied in many places. Identity Root authority determines whether records claiming to update that user's state are valid.

## Identity Root vs Mailbox

A Mailbox is delivery infrastructure.

A mailbox route MUST NOT be treated as identity authority.

Changing mailbox providers MUST NOT change Identity Root continuity.

## Identity Root vs Provider Account

A provider account MAY help users discover, host, sync, cache, or recover data.

Provider account existence MUST NOT be treated as protocol identity authority unless an explicit protocol capability grants a narrow role.

## Required state families

A complete Identity Root specification SHOULD eventually define:

- root identifier format;
- controller key format;
- device authorization records;
- device revocation records;
- key rotation records;
- recovery records;
- capability issuer rules;
- identity projection rules;
- tombstone/deactivation behavior;
- audit/checkpoint behavior.

## Validation

Before applying an identity-sensitive record, implementations MUST validate:

- record signature;
- signer authority;
- applicable controller or device authorization;
- revocation status;
- consistency class;
- replay/idempotency behavior;
- key epoch or rotation rules where applicable.

## Failure behavior

If Identity Root authority cannot be established, implementations MUST fail closed for authority-sensitive state.

Implementations MAY retain untrusted records as quarantined observations if privacy and safety policy permits.

## Low-bandwidth behavior

Identity Root proofs, device authorization state, revocation state, and key-epoch records SHOULD be prioritized in low-bandwidth sync.

Large profile data, media, social history, indexes, or generated metadata SHOULD NOT block identity verification.

## Censorship-resilience behavior

Identity Root verification SHOULD work from locally held records, nearby peer exchange, portable sync drops, or other non-hosted transfer paths when public providers are unavailable.

## Security considerations

Identity Root compromise is high impact.

The protocol SHOULD support recovery and rotation patterns that reduce single-device loss and single-provider lock-in.

Future threshold authority MAY improve recovery and governance, but ordinary identity verification MUST remain possible without contacting a central authority.

## Open questions

- Final root identifier format.
- Whether the first stable profile requires DID-compatible identifiers, protocol-native identifiers, or both.
- Initial controller key algorithm set.
- Initial recovery mechanism before FROST/threshold authority is specified.
