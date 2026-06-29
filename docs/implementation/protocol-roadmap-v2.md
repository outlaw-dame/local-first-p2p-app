# Protocol Roadmap v2

- Status: Draft reconciliation roadmap
- Date: 2026-06-27
- Branch: `docs/protocol-roadmap-v2`
- Repository baseline checked: default branch `master`, recent merged PRs through Phase 4 MLS group-control projection work

## Purpose

This document reconciles the implementation doctrine, phase map, current-state document, roadmap-ordering reference, Phase 4 exit reports, recent merged PRs, and trust/safety phase documents into one working roadmap.

It does not replace detailed ADRs, protocol doctrine, or exit reports. It is the planning layer that shows what is complete, what is partial, what is blocked, and where cross-cutting safety work belongs.

The roadmap follows these rules:

1. Do not duplicate protocol primitives that already exist.
2. Treat trust/safety, child safety, media safety, abuse prevention, and content curation as cross-cutting runtime gates, not a late dashboard.
3. Keep bridges, relays, super-peers, mailboxes, Holepunch/Pear, Hypercore/Corestore, and WebRTC as delivery/runtime layers, not protocol authorities.
4. Keep private payloads encrypted and preserve bridge log privacy.
5. Do not allow public search, recommendation, media replication, or public social outbox work to bypass trust/safety and content-addressing gates.
6. When this document pulls work forward from `roadmap-ordering.md`, call that out explicitly as a deliberate ordering change.

## Verified source documents

This roadmap was reconciled against:

- `docs/implementation/phase-map.md`
- `docs/implementation/current-state.md`
- `docs/implementation/next-development-path.md`
- `docs/implementation/roadmap-ordering.md`
- `docs/implementation/trust-safety-phase-plan.md`
- `docs/implementation/phase-3-mls-implementation-plan.md`
- `docs/implementation/phase-4-mls-group-control-implementation-plan.md`
- `docs/implementation/phase-4.2-exit-report.md`
- `docs/implementation/phase-4.3-exit-report.md`
- `docs/implementation/phase-4.4-exit-report.md`
- `docs/protocol/bridge-admission-doctrine.md`
- recent merged PRs #95 through #110, especially #103 through #110 for private payload and Phase 4 MLS work

Phase 4 is real and active in the repository: it is documented by the Phase 4 MLS group-control plan and backed by merged PRs #106 through #110. The earlier branch search for `phase` / `phase-4` only checked whether there were additional unmerged active branches matching those names. It returned no matching active branches, so this roadmap treats the default branch plus merged PR history as the implementation baseline.

## Important correction: Phase 4.5 / 4.6 are roadmap-ordering changes

`roadmap-ordering.md` currently places related work across several later phases:

- Phase 5 — bridge resumability hardening: GET-with-cursor backlog, cursor/checkpoint tests, persistent per-token streaming rate limits, persistent token registry, hot rotation, SSE, long-polling, Durable Streams conformance tests.
- Phase 8 — bridge capability modules.
- Phase 15 — super-peer and persistent availability design.
- Phase 19 — production bridge runtime.

Therefore:

- **Phase 4.5 is a proposed consolidation/pull-forward of explicit Phase 4.x bridge hardening deferrals.** Its scope is strongly backed by Phase 4.2, 4.3, and 4.4 exit-report deferred-work lists plus bridge admission doctrine. It is not an arbitrary new safety phase.
- **Phase 4.6 is a proposed pull-forward of a narrow operator-policy subset.** It does not claim that full relay/super-peer availability should move out of Phase 15. It only pulls forward the operator policy, trusted labeler/policy subscription wiring, and advisory reputation pieces needed before broader bridge resumability and public discovery work.

This distinction matters because the roadmap should remain honest: Phase 4.5/4.6 do not appear as named phases in the older ordering reference. They are deliberate re-ordering proposals based on real deferrals and safety dependencies.

## Status legend

