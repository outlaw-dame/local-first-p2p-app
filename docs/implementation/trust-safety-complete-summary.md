# Trust & Safety — Complete Stack Summary

- Status: Foundation complete (1.6x family)
- Date: 2026-05-31
- Package: `@lfp2p/trust-safety`
- Consumed by (planned): `@lfp2p/local-store`, `apps/pwa`,
  `apps/bridge-service`, `apps/moderation-tools` (future),
  `apps/labeler-service` (future)

This document is the canonical entry point for the
trust-and-safety stack after Phase 1.68. It surveys what shipped,
where to look, and what each downstream consumer is expected to do.

## Phases shipped

| Phase | Slice | Exit report |
|---|---|---|
| 1.61 | T&S protocol core (shapes + validators) | `phase-1.61-exit-report.md` |
| 1.62 | Local user controls (12 event kinds + projection + selector) | `phase-1.62-exit-report.md` |
| 1.63 | Reports, appeals, encrypted evidence (5 lifecycle events + projection + privacy guard) | `phase-1.63-exit-report.md` |
| 1.64 | Bridge / relay / super-peer admission (6 events + rate limit + reputation + replay + audit + decision engine) | `phase-1.64-exit-report.md` |
| 1.65 | Curation and reach (6 events + projection + surface gate) + hardening pass | `phase-1.65-exit-report.md` |
| 1.66 | Labeler runtime (composable / stackable, 7 events + projection + kind taxonomy + aggregators) | `phase-1.66-exit-report.md` |
| 1.67 | Moderation runtime (7 events + projection + queue + cross-references) | `phase-1.67-exit-report.md` |
| 1.68 | Completion sweep (threat-model refresh + this summary) | `phase-1.68-exit-report.md` |

## Sub-modules

| Sub-module | Public surface | Doctrine |
|---|---|---|
| (top level shapes) | `SafetyAuthority`, `SafetySubjectRef`, `SafetyAction`, `SafetyLabel*`, `SafetyAnnotation`, `SafetyReport`, `SafetyAppeal`, `SafetyPolicy`, `SafetyPolicyDecision`, `TransportAdmissionDecision`, `CurationRule`, `CurationExplanation` | `docs/protocol/trust-safety-event-policy.md` |
| `local-controls/` | 12 event kinds, `LocalControlState`, `decideVisibility`, snapshot import/export | `docs/protocol/local-controls-portability.md` |
| `reports-appeals/` | 5 lifecycle events, `ReportsAppealsState`, `classifyReportPrivacy`, `canBridgeForwardReport` | (in exit report) |
| `transport-admission/` | 6 events, `admitEnvelope` decision engine, token-bucket rate limit, peer reputation, replay cache, audit log | `docs/protocol/bridge-admission-doctrine.md` |
| `curation-runtime/` | 6 events, `CurationState`, `computeItemRanking`, `decideCurationSurfaceIngest`, `decideReportAsCurationSignal` | `docs/protocol/curation-doctrine.md` |
| `labelers-runtime/` | 7 events, `LabelersState`, `effectiveLabelsForSubject`, `mostRestrictiveAction` | `docs/protocol/labeler-runtime-doctrine.md` |
| `moderation-runtime/` | 7 events, `ModerationState`, policy + queue + decision lifecycle, `queueItemsForSource` | `docs/protocol/moderation-runtime-doctrine.md` |

## Dependency graph

```
content-addressing (Phase 1.56)
       ▲
       │ (ObjectRef, BlockRef, DigestRef)
       │
trust-safety/top-level (Phase 1.61)
       ▲
       ├── local-controls (Phase 1.62)
       ├── reports-appeals (Phase 1.63)
       ├── transport-admission (Phase 1.64) ──┐
       │      consumes local-controls         │
       │      consumes reports-appeals        │
       ├── curation-runtime (Phase 1.65)      │
       │      consumes reports-appeals        │
       │      (privacy classification)        │
       ├── labelers-runtime (Phase 1.66)      │
       │      consumes curation-runtime       │
       │      (subjectKey helper)             │
       └── moderation-runtime (Phase 1.67) ───┘
              consumes curation-runtime
              (subjectKey helper)
```

No cycles. Each sub-module's projection is independently
deterministic and replayable.

## "How to consume `@lfp2p/trust-safety` from a downstream package"

### Local UI / PWA (apps/pwa)

1. Read the user's local-control event log from `local-store`.
2. Build `LocalControlState` via `seedLocalControlState`.
3. For each candidate post / actor / thread / notification, build a
   `SelectorContext` from the rendered content and call
   `decideVisibility`. Apply the returned `VisibilityDecision`.
4. For each candidate notification, additionally consult
   `notificationChannel` semantics.
5. Emit `LocalControlEvent`s when the user changes a preference; sign
   the envelope at `device-local` or `account-local` scope. Never
   public.

### Subscriber-side label ingestion

1. Subscribe (account-local) to each labeler whose stream you want.
2. As `LabelerEvent`s arrive from the labeler's wire API (out of
   scope for this package), feed them into `applyLabelerEvent`.
3. For each candidate subject, call `effectiveLabelsForSubject` with
   the subscriber's `actorId`. Pass the stack to
   `mostRestrictiveAction` or to a custom combiner.
4. Combine with the local-control selector: a label whose effective
   action is `hide` produces a visibility `hide`, but the
   local-control selector's own decisions take precedence (user
   block > labeler stack).

### Bridge / relay / super-peer (apps/bridge-service)

1. On every inbound envelope, project to an `AdmissionEnvelope`.
2. Call `admitEnvelope(state, envelope, config, context?, now)`. The
   `context` carries the recipient's `LocalControlState` (if
   forwarding multi-device sync) and embedded `SafetyReport` (if the
   envelope wraps `safety.report.created`).
