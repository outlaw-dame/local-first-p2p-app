# MLS Group Keying

- Status: Draft
- Specification series: 8
- Specification version: 0.x
- Scope: MLS as the required group key-management model for encrypted group payloads
- Profiles: Messaging, Social, Security
- Related:
  - `docs/specification/01-core/authority-model.md`
  - `docs/specification/02-identity/identity-root.md`
  - `docs/specification/02-identity/device-model.md`
  - `docs/specification/08-security/mls-virtual-delivery-service.md`
  - `docs/specification/08-security/mls-fork-detection-and-recovery.md`
  - `docs/adr/012-mls-dependency-and-group-keying-v1.md`
  - `docs/adr/015-mls-library-selection-v1.md`

## Purpose

This document defines how MLS (RFC 9420) provides group confidentiality, forward secrecy, and post-compromise security for group-scoped payloads without becoming a transport, identity system, moderation system, storage system, or object authority.

## Scope

This document covers the MLS integration model: authority layering, identity binding, credential requirements, epoch semantics, group-control records, and payload validation. Delivery of MLS messages is covered by `mls-virtual-delivery-service.md`. Fork behavior is covered by `mls-fork-detection-and-recovery.md`.

## Terminology

- **MLS Group**: an MLS-managed cryptographic membership and key schedule for a set of authorized Devices. See `GLOSSARY.md`.
- **Epoch**: one step in a group's linear key schedule. See `GLOSSARY.md`.
- **KeyPackage**: a pre-published, signed MLS join object bound to a Device. See `GLOSSARY.md`.
- **Group-Control Record**: a signed protocol event mirroring an MLS state change. See `GLOSSARY.md`.

## Requirements

- Implementations MUST use MLS-managed group state to protect group-scoped payloads once a group is MLS-active.
- Implementations MUST NOT implement an in-house MLS cryptographic stack.
- Implementations MUST access MLS functionality through a provider boundary (`MlsProvider`-style interface) so the MLS runtime is an implementation detail, not a protocol object.
- MLS library internals MUST NOT be exposed as canonical protocol objects.
- MLS group state MUST NOT replace controller identity, Device authorization, Capabilities, trust policy, moderation policy, object references, or signed protocol events.
- An MLS-active group MUST NOT accept older group payload formats (including Phase 2 private payload envelopes) as an alternate path.

## Authority layering

```txt
controller identity
→ device identity
→ capability and membership policy
→ signed group-control records
→ MLS provider state
→ encrypted group payload delivery
```

Transport success is not replication success, and delivery success is not cryptographic authorization.

## Identity and device binding

An MLS client maps to a protocol-authorized Device identity, not only to a user account.

KeyPackages and MLS credentials MUST bind to:

- controller identity;
- Device identity;
- current Device authorization state;
- signing key reference;
- supported ciphersuite/capability set;
- expiration and revocation state.

A removed, revoked, or rotated Device MUST NOT be able to publish valid group commits or application messages for future epochs.

Implementations MUST fail closed on unknown, expired, revoked, or mismatched Device credentials.

## Ciphersuite

The v1 profile pins `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519` so MLS credential signatures align with the protocol's Ed25519 identity model (see ADR-015).

Implementations MAY support additional ciphersuites behind explicit capability negotiation, but MUST NOT silently downgrade below the pinned suite.

## Group-control records

Every MLS state change MUST be mirrored by a signed Group-Control Record. The registered event kinds are:

- `mls.group.created`
- `mls.member.proposed`
- `mls.member.added`
- `mls.member.removed`
- `mls.device.updated`
- `mls.commit.published`
- `mls.welcome.issued`
- `mls.epoch.advanced`
- `mls.fork.detected`
- `mls.fork.recovery.published`
- `mls.stale-epoch.rejected`

Common required fields: `version`, `controlId`, `groupId`, `epoch`, `createdAt`, `issuerDeviceId`, `previousControlId` (all records except group creation), `membershipDigest` (epoch-advancing records), optional `commitRef`, optional `diagnosticRef`.

