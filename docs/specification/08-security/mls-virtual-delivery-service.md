# MLS Virtual Delivery Service

- Status: Draft
- Specification series: 8
- Specification version: 0.x
- Scope: decomposing the RFC 9420 Delivery Service role across untrusted delivery surfaces
- Profiles: Messaging, Availability, Security
- Related:
  - `docs/specification/08-security/mls-group-keying.md`
  - `docs/specification/08-security/mls-fork-detection-and-recovery.md`
  - `docs/specification/05-mailbox/mailbox.md`
  - `docs/specification/05-mailbox/delivery-envelopes.md`
  - `docs/specification/04-sync/portable-sync-drops.md`
  - `docs/adr/016-virtual-delivery-service-v1.md`

## Purpose

RFC 9420 assumes a Delivery Service (DS) that stores KeyPackages, fans out handshake and application messages, and (in many deployments) serializes commits per group.

This protocol has no central server and forbids infrastructure from becoming authority. This document defines the **virtual Delivery Service**: the DS role decomposed into capabilities that any delivery surface MAY advertise, with all authority-bearing decisions kept client-side.

## Scope

This document covers the KeyPackage store, Welcome routing, handshake/application message fan-out, and ordering semantics. It does not cover MLS state validation (see `mls-group-keying.md`) or fork resolution (see `mls-fork-detection-and-recovery.md`).

## Terminology

- **Virtual Delivery Service**: the aggregate of DS capabilities provided by zero or more delivery surfaces for a given group. No single surface is "the" DS.
- **KeyPackage store**: a provider capability that stores and serves pre-published KeyPackages.
- **Delivery surface**: a bridge, relay, super-peer, mailbox host, direct P2P session, or Portable Sync Drop that moves encrypted records.

## Design goals

Supports P2P survivability, optional hosted infrastructure, and graceful degradation: any delivery path can carry MLS traffic, so losing a provider degrades availability, never authority or confidentiality.

## Requirements

- A delivery surface MAY advertise the capabilities `availability.mls-key-package-store`, `availability.mls-welcome-delivery`, and `availability.mls-message-fanout`.
- A delivery surface providing DS capabilities MUST NOT:
  - receive or require plaintext group payloads;
  - decide group membership;
  - decide which commit wins an epoch conflict;
  - become the latest-state authority for any group;
  - alter, reorder-and-conceal, or selectively rewrite signed records without detection (records are signed; tampering fails validation).
- Clients MUST NOT treat DS acceptance as durable delivery, membership change, or epoch advancement. Only client-side validation and apply advances local group state.
- Clients SHOULD publish to and read from multiple delivery surfaces where available, so a withholding surface cannot silently partition a group.
- Groups MUST remain operable with zero DS capability available, using direct P2P sessions or Portable Sync Drops.

## KeyPackage store

A KeyPackage store accepts, stores, and serves signed KeyPackage publications.

### Publication

A KeyPackage publication MUST include:

- the KeyPackage bytes (or a content reference to them);
- controller id and Device id it is bound to;
- ciphersuite;
- expiry (`notAfter`);
- the Device signature over the publication.

The store MUST validate structure, signature, expiry, and byte caps before accepting. The store MUST NOT validate or decide group membership.

### Serving and consumption

- Fetch requests are scoped to a controller/Device and MUST only return unexpired KeyPackages.
- Ordinary KeyPackages SHOULD be **consume-once**: the store marks a served KeyPackage as consumed so two adders do not reuse the same init key.
- Each Device SHOULD designate one **last-resort KeyPackage** that MAY be served repeatedly when the consumable pool is empty. Clients MUST expect last-resort reuse and handle the resulting Welcome accordingly.
- The store MUST enforce per-Device publication caps and per-requester rate limits.

### Rotation and revocation

- Devices SHOULD rotate KeyPackages before expiry and replenish consumed ones opportunistically when online.
- When a Device is revoked in the identity-control log, its KeyPackages MUST be treated as invalid by clients regardless of store state, and stores SHOULD delete them when the revocation is observed.
- Store deletion is a hygiene measure, never the authority mechanism; clients MUST re-validate Device authorization when processing an Add that used a fetched KeyPackage.

## Welcome routing

Welcome messages are delivered as encrypted mailbox Delivery Envelopes addressed to the joining Device (see `05-mailbox/delivery-envelopes.md`).