3. Honor `result.decision.action`:
   - `accept` / `accept-limited` → forward.
   - `reject` / `quarantine` / `rate-limit` / `drop-duplicate` →
     refuse; emit the matching transport event for downstream
     persistence.
4. Persist `result.nextState` as the operator's projection.

### Moderation tools (future apps/moderation-tools)

1. Subscribe to the operator's `ModerationState` event stream
   (delivered via a future moderation API on `apps/bridge-service`).
2. Build `ModerationState` via `seedModerationState`.
3. Surface queue items by status / assignee via the indexes. Show
   the moderator their inbox.
4. On a moderator's decision, emit a `safety.policy.decision.recorded`
   plus a `moderation.queue.item.resolved` cross-referencing the
   decision.

### Public feed / search / recommendation (future)

1. Before ingesting any item, call
   `decideCurationSurfaceIngest(surface, envelopeScope, subject)`. If
   not allowed, drop.
2. For each candidate item, call `computeItemRanking(state, subject)`.
   Use `effectiveNetScoreDelta` as a ranking signal; honor
   `isExcludedFromFeed | isExcludedFromSearch | isExcludedFromRecommendation`.
3. Before using a report as a signal, call
   `decideReportAsCurationSignal(report, surface)`.

## Explicit non-deferred deferrals

Everything still owed to downstream consumers is listed here, with
the phase that originally identified the deferral:

| Deferral | Origin phase | Belongs to |
|---|---|---|
| Dexie persistence for every projection | 1.62, 1.63, 1.64, 1.65, 1.66, 1.67 | `packages/local-store` |
| PWA settings UI for local controls | 1.62 | `apps/pwa` |
| Account-local sync envelope wiring | 1.62 | `packages/sync-client` + ADR-002 |
| Host-side semantic embedding pipeline | 1.62 | `apps/pwa` or a future `packages/embeddings` |
| Bridge-service HTTP wiring of `admitEnvelope` | 1.64 | `apps/bridge-service` |
| Envelope-layer signature verification | 1.64 | `packages/protocol` + ADR-002 |
| Policy-list resolution runtime | 1.64 | future T&S subscription runtime |
| Media-scanner verdict ingestion | 1.64 | future T&S admission expansion |
| Feed / search runtime consuming `computeItemRanking` | 1.65 | `@lfp2p/search` + new feed package |
| Trust-policy engine integration | every phase | ADR-006 (future) |
| Labeler HTTP/WS API | 1.66 | future `apps/labeler-service` |
| Moderation tools API and UI | 1.67 | future `apps/moderation-tools` |
| BLAKE3 runtime | 1.56 | future content-addressing slice |
| `z` / `k` multibase parsers | 1.56 | future content-addressing slice |

## Boundary discipline preserved across all 1.6x phases

Every sub-module in this package is:

- **Pure**: no IO, no clock reads (everything takes explicit `now`),
  no random.
- **Frozen**: all returned state is deeply frozen; mutation
  attempts throw at runtime.
- **Validated before mutation**: every entry function validates
  input shape first, throws a `TrustSafetyError` with a stable
  `code` (one of `TS_*`) on failure, and never partially mutates.
- **Idempotent on `eventId`**: replay-safe by construction.
- **Free of UI / HTTP / Dexie / ML**: every external dependency is
  documented as a host-injection point (callback, parameter, or
  separate consumer package).

## Tests

884 tests across the monorepo as of Phase 1.67. Roughly:

| Sub-module | Test count |
|---|---:|
| top-level shapes (Phase 1.61) | ~120 |
| local-controls (1.62 + 1.62.1 expansion + hardening) | ~130 |
| reports-appeals (1.63) | ~50 |
| transport-admission (1.64) | ~80 |
| curation-runtime (1.65) | ~65 |
| labelers-runtime (1.66) | ~27 |
| moderation-runtime (1.67) | ~28 |
| cross-cutting (hardening, fixtures, content-addressing) | ~380 |

## Acceptance criteria — final state

From `docs/implementation/trust-safety-phase-plan.md`:

- [x] Phase 1.56 content-addressing package exists and is tested.
- [x] T&S protocol core exists and is tested.
- [x] Local user controls exist and are private by default.
- [x] Reports/appeals can reference encrypted evidence safely.
- [x] Bridge/relay/super-peer admission decisions are scoped and audited.
- [x] Curation/reach controls are separate from moderation enforcement.
- [x] Public search/recommendation cannot ingest private scopes.
- [~] Media manifest planning consumes `BlockRef` / `ObjectRef` —
  contingent on Phase 7 (Media manifests) when it begins; the protocol
  shape supports it via `SafetySubjectRef.media`.
- [x] Fixtures cover valid and invalid safety objects.
- [x] Threat models are updated for implemented code.

Plus the labeler / moderation event family coverage that closed the
post-1.65 audit gaps:

- [x] All 6 reserved labeler/tagger lifecycle events shipped (Phase 1.66).
- [x] All 7 reserved policy/moderation lifecycle events shipped (Phase 1.67).

## Next directions (per the docs)

Per `docs/implementation/phase-map.md` "Next required gates":

1. Record ADR-000 for the runtime/product decision.
2. Add an explicit schema/storage versioning policy.
3. Add initial protocol event fixtures and tests under the fixture
   policy.
4. Add the bridge compromise threat-model note.
5. Add sync offset/checkpoint design before implementing Durable
   Streams/WebSocket readers.
6. Expand identity-control implementation from ADR-001 into protocol
   fixtures and projection logic (**Phase 2**).
7. Expand payload encryption implementation from ADR-002 into envelope
   schema, fixtures, and enforcement.

After those gates, the first feature surface the doctrine permits is
**Phase 5 — Chat vertical slice**.
