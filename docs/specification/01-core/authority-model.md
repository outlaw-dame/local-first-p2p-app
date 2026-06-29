# Authority Model

- Status: Draft
- Specification series: 1
- Specification version: 0.x
- Scope: protocol authority boundaries and validation doctrine
- Profiles: Core, Messaging, Social, Availability, Offline, Security
- Related:
  - `docs/specification/00-philosophy/protocol-philosophy.md`
  - `docs/specification/01-core/protocol-layers.md`
  - `docs/specification/SECURITY_MODEL.md`
  - `docs/protocol/operation-consistency-classes.md`

## Purpose

This document defines what establishes protocol authority and what does not.

It is the primary constitutional boundary preventing bridges, relays, mailboxes, super-peers, app views, feed generators, public indexes, storage providers, or transports from becoming implicit sources of truth.

## Authority definition

Protocol authority is the right to create, modify, revoke, validate, or project protocol state according to cryptographic and deterministic protocol rules.

Authority MUST be derived from one or more of:

- Identity Root / Controller authority;
- authorized Device authority;
- signed event envelopes;
- capability grants and revocations;
- encryption/key-epoch state;
- MLS group-control state;
- consistency-class-specific validation;
- deterministic projection rules;
- trust/safety authority where explicitly defined;
- threshold authority where explicitly defined.

Authority MUST NOT be derived solely from:

- provider acceptance;
- mailbox storage;
- bridge admission;
- relay forwarding;
- super-peer availability;
- public index visibility;
- feed generator inclusion;
- search result ranking;
- app-view display;
- CDN/cache presence;
- DHT announcement;
- transport delivery;
- content-addressed availability;
- local database row existence.

## Authority roles

### Controller authority

Controller authority governs identity-level decisions.

Examples:

- device authorization;
- device revocation;
- controller rotation;
- recovery;
- high-risk capability grants;
- identity-root continuity.

Controller authority MUST be cryptographically verifiable.

### Device authority

Device authority is granted by a Controller or equivalent identity authority.

An authorized Device MAY sign records within its granted scope.

A Device MUST NOT act outside the authority granted to it.

Revoked devices MUST NOT be accepted for new authority-sensitive writes after revocation is known and valid according to the relevant consistency rules.

### Capability authority

Capability authority is scoped permission to perform an action, advertise a service, or act on behalf of a user, Space, provider, or protocol role.

Capabilities SHOULD be least-privilege, scoped, revocable, and auditable where possible.

A capability grant MUST NOT imply unrelated authority.

### Space authority

Space authority governs Space identity, membership, roles, channels, policy, and optional infrastructure descriptors.

Space authority MAY be controlled by a single controller, a delegated role/capability chain, or future threshold governance.

A Space infrastructure provider MUST NOT become Space authority merely by hosting mailbox, feed, search, relay, or cache services.

### Mailbox authority

Mailbox authority is limited to mailbox-specific delivery state.

A mailbox provider MAY accept, queue, expire, reject, rate-limit, or acknowledge delivery records according to mailbox policy.

A mailbox provider MUST NOT decide recipient durable state, identity validity, group membership, latest state, or plaintext message authority.

### Feed authority

Feed ownership and subscription state belong to users, Spaces, or other protocol authorities.

Feed generators MAY produce candidate sets, ranking, or indexes. Feed generators MUST NOT decide canonical social state merely by including or excluding records.

### Moderation authority

Moderation authority MUST be explicit.

Examples may include:

- user-local controls;
- Space moderation roles;
- labeler authority;
- provider admission policy;
- report/appeal lifecycle authority;
- legal/safety isolation authority where specified.

Provider admission policy is not global moderation authority.

### Provider authority

Availability providers have authority only over their own service operation unless an explicit protocol capability grants more.

A provider MAY protect itself by rejecting traffic, rate-limiting, quarantining, expiring records, or refusing storage.

Provider self-protection MUST NOT be represented as global deletion, global moderation, identity invalidation, or user-state revocation.

### Threshold authority

Threshold authority, including future FROST-based authority, MAY be used for high-risk actions such as controller recovery, controller rotation, Space governance, moderator council decisions, or shared infrastructure authority.

