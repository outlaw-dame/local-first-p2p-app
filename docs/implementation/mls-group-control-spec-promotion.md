# MLS Group Control → Protocol Specification Promotion

- Status: Draft
- Date: 2026-06-30
- Scope: map existing MLS group-control planning and projection work into the newer mailbox, social, sync, and future security specification model
- Related implementation:
  - `packages/mls-group-projection`
  - `docs/implementation/phase-3-mls-implementation-plan.md`
  - `docs/implementation/phase-4-mls-group-control-implementation-plan.md`
  - `docs/adr/012-mls-dependency-and-group-keying-v1.md`
  - `docs/protocol/mls-group-keying.md`
  - `docs/implementation/specification-reconciliation.md`
- Related specifications:
  - `docs/specification/05-mailbox/`
  - `docs/specification/06-social/spaces.md`
  - `docs/specification/06-social/channels.md`
  - `docs/specification/06-social/threads.md`
  - `docs/specification/04-sync/selective-replica-sync.md`
  - future `docs/specification/08-security/`

## Purpose

The MLS group-control slice predates the new `docs/specification/` tree.

This document promotes that work into the newer model so group privacy, group membership, key epoch state, mailbox delivery, and Space/Channel semantics remain connected rather than becoming separate app-specific systems.

## Current implemented / planned slice

The existing MLS work established:

- MLS dependency and group-keying ADR direction;
- signed group-control event planning;
- deterministic group projection expectations;
- group creation and membership lifecycle planning;
- epoch advancement and stale epoch rejection planning;
- fork detection and recovery planning;
- mailbox/bridge/super-peer delivery boundaries for welcome and group material;
- clear doctrine that delivery providers do not become group membership authority.

## Specification mapping

| Existing area | Specification owner | Promotion rule |
|---|---|---|
| Group creation | future `08-security/mls-groups.md`, `06-social/spaces.md` | Group creation is security state and social context state. |
| Member proposal/add/remove | future `08-security/mls-groups.md`, `06-social/roles.md` | Membership changes must align with Space/Channel policy and signed authority. |
| Commit published | future `08-security/mls-groups.md` | Commit state advances group epoch; providers do not decide membership. |
| Epoch advanced | future `08-security/key-epochs.md` | Epoch state must be explicit and replay-safe. |
| Welcome routing | `05-mailbox/delivery-envelopes.md` | Welcome material may be delivered by mailbox/provider routes without plaintext access. |
| Group application messages | `05-mailbox/mailbox.md`, `06-social/channels.md` | Message delivery and social Channel context must remain distinct. |
| Sync replay | `04-sync/selective-replica-sync.md` | Group-control records must validate before projection and before payload apply. |
| Fork detection/recovery | future `08-security/mls-groups.md` | Fork handling is security state, not provider policy. |

## Required boundaries

- MLS group-control records are protocol records, not provider-local state.
- Group delivery success is not group-state acceptance.
- Providers must not see private group plaintext.
- Bridge, relay, mailbox, or super-peer delivery does not create group membership authority.
- Group epoch state must be validated before applying private group messages.
- Space/Channel policy and group cryptographic state must not drift silently.
- Recovery and fork handling must be explicit protocol state, not UI-only behavior.

## Promotion stages

### Stage MLS-P1 — Documentation promotion

Status: this document.

Exit criteria:

- Existing MLS planning is mapped into mailbox, social, sync, and future security specs.
- Provider-delivery versus group-authority boundaries are explicit.
- Future group privacy work cites this promotion document or resulting Series 8 specs.

### Stage MLS-P2 — Series 8 MLS group specs

Create:

- `docs/specification/08-security/mls-groups.md`;
- `docs/specification/08-security/key-epochs.md`;
- `docs/specification/08-security/group-fork-recovery.md`.

### Stage MLS-P3 — Mailbox delivery mapping

Define how group-control and welcome material use mailbox delivery:

- Delivery Envelope wrapper;
- sender/author distinction;
- recipient Device or group recipient scope;
- provider-accepted versus recipient-applied state;
- expiry and retry behavior;
- undecryptable placeholder behavior.

### Stage MLS-P4 — Space/Channel integration

Define how private Spaces and Channels bind to MLS group state:

- Space membership versus MLS membership;
- Channel writer policy versus MLS recipient set;
- role/capability changes that require group epoch changes;
- private Channel feed heads;
- invite/accept/reject lifecycle.

### Stage MLS-P5 — Runtime conformance audit

Audit current and future group code for:

- deterministic projection;
- idempotent replay;
- stale epoch rejection;
- fork detection;
- local policy apply order;
- mailbox/provider opacity;
- sync replay behavior;
- recovery event handling.

## Deferred work

Known deferrals preserved by this promotion:

- full MLS runtime integration;
- Series 8 security specs;
- mailbox delivery wrappers for group-control records;
- Space/Channel policy binding;
- multi-device welcome routing;
- fork recovery UX;
- conformance tests for stale epochs, duplicate commits, and provider opacity.

## Immediate engineering gates

Before expanding private groups, group chat, Space private Channels, or MLS runtime integration, future PRs should ensure:

1. group-control records have a spec-tree home;
2. provider delivery is not represented as membership acceptance;
3. private group plaintext remains unavailable to providers;
4. epoch state is checked before applying group payloads;
5. Space/Channel membership does not silently diverge from group cryptographic state;
6. fork and recovery states are explicit and testable.

## Current status

The MLS group-control slice remains foundational for private groups and private Channels.

It should be promoted into Series 8 security and tied back to mailbox, sync, Spaces, and Channels rather than left as a standalone implementation plan.
