# Phase 1.72 — Consistency Class Enforcement

- Status: Implementation follow-up
- Date: 2026-06-28
- Depends on:
  - `docs/protocol/operation-consistency-classes.md`
  - `packages/protocol/src/index.ts`

## Purpose

`docs/protocol/operation-consistency-classes.md` defines the doctrine that prevents the protocol from applying CRDT, Loro, Yjs, or last-writer-wins shortcuts to lifecycle, authority, key-epoch, or infrastructure-observation events.

Before this follow-up, the taxonomy was an audit lens only. A future contributor could add a new first-class `EventKind` and forget to classify it. That would leave code review to catch the drift manually.

This phase makes the first-class protocol-event part enforceable.

## Implemented guardrail

`packages/protocol/src/consistency-classes.ts` adds:

- `OperationConsistencyClass = 'A' | 'B' | 'C' | 'D' | 'E'`;
- metadata for each class, including whether CRDT-style payload merging or LWW is allowed at that boundary;
- `EVENT_KIND_CONSISTENCY_CLASS`, an exhaustive `Record<EventKind, OperationConsistencyClass>`;
- helper assertions for callers that need to guard CRDT/Loro/Yjs or LWW usage explicitly.

The registry uses TypeScript's `satisfies Readonly<Record<EventKind, OperationConsistencyClass>>` check. Adding a new first-class `EventKind` without classifying it becomes a typecheck failure.

## Current classifications

### Class A — eventually consistent projection events

These may use pure projection, idempotency, commutative apply, and narrow field-level LWW when the protocol object explicitly allows it.

Current first-class protocol kinds:

- `identity.contact-card.published`
- `contact.petname.set`
- `note.created`
- `outbox.test.created`
- `reputation.observation.recorded`
- `reputation.aggregator.published`
- `reputation.aggregator.score.removed`

### Class B — append-only lifecycle state machines

These require lifecycle transition checks and must not use CRDT or LWW as the state authority.

Current first-class protocol kinds:

- `identity.capability.revoked`
- `reputation.attestation.published`
- `reputation.attestation.revoked`

### Class C — monotonic authority / epoch transitions

These require authority and monotonicity checks and must never use CRDT or LWW as the conflict rule.

Current first-class protocol kinds:

- `identity.device.created`
- `identity.controller.created`
- `identity.device.authorized`
- `identity.device.revoked`
- `identity.device.rotated`
- `identity.capability.granted`

### Class D — encrypted payload / key-epoch transitions

The older taxonomy reserved Class D for future private payload and MLS work. Phase 4 has now made MLS group-control records first-class protocol events, so those first-class MLS kinds are classified here.

Current first-class protocol kinds:

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

### Class E — infrastructure observations

No first-class `SignedEventEnvelope` event kinds currently live in Class E. Transport-admission events are still package-local trust/safety events, not `@lfp2p/protocol` `EventKind`s.

## Tests

`packages/protocol/src/consistency-classes.test.ts` pins:

- the allowed class identifiers;
- representative event-kind classifications;
- rejection of CRDT/Loro/Yjs-style payload merging at Class C and D boundaries;
- rejection of last-writer-wins at Class B, C, and D boundaries;
- runtime registry values are all known class identifiers.

## Remaining work

This phase enforces the registry for first-class `@lfp2p/protocol` event kinds only.

Still needed:

1. Bring package-local event families under equivalent registries:
   - local-controls events;
   - reports/appeals events;
   - labeler-runtime events;
   - moderation-runtime events;
   - curation-runtime events;
   - transport-admission events;
   - future private payload / mailbox / media-safety event families.
2. Add a repository-level CI test that compares every package-local event-kind constant against an exported class registry.
3. Update `docs/protocol/operation-consistency-classes.md` after this PR lands so the doctrine table matches the current first-class `EventKind` union, especially the reputation and MLS rows.
4. Decide whether `@lfp2p/protocol` should re-export `./consistency-classes` from `.` or keep it as a dedicated subpath export. This follow-up keeps it as `@lfp2p/protocol/consistency-classes` to avoid introducing an index-file circularity during this slice.

## Exit criteria

- Every current first-class `EventKind` is classified.
- A future first-class `EventKind` addition fails typecheck until classified.
- CRDT/Loro/Yjs and LWW boundaries are explicit helper assertions.
- Existing event validation behavior is unchanged.