Threshold authority SHOULD NOT be required for ordinary posts, messages, mailbox envelopes, or routine local events.

## Validation doctrine

### Verify before apply

Implementations MUST perform required validation before applying records to authority-sensitive state.

Validation may include:

- signature verification;
- signer authorization;
- capability scope checks;
- revocation checks;
- key epoch checks;
- consistency class checks;
- replay/idempotency checks;
- object reference integrity checks;
- payload digest checks;
- policy checks;
- local user controls.

### Reject safely

If validation fails, an implementation MUST NOT apply the record to authority-sensitive state.

The implementation MAY retain a rejection record, audit entry, quarantine item, or local diagnostic according to privacy and safety policy.

### Local policy can be stricter

A local user, app, provider, or Space MAY apply stricter local policy than the global protocol minimum.

Stricter local policy MUST NOT be misrepresented as global protocol invalidity.

## Consistency and authority

Authority-sensitive records MUST declare or inherit an approved consistency class.

Examples:

- identity/device/capability authority generally requires monotonic or lifecycle consistency;
- reports/appeals generally require append-only lifecycle consistency;
- MLS and key-epoch state requires key-epoch consistency;
- infrastructure observations require infrastructure-scoped consistency;
- ordinary app data may allow eventual projection or narrow LWW where specified.

Generic LWW, mutable path overwrite, or CRDT-style merge MUST NOT be used for authority-sensitive records unless a specific specification explicitly permits it.

## Content addressing and authority

Content addressing proves or supports integrity. It does not prove authorization.

A content-addressed object MUST still be validated according to the object type, signature, capability, encryption, and consistency requirements.

A provider that can serve a digest is not necessarily authorized to create, modify, or interpret the object.

## Infrastructure and authority

### Bridge

A Bridge MAY help constrained peers submit, fetch, or catch up on records.

Bridge acceptance MUST NOT imply global validity.

### Relay

A Relay MAY move bytes or forward traffic.

Relay delivery MUST NOT imply authenticity or authorization.

### Super-Peer

A Super-Peer MAY provide high-availability assistance, replication hints, introductions, or cache services.

A Super-Peer MUST NOT own latest state.

### Mailbox Provider

A Mailbox Provider MAY queue encrypted delivery records and produce mailbox-scoped receipts.

Mailbox provider state MUST remain separate from durable recipient state.

### Search / Feed Provider

Search and Feed providers MAY produce indexes, rankings, and candidate sets.

Their outputs MUST be treated as candidates or projections, not canonical social state.

## Failure behavior

When authority cannot be established, implementations SHOULD fail closed for authority-sensitive state.

When availability fails but authority is intact, implementations SHOULD degrade by using alternative availability or transport paths.

Examples:

- if a mailbox is unavailable, queue locally or use another mailbox route;
- if a feed generator is unavailable, fall back to local chronological feeds;
- if a bridge is blocked, use direct P2P, local discovery, or portable sync drops;
- if a content provider disappears, use another provider or defer payload fetch;
- if a signature is invalid, reject the record regardless of delivery path.

## Security considerations

The main risk is authority confusion.

Implementations MUST guard against:

- provider equivocation being treated as truth;
- mailbox receipt being treated as recipient acceptance;
- feed inclusion being treated as endorsement;
- public index visibility being treated as permission;
- transport identity being confused with protocol identity;
- content availability being confused with authorization;
- local policy being presented as global invalidity;
- stale capabilities being accepted after revocation;
- revoked devices continuing to produce accepted authority-sensitive records.

## Interoperability considerations

Independent implementations MUST agree on authority checks for shared primitives.

Where app projections differ, they SHOULD still preserve the same underlying validation and authority semantics.

Provider APIs SHOULD expose authority boundaries clearly. Names such as `accepted`, `delivered`, `indexed`, or `generated` SHOULD be scoped to provider behavior unless the relevant specification defines stronger meaning.

## Open questions

- Which authority events require threshold signatures in the first Security Profile.
- Whether Space authority should support owned and communal governance modes in the first Social Profile.
- Which provider actions need portable audit records versus local-only logs.
