# Specification Reconciliation Inventory

- Status: Draft
- Date: 2026-07-02
- Scope: map older implementation/protocol planning docs and shipped slices into the `docs/specification/` tree

## Purpose

The repository has an implementation-independent specification tree under `docs/specification/`.

Several older docs and shipped slices predate that tree. Those older docs are still useful, but they must not remain as competing sources of protocol authority.

This inventory identifies which older slices are already represented by the newer specifications, which have promotion documents, and which remain implementation plans.

## Rule

When an older `docs/protocol/*` or `docs/implementation/*` document conflicts with `docs/specification/*`, the newer specification tree should be treated as the target protocol model.

Older docs should be read as:

- implementation history;
- exit-report evidence;
- detailed runtime notes;
- threat-model and test rationale;
- source material for future spec promotions.

They should not silently define protocol semantics outside the specification tree.

## Current reconciliation status

| Area | Current status | Primary current docs |
|---|---|---|
| Identity Root / controller / Device authority | Represented in Series 2 and implemented in the identity-control core. Older identity-control docs remain implementation evidence and detailed lifecycle rationale. | `docs/specification/02-identity/identity-root.md`, `docs/specification/02-identity/device-model.md`, `docs/protocol/identity-control-log.md`, `docs/adr/001-identity-control-log-v1.md`, `docs/implementation/phase-2.1-exit-report.md` |
| User Data Root | Represented in Series 2; Phase 5.11 now provides the implementation plan for local-store state, `udr.*` events, UDR projection, local-store append/load wiring, and PWA view-model wiring. | `docs/specification/02-identity/user-data-root.md`, `docs/specification/02-identity/replica-model.md`, `docs/implementation/phase-5.11-user-data-root-plan.md` |
| Chat slice | Promoted. Runtime implementation remains staged behind persistence, mailbox, sync, Space/Channel, and PWA UI gates. | `docs/implementation/phase-5-chat-spec-promotion.md` |
| Content addressing / Object References | Promoted. Runtime storage/fetch adapters and remaining hash/runtime work are deferred implementation work. | `docs/implementation/content-addressing-spec-promotion.md`, `docs/specification/03-data/` |
| Trust & Safety stack | Promoted. Series 6/7/9 specs and the promotion doc now anchor older T&S docs and package behavior. Runtime/UI gaps remain implementation work. | `docs/implementation/trust-safety-spec-promotion.md`, `docs/specification/06-social/`, `docs/specification/07-availability/`, `docs/specification/09-profiles/` |
| Availability surfaces | Promoted. Bridge/relay/super-peer/provider descriptors are availability infrastructure, not protocol authority. | `docs/implementation/availability-surfaces-spec-promotion.md`, `docs/specification/07-availability/` |
| Existing sync-client / checkpointed bridge sync | Promoted. The existing sync-client is one adapter slice toward Selective Replica Sync, not the complete sync engine. | `docs/implementation/sync-client-spec-promotion.md`, `docs/specification/04-sync/` |
| MLS group control | Promoted into Series 8 security specs. | `docs/implementation/mls-group-control-spec-promotion.md`, `docs/specification/08-security/` |
| Mailbox runtime | Runtime implementation plan exists. Implementation has started with the mailbox runtime foundation package. | `docs/implementation/mailbox-runtime-implementation-plan.md`, `packages/mailbox-runtime/` |
| Feed runtime | Runtime implementation plan exists. | `docs/implementation/feed-runtime-implementation-plan.md` |
| Spaces / Channels runtime | Runtime implementation plan exists. | `docs/implementation/space-channel-runtime-implementation-plan.md` |

## Identity and UDR clarification

The current identity model is not "identity equals one raw key pair."

The current model is:

```txt
Identity Root = stable protocol identity anchor
Controller key material = active authority over that Identity Root
Device key material = delegated authority within scope
User Data Root = durable portable state for that Identity Root
Replica = copy or partial copy of state
Provider / mailbox / transport account = availability or UX surface, not identity authority
```

A simple v1 implementation may bootstrap an Identity Root from one controller key pair, but future controller rotation, recovery, or threshold authority must preserve Identity Root continuity without treating every key replacement as a new account.

## Remaining implementation deltas

The following are not new doctrine gaps; they are implementation stages already mapped to current specs/plans:

1. Phase 2.2 identity projection persistence and PWA emit/append wiring.
2. Phase 5.11 Step 1 `StoredUserDataRoot` local-store schema keyed by Identity Root identifier.
3. Phase 5.11 Step 2 `udr.*` event kinds in `packages/protocol`.
4. Phase 5.11 Step 3 `@lfp2p/udr-projection`.
5. Phase 5.11 Step 4 local-store `appendUdrEvent` / `loadUdrState`.
6. Mailbox runtime local-store schema and bridge/provider adapter.
7. Feed runtime package and provider-assisted generator adapter.
8. Space/Channel runtime package and MLS/private group binding.
9. Full sync adapter expansion beyond checkpointed bridge sync.
10. Identity recovery, multi-controller accounts, and capability delegation chains.

## Completed promotion history

The following older promotion targets have been addressed and should no longer be treated as missing doctrine work:

- content addressing / Object References promotion;
- Trust & Safety promotion;
- availability surfaces promotion;
- sync-client promotion;
- MLS group-control promotion;
- mailbox runtime implementation plan;
- feed runtime implementation plan;
- Space/Channel runtime implementation plan.

If an older roadmap still says one of these files must be created, that statement is stale and should be interpreted through this inventory and the files listed above.

## Development gating rule

Do not expand a user-facing runtime surface if its underlying shipped slice still has no mapping into the specification tree.

Examples:

- do not expand chat UI before the chat promotion and mailbox/sync boundaries are accepted;
- do not expand feed UI before feeds consume Collections, Object References, curation policy, and Sync Interests;
- do not expand super-peer behavior before Series 7 availability specs land;
- do not expand moderation tooling before Trust & Safety has a spec-tree home;
- do not treat a UDR replica, mailbox route, provider account, or local database row as the user identity.

## Maintenance rule

When a promotion document or runtime plan lands, update this inventory in the same PR or a follow-up cleanup PR. This file should not continue to list completed promotions as missing work.