- **Complete**: implementation and tests are present for the current intended scope.
- **Foundation complete**: protocol/package/projection foundation exists, but downstream runtime/UI/network integration remains.
- **Partial**: meaningful work exists but the phase is not complete.
- **In progress**: active roadmap phase with some merged work and known follow-up slices.
- **Proposed pull-forward**: real work exists in docs/deferrals, but this phase name/order is new in this v2 roadmap.
- **Planned**: documented target work, not yet implemented.
- **Blocked**: should not start until listed dependencies are complete.

## Roadmap overview

| Phase | Status | Summary | Safety placement |
|---|---:|---|---|
| 0 | Partial | Doctrine, repo discipline, ADR/exit-report templates | Require roadmap/exit-report discipline before broad feature work |
| 1 | Partial | Protocol primitives and canonical fixtures | Complete fixture/version/signature discipline before widening protocol surface |
| 1.56 | Foundation complete | Content addressing and object references | Required for evidence refs, media safety, quarantine, search provenance |
| 1.6 | Foundation complete | T&S doctrine and protocol boundaries | Establishes safety as protocol/runtime boundary |
| 1.61 | Foundation complete | T&S protocol core | Defines authorities, scopes, subjects, labels, reports, decisions |
| 1.62 | Foundation complete | Local user controls | Private-by-default blocks, mutes, label prefs, policy-list subscriptions |
| 1.63 | Foundation complete | Reports, appeals, encrypted evidence refs | Required for safe abuse reporting and appeals |
| 1.64 | Foundation complete | Bridge/relay/super-peer admission policy | Core transport safety engine |
| 1.65 | Foundation complete | Curation and reach controls | Public search/feed/recommendation gate foundation |
| 1.66 | Foundation complete | Labeler runtime | Stackable signed labels, labeler provenance, media-scanner kind |
| 1.67 | Foundation complete | Moderation runtime | Policy, queue, decision lifecycle |
| 1.68 | Complete | T&S completion sweep | Documents full 1.6x stack |
| 1.69 | Foundation complete | Content categories, capabilities, adult-content gate | Adds `scan.media-csam` and category gates |
| 1.70 | Foundation complete | PWA T&S settings and safer keyword kinds | User-facing local controls |
| 1.71 | Foundation complete | Block-evasion hardening | Unicode/confusables and report-rate hardening |
| 1.8 | Complete for current scope | Local personalized EigenTrust/reputation graph | Reputation becomes local, opt-in, admission/curation signal |
| 2 | Partial | Private/account-local payload helpers | Must be promoted to full private payload runtime before private chat |
| 2.3 | Partial/foundation | Identity proof registry, capability proof pipeline, contact-card/outbox gating | Required for authority resolution and safety decisions |
| 3 | Complete as docs | MLS architecture and dependency decision | Establishes MLS provider boundary before group control |
| 4 | In progress | MLS group-control phase; PRs #106–#110 landed the plan, validators, first-class event kinds, and deterministic projection | Group safety, stale epoch rejection, revoked-device rejection, fork handling, downgrade prevention |
| 4a | Foundation complete | MLS group-control protocol records and deterministic projection package | Needs exit-report/current-state reconciliation |
| 4b | Planned | MLS group-control persistence and bridge/sync wiring | Safety checks must run before forwarding/storing group records |
| 4.5 | Proposed pull-forward | Bridge resumability + production hardening follow-up from Phase 4.2–4.4 deferrals and old Phase 5/19 ordering | Persistent auth/rate-limit state, hot rotation, auth audit, missing admission deferral wiring |
| 4.6 | Proposed pull-forward | Narrow operator policy runtime before full super-peer availability | Operator policy/labeler subscriptions, advisory reputation consumption, scoped enforcement; not full Phase 15 super-peer runtime |
| 5 | Planned/blocked | Private messaging and encrypted mailbox foundation | Must include first-contact/stranger safety before chat UX |
| 5.1 | Planned | First-contact, stranger-message, and minor-safety interaction barriers | Unknown-sender quarantine, stranger DM friction, and contact-gated defaults |
| 6 | Planned/blocked | Media safety runtime before media replication | Known-abuse/media-scanner/quarantine phase |
| 7 | Planned/blocked | Public index/search/recommendation safety gates | Public discovery cannot ingest private/unsafe objects |
| 8+ | Planned/blocked | Media, social outbox, semantic discovery, recommendations, full-peer work | Only after runtime gates are active |

