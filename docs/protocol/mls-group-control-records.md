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
- Forks are surfaced and resolved through signed recovery records.

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
- optional `previousControlId`;
- optional `membershipDigest`;
- optional `commitRef`;
- optional `diagnosticRef`.

## Validation posture

Validate structure at the protocol boundary and semantic authorization in the group projection layer.

Protocol validation should catch malformed records, unsupported versions, bad epochs, missing refs, unsupported fields, and plaintext group payloads.

Projection validation should catch non-members, revoked devices, stale epochs, wrong-recipient welcomes, replayed commits, conflicting forks, and scope-widening attempts.

## Relationship to private payload envelopes

Phase 2 private payload envelopes remain valid for account-local and non-MLS private payloads.

MLS application-message envelopes are valid only for group-scoped MLS payloads and must be explicitly recognized by group privacy validation.

## Relationship to signed annotations and labelers

Group-control records are control-plane records. They are not labeler annotations, moderation labels, or client-side annotations.

Those systems may target group objects or messages later, but they must not mutate group-control records or retroactively alter MLS state.
