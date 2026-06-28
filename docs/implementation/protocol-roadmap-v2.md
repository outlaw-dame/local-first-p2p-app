# Protocol Roadmap v2

- Status: Draft reconciliation roadmap
- Date: 2026-06-27
- Branch: `docs/protocol-roadmap-v2`
- Repository baseline checked: default branch `master`, recent merged PRs through Phase 4 MLS group-control projection work

## Purpose

This document reconciles the implementation doctrine, phase map, current-state document, recent merged PRs, and trust/safety phase documents into one working roadmap.

It does not replace detailed ADRs, protocol doctrine, or exit reports. It is the planning layer that shows what is complete, what is partial, what is blocked, and where cross-cutting safety work belongs.

The roadmap follows these rules:

1. Do not duplicate protocol primitives that already exist.
2. Treat trust/safety, child safety, media safety, abuse prevention, and content curation as cross-cutting runtime gates, not a late dashboard.
3. Keep bridges, relays, super-peers, mailboxes, Holepunch/Pear, Hypercore/Corestore, and WebRTC as delivery/runtime layers, not protocol authorities.
4. Keep private payloads encrypted and preserve bridge log privacy.
5. Do not allow public search, recommendation, media replication, or public social outbox work to bypass trust/safety and content-addressing gates.

## Verified source documents

This roadmap was reconciled against:

- `docs/implementation/phase-map.md`
- `docs/implementation/current-state.md`
- `docs/implementation/next-development-path.md`
- `docs/implementation/trust-safety-phase-plan.md`
- `docs/implementation/phase-3-mls-implementation-plan.md`
- `docs/implementation/phase-4-mls-group-control-implementation-plan.md`
- recent merged PRs #95 through #110, especially #103 through #110 for private payload and Phase 4 MLS work

Branch search for `phase` / `phase-4` returned no matching active branches, so this roadmap treats the default branch and merged PR history as the implementation baseline.

## Status legend

- **Complete**: implementation and tests are present for the current intended scope.
- **Foundation complete**: protocol/package/projection foundation exists, but downstream runtime/UI/network integration remains.
- **Partial**: meaningful work exists but the phase is not complete.
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
| 4a | Mostly complete | MLS group-control protocol records and deterministic projection | Latest merged work; continue with Phase 4b persistence/wiring |
| 4b | Planned | MLS group-control persistence and bridge/sync wiring | Safety checks must run before forwarding/storing group records |
| 4.5 | Planned | Production bridge runtime hardening | New runtime gate for production bridge deployment |
| 4.6 | Planned | Relay/super-peer operator policy runtime | New operator-safety integration phase |
| 5 | Planned/blocked | Private messaging and encrypted mailbox foundation | Must include first-contact/stranger safety before chat UX |
| 6 | Planned/blocked | Media safety runtime before media replication | New known-abuse/media-scanner/quarantine phase |
| 7 | Planned/blocked | Public index/search/recommendation safety gates | Public discovery cannot ingest private/unsafe objects |
| 8+ | Planned/blocked | Media, social outbox, semantic discovery, recommendations, full-peer work | Only after runtime gates are active |

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

### Phase 4a — MLS group-control protocol records and deterministic projection

Status: **Mostly complete / latest active implementation area**.

Verified foundation:

- PR #106 added Phase 4 MLS group-control plan.
- PR #107 added group envelope validators.
- PR #109 added first-class MLS group-control event kinds and envelope validation.
- PR #110 added deterministic MLS group-control projection package.

Remaining work:

- Verify phase-map/current-state reflects PRs #109/#110; `current-state.md` may be stale because it still references an older baseline.
- Add a Phase 4a exit report if not already present.
- Ensure group-control projection package is listed in current-state.

Safety integration:

- Group-control records must reject stale epochs, revoked devices, wrong-recipient welcomes, scope widening, forked state, and replay.

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

### Phase 4.5 — Production bridge runtime hardening

Status: **Planned**.

Why this phase exists:

Current bridge primitives and Phase 4.1–4.4 are strong, but `current-state.md` still lists production server runtime, persistent streaming rate limits, token rotation, mTLS/OAuth/JWT, encrypted mailbox actor, full P2P bridge integration, public index service, and production observability/log privacy as not implemented.

Required deliverables:

- Production HTTP/WebSocket runtime binding.
- Persistent token registry and hot rotation.
- Persistent per-token streaming rate limit.
- GET-with-cursor backlog read or documented alternative.
- SSE/long-polling fallback or explicit non-goal.
- mTLS/OAuth2/JWT auth adapters as optional runtime modules.
- Production log privacy and metrics policy.
- Durable admission audit persistence.
- DLQ/quarantine review surface.

