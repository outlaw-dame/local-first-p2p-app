# MLS Group Control → Protocol Specification Promotion

- Status: Draft
- Date: 2026-07-01
- Scope: promote the Phase 3/4 MLS doctrine and the shipped group-control projection into the Series 8 security specifications, and gate Phase 6 implementation on them
- Related implementation:
  - `docs/implementation/phase-3-mls-implementation-plan.md`
  - `docs/implementation/phase-4-mls-group-control-implementation-plan.md`
  - `packages/mls-group-projection/src/index.ts`
  - `packages/mls-group-projection/src/index.test.ts`
- Related specifications:
  - `docs/specification/08-security/mls-group-keying.md`
  - `docs/specification/08-security/mls-virtual-delivery-service.md`
  - `docs/specification/08-security/mls-fork-detection-and-recovery.md`
  - `docs/specification/08-security/encrypted-evidence.md`
- Related ADRs:
  - `docs/adr/012-mls-dependency-and-group-keying-v1.md`
  - `docs/adr/015-mls-library-selection-v1.md`
  - `docs/adr/016-virtual-delivery-service-v1.md`

## Purpose

The MLS group-control slice (Phase 3 doctrine + Phase 4 projection) was written before the implementation-independent specification tree existed. This document promotes it into the Series 8 security specifications so Phase 6 (MLS private group encryption v1) implements against spec-tree doctrine instead of scattered planning docs, per `docs/implementation/specification-reconciliation.md` item 5.

## Current implemented slice

- `@lfp2p/mls-group-projection`: pure projection over eleven signed group-control event kinds (`mls.group.created`, `mls.member.proposed`, `mls.member.added`, `mls.member.removed`, `mls.device.updated`, `mls.commit.published`, `mls.welcome.issued`, `mls.epoch.advanced`, `mls.fork.detected`, `mls.fork.recovery.published`, `mls.stale-epoch.rejected`).
- Projection state tracks membership, local device status, epoch chain, fork candidates, fork recovery records (`policy-authority` | `deterministic-fallback`), and rejected-record diagnostics.
- Replay-equivalence, idempotency, stale-epoch, and fork-handling test coverage in the package suite.
- Protocol-level MLS application-message envelope recognition already ships in `packages/protocol/src/mls.ts` (`MLS_APPLICATION_MESSAGE_ENVELOPE_VERSION`, `looksLikeMlsApplicationMessageEnvelope`), and `validatePayloadPrivacyScope` accepts these envelopes for `group` privacy alongside Phase 2 private-payload envelopes.
- Doctrine docs: `docs/protocol/mls-group-keying.md`, `docs/protocol/mls-group-control-records.md`.

## Current non-implemented pieces

- No MLS cryptographic runtime (no library dependency yet; ADR-015 now selects `ts-mls` behind an `MlsProvider` boundary).
- No KeyPackage store or any virtual Delivery Service capability on the bridge (ADR-016 now defines the model).
- No _semantic_ MLS application-message validation binding envelopes to group id / epoch / sender device (the protocol layer already recognizes the envelope shape and gates it to `group` privacy — see Current implemented slice — but wrong-group / wrong-epoch / stale-epoch / scope-widening rejection and MLS-active format-fallback rejection are projection/runtime work).
- No Welcome-over-mailbox routing.
- No encrypted-evidence retrieval runtime (blocked on Phase 7.0 block-store).
- No PWA group UX or key-ceremony surfaces.

## Layer mapping

| Existing concept                             | New specification owner                                 | Promotion rule                                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/protocol/mls-group-keying.md` doctrine | `08-security/mls-group-keying.md`                       | Spec is now the normative home; the protocol doc remains design history.                                                                          |
| `mls.*` group-control events                 | `08-security/mls-group-keying.md` + Event Type Registry | Kinds preserved exactly as shipped; registry entry required before any new kind.                                                                  |
| Fork candidate queue + recovery records      | `08-security/mls-fork-detection-and-recovery.md`        | Shipped projection behavior is the reference; spec adds the deterministic-fallback constraints and scope-widening prohibition as normative rules. |
| Delivery-service doctrine section (ADR-012)  | `08-security/mls-virtual-delivery-service.md` + ADR-016 | "Delivery services only" is decomposed into three registered capabilities; ordering is explicitly advisory.                                       |
| Phase 1.63 encrypted-evidence guards         | `08-security/encrypted-evidence.md`                     | Structural guards stay in `@lfp2p/trust-safety`; the retrieval path and re-encryption model are now specified.                                    |
| `MlsProvider` boundary (doctrine)            | ADR-015                                                 | Interface definition is the first Phase 6 implementation gate.                                                                                    |

## Required doctrine boundaries

- **Provider is not protocol**: MLS library state never persists or replicates as protocol objects; only RFC 9420 wire objects and signed group-control records cross the boundary.
- **Delivery is not authority**: no DS capability decides membership, epoch validity, or commit ordering.
- **Fork resolution is signed**: no wall-clock, arrival-order, or surface-hint tie-breaking; scope-widening commits can never win a tie-break.
- **Evidence never widens keys**: reporting group content re-encrypts to the moderation authority; group keys never leave the group.
- **No format fallback**: MLS-active groups reject Phase 2 private payload envelopes.

## Promotion stages

### Stage P6-M1 — Documentation promotion (this PR)

Series 8 specs, ADR-015, ADR-016, glossary/changelog/registry updates, this document. Future MLS work must cite the Series 8 specs.

### Stage P6-M2 — MLS provider adapter

`MlsProvider` interface; `ts-mls` adapter with injected storage/key custody; RFC 9420 interop vectors as CI fixtures; bundle-size budget check.

### Stage P6-M3 — Group payload validation

Protocol-level envelope recognition already exists (`packages/protocol/src/mls.ts`); the remaining work is _semantic_ binding and projection enforcement: wrong-group / wrong-epoch / stale-epoch / replay / scope-widening rejection fixtures, and MLS-active format-fallback rejection (once a group is MLS-active, its Phase 2 private-payload envelopes are rejected).

### Stage P6-M4 — Virtual Delivery Service on the bridge

KeyPackage store (publish/serve/consume-once/last-resort/rotation/caps), Welcome routing over mailbox delivery envelopes, message fan-out with advisory ordering hints, admission wiring per Phase 1.64.

### Stage P6-M5 — End-to-end encrypted group slice

Create/join/message/remove flows across two simulated devices; fork detect→recover integration test; offline catch-up; stale-epoch and revoked-device rejection at runtime.

### Stage P6-M6 — Encrypted evidence retrieval

Blocked on Phase 7.0 `@lfp2p/block-store`. Reporter-side re-encryption helper, authority-side retrieval pipeline (fetch → cap → verify-digest → decode → decrypt), report-AAD binding.

## Tests required by promotion

- provider adapter passes official RFC 9420 interop vectors;
- bridge never imports MLS decrypt paths (ciphertext-opacity, mirroring the Phase 5 chat proof);
- consume-once KeyPackage semantics and depletion defense;
- zero-DS group operation (direct/sync-drop only);
- fork: detection, policy-authority recovery, deterministic fallback, scope-widening abstention, replay equivalence;
- MLS-active group rejects Phase 2 envelope fallback;
- evidence: wrong-authority unwrap failure, digest-mismatch rejection, caps before decode.

## Current status

The MLS group-control slice is promoted as the Series 8 security foundation. Doctrine (specs + ADR-015 + ADR-016) is complete for Phase 6; implementation begins at Stage P6-M2 and MUST be extended through the stages above rather than replaced or bypassed.