- Welcome payloads MUST be encrypted end-to-end; the mailbox host sees ciphertext and routing metadata only.
- Sealed-recipient delivery SHOULD be used where the mailbox profile supports it.
- A client receiving a Welcome MUST validate it against a KeyPackage it actually published and MUST reject wrong-recipient or replayed Welcomes.
- A `mls.welcome.issued` Group-Control Record mirrors issuance; delivery state is mailbox state, not group state.

## Handshake and application message fan-out

- Delivery surfaces MAY fan out MLS handshake messages (proposals, commits) and application messages to group members' inboxes or sync feeds.
- Fan-out surfaces MAY attach a per-group, per-surface monotonic sequence number as an **ordering hint**. Ordering hints are advisory delivery metadata and MUST NOT be treated as epoch authority.
- Because no surface serializes commits, concurrent commits for the same epoch are expected and are handled by `mls-fork-detection-and-recovery.md`.
- Admission of MLS traffic through a surface follows the transport admission policy (byte caps, rate limits, replay cache, privacy-scope checks per surface).

## State machine

The KeyPackage store lifecycle per record: `published → available → (consumed | expired | deleted)`. `consumed`, `expired`, and `deleted` are terminal for ordinary KeyPackages. A last-resort KeyPackage skips `consumed` and remains `available` until `expired`, `deleted`, or superseded by rotation.

## Validation

Before serving DS operations a surface MUST validate: publication signature, expiry, byte caps, rate limits, and replay. It MUST NOT attempt to validate group membership, epoch correctness, or payload contents — those are client-side.

## Consistency model

KeyPackage store state is infrastructure observation state (Class E per `REGISTRIES.md`), service-local and non-authoritative. Group-Control Records carried by a surface retain their own Class D semantics; carriage does not change class.

## Replication and sync behavior

MLS handshake traffic and Group-Control Records are small, high-priority records in selective sync. Welcome delivery uses the mailbox. Portable Sync Drops MAY carry KeyPackages, Welcomes, handshake messages, and Group-Control Records for offline/censored environments.

## Privacy considerations

A DS-capable surface observes: who publishes KeyPackages, who fetches whose KeyPackages, group ids (or pseudonymous group routing labels), message sizes, and timing. Implementations SHOULD use pseudonymous per-surface group labels where feasible, SHOULD pad or batch where practical, and MUST keep DS logs within privacy-safe logging rules.

## Security considerations

- **Withholding/partition**: a surface can drop traffic. Mitigation: multi-surface publication, direct P2P and sync-drop fallback, fork detection surfacing missing-epoch gaps.
- **KeyPackage depletion**: an attacker fetch-drains a Device's pool. Mitigation: rate limits, per-requester caps, last-resort KeyPackage.
- **Stale/revoked KeyPackage serving**: mitigated by client-side expiry and Device-authorization re-validation.
- **Welcome replay / wrong recipient**: client-side rejection; consume-once semantics narrow the window.
- **Equivocation** (serving different views to different members): surfaced by membership digest mismatch in Group-Control Records and fork detection; signed records prevent silent content forgery.

## Interoperability considerations

The capability identifiers, KeyPackage publication shape, consume-once semantics, and Welcome-over-mailbox routing are the stable surface. Surfaces are otherwise free in storage layout.

## Low-bandwidth behavior

KeyPackage fetches and handshake messages are small and sync first. Clients in degraded mode MAY defer replenishing their KeyPackage pool but SHOULD warn when the pool is empty and only the last-resort KeyPackage remains.

## Censorship-resilience behavior

All DS capabilities are optional accelerators. Groups MUST remain operable via direct sessions and Portable Sync Drops when hosted surfaces are blocked.

## Provider behavior

Summarized above: store/forward ciphertext and signed records under caps and admission policy; never plaintext, membership, ordering, or latest-state authority.

## Registry impact

- Capability Registry: `availability.mls-key-package-store`, `availability.mls-welcome-delivery`, `availability.mls-message-fanout`.
- Error Code Registry: `key-package-exhausted`, `key-package-expired`.

## Conformance impact

Availability profile: surfaces advertising DS capabilities MUST pass KeyPackage lifecycle, cap, and no-plaintext fixtures. Messaging profile: clients MUST pass consume-once, last-resort reuse, wrong-recipient Welcome, and zero-DS operation fixtures.

## Open questions

- Whether last-resort KeyPackage reuse is acceptable for the Security profile or gated behind explicit group policy.
- Pseudonymous group routing label scheme.
- Whether ordering hints are worth standardizing beyond an opaque per-surface sequence.
