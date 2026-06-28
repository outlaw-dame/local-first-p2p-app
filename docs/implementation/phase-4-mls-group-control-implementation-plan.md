# Phase 4 MLS Group-Control Implementation Plan

- Status: Draft
- Date: 2026-06-27
- Roadmap phase: Phase 4 — MLS group control records
- Depends on:
  - `docs/adr/012-mls-dependency-and-group-keying-v1.md`
  - `docs/protocol/mls-group-keying.md`

## Purpose

Phase 4 turns the Phase 3 MLS doctrine into protocol-level signed control records and projection behavior.

This phase should still avoid adding a full MLS runtime dependency until the protocol record shapes, validators, and deterministic projection tests exist.

## First implementation slice

The first code PR should update `@lfp2p/protocol` with:

- first-class MLS group-control event kinds;
- an MLS application-message envelope shape;
- validation support for `group` privacy payloads that are MLS envelopes;
- strict rejection of plaintext group payloads;
- tests proving Phase 2 private envelopes still work only where appropriate and cannot downgrade MLS-active groups.

## Event kinds

Initial group-control event kinds:

```txt
mls.group.created
mls.member.proposed
mls.member.added
mls.member.removed
mls.device.updated
mls.commit.published
mls.welcome.issued
mls.epoch.advanced
mls.fork.detected
mls.fork.recovery.published
mls.stale-epoch.rejected
```

These are signed protocol events. They are not raw library internals.

## MLS application-message envelope

Define a protocol-safe envelope for group application messages.

Required fields:

- `version`: `lfp2p.mls-application-message.envelope.v1`;
- `groupId`;
- `epoch`;
- `senderDeviceId`;
- `ciphertext`;
- `messageRef` or equivalent stable message id;
- optional `aadRef` / `contentRefs` where needed.

Validation requirements:

- exact version match;
- safe non-negative epoch;
- non-empty group id;
- non-empty sender device id that matches the outer signed event envelope `deviceId`;
- base64url ciphertext;
- no unsupported fields;
- no plaintext body/content fields;
- payload privacy must be `group`.

## Group privacy validation update

Current protocol validation requires non-public group payloads to be Phase 2 private payload envelopes.

Phase 4 must update this rule:

```txt
dm privacy     → Phase 2 private payload envelope only
self privacy   → identity events or Phase 2 private payload envelope
group privacy  → Phase 2 private payload envelope OR MLS application-message envelope; MLS-only once the target group is MLS-active
public/local   → neither private nor MLS encrypted envelopes
```

This keeps plaintext group payloads invalid while allowing MLS-protected group payloads. It also prevents cryptographic downgrade: once a group is initialized with or upgraded to MLS, projection policy must reject Phase 2 private envelopes for that group.

## Group-control payload validation

Each control kind should share a common base:

- `version`: `lfp2p.mls-group-control.v1`;
- `groupId`;
- `epoch`;
- `controlId`;
- `createdAt`;
- `issuerDeviceId`;
- `previousControlId` required for all records except group creation;
- optional `commitRef`;
- optional `membershipDigest` required on epoch-advancing records.

Kind-specific fields:

- group created: creator device, initial member refs, group metadata ref;
- member/device proposed: proposed identity/device, proposal ref;
- member/device added: added identity/device, welcome ref;
- member/device removed: removed identity/device, removal reason code;
- device updated: device id, key package ref;
- commit published: commit ref, parent epoch/checkpoint, membership digest;
- welcome issued: recipient identity/device, welcome ref;
- epoch advanced: prior epoch, next epoch, checkpoint, membership digest;
- fork detected: conflicting commit refs, observed epoch;
- fork recovery: selected commit/ref, rejected candidates, policy authority;
- stale epoch rejected: rejected epoch/message/control ref.

## Projection behavior

The group projection must be deterministic and local-first.

Projection state should include:

- group id;
- current epoch;
- accepted checkpoint;
- membership digest;
- local device membership status;
- accepted control ids;
- rejected/stale control ids;
- fork candidates;
- fork recovery records;
- diagnostics.

## Fork handling

MLS epochs are linear, but local-first/P2P delivery may surface concurrent commits.

Required behavior:

1. Detect conflicting commits for the same group/epoch transition.
2. Queue conflicting candidates.
3. Keep the last accepted epoch stable.
4. Reject candidates involving revoked devices or scope widening.
5. Prefer a signed recovery/control record from an authorized policy authority before choosing a branch.
6. If the authority is unreachable and local policy allows automated recovery, use a deterministic fallback rule such as lowest canonical commit hash after validating issuer authority, membership digest, epoch parent, and no scope widening.
7. Preserve audit data for rejected candidates.

The fallback rule must be deterministic, auditable, fail-closed for unsafe candidates, and unable to select a commit from a revoked or unauthorized device.

## Multi-device welcome routing

When adding a new device for an existing controller, the protocol must define:

- which existing device or policy authority is allowed to commit the add;
- how the welcome material is addressed to the new device;
- how wrong-recipient welcomes are rejected;
- how mailbox/bridge/super-peer delivery may carry the welcome without plaintext access;
- how replayed welcomes are rejected.

## Required tests

Protocol tests:

- accepts valid MLS group-control payloads;
- rejects wrong group-control versions;
- accepts epoch 0 and rejects negative or unsafe epochs;
- rejects malformed group ids and device ids;
- rejects MLS application-message envelopes whose `senderDeviceId` differs from the outer event `deviceId`;
- accepts MLS application-message envelope for `group` privacy;
- accepts Phase 2 private envelope for `group` privacy only for non-MLS-active groups;
- rejects Phase 2 private envelope downgrade for MLS-active groups;
- rejects plaintext `group` payloads;
- rejects MLS envelopes outside `group` privacy;
- rejects malformed MLS ciphertext;
- rejects unsupported MLS envelope fields;
- rejects missing `previousControlId` on non-creation records;
- rejects missing `membershipDigest` on epoch-advancing records.

Projection tests:

- valid group creation;
- valid member add;
- valid member remove;
- stale epoch rejection;
- revoked-device rejection;
- wrong-recipient welcome rejection;
- replay/idempotency behavior;
- fork detection;
- deterministic fork recovery;
- automated fallback fork recovery when policy permits it;
- offline catch-up;
- multi-device welcome routing.

## Non-goals

This phase does not add an MLS cryptographic runtime, implement UI, implement encrypted chat UX, or make bridges/super peers membership authorities.

## Exit criteria

Phase 4 is complete when:

- group-control event kinds are first-class protocol kinds;
- group-control payload validation exists;
- MLS group privacy envelope validation exists;
- deterministic group projection behavior exists;
- fork recovery and multi-device welcome routing are covered by tests;
- Phase 5 bridge resumability can carry these records without becoming cryptographic authority.