Safety requirements:

- No bridge logs may echo payloads, tokens, private evidence, encryption key refs, or full digests.
- Bridge refusal remains local infrastructure self-protection, not global deletion.
- All ingress paths must pass admission before mutation.

### Phase 4.6 — Relay/super-peer operator policy runtime

Status: **Planned**.

Required deliverables:

- Operator policy-list subscription runtime.
- Trusted labeler subscription runtime for relay/super-peer operators.
- Operator-scoped allow/deny/quarantine/rate-limit decisions.
- Multi-bridge advisory reputation propagation.
- Durable operator audit logs.
- Operator appeal/review hooks.

Safety requirements:

- Operators can protect their infrastructure without becoming global moderators.
- Operator policy must be auditable and scoped.
- Policy-list resolution must not leak private local-control graphs.

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

### Phase 8 — Media manifests, replication, and block-store adapters

Status: **Planned / blocked until Phase 6**.

Required deliverables:

- Media manifests using `BlockRef` / `ObjectRef`.
- Block-store adapters.
- Replication policy.
- Preview generation policy.
- Safe import/export.

Safety requirements:

- Every media object passes media-safety runtime before public relay/index/preview.
- Private media requires encryption descriptors.
- Compression bomb and decoded-size guards remain active.

### Phase 9 — Public social outbox and public object publishing

Status: **Planned / blocked until Phase 4.5, 4.6, 6, and 7**.

Required deliverables:

- Public post/note/reply/repost/reaction object schemas.
- Public outbox worker.
- Capability-gated publishing.
- Labeler/curation/reputation hooks before public fanout.

Safety requirements:

- Public outbox must fail closed on malformed payload, missing capability, unsafe media, private scope, or hard-safety denial.

### Phase 10 — Naming and namespace UX

Status: **Planned**.

Required deliverables:

- Name-proof UI.
- Human-readable identifier proofs.
- Anti-phishing display rules.

Safety requirements:

- Names are convenience proofs, not authority by themselves.
- Fingerprint and identity-control state remain primary.

### Phase 11 — Accessibility and signed annotations implementation

Status: **Planned / docs foundation exists**.

Verified foundation:

- ADR-011 and annotation coexistence doctrine from PR #102.

Required deliverables:

- Protocol-native accessibility metadata shapes.
- Signed annotation implementation.
- Clear coexistence rules between client annotations and labelers.

Safety requirements:

- Client-side annotations must not masquerade as labeler/moderation authority.
- Labeler annotations must not overwrite private local annotations without user choice.

### Phase 12 — Semantic discovery doctrine to runtime

Status: **Planned / docs foundation exists**.

Verified foundation:

- Semantic discovery roadmap/docs from PRs #96/#98.

Required deliverables:

- Local-first semantic index contract.
- Public discovery gate consumption from Phase 7.
- Privacy-preserving local embeddings path.

Safety requirements:

- Semantic search must not index private scopes into public surfaces.
- Reputation/labeler/curation gates apply before ranking.

### Phase 13 — Persistent full-peer / local-first storage adapters

Status: **Planned**.

Required deliverables:

- OPFS/IndexedDB/native block-store adapters.
- Hypercore-compatible adapter boundary.
- Content-addressed bundle fetchers.

Safety requirements:

- Storage adapters enforce private encryption descriptors.
- Known unsafe public media cannot be silently cached for redistribution.

### Phase 14 — Holepunch/Pear transport adapter

Status: **Planned**.

Required deliverables:

- Holepunch/Pear transport adapter.
- Noise/session transport integration.
- DHT/topic discovery constrained by protocol policy.

Safety requirements:

- Discovery does not bypass admission, reputation, local controls, or media safety.
- Peer exchange does not override user blocks/quarantine.

### Phase 15 — Hypercore/Corestore substrate adapter

Status: **Planned**.

Required deliverables:

- Hypercore/Corestore persistence/replication adapter.
- Feed/key management boundary.
- Event-log replay compatibility.

Safety requirements:

- Hypercore feed replication must preserve T&S gates and object privacy.
- Feed possession is not trust authority.

### Phase 16 — WebRTC DataChannel runtime

Status: **Planned**.

Required deliverables:

- WebRTC DataChannel transport.
- ICE/STUN/TURN boundary.
- Group/media transfer policy.

Safety requirements:

- WebRTC transfer still passes admission and local controls.
- Unknown peer media auto-download remains disabled unless policy allows.

