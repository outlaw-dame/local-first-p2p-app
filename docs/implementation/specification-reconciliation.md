# Specification Reconciliation Inventory

- Status: Draft
- Date: 2026-06-30
- Scope: map older implementation/protocol planning docs and shipped slices into the new `docs/specification/` tree

## Purpose

The repository now has an implementation-independent specification tree under `docs/specification/`.

Several older docs and shipped slices predate that tree. Those older docs are still useful, but they must not remain as competing sources of protocol authority.

This inventory identifies which older slices are already represented by the new specifications, which need promotion documents, and which should become implementation plans rather than new protocol doctrine.

## Rule

When an older `docs/protocol/*` or `docs/implementation/*` document conflicts with `docs/specification/*`, the newer specification tree should be treated as the target protocol model.

Older docs should be read as:

- implementation history;
- exit-report evidence;
- detailed runtime notes;
- threat-model and test rationale;
- source material for future spec promotions.

They should not silently define protocol semantics outside the specification tree.

## Already promoted / in progress

### Phase 5 chat slice

Promotion PR: `docs/implementation/phase-5-chat-spec-promotion.md`.

Status: ready as the first promotion pattern.

Purpose:

- preserves existing `chat.*` event kinds;
- maps them to mailbox, social, sync, data, and identity specs;
- prevents chat from becoming an app-only surface;
- records next gates: persistence, mailbox boundaries, selective sync, Space/Channel context, PWA UI.

## Promotion candidates

### 1. Content addressing / Object References

Older sources:

- `docs/implementation/phase-1.56-content-addressing-plan.md`
- `docs/protocol/content-addressing.md`
- `docs/threat-model/content-addressing-abuse.md`
- `packages/content-addressing`

New specification homes:

- `docs/specification/03-data/object-references.md`
- `docs/specification/03-data/content-refs.md`
- `docs/specification/03-data/merkle-checkpoints.md`
- `docs/specification/03-data/entity-component-snapshots.md`
- `docs/specification/04-sync/portable-sync-drops.md`

Needed action:

Create `docs/implementation/content-addressing-spec-promotion.md`.

That document should map `DigestRef`, `ContentLink`, `BlockRef`, `ObjectRef`, `BundleRef`, and `StorageLocationHint` into the Series 3 data specs and Series 4 Portable Sync Drop model.

It should also clarify deferred work:

- BLAKE3 runtime;
- additional multibase parsers;
- media manifest integration;
- storage adapters;
- provider availability hints;
- Content Bundle / Portable Sync Drop packaging.

### 2. Trust & Safety stack

Older sources:

- `docs/implementation/trust-safety-complete-summary.md`
- `docs/protocol/trust-safety-event-policy.md`
- `docs/protocol/local-controls-portability.md`
- `docs/protocol/bridge-admission-doctrine.md`
- `docs/protocol/curation-doctrine.md`
- `docs/protocol/labeler-runtime-doctrine.md`
- `docs/protocol/moderation-runtime-doctrine.md`
- `docs/protocol/content-categories-doctrine.md`
- `docs/protocol/block-evasion-resilience.md`
- `docs/protocol/reputation-graph-doctrine.md`
- `packages/trust-safety`

New specification homes:

- `docs/specification/06-social/`
- `docs/specification/07-availability/`
- `docs/specification/08-security/`
- `docs/specification/09-profiles/`

Needed action:

Create a Trust & Safety specification promotion suite, likely split into:

- `docs/specification/06-social/local-controls.md`
- `docs/specification/06-social/moderation-labels.md`
- `docs/specification/06-social/reports-and-appeals.md`
- `docs/specification/06-social/curation-and-reach.md`
- `docs/specification/07-availability/transport-admission.md`
- `docs/specification/09-profiles/trust-safety-profile.md`

This is a high-priority promotion because the code is substantial and currently relies on older doctrine docs for conceptual anchoring.

### 3. Bridge / Relay / Super-peer availability surfaces

Older sources:

- `docs/implementation/phase-4.6-relay-superpeer-policy-plan.md`
- `docs/implementation/phase-4.5-production-bridge-hardening-plan.md`
- `docs/protocol/bridge-admission-doctrine.md`
- `apps/bridge-service`

New specification homes:

- `docs/specification/07-availability/`
- `docs/specification/05-mailbox/`
- `docs/specification/04-sync/`

Needed action:

Create Series 7 availability specs:

- `docs/specification/07-availability/bridges.md`
- `docs/specification/07-availability/relays.md`
- `docs/specification/07-availability/super-peers.md`
- `docs/specification/07-availability/provider-descriptors.md`
- `docs/specification/07-availability/admission-policy.md`
- `docs/specification/07-availability/advisory-reputation.md`

Non-negotiable mapping:

- bridge/relay/super-peer are availability infrastructure;
- provider acceptance is not durable user acceptance;
- providers do not become Identity Root, User Data Root, Space, mailbox, or feed authority;
- operator policy is service-local unless a capability grants a narrow authority role.

### 4. Existing sync-client / checkpointed bridge sync

Older sources:

- `docs/adr/003-sync-offsets-and-cursors-v1.md`
- `docs/implementation/next-development-path.md`
- `packages/sync-client`
- `packages/local-store` `syncCheckpoints`

New specification homes:

- `docs/specification/04-sync/selective-replica-sync.md`
- `docs/specification/04-sync/sync-interests.md`
- `docs/specification/04-sync/checkpoints.md`
- `docs/specification/04-sync/low-bandwidth-profile.md`
- `docs/specification/04-sync/portable-sync-drops.md`

Needed action:

Create `docs/implementation/sync-client-spec-promotion.md`.

That document should map the current checkpointed bridge sync into Selective Replica Sync and identify the delta to:

- Sync Interests;
- partition-scoped checkpoints;
- headers-first sync;
- lazy payload fetch;
- mailbox adapter;
- direct P2P/WebRTC adapter;
- Hypercore/Corestore adapter;
- Portable Sync Drop adapter;
- local-nearby/Bluetooth adapter;
- super-peer availability adapter.

### 5. MLS group control

Older sources:

- `docs/implementation/phase-3-mls-implementation-plan.md`
- `docs/implementation/phase-4-mls-group-control-implementation-plan.md`
- `docs/adr/012-mls-dependency-and-group-keying-v1.md`
- `docs/protocol/mls-group-keying.md`
- `packages/mls-group-projection`

New specification homes:

- `docs/specification/05-mailbox/`
- `docs/specification/06-social/spaces.md`
- `docs/specification/06-social/channels.md`
- future `docs/specification/08-security/`

Needed action:

Create `docs/implementation/mls-group-control-spec-promotion.md`, then Series 8 security specs.

The promotion should preserve:

- MLS control events as signed protocol records;
- group privacy envelope validation;
- fork detection/recovery;
- multi-device welcome routing;
- mailbox/bridge/super-peer delivery without plaintext access;
- providers not becoming membership authority.

### 6. Reputation graph

Older sources:

- `docs/protocol/reputation-graph-doctrine.md`
- `docs/implementation/phase-1.8.1-exit-report.md` through `phase-1.8.14-exit-report.md`
- `packages/trust-safety/src/reputation-graph/`
- `packages/sync-client` reputation ingestion work

New specification homes:

- `docs/specification/06-social/curation-and-reach.md`
- `docs/specification/07-availability/advisory-reputation.md`
- `docs/specification/09-profiles/trust-safety-profile.md`

Needed action:

Fold reputation into the Trust & Safety promotion suite, but keep one dedicated section because reputation touches both social ranking and availability/admission.

### 7. Feeds / Collections runtime

Older sources:

- `docs/implementation/phase-5-foundation-roadmap.md`
- `docs/protocol/curation-doctrine.md`
- `packages/trust-safety` curation runtime

New specification homes:

- `docs/specification/06-social/feeds.md`
- `docs/specification/06-social/collections.md`
- `docs/specification/07-availability/`

Needed action:

Do not create another doctrine doc first. Create a runtime implementation plan only after Content Addressing, Sync, and T&S promotion are anchored.

Suggested future file:

- `docs/implementation/feed-runtime-implementation-plan.md`

### 8. Mailbox runtime

Older sources:

- `docs/implementation/phase-5-foundation-roadmap.md`
- Phase 5 chat implementation plan
- bridge/outbox foundation

New specification homes:

- `docs/specification/05-mailbox/mailbox.md`
- `docs/specification/05-mailbox/delivery-envelopes.md`
- `docs/specification/05-mailbox/receipts-and-acks.md`
- `docs/specification/05-mailbox/forwarding.md`
- `docs/specification/05-mailbox/retention-and-expiry.md`

Needed action:

Create `docs/implementation/mailbox-runtime-implementation-plan.md` after chat promotion lands.

This should be implementation planning, not another protocol doctrine doc.

### 9. Spaces / Channels runtime

Older sources:

- `docs/implementation/phase-5-foundation-roadmap.md`
- Phase 5 chat implementation plan
- MLS group-control docs

New specification homes:

- `docs/specification/06-social/spaces.md`
- `docs/specification/06-social/channels.md`
- `docs/specification/06-social/threads.md`
- `docs/specification/06-social/roles.md`
- `docs/specification/06-social/presence.md`

Needed action:

Create `docs/implementation/space-channel-runtime-implementation-plan.md` after mailbox and sync boundaries are implemented.

## Roadmap docs that need pointer updates

The following older docs should be updated with pointers to this inventory and/or the new specification files:

- `docs/implementation/phase-5-foundation-roadmap.md`
- `docs/implementation/next-development-path.md`
- `docs/implementation/phase-1.56-content-addressing-plan.md`
- `docs/implementation/trust-safety-complete-summary.md`
- `docs/implementation/phase-4.6-relay-superpeer-policy-plan.md`
- `docs/implementation/phase-4-mls-group-control-implementation-plan.md`

## Recommended order

1. Merge the chat promotion PR.
2. Content Addressing / ObjectRef promotion.
3. Trust & Safety specification promotion suite.
4. Availability surfaces / super-peer specs.
5. Existing sync-client promotion.
6. MLS group-control promotion.
7. Mailbox runtime implementation plan.
8. Feed runtime implementation plan.
9. Space/Channel runtime implementation plan.

## Development gating rule

Do not expand a user-facing runtime surface if its underlying shipped slice still has no mapping into the specification tree.

For example:

- do not expand chat UI before the chat promotion and mailbox/sync boundaries are accepted;
- do not expand feed UI before feeds consume Collections, Object References, curation policy, and Sync Interests;
- do not expand super-peer behavior before Series 7 availability specs land;
- do not expand moderation tooling before Trust & Safety has a spec-tree home.