## Phase 4 clarification

Phase 4 should be read as the active MLS group-control implementation phase, not as absent or unstarted.

The repository has clear Phase 4 evidence:

- `docs/implementation/phase-4-mls-group-control-implementation-plan.md` defines Phase 4 as signed MLS group-control records plus deterministic projection behavior.
- PR #106 added the Phase 4 MLS group-control plan and doctrine.
- PR #107 added group envelope validators.
- PR #109 added first-class MLS group-control event kinds and envelope validation.
- PR #110 added the deterministic MLS group-control projection package.

The remaining Phase 4 work is therefore not “start Phase 4.” It is:

1. reconcile `current-state.md`, `phase-map.md`, and exit reports with the merged Phase 4 work;
2. complete Phase 4b persistence/sync/bridge wiring;
3. handle Phase 4.5 and 4.6 as explicit ordering changes that pull forward safety-critical bridge/operator-policy work.

## Phase 4.5 source-of-truth deferrals

Phase 4.5 is grounded in existing deferred-work lists and doctrine, not just new planning. It should close the following gaps:

| Item | Existing source | Current state | Phase 4.5 treatment |
|---|---|---|---|
| Persistent per-token HTTP rate-limit buckets | Phase 4.3 exit report; bridge doctrine HTTP hardening | `BridgeHttpRateLimiter` is in-memory only; restart resets HTTP buckets | Persist per-token HTTP buckets or document equivalent durable store |
| Persistent token registry / hot rotation | Phase 4.3 exit report; roadmap-ordering Phase 5/19 | Tokens supplied at handler-options time | Add file/DB-backed token registry with safe hot rotation |
| Auth audit log | Phase 4.3 exit report | No operator auth audit log | Add privacy-safe auth audit log for success/failure classes |
| mTLS / OAuth2 / JWT decision/adapters | Phase 4.3 exit report; roadmap-ordering Phase 19 | Bearer-only v1 | Decide and/or add adapters without weakening bearer-path tests |
| Persistent per-token streaming rate limit | Phase 4.4 exit report; bridge doctrine deferred Phase 4.4.1+ | Per-socket in-memory cap only | Add token-keyed streaming bucket parallel to HTTP bucket |
| SSE / long-polling alternate transports | Phase 4.4 exit report; roadmap-ordering Phase 5 | WebSocket adapter exists | Add or explicitly defer adapters with conformance criteria |
| GET-with-cursor backlog read | Phase 4.4 exit report; roadmap-ordering Phase 5 | POST/WebSocket backlog only | Add CDN-cacheable GET cursor surface or document non-goal |
| Per-stream subscription cap | Phase 4.4 exit report | No per-stream subscriber cap | Add per-token/per-stream quota |
| Hot key-rotation of `AdmissionConfig.operatorAuthority` | Phase 4.2 exit report | Requires gateway reconstruction | Add safe rotation path or document reconstruction as operator action |
| Multi-bridge advisory reputation propagation | Phase 4.2 exit report | Future work | Treat as 4.6 unless only local bridge consumption is needed in 4.5 |
| `decideUserBlockTransport` gateway wiring | Bridge admission doctrine check #9 | Function exists in T&S; gateway wiring must be verified/added | Wire recipient context into admission gateway before forwarding |
| `canBridgeForwardReport` gateway wiring | Bridge admission doctrine check #10 | Function exists in T&S; gateway wiring must be verified/added | Wire structural report-forwarding guard without decrypting anything |

Phase 4.5 should be an implementation-plan doc before code begins. Suggested doc path:

```text
docs/implementation/phase-4.5-bridge-hardening-plan.md
```

## Phase 4.6 source-of-truth and ordering change

Phase 4.6 is **not** currently a named phase in the old ordering reference. It is a proposed pull-forward of the operator-policy subset that is safety-critical before bridge resumability/public discovery expands.

What should move into 4.6:

| Work | Existing source | Why pull forward |
|---|---|---|
| Operator policy-list subscriptions | Phase 1.62 foundation; bridge operator tools in T&S phase plan | Bridge/relay operators need policy inputs before public surfaces scale |
| Trusted labeler subscriptions for operators | Phase 1.66 foundation; labeler capabilities in Phase 1.69 | Needed for scoped infrastructure policy, media scanner labels, spam/malware labels |
| Advisory reputation feed consumption | Phase 4.2 deferral; bridge doctrine says advisory feeds are informational, not authoritative | Lets operators share abuse signals without creating global moderation |
| Scoped enforcement across surfaces | Bridge admission doctrine scope matrix | Relay/super-peer/public-index surfaces have different allowed scopes |
| Operator quarantine/review workflow | TransportAdmissionState already has quarantine infrastructure | Makes quarantine reviewable instead of invisible runtime state |

What should **not** move into 4.6:

- Full super-peer availability runtime from old Phase 15.
- Full persistent availability design.
- Full community governance or moderation-tools UI.
- Full appeal tooling beyond hooks/cross-references into Phase 1.67 moderation runtime.

Suggested doc path:

```text
docs/implementation/phase-4.6-operator-policy-runtime-plan.md
```

## Phase-by-phase reconciliation

### Phase 0 — Doctrine, repo discipline, ADRs

Status: **Partial**.

Verified foundation:

- Monorepo discipline, CI/lint/typecheck/test/build, ADR template, threat-model template, exit-report template, fixture policy.

Remaining work:

- Keep a single canonical roadmap updated after significant PRs.
- Require exit reports for every claimed phase completion.
- Keep phase-map/current-state synchronized with this roadmap.

Exit criteria:

- Every future phase PR updates one of: exit report, current-state, phase-map, or this roadmap.

### Phase 1 — Protocol primitives and canonical fixtures

Status: **Partial**.

Verified foundation:

- Signed/unsigned event envelopes, `SourceRef`, canonical JSON helper, validation helpers, protocol fixture discipline.

Remaining work:

- Continue expanding golden fixtures as event kinds are added.
- Maintain unknown-version and negative fixture policy for new protocol families.

### Phase 1.56 — Content addressing and object references

Status: **Foundation complete**.

Verified foundation:

- `@lfp2p/content-addressing` with `DigestRef`, `ContentLink`, `BlockRef`, `BundleRef`, `ObjectRef`, storage hints, redaction helpers, fixture suite, adversarial tests.

Remaining work:

- Application-specific object schemas.
- Storage adapters/runtime fetchers.
- Direct integration into later media/search/public index/runtime phases.
- BLAKE3 runtime only after ADR/dependency acceptance.

Safety integration:

- This is the basis for exact evidence refs, quarantine refs, media-safety verdict subjects, denylisted CIDs/digests, and public-search provenance.

### Phase 1.6–1.71 — Trust and safety foundation

Status: **Foundation complete** through the current intended scope.

Verified foundation:

- T&S protocol core.
- Local controls.
- Reports/appeals.
- Transport admission.
- Curation runtime.
- Labeler runtime.
- Moderation runtime.
- Content categories/capabilities/adult-content gate.
- PWA T&S settings.
- Block-evasion hardening.

Remaining work:

- Do not add duplicate T&S primitives.
- Move next work into runtime integration phases: bridge, relay/super-peer, media, public index, search, recommendation, chat UX.

Safety integration:

- Treat this stack as non-optional for every production ingress path.
- Public surfaces must reject private scopes.
- Hard-safety labels cannot be downgraded.
- Transport rejection remains infrastructure-scoped, not global deletion.

### Phase 1.8 — Reputation graph

Status: **Complete for current scope**.

Verified foundation:

- Reputation event validator.
- Local personalized EigenTrust/PageRank-style computer.
- Sybil-hardening helpers.
- Aggregator labeler integration.
- Admission-band modulation.
- Dexie persistence and PWA reputation UI.
- Sync-client inbound aggregator ingestion.
- First-class protocol reputation event kinds.
- Local-only default labeler registry.

Remaining work:

- Apply reputation as a runtime signal in later bridge, relay, stranger-contact, curation, search, and recommendation phases.
- Do not make reputation a global authority.

