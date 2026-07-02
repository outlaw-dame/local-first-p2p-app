# Local Verifier Boundary

- Status: Draft
- Date: 2026-06-03
- Related ADRs:
  - `docs/adr/001-identity-control-log-v1.md`
  - `docs/adr/002-private-payload-encryption-envelope-v1.md`
  - `docs/adr/003-sync-offsets-and-cursors-v1.md`
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
  - `docs/adr/005-content-addressing-and-object-references-v1.md`
- Related protocol docs:
  - `docs/protocol/operation-consistency-classes.md`
  - `docs/protocol/bridge-admission-doctrine.md`
  - `docs/protocol/identity-control-log.md`
- Related implementation docs:
  - `docs/implementation/trust-safety-complete-summary.md`

## Purpose

The repo's "verifier" is the named boundary every inbound signed
event MUST cross before its projection delta is committed. The
verifier is not a single package — it is a documented composition of
checks owned by the packages where each check naturally lives.

This document names that composition, lists every check, names which
package owns each check, and pins the contract with one adversarial
integration test (`packages/sync-client/src/verifier-boundary.test.ts`).

We deliberately did **not** introduce a `packages/verifier` wrapper.
Re-asserting the same contracts in a wrapper would add a parallel
code path with its own bug surface and no new guarantee. The existing
packages already enforce these checks; the verifier "is" the inbound
pipeline through `processInboundSyncBatch`. The job of this doc is
to make that pipeline explicit and auditable.

If a future change introduces a real bypass (e.g. an inbound path
that lands a signed event without traversing one of the documented
checks), the response is **first** to add a check at the right
package — not to build a wrapper.

## The boundary, today

The canonical inbound entry point is
`@lfp2p/sync-client/processInboundSyncBatch`. It traverses the
following checks in this order, per-record:

| #   | Check                                                                                                                                          | Owner package                                                                               | Failure mode                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1   | Checkpoint-key preflight (when `expectedCheckpointKey` is set)                                                                                 | `@lfp2p/sync-client`                                                                        | `Error("…checkpoint key mismatch…")`      |
| 2   | Ed25519 signature verification                                                                                                                 | `@lfp2p/crypto` (via `verifySignedEventEnvelope`)                                           | `Error("…signature verification failed")` |
| 3   | Envelope shape validation: version, kind allowlist, author/deviceId/createdAt, lamport, privacy scope, schemaVersion, payload JSON shape, refs | `@lfp2p/protocol` (via `validateSignedEvent` → `validateUnsignedEvent`)                     | plain `Error(...)`                        |
| 4   | Per-kind payload shape (`validatePayloadForKind`)                                                                                              | `@lfp2p/protocol`                                                                           | `Error("<kind>.<field> must …")`          |
| 5   | Privacy-scope-for-kind (`requirePrivacyForIdentityEvent`, etc.)                                                                                | `@lfp2p/protocol`                                                                           | `Error("…privacy must be …")`             |
| 6   | Sync-checkpoint monotonicity: stale-sequence skipped, cursor-mismatch at same sequence rejected                                                | `@lfp2p/local-store` (via `putSignedEventWithSyncCheckpoint` → `checkpointAdvanceDecision`) | `SyncCheckpointRejectedError`             |
| 7   | Identity-event defense-in-depth: re-run `validateIdentityEvent` on identity kinds                                                              | `@lfp2p/identity` (called from `applyIdentityControlEvent`) — Phase 2.1                     | `IdentityError("[IDENTITY_*] …")`         |
| 8   | Identity-control lifecycle: controller-signed, monotonic epoch, device-exists, authority-match, lifecycle-transition                           | `@lfp2p/identity` (via `applyIdentityControlEvent`)                                         | `IdentityError` / plain `Error`           |
| 9   | Transactional persistence of `signedEvents` + `syncCheckpoints` + (when identity) `identityControlProjections` in a single Dexie transaction   | `@lfp2p/local-store`                                                                        | rolls back on any `throw` in 7 or 8       |

For trust-safety control / labeler events the entry point is
`DexieLocalFirstStore.appendTrustSafetyControlEvent` /
`appendTrustSafetyLabelerEvent` (Phase 1.70.B), which:

| #   | Check                                                                                                   | Owner package         |
| --- | ------------------------------------------------------------------------------------------------------- | --------------------- |
| 1   | Re-run `validateLocalControlEvent` / `validateLabelerEvent` at append time                              | `@lfp2p/trust-safety` |
| 2   | Idempotency on `eventId` (silent no-op on duplicate)                                                    | `@lfp2p/local-store`  |
| 3   | Transactional insert into the event-log table                                                           | `@lfp2p/local-store`  |
| 4   | Re-validate every row on `loadLocalControlState` / `loadLabelersState`; skip-and-continue on corruption | `@lfp2p/local-store`  |

## What the verifier does NOT do today

Each of these is a documented deferral with a target phase. Naming
them here keeps the gap-list honest and gives reviewers a single
place to check before adding a new event kind.

| Missing check                                                                   | Target slice                                                       | Note                                                                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Trust-safety transport-admission (`admitEnvelope`) on inbound bridge deliveries | Phase 4.1 wiring of the existing engine into `apps/bridge-service` | Engine, fixtures, and tests already exist (Phase 1.64). Bridge just doesn't call them yet.                   |
| Capability-proof verification on the event author                               | Future capability-on-the-wire ADR                                  | Capabilities exist in the identity-control log; capability _proofs_ on regular events are not yet specified. |
| Content-ref retrieval verification (`fetch → cap → verify-digest → decode`)     | Phase 7.0 `packages/block-store` runtime                           | Validators exist (`@lfp2p/content-addressing`); a runtime that _uses_ them at fetch time does not.           |
| Private payload decryption + key-epoch check                                    | Phase 5.0 ADR-002 private-payload envelope implementation          | Required before chat (Phase 5) and MLS (Phase 6).                                                            |

## What the bridge MUST NOT do

(Copied here as a cross-reference; canonical home is
`docs/protocol/bridge-admission-doctrine.md`.)

The bridge may validate envelope shape, signature, scope, size,
idempotency, replay, rate limits, and routing metadata. The bridge
must NOT:

- decrypt private payloads,
- become the semantic authority for room / message / social objects,
- sign Class B or C events (per `operation-consistency-classes.md`),
- emit anything other than Class E (`transport.*`) events.

The trust-safety transport-admission engine (Phase 1.64) is the
mechanism for the bridge to enforce all of the above structurally
once Phase 4.1 wires it in.

## How rejection is logged

The inbound pipeline reports rejection via `ProcessInboundSyncResult.errors`:

- `index` — the offset in the input batch.
- `eventId` — only when the value parsed as a non-empty string;
  otherwise omitted (defense-in-depth against logging an
  attacker-controlled blob).
- `reason` — the normalized error message. We do not include the
  event payload, signature, or any private content in the log.

## Contract test

`packages/sync-client/src/verifier-boundary.test.ts` asserts the
documented check ordering with one adversarial input class per check.
If a future change accidentally drops a check (e.g. someone skips
signature verification on a "trusted" inbound path), the
corresponding test fails.

The test is the contract: any new inbound entry point that doesn't
pass it MUST NOT exist.

## What this is NOT

This document does not:

- introduce a new package,
- duplicate per-kind validators or projections,
- specify the wire format of any event kind,
- specify capability-proof or content-ref retrieval semantics
  (those are future ADRs / phases).
