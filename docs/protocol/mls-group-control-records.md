# MLS Group-Control Records

- Status: Draft
- Date: 2026-06-27
- Roadmap phase: Phase 4
- Related implementation plan: `docs/implementation/phase-4-mls-group-control-implementation-plan.md`

## Purpose

MLS group-control records are signed protocol events that make group cryptographic state auditable, replayable, and local-first.

They are not raw MLS library internals. They are protocol records that bind MLS material to controller identity, device authorization, group membership policy, and deterministic projection behavior.

## Core invariants

- Every group-control record is signed.
- Delivery services may carry records but do not authorize membership.
- Group payload plaintext is never exposed to bridge, mailbox, relay, or super-peer infrastructure.
- Control records must be replay/idempotency safe.
- Stale epochs fail closed.
- Forks are surfaced and resolved through signed recovery records or deterministic fallback policy where explicitly allowed.
- MLS-active groups must not accept older group payload formats as an alternate path.

## Record families

Initial families:

- group lifecycle;
- membership proposal;
- membership add/remove;
- device key update;
- commit publication;
- welcome delivery;
- epoch advancement;
- fork detection;
- fork recovery;
- stale epoch rejection.

## Common fields

All records should include:

- `version`;
- `controlId`;
- `groupId`;
- `epoch`;
- `createdAt`;
- `issuerDeviceId`;
- `previousControlId` required for all records except group creation;
- `membershipDigest` required on epoch-advancing records;
- optional `commitRef`;
- optional `diagnosticRef`.

## Epoch numbering

Epoch values must be safe non-negative integers.

Epoch 0 is valid for initial group creation and early MLS state. Negative, non-integer, or unsafe values must fail closed.

## Validation posture

Validate structure at the protocol boundary and semantic authorization in the group projection layer.

Protocol validation should catch malformed records, unsupported versions, bad epochs, missing refs, unsupported fields, sender-device mismatch, and plaintext group payloads.

Projection validation should catch non-members, revoked devices, stale epochs, wrong-recipient welcomes, replayed commits, conflicting forks, format fallback attempts, and scope-widening attempts.

## Relationship to private payload envelopes

Phase 2 private payload envelopes remain valid for account-local and non-MLS private payloads.

MLS application-message envelopes are valid only for group-scoped MLS payloads and must be explicitly recognized by group privacy validation.

Once a group is MLS-active, Phase 2 private payload envelopes for that group must be rejected by projection policy.

## Relationship to signed annotations and labelers

Group-control records are control-plane records. They are not labeler annotations, moderation labels, or client-side annotations.

Those systems may target group objects or messages later, but they must not mutate group-control records or retroactively alter MLS state.