Safety integration:

- Use reputation for friction, rate limits, ranking, and warnings.
- Do not use reputation alone for irreversible enforcement.

### Phase 2 — Private/account-local payload runtime

Status: **Partial**.

Verified foundation:

- Recent merged PR #103 added `@lfp2p/private-payload` helpers.
- PR #108 addressed review findings for the private-payload work.

Remaining work:

- Promote helpers into a full private payload runtime contract.
- Add fixtures for encrypted/decrypted envelope behavior.
- Add metadata-minimization tests.
- Wire bridge log/privacy enforcement.
- Integrate with account-local sync.

Safety integration:

- Private payloads are a prerequisite for safe reports, encrypted evidence, DMs, groups, and account-local safety state.

### Phase 2.3 — Identity-control authority and proof registry

Status: **Partial/foundation**.

Verified foundation:

- Recent merged PRs #95–#104 added proof-registry persistence, proof auto-registration, PWA audit consumption, outbox gating, and contact-card publish gating.

Remaining work:

- Continue consolidating identity-control authority resolution as the source for capability-gated safety decisions.
- Ensure T&S authority checks consume proof registry state rather than trusting declared authority fields alone.

Safety integration:

- Safety authorities, labelers, moderators, media scanners, and bridge operators need proof-backed authority resolution.

### Phase 3 — MLS architecture and dependency decision

Status: **Complete as planning/docs**.

Verified foundation:

- ADR-012 and MLS group-keying doctrine.
- MLS provider boundary and dependency evaluation criteria.
- Phase 4 handoff requirement: implement signed MLS group-control records and deterministic projection; do not revisit whether MLS belongs in the architecture.

Remaining work:

- No runtime MLS dependency until provider tests and minimal fixtures are ready.

### Phase 4 — MLS group-control implementation

Status: **In progress**.

Verified foundation:

- Phase 4 implementation plan exists.
- Merged PR #106 added the Phase 4 plan.
- Merged PR #107 added group envelope validators.
- Merged PR #109 added first-class MLS group-control event kinds and envelope validation.
- Merged PR #110 added deterministic MLS group-control projection.

Remaining work:

- Add/update a Phase 4a exit report.
- Update `current-state.md` and `phase-map.md` to reflect PRs #109/#110.
- Implement Phase 4b: persistence, sync-client dispatch, and bridge E2E wiring.

Safety integration:

- Group-control records must reject stale epochs, revoked devices, wrong-recipient welcomes, scope widening, unsafe fork recovery, and replay.
- MLS-active groups must not downgrade back to Phase 2 private envelopes.

### Phase 4a — MLS group-control protocol records and deterministic projection

Status: **Foundation complete / cleanup needed**.

Verified foundation:

- First-class event kinds.
- Group-control validation.
- MLS application-message envelope validation.
- Deterministic projection package.

Remaining work:

- Documentation cleanup and exit-report alignment.
- Confirm `current-state.md` includes the MLS projection package and not just older bridge Phase 4 work.

### Phase 4b — MLS group-control persistence and sync/bridge wiring

Status: **Planned**.

Required deliverables:

- Add local-store persistence for MLS group-control projection state.
- Add sync-client inbound processing for MLS group-control event kinds.
- Ensure bridge delivery can carry MLS group-control records without becoming membership authority.
- Preserve deterministic projection rebuild from event logs.
- Add E2E tests: local emit → bridge → inbound sync → local projection.

Safety requirements:

- Admission checks before persistence.
- Signature verification before rate-limit burn.
- Reject downgrade from MLS-active groups to Phase 2 private envelopes.
- Ensure report/appeal/evidence flows can cite MLS group objects without leaking plaintext.

### Phase 4.5 — Bridge hardening follow-up from Phase 4 deferrals

Status: **Proposed pull-forward**.

Why this phase exists:

The old ordering reference placed bridge resumability hardening at Phase 5 and production bridge runtime at Phase 19. The Phase 4.2–4.4 exit reports show several security and abuse-resistance items that should happen before the project expands into broader resumability, chat, media, public discovery, or full-peer runtime. Phase 4.5 consolidates those existing deferrals into a single near-term implementation plan.