Group-Control Records are control-plane records. Labelers, moderation labels, and client-side annotations MUST NOT mutate them or retroactively alter MLS state.

## State machine

Each group has a linear epoch sequence starting at epoch 0. Epoch values MUST be safe non-negative integers; negative, non-integer, or unsafe values fail closed.

Projections MUST track, per group: group id, epoch number, epoch authenticator or equivalent checkpoint, commit object reference, membership set digest, local Device membership state, last applied control record, and stale/forked state diagnostics.

Concurrent commits and fork behavior are specified in `mls-fork-detection-and-recovery.md`.

## Validation

Structural validation happens at the protocol boundary; semantic authorization happens in the group projection layer.

Protocol validation MUST reject: malformed records, unsupported versions, bad epochs, missing refs, unsupported fields, sender-Device mismatch, and plaintext group payloads.

Projection validation MUST reject or quarantine: non-members, revoked Devices, stale epochs, wrong-recipient welcomes, replayed commits, conflicting forks, format fallback attempts, and scope-widening attempts.

## Consistency model

MLS Group-Control Records are key-epoch transitions (Consistency Class D per `REGISTRIES.md`). CRDT-style merge, LWW, or mutable overwrite semantics MUST NOT be applied to group key state.

Replay of already-applied control records MUST be idempotent.

## Payload validation

Group privacy validation MUST recognize MLS application-message envelopes for group-scoped payloads. An MLS payload envelope MUST bind to group id, epoch, sender Device, and target object/event metadata closely enough to reject wrong-group, wrong-epoch, malformed, replayed, or scope-widening payloads.

Phase 2 private payload envelopes remain valid for account-local and non-MLS private payloads. Once a group is MLS-active, projection policy MUST reject Phase 2 envelopes for that group.

## Privacy considerations

MLS protects message contents; it does not automatically hide metadata. Implementations SHOULD treat group id, epoch, membership changes, message frequency, delivery path, and attachment availability as potentially sensitive metadata and SHOULD minimize what providers can observe.

## Security considerations

Implementations MUST account for: compromised delivery services; malicious or stale member Devices; revoked-Device replay; stale epoch delivery; welcome replay or wrong-recipient delivery; group fork attempts; malicious insiders fragmenting group state; and runtime mismatch across browser/native/full-peer providers.

Offline catch-up MUST reject or quarantine commits from non-members, commits from revoked Devices, stale epochs, malformed welcomes, messages for unknown groups, wrong-recipient material, and scope-widening attempts.

## Interoperability considerations

Independent implementations interoperate through RFC 9420 wire formats, the pinned ciphersuite, the Group-Control Record kinds above, and the KeyPackage binding rules. The MLS runtime library is never an interoperability surface.

## Low-bandwidth behavior

Key epochs, membership checkpoints, and Group-Control Records are high-priority small records and SHOULD sync before payload bytes (see `04-sync/low-bandwidth-profile.md`). Deferred payloads MUST NOT defer epoch validation for records that are applied.

## Provider behavior

Providers may carry MLS handshake messages, application messages, and Group-Control Records. They MUST NOT receive plaintext group payloads, become membership authorities, or become latest-state authorities. See `mls-virtual-delivery-service.md`.

## Registry impact

- Event Type Registry: the eleven `mls.*` Group-Control Record kinds listed above.
- Capability Registry: `security.mls`.
- Cryptographic Algorithm Registry: `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`.

## Conformance impact

Messaging and Security profiles require this document for encrypted group support. Fixture expectations: valid/invalid Group-Control Records, stale-epoch rejection, revoked-Device rejection, replay equivalence.

## Open questions

- Final MLS credential encoding profile per runtime (browser, native, full-peer).
- Whether epoch authenticators are REQUIRED or RECOMMENDED in checkpoint records for the Core profile.
- External-join (GroupInfo-based) support policy for v1.