### Phase 17 — Encrypted group chat UX

Status: **Planned / blocked until Phase 4b and Phase 5**.

Required deliverables:

- MLS-backed group chat UX.
- Membership/fork diagnostics.
- Group report/block/leave flows.

Safety requirements:

- Group state must reject stale/revoked/forked unsafe epochs.
- Reports can cite group objects without leaking plaintext.

### Phase 18 — Communities / governance runtime

Status: **Planned**.

Required deliverables:

- Community authority model.
- Community-scoped policies.
- Moderator queue tooling.
- Community labeler/policy subscriptions.

Safety requirements:

- Community governance is scoped; it is not global protocol authority.
- Appeals and audit trails are required for high-impact decisions.

### Phase 19 — Labeler discovery and hosting

Status: **Planned**.

Required deliverables:

- Labeler profile hosting API.
- Label definition publication.
- Subscription discovery UX.
- Overlap warnings surfaced to users/operators.

Safety requirements:

- No default global labeler authority.
- Users/operators explicitly choose labelers and namespaces.

### Phase 20 — Moderation tools UI/API

Status: **Planned**.

Required deliverables:

- Moderation queue UI/API.
- Report acknowledgement/resolution tooling.
- Appeal resolution tooling.
- Policy version management.

Safety requirements:

- Decisions are signed, scoped, appealable where appropriate, and tied to policy versions.

### Phase 21 — Public feed generation

Status: **Planned / blocked until Phase 7**.

Required deliverables:

- Feed generation runtime.
- Curation/reputation/labeler integration.
- Explanation records.

Safety requirements:

- Feed grouping is not moderation.
- Feed inclusion is subject to public-scope and media-safety gates.

### Phase 22 — Recommendation runtime

Status: **Planned / blocked until Phase 7**.

Required deliverables:

- Candidate generation.
- Local/private profile safety.
- Curation and labeler gates.

Safety requirements:

- Private user controls and private reports cannot leak into public explanation surfaces.

### Phase 23 — Cross-protocol public import/export

Status: **Planned / blocked**.

Required deliverables:

- Import adapter contracts.
- Export adapter contracts.
- Cross-protocol object mapping.

Safety requirements:

- Imported labels/annotations must pass local validation and trust policy before affecting UI, moderation, or curation.
- No imported protocol becomes authority by default.

### Phase 24 — Native/full-peer packaging

Status: **Planned**.

Required deliverables:

- Native runtime adapters.
- Secure key storage.
- Background sync policy.

Safety requirements:

- Native/full-peer behavior must match protocol objects and gates used by PWA/light peers.

### Phase 25 — Observability, audits, and deployment profiles

Status: **Planned**.

Required deliverables:

- Production deployment profiles.
- Audit export format.
- Privacy-preserving metrics.
- Incident-review hooks.

Safety requirements:

- Logs and metrics must not become surveillance side channels.

### Phase 26 — Abuse-resilience drills and red-team fixture suite

Status: **Planned**.

Required deliverables:

- Adversarial fixture suite across identity, bridge, MLS, media, search, recommendation, and moderation.
- Replay/staleness/fork tests.
- Sockpuppet/coordinated-brigading simulations.
- Media-safety fake-hash drill.

Safety requirements:

- Every high-risk production surface has explicit adversarial tests before launch.

### Phase 27 — Public beta readiness gate

Status: **Planned**.

Required deliverables:

- Final phase-map/current-state reconciliation.
- All exit reports complete.
- Known blocked/non-goal list.
- Deployment checklist.
- Safety readiness checklist.

Safety requirements:

- No public beta unless private payload, bridge admission, media safety, public discovery gates, reports/appeals, labeler subscriptions, local controls, and audit logging are active.

## Immediate next implementation sequence

Based on the repo state and recent merged PRs, the next clean sequence is:

1. **Phase 4a cleanup**
   - Add/update Phase 4a exit report.
   - Update `current-state.md` and `phase-map.md` to reflect PRs #109/#110.

2. **Phase 4b**
   - Persist MLS group-control projection.
   - Wire sync-client inbound MLS group-control dispatch.
   - Add bridge E2E test for MLS group-control records.

3. **Phase 4.5**
   - Production bridge runtime hardening.

4. **Phase 4.6**
   - Relay/super-peer operator policy runtime.

5. **Phase 5**
   - Private messaging/encrypted mailbox foundation.

6. **Phase 5.1**
   - First-contact, stranger-message, and minor-safety interaction barriers.

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