Required deliverables:

- Persistent per-token HTTP rate-limit buckets.
- Persistent token registry and hot rotation.
- Auth audit log with privacy-safe event classes.
- Persistent per-token streaming rate limit.
- Per-stream subscription cap.
- GET-with-cursor backlog read or explicit documented deferral.
- SSE / long-polling adapter decision or explicit documented deferral.
- Hot rotation path for `AdmissionConfig.operatorAuthority` or explicit reconstruction workflow.
- Wire `decideUserBlockTransport` into `BridgeAdmissionGateway` using recipient context.
- Wire `canBridgeForwardReport` into `BridgeAdmissionGateway` without decrypting report bodies/evidence.

Safety requirements:

- No bridge logs may echo payloads, tokens, private evidence, encryption key refs, or full digests.
- Bridge refusal remains local infrastructure self-protection, not global deletion.
- All ingress paths must pass admission before mutation.
- Rate-limit and auth state cannot reset to a fresh abuse budget on restart.

### Phase 4.6 — Operator policy runtime subset

Status: **Proposed pull-forward**.

Why this phase exists:

The old ordering reference keeps full super-peer availability in Phase 15. That remains correct. But a smaller operator-policy layer is needed earlier so bridge/relay/public-index operators can consume scoped policy feeds and labeler signals without hardcoding global authority or waiting for full super-peer runtime.

Required deliverables:

- Operator policy-list subscription runtime.
- Trusted labeler subscription runtime for bridge/relay/public-index operators.
- Advisory reputation feed consumption with explicit non-authoritative semantics.
- Operator-scoped allow/deny/quarantine/rate-limit decision persistence.
- Quarantine review surface or structured review log.
- Cross-reference hooks into Phase 1.67 moderation runtime, without implementing full moderation-tools UI.

Safety requirements:

- Operators can protect their infrastructure without becoming global moderators.
- Operator policy must be auditable and scoped.
- Policy-list resolution must not leak private local-control graphs.
- Advisory reputation feeds remain informational and locally weighted, never mandatory global truth.

### Phase 5 — Private messaging and encrypted mailbox foundation

Status: **Planned / blocked until Phase 2, 4b, and bridge privacy gates are complete**.

Required deliverables:

- Encrypted mailbox actor.
- DM send/receive runtime using private payload envelope.
- Group-message runtime using MLS envelope where group is MLS-active.
- Private report creation from DMs/groups.
- Encrypted evidence attachment flow.

Safety requirements:

- No plaintext private message payloads in bridge, mailbox, logs, search, curation, or public index.
- DMs and group messages must have local report/block/escalate paths.

### Phase 5.1 — First-contact, stranger-message, and minor-safety interaction barriers

Status: **Planned**.

This is a new explicit cross-cutting phase. It belongs after private payload foundations and before broad chat UX.

Required deliverables:

- Unknown-sender quarantine.
- Stranger DM friction.
- Contact-gated messaging defaults.
- No auto-download of media from unknown peers.
- Per-stranger first-contact warnings.
- Optional guardian/family safety mode as a local policy module, not a protocol backdoor.
- Local-only safety prompts for risky interaction patterns.
- Fast report/block/escalate UX from encrypted conversations.

Safety requirements:

- Preserve E2EE.
- Do not create silent server-side content access.
- Unknown adult-to-minor contact should be structurally difficult by default where age/minor mode is known or locally configured.
- Metadata/risk analysis must be privacy-bounded and explainable.

### Phase 6 — Media safety runtime before media replication

Status: **Planned / blocked before media manifests and replication**.

This is the most important new safety insertion.

Required deliverables:

- `docs/protocol/media-safety-runtime.md`.
- Fake-hash-provider test interface; no real illegal-material fixtures.
- Trusted hash-provider abstraction.
- Media scanner labeler integration using existing `media-scanner` labeler kind and `scan.media-csam` capability.
- Known-abuse verdict event shape or documented mapping to existing label/verdict primitives.
- Block-before-store/index/preview/relay gate.
- Quarantine workflow with object refs only.
- Encrypted evidence escrow shape.
- Lawful reporting handoff placeholder/interface.
- Audit-safe logs.
- Media scanner failure-mode policy: fail-closed for untrusted public distribution, fail-open only for local encrypted/private storage where policy allows.

