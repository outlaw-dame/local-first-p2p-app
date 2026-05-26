# Project Roadmap (Intent vs Implementation)

This roadmap compares the architecture intent to the code that currently exists, then defines the recommended execution path.

It is meant to be the practical planning companion to:

- `docs/frontend_architecture.md`
- `docs/implementation_doctrine.md`
- `docs/implementation/phase-map.md`
- `docs/implementation/next-development-path.md`

## 1) Target outcome (what the project is trying to accomplish)

The target product is a PWA-first, local-first protocol client that:

- writes durable user actions locally first,
- signs durable events,
- keeps bridge/server non-authoritative for private canonical state,
- syncs opportunistically through bridge infrastructure,
- remains compatible with future full-peer runtimes.

The architecture target is broader than the current code: identity control logs, payload encryption, richer sync readers, social/chat/media/search breadth, and eventual full-peer compatibility.

## 2) Current implementation snapshot (what is coded now)

### Foundation implemented

- PWA shell with local identity bootstrap, local signed writes, local summary rendering, outbox enqueue.
- Guarded bridge config boundary and guarded transport preparation boundary.
- Dev-only manual outbox delivery path with explicit gate and batch-size limits.
- Manual delivery send budget guard (window/runs/entries/min-interval constraints).
- HTTP bridge transport hardening and inbound bridge read transport slices.
- Bridge service primitives with signature checks, privacy-scope filtering, idempotency handling, and optional bearer auth boundary.
- Schema/versioning policy document exists.
- Apple-first UI Phase A token hardening landed (semantic token expansion and shell wiring).

### Still intentionally missing

- Production outbox automation wiring in foreground/background lifecycle.
- Durable sync offsets/checkpoints implemented in storage and sync contracts.
- Identity control log and capability/revocation model.
- Payload encryption contract for private user-facing content.
- Chat/groups/media/social/search feature surfaces.
- Production-grade bridge controls (operational auth lifecycle, abuse controls, observability, deployment posture).

## 3) Key intent-to-code gaps

### Gap A - Governance and doctrine completion

- Architecture doctrine expects ADR and threat-model progression before broad feature expansion.
- Some docs still describe older baselines and need synchronized truth updates.

### Gap B - Sync correctness before automation

- Manual delivery exists, but durable offset/checkpoint persistence is still the gating prerequisite for richer readers and robust resume behavior.

### Gap C - Security model before private product breadth

- Signed-event and bridge hardening exist.
- Private payload encryption and identity-control authority model are not finalized.

### Gap D - UX/system polish sequencing

- Apple-first visual direction has started.
- Additional UI phases should continue without introducing architecture drift or hidden sync behavior in UI layers.

## 4) Recommended execution roadmap

### Phase R1 - Docs and truth-layer alignment (short)

Objective:

- Align implementation truth docs with current landed features so planning is reliable.

Deliverables:

- Refresh `docs/implementation/current-state.md` baseline and feature inventory.
- Refresh `docs/implementation/phase-map.md` status lines for bridge auth and manual delivery/send-budget progress.
- Refresh `docs/implementation/planning-to-code-alignment.md` for newly landed boundaries.

Exit criteria:

- Implementation docs no longer reference stale baseline snapshots.

### Phase R2 - Guardrail completion (high priority)

Objective:

- Finish doctrine gates required before larger feature breadth.

Deliverables:

- Finalize ADR-000 runtime/product-surface record.
- Add initial protocol fixture pack and negative fixture tests.
- Add bridge compromise threat-model note.

Exit criteria:

- Protocol and bridge behavior are constrained by fixtures and threat-model artifacts.

### Phase R3 - Sync offsets/checkpoints implementation (highest leverage)

Objective:

- Add durable offset/checkpoint persistence to support reliable readers and resume behavior.

Deliverables:

- local-store sync checkpoint schema and APIs.
- sync-client offset contract and tests.
- optional ADR for offset semantics if needed by policy.

Exit criteria:

- offset create/update/read/reject semantics tested, persisted, and isolated by source/stream/scope.

### Phase R4 - Delivery integration hardening (still controlled)

Objective:

- Move from manual-only to controlled lifecycle wiring without jumping to production automation.

Deliverables:

- single-flight foreground integration gates,
- explicit online checks and retry-budget surfaces,
- clear terminal failure UX and operator-facing diagnostics,
- no silent background behavior yet.

Exit criteria:

- foreground-triggered delivery is deterministic, bounded, and observable.

### Phase R5 - Identity + private payload security contracts

Objective:

- Lock identity authority and payload privacy contracts before private chat/product breadth.

Deliverables:

- identity-control ADR (root/controller, device delegation, revocation, epochs),
- payload encryption ADR (scope-specific metadata visibility and failure modes),
- fixture/test hooks for contract enforcement.

Exit criteria:

- private feature work can start without redefining core security objects mid-flight.

### Phase R6 - Feature vertical slices (chat/social/media/search)

Objective:

- Build user-facing breadth only after R2 through R5 gates are met.

Deliverables:

- room/chat deterministic apply slice,
- social outbox/event model slice,
- media manifest slice,
- search quality uplift slice.

Exit criteria:

- each vertical slice ships with fixture coverage, threat notes, and no architecture drift.

## 5) Immediate next backlog (recommended order)

1. Update implementation truth docs (R1).
2. Ship protocol fixture pack + tests (R2).
3. Add bridge compromise threat-model note (R2).
4. Implement sync checkpoints in local-store and sync-client (R3).
5. Add foreground delivery integration behind explicit gates (R4).

## 6) Roadmap operating rules

- No new durable object shape without versioning policy coverage.
- No private user payload transmission without encryption contract.
- No hidden delivery automation in UI events without explicit gate docs and tests.
- No bridge/server authority over signed canonical local state.
- Every roadmap slice should update implementation docs and include targeted tests.