Safety requirements:

- Do not persist or redistribute known-illegal material.
- Do not expose raw hash lists to untrusted clients.
- Use fake hashes and synthetic fixtures only in tests.
- Preserve exact object refs, decision provenance, and appealability where legally/operationally appropriate.

### Phase 7 — Public index/search/recommendation safety gates

Status: **Planned / blocked before public discovery**.

Required deliverables:

- Public-index ingest gate consuming:
  - content-addressing refs,
  - transport admission,
  - labelers,
  - local/reputation signals where applicable,
  - curation runtime,
  - media safety verdicts.
- Public-scope-only ingest.
- Denylisted object refusal.
- Private report exclusion from public ranking/search.
- Explanation records that avoid private-signal leakage.
- Search/recommendation exclusion distinct from deletion.

Safety requirements:

- Public search/recommendation must reject private scopes.
- Curation must downrank/exclude without pretending to be global deletion.
- Public discovery cannot bypass media safety verdicts.

## Immediate next implementation sequence

Based on the repo state and the corrected source-doc review, the next clean sequence is:

1. **Phase 4a cleanup**
   - Add/update Phase 4a exit report.
   - Update `current-state.md` and `phase-map.md` to reflect PRs #109/#110.

2. **Phase 4b**
   - Persist MLS group-control projection.
   - Wire sync-client inbound MLS group-control dispatch.
   - Add bridge E2E test for MLS group-control records.

3. **Phase 4.5 implementation plan**
   - Write `docs/implementation/phase-4.5-bridge-hardening-plan.md` using the Phase 4.2–4.4 deferral table above.

4. **Phase 4.5 build**
   - Start with persistent HTTP/streaming rate-limit state, token registry/hot rotation, and missing admission deferral wiring.

5. **Phase 4.6 implementation plan**
   - Write `docs/implementation/phase-4.6-operator-policy-runtime-plan.md` as a deliberate pull-forward from old Phase 8/15/19-adjacent work.

6. **Phase 5 / 5.1**
   - Private messaging/encrypted mailbox foundation, then first-contact safety before broad chat UX.

7. **Phase 6**
   - Media safety runtime.

8. **Phase 7**
   - Public index/search/recommendation safety gates.

Only after those should the project proceed into broad media replication, public social outbox, public discovery, recommendations, and full-peer expansion.

## New documents to add before implementation of the new safety runtime phases

Before Phase 5.1, Phase 6, and Phase 7 implementation PRs, add:

1. `docs/protocol/child-safety-architecture.md`
   - Threat model: grooming, sextortion, CSAM, harassment, unknown-sender abuse, coercion.
   - Constraints: preserve E2EE; no server-side plaintext access; no global surveillance authority.
   - Required controls: first-contact friction, unknown-sender quarantine, reporting, evidence, local prompts, guardian/family mode as local policy.

2. `docs/protocol/media-safety-runtime.md`
   - Scanner abstraction, fake-hash fixtures, verdicts, quarantine, evidence escrow, lawful handoff, audit logging.

3. `docs/protocol/trusted-safety-feed-protocol.md`
   - Labeler feeds, policy feeds, deny feeds, scanner feeds, revocation feeds, subscription/namespace trust.

4. `docs/protocol/safety-capability-model.md`
   - Capability taxonomy for scanning, classifying, reviewing, reporting, aggregating, and appeals.

## Non-negotiable safety gates

- Private payloads must not be logged.
- Bridges must verify signatures before admission/reputation mutation.
- Bridges/relays/super-peers enforce local infrastructure policy; they do not perform global deletion.
- Known-abuse media must be blocked before public relay/storage/index/preview.
- Public search/recommendation/feed surfaces must reject private scopes.
- Reputation is a friction/ranking/admission signal, not a sole irreversible enforcement authority.
- No external labeler, scanner, policy feed, or aggregator is trusted by default.
- Tests must use fake/synthetic media safety fixtures only.
