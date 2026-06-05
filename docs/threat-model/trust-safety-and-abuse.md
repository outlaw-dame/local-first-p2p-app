# Threat Model: Trust, Safety, Moderation, and Curation

- Status: Draft
- Date: 2026-05-27
- Related ADRs:
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
  - `docs/adr/001-identity-control-log-v1.md`
  - `docs/adr/002-private-payload-encryption-envelope-v1.md`
  - `docs/adr/005-content-addressing-and-object-references-v1.md`
- Related protocol docs:
  - `docs/protocol/trust-safety-event-policy.md`
  - `docs/protocol/content-addressing.md`
- Owners: project maintainers

## Feature / surface

This threat model covers the trust and safety system for the local-first P2P/hybrid architecture.

The system includes:

- user-local controls,
- owner/admin/moderator/reviewer role handling,
- capability-backed authority checks,
- labeler and Tagger-agent subscriptions,
- safety annotations,
- reports and appeals,
- moderation queues,
- bridge/relay/super-peer admission decisions,
- media quarantine and scan state,
- curation/reach/search/recommendation controls,
- redacted safety audit logs,
- W3C Web Annotation interoperability projection,
- future Verifiable Credential and OCapN/UCAN-like authority inputs.

The system explicitly does not assume a single global moderator, global admin, or global deletion authority.

## Assets

What must be protected?

- Private payloads:
  - DMs,
  - group messages,
  - private media,
  - encrypted report bodies,
  - encrypted appeal bodies,
  - moderation evidence bundles,
  - private label preferences,
  - private curation preferences.
- Private keys:
  - local device signing keys,
  - controller/root identity keys,
  - future capability issuer keys,
  - future labeler/moderator/bot keys,
  - bridge/super-peer operator keys.
- Identity/control state:
  - owner/admin/moderator grants,
  - device authorization/revocation,
  - capability grants/revocations,
  - policy versions,
  - credential trust policy.
- Local database state:
  - mutes,
  - blocks,
  - hidden posts,
  - label preferences,
  - trust preferences,
  - report drafts,
  - appeal drafts,
  - moderation queue projections.
- Derived indexes:
  - safety labels,
  - curation decisions,
  - public search inclusion state,
  - recommendation exclusion state,
  - bridge quarantine indexes.
- Metadata:
  - subject refs,
  - object refs,
  - reason codes,
  - policy versions,
  - authority refs,
  - labeler subscriptions,
  - report routing,
  - bridge admission decisions.
- Availability:
  - ability to report abuse,
  - ability to appeal decisions,
  - ability to hide/mute/block locally,
  - bridge/relay/super-peer ability to protect itself from floods,
  - community ability to moderate shared spaces.

## Trust boundaries

List boundaries crossed by data or control:

- client/device boundary:
  - local user state,
  - local preferences,
  - private reports before encryption,
  - private evidence before encryption,
  - local-only curation decisions.
- bridge/server boundary:
  - bridge delivery envelopes,
  - admission decisions,
  - rate-limit decisions,
  - quarantine records,
  - encrypted report/evidence transport.
- peer/super-peer boundary:
  - replicated public content,
  - encrypted private envelopes,
  - content-addressed blocks,
  - public labels and policy lists,
  - super-peer storage/forwarding decisions.
- local storage boundary:
  - Dexie/IndexedDB projections,
  - future OPFS block store,
  - local search indexes,
  - private preference tables.
- service worker/cache boundary:
  - cached public assets,
  - cached public media,
  - offline UI state,
  - potential accidental private cache leakage.
- third-party API boundary:
  - future media scanning APIs,
  - future phishing/malware lookups,
  - future VC/credential status checks,
  - future external labeler subscriptions.

## Actors

- honest local user:
  - wants safety controls and privacy.
- honest remote peer:
  - sends valid signed content.
- abusive user:
  - sends harassment, spam, scams, malware, brigading, or illegal material.
- compromised bridge:
  - forges confirmations, leaks metadata, replays messages, drops reports, or applies wrong admission policy.
- malicious bridge/operator:
  - uses admission policy to censor, surveil, or misrepresent local decisions as global deletions.
- honest bridge/operator:
  - needs tools to protect infrastructure from spam, malware, and resource exhaustion.
- malicious peer:
  - floods labels/reports, spoofs metadata, replays events, or creates malformed content-addressed refs.
- revoked device:
  - attempts to continue publishing labels, reports, moderation decisions, or curation decisions.
- malicious labeler/Tagger agent:
  - publishes false labels, label spam, targeted suppression, or malicious curation tags.
- compromised labeler/Tagger agent:
  - previously trusted key starts issuing bad labels.
- malicious moderator/admin:
  - abuses community authority, hides critics, leaks reports, suppresses appeals.
- compromised moderator/admin device:
  - issues validly signed but unauthorized or unexpected decisions after revocation.
- reporter brigader:
  - mass-files reports to force moderation or harass targets.
- malicious public indexer:
  - indexes private/group content or ignores delete/quarantine/exclusion signals.
- malicious curator/recommender:
  - suppresses content while pretending ranking is neutral.
- network attacker:
  - observes timing/metadata, tampers with transport, blocks delivery, or replays old packets.
- compromised local device:
  - can access local plaintext and private keys; out of scope for full prevention but mitigations should reduce blast radius.

## Data flow

1. A user creates, receives, or syncs signed events and content-addressed objects.
2. Local policy applies user mutes, blocks, label preferences, and curation preferences.
3. Public or subscribed labelers/Tagger agents publish advisory labels/annotations.
4. Reports and appeals are created locally, optionally with encrypted body/evidence refs.
5. Communities/admins/moderators/reviewers/bots produce scoped policy decisions.
6. Bridges/relays/super-peers apply admission policy, rate limits, dedupe, and quarantine.
7. Public indexes/search/recommendation surfaces consume only public-safe objects and safety/curation decisions.
8. Audit records are stored with redacted identifiers and reason codes.

## Threats

| Threat | Impact | Existing mitigation | Missing mitigation | Test required |
|---|---|---|---|---|
| Forged label/report/decision | False moderation or curation state | Signed event foundation exists | Authority/capability validation, fixtures | Reject invalid signature/authority |
| Revoked moderator/bot continues acting | Unauthorized enforcement | Identity-control ADR exists | Projection checks for revocation before decisions | Revoked authority rejected |
| Label spam | Feed/search suppression or warning fatigue | None specific | Labeler trust policy, rate limits, local subscriptions | Unknown labeler labels ignored/downweighted |
| Report brigading | False enforcement and queue floods | None specific | Report rate limits, trust weighting, duplicate detection, triage queues | Report flood does not auto-enforce |
| Malicious Tagger agent | Targeted suppression or false tags | None specific | Advisory-by-default labels, capability checks for enforcement | Tagger output alone does not hide content |
| Bot over-enforcement | Automated false positives cause harm | None specific | Capability-bound automation, human review for high-impact decisions | Bot cannot issue high-impact action without capability |
| Admin ambient authority | Owner/admin can do too much or leak private data | None specific | Role-to-capability mapping, least-authority grants | Admin missing capability cannot access evidence |
| Bridge confused deputy | Bridge treats local policy as global deletion | Bridge-safe scopes exist | Admission decision scope rules | Bridge rejection not global deletion |
| Private report body leakage | Abuse evidence exposed to bridges/public | Private payload ADR exists | Encrypted report/evidence refs and log redaction | Report plaintext cannot enter public event |
| Private mute/block graph leakage | User safety preferences exposed | None specific | Local/self scope default, redacted sync | Mutes/blocks not sent to public/bridge analytics |
| Public index ingests private content | Severe privacy breach | None specific | Public-safe ingestion gates, scope validation | `dm`/`group` content rejected by public index fixtures |
| Curation masquerades as moderation | Hidden suppression without transparency | None specific | Curation explanation records, action separation | Downrank != hide/remove |
| Moderation masquerades as global deletion | Users misled about decentralized state | None specific | Scope labels, UI text, policy docs | Community removal not global deletion |
| Policy-list poisoning | Bridges/communities subscribe to malicious lists | None specific | Signed policy lists, issuer trust, versioning, revocation | Untrusted list ignored |
| Malicious media label | Safe media quarantined or unsafe media allowed | None specific | Trusted scanner/labeler policy, evidence refs | Scanner scope enforced |
| Resource exhaustion through reports | Queue/storage overload | Some bridge hardening | Rate limits, quotas, idempotency, duplicate collapse | Report flood bounded |
| Resource exhaustion through labels | Local DB/index bloat | None specific | label limits, trusted namespaces, pruning | Label flood bounded |
| Metadata leakage through object refs | Private content correlated by digest/CID | Content ADR planned | Privacy-aware dedupe and encrypted block rules | Private/public dedupe isolation |
| Appeal suppression | Users cannot challenge decisions | None specific | appealable flag, appeal routing, audit state | Appealable decision can be appealed |
| Malformed safety object | Parser crash or unsafe fallback | Protocol validation helpers exist | T&S validators and fixtures | Malformed object rejected predictably |
| Unsafe logging | Private evidence/preferences in logs | Some stated quality bar | redacted audit/log policy | Log tests assert no private plaintext |

## Logging and telemetry rules

- Private plaintext allowed in logs: No.
- Private keys allowed in logs: No.
- Raw report/evidence body allowed in logs: No.
- Private mute/block graph allowed in logs: No.
- Full private object refs allowed in logs: No unless local-only debug mode and explicitly redacted.
- Sensitive identifiers allowed in logs:
  - decision id,
  - reason code,
  - policy version,
  - redacted actor/object digest prefix,
  - scope,
  - action,
  - queue state.
- Redaction/hash policy:
  - prefer stable redacted ids only inside one operator boundary,
  - avoid cross-service correlation ids for private reports/preferences,
  - never log embedded credentials or full private URLs.
- User-visible error policy:
  - disclose the action and scope,
  - avoid exposing private evidence or reporter identity,
  - say whether a decision is local/community/bridge/index scoped,
  - say whether appeal is available.

## Required tests before beta

- [ ] Valid local mute/block/hide path.
- [ ] Invalid signature / forged label/report/decision.
- [ ] Stale/replayed report/decision.
- [ ] Duplicate report idempotency.
- [ ] Malformed safety object.
- [ ] Resource-exhaustion input for labels/reports.
- [ ] Privacy/logging assertion for reports/evidence/preferences.
- [ ] Revocation/permission change where applicable.
- [ ] Unknown labeler ignored by default.
- [ ] Trusted labeler subscription applies only trusted namespaces.
- [ ] Tagger agent labels remain advisory unless policy elevates them.
- [ ] Bot/moderator cannot perform actions outside capability scope.
- [ ] Bridge-local rejection cannot be read as global deletion.
- [ ] Community-local removal cannot delete account/global identity.
- [ ] Curation downrank cannot be presented as moderation removal.
- [ ] Public search rejects private scopes.
- [ ] Encrypted evidence cannot be routed to public label/search flows.

## Residual risk

Even after these mitigations:

- A compromised local device can expose local private state.
- Decentralized systems cannot guarantee global deletion of already replicated content.
- False positives and false negatives remain possible for human and automated moderation.
- Public content-addressed data can persist if replicated by peers outside our control.
- Some legal/compliance risks require operational policy beyond protocol mechanics.
- Users may misunderstand scoped actions unless UI communicates them clearly.
- Malicious clients can ignore advisory labels and community decisions outside controlled surfaces.

## Review notes

- This threat model must be reviewed before public social outbox, media manifests, public search, recommendation intelligence, or production bridge deployment.
- Updates are required when capability/credential authority docs are added.
- Updates are required when media manifests or bridge/super-peer admission code is implemented.

---

## Implementation update — Phase 1.62.1 through 1.67

This section documents threats and mitigations introduced by the
post-Phase-1.62 expansion, the Phase 1.64 deferral integrations,
the Phase 1.65 surface gate, the Phase 1.65 hardening pass, the
Phase 1.66 labeler runtime, and the Phase 1.67 moderation runtime.

### Phase 1.62.1 expansion (allowlist, semantic keywords, snapshot)

- **Allowlist abuse**: an attacker who can produce events as the
  user could allowlist a colluding actor to neutralize labels.
  Mitigation: the local-control allowlist only suppresses
  non-hard-safety labels; `SafetyLabelDefinition.hardSafety` labels
  remain applied. Phase 1.65 surface gate additionally prevents
  private subjects from being labeled into public surfaces.
- **Semantic-matcher injection / mismatched-model attack**: a
  malicious labeler could publish an embedding ref that was
  generated by a different model than the consumer expects.
  Mitigation: `safety.keyword.muted` carries `embeddingModel` as a
  required field on `semantic` match kinds; consumers refuse to
  invoke the matcher with mismatched model identifiers. The
  selector itself never compiles a regex and never loads a model;
  semantic match is a host-provided callback.
- **Snapshot replay rollback**: a stale snapshot replayed via
  out-of-order sync would erase newer preference state.
  Mitigation: `assertSnapshotIsNotStale` refuses to apply snapshots
  older than `state.snapshotAppliedAt`. Default import strategy is
  `union` which preserves local-only state.

### Phase 1.64 deferral integrations (user-block transport, report forwarding)

- **Bypass via transport layer**: an attacker forwards messages
  from a blocked producer through a less-controlled relay.
  Mitigation: `decideUserBlockTransport` runs at every transport
  surface the user's local-control state reaches.
- **Bridge decryption pressure**: under regulatory pressure, a
  bridge operator could be asked to inspect encrypted reports.
  Mitigation: `decideReportForwarding` runs the structural
  privacy check without decrypting anything; bridges MUST refuse
  to decrypt encrypted bodies as a non-negotiable rule per
  `docs/protocol/bridge-admission-doctrine.md`.

### Phase 1.65 surface gate

- **Public-feed cross-contamination**: a private DM whose subject
  is leaked into a public ranking signal would let observers
  infer the DM's contents.
  Mitigation: `decideCurationSurfaceIngest` rejects every
  non-public envelope scope on public surfaces. Private-by-nature
  subject types are rejected even when the envelope is public.
- **Private-only report as public signal**: a report about
  private content would identify that the private content
  exists.
  Mitigation: `decideReportAsCurationSignal` refuses to use a
  `private-only` report on public surfaces (Phase 1.63 deferral
  resolved here).

### Phase 1.65 hardening pass (prototype pollution)

- **Prototype pollution via reserved key**: an attacker submits
  events whose ids are `__proto__`, `constructor`, etc., hoping
  to mutate the JavaScript prototype chain at a projection
  record.
  Mitigation: two layers. `assertId` rejects reserved property
  names at the validator boundary (`TS_FORBIDDEN_KEY`). The
  shared `projection-helpers.ts` module uses
  `Object.defineProperty` with explicit data-descriptor flags so
  even a bypassed key lands as an own property, never invoking
  the prototype setter.

### Phase 1.66 labeler runtime (composable / stackable)

- **Cross-labeler revocation**: a malicious labeler tries to
  revoke a legitimate label issued by a different labeler.
  Mitigation: `safety.label.revoked` rejects revocations whose
  `revokedBy.actorId` does not match the original label's
  `issuer.actorId`. Cross-labeler disagreement is expressed by
  *issuing an opposing label*, never by revocation.
- **Aggregator trust-loop**: an aggregator declares itself as a
  source.
  Mitigation: validator rejects `aggregatorOf` containing the
  labeler's own id.
- **Stacking dominance**: a single high-volume labeler floods
  labels to dominate the stack.
  Mitigation: `effectiveLabelsForSubject` returns the full stack
  per (labelKey × issuing labeler); per-labeler `actionOverride`
  lets subscribers cap the action they accept from each labeler
  individually. The default `mostRestrictiveAction` combiner is
  documented; UIs are free to use other combiners (median,
  trusted-only, etc.).
- **Profile substitution**: a malicious actor publishes a profile
  with the same `labelerId` as a legitimate labeler.
  Mitigation: the projection trusts whichever profile was
  published most recently for a given `labelerId`. The signing
  identity behind the publish event is verified at the envelope
  layer — distinct labelerIds cannot collide as long as their
  controlling identities are distinct.

### Phase 1.67 moderation runtime

- **Retroactive policy erasure**: a malicious admin deprecates a
  policy to hide that decisions were made under it.
  Mitigation: deprecation does NOT remove past versions or
  decisions. `decisionsByPolicyId` indexes by the policy version
  string from the decision itself; the audit chain survives
  deprecation.
- **Queue starvation / DoS**: an attacker creates many queue
  items to overwhelm moderators.
  Mitigation: queue items are operator-scoped; a community queue
  is not a bridge queue. Each operator's moderation tools can
  apply rate-limit / quarantine via the Phase 1.64 transport
  admission engine before queue items are ever created.
- **Decision-without-policy injection**: a moderator submits a
  decision whose `policyVersion` references a non-existent
  policy.
  Mitigation: the projection records the decision but the
  `decisionsByPolicyId` lookup returns no policy record for an
  unrecognized version string — downstream consumers (trust-policy
  engine) can flag and refuse to honor.
- **Re-litigation laundering**: a moderator tries to re-open a
  resolved queue item to overturn a decision without an appeal.
  Mitigation: re-resolve is rejected at apply time; appeals go
  through Phase 1.63's `SafetyAppeal` lifecycle, not the queue.

### Phase 1.8 reputation graph (1.8.1 – 1.8.10)

The reputation graph track (see
`docs/protocol/reputation-graph-doctrine.md`) adds a graph-aware
per-user trust score that augments the existing per-peer / per-author
signals. Every attack class below has at least one pinned adversarial
test; the test name is cited in parentheses so a regression breaking
the mitigation surfaces immediately in the suite.

- **Sybil cluster (vanilla EigenTrust attack)**: an attacker spins
  up many fake accounts and has them mutually endorse each other
  with high satisfaction counts.
  Mitigation: personalized PageRank with a per-user seed vector
  (Phase 1.8.2). Sybils disconnected from the user's contact
  graph score ≈ zero regardless of internal endorsement volume.
  Pinned by `disconnected sybil cluster scores ~zero regardless of
  internal endorsements`
  (`reputation-graph-computer.test.ts`).

- **Weakly-connected sybil with foothold**: an attacker manages a
  single weak observation from the user into the sybil cluster
  and then uses internal high-volume endorsements to inflate
  reach.
  Mitigation: the weak foothold edge is non-attested (observation
  only) and gets multiplied by `pathQualityDamping`; the cluster's
  internal endorsements are also non-attested and dampened.
  Pinned by `sybil cluster connected via a single weak observation
  gets a much lower score than the connected real subject`
  (`reputation-graph-computer.test.ts`).

- **Feedback clique (closed mutual-endorsement ring)**: N accounts
  agree to rate each other maximally with no outbound trust to
  anyone else.
  Mitigation: closed-SCC detection via iterative Tarjan + per-
  member multiplicative `(1 / N)^cliquePenaltyExponent` (default
  exponent 0.5 → `1 / √N` per-member penalty).
  Pinned by `closed SCC of size 3 is penalized` +
  `SCC with an outbound edge to a non-member is NOT penalized`
  (`reputation-graph-sybil-hardening.test.ts`).

- **Community-structure / eigenvector-centrality attack**: an
  attacker positions a sybil near pre-trusted seeds to inherit
  centrality.
  Mitigation: path-quality damping multiplies non-attested edges
  by `pathQualityDamping` (default 0.7) BEFORE row normalization;
  multi-edge rows favor attested edges over observation-only ones.
  Pinned by `within an observer row with both attested + observation-only
  edges, attested gets more weight`
  (`reputation-graph-sybil-hardening.test.ts`).

- **Negative-valence shield**: an attacker tries to mask a path
  as "attested" by emitting a negative-valence attestation about
  the subject (which technically is an attestation event).
  Mitigation: only positive valence counts as "attested" for the
  damping shield. Negative + dispute attestations do NOT shield
  an edge from path damping.
  Pinned by `negative-valence attestations do NOT shield
  non-attestation damping`
  (`reputation-graph-sybil-hardening.test.ts`).

- **Trust laundering via short-lived hot accounts**: an attacker
  spins up an account, generates a burst of high-volume
  observations / interactions in a short window, then disposes
  of it (or the attacker's existing high-volume bursty behavior
  inflates trust faster than realistic engagement).
  Mitigation: time-bucket compression aggregates observations by
  `floor(windowEndMs / observationBucketMs)` (default 24 h) per
  `(observer, subject)` pair, then applies a `sqrt`-style concave
  compression per bucket. A single 10 000-burst contributes
  ~100 units; the same volume spread across 10 buckets contributes
  ~316 units — spread is rewarded > 3× over burst.
  Pinned by `a single 10_000-burst contributes less than 10 × 1000-spread`
  (`reputation-graph-sybil-hardening.test.ts`).

- **Fingerprint amplifier evasion / mimicry**: an attacker
  publishes a `contact.verified-in-person` attestation about a
  subject they have NOT actually verified out of band, hoping to
  earn the fingerprint amplifier.
  Mitigation: the doctrine treats `contact.verified-in-person`
  and `contact.long-term-correspondence` as the SIGNALS that
  trigger the amplifier, but the attestation itself is signed by
  the issuer's device — so a false claim only inflates the trust
  weight of edges the issuer themselves observes. Their
  downstream consumers (subscribers / inbound peers) must already
  trust the issuer for the amplifier to take effect. This is by
  design: the doctrine's "one signal an on-chain protocol cannot
  replicate" exists precisely because the trust comes from the
  real out-of-band human relationship, not the protocol-level
  flag.
  Pinned by `contact.verified-in-person attestation outweighs
  community.contributor of same strength` +
  `FINGERPRINT_VERIFIED_CONTEXT_TAGS includes the documented set + is frozen`
  (`reputation-graph-sybil-hardening.test.ts`).

- **Hostile aggregator publishing biased scores**: a subscribed
  reputation aggregator publishes scores designed to over- or
  under-rank specific subjects.
  Mitigation: doctrine non-negotiable LOCAL ALWAYS PRIORITY 0
  (Phase 1.8.4). For every subject in the user's local
  `LocalReputationState`, the local score wins regardless of the
  aggregator's opinion. Aggregator scores are also clamped to
  `[0, 1]` at the runtime boundary as defense-in-depth.
  Pinned by `a subject scored by the local computer takes the
  local score regardless of aggregator opinion` +
  `aggregator-published score outside [0, 1] is clamped`
  (`reputation-graph-aggregator-runtime.test.ts`).

- **Unsubscribed-labeler injection**: an attacker publishes
  reputation events under a labeler id the user has NOT
  subscribed to, attempting to influence the composed view.
  Mitigation: aggregator events from non-subscribed labelers are
  silently dropped at the runtime boundary; the user has not
  opted in.
  Pinned by `aggregator events from non-subscribed labelers are
  silently dropped`
  (`reputation-graph-aggregator-runtime.test.ts`).

- **Reserved-sentinel impersonation**: a labeler publishes under
  the reserved id `__local__`, attempting to claim the local
  source's privileged priority-0 slot.
  Mitigation: PWA subscription validator rejects the reserved
  sentinel outright; aggregator runtime treats any priority-0
  subscription as silently dropped (only the local computer owns
  that slot).
  Pinned by `LOCAL ALWAYS WINS: reserved sentinel labeler id is
  rejected outright` (`pwa-reputation-state.test.ts`) +
  `subscriptions with priority 0 are silently dropped`
  (`reputation-graph-aggregator-runtime.test.ts`).

- **Stale-removal weaponization**: an attacker emits a
  `reputation.aggregator.score.removed` event before any matching
  publish, hoping the runtime throws or misbehaves.
  Mitigation: stale removals (no matching candidate at apply
  time) are no-ops. The runtime fails open rather than throwing.
  Pinned by `a removal arriving BEFORE its publish is a stale no-op
  (fail open)` (`reputation-graph-aggregator-runtime.test.ts`).

- **Score-shape forgery**: a labeler publishes an aggregator
  event whose per-subject `score` or `confidence` is outside the
  documented `[0, 1]` range (NaN, negative, > 1) to manipulate
  composition.
  Mitigation: Phase 1.8.1 validator rejects out-of-range values
  at the protocol layer; defense-in-depth clamping at the runtime
  boundary catches anything that slips through.
  Pinned by `aggregator-published score outside [0, 1] is clamped`
  (`reputation-graph-aggregator-runtime.test.ts`).

- **Reputation graph privacy leak**: observations / attestations
  about other peers carry sensitive social-graph topology
  information.
  Mitigation: doctrine non-negotiable "default privacy =
  device-local" enforced structurally at the PWA emit layer
  (Phase 1.8.7). The helpers do NOT cross-publish; persisted
  events live in the local Dexie log only. A future cross-device
  sync flow is gated behind explicit user opt-in.
  Pinned by `DEVICE_LOCAL_PRIVACY_NOTICE — frozen content the UI
  MUST surface` (`pwa-reputation-state.test.ts`).

- **Replay equivalence regression (correctness, not malicious)**:
  any change to the reputation pipeline that causes two replays
  of the same event log to produce different scores would silently
  poison every consumer.
  Mitigation: pinned by `same input thrice produces three
  byte-identical states` +
  `hardening pipeline preserves byte-identical output across
  replays` (`reputation-graph-computer.test.ts` +
  `reputation-graph-sybil-hardening.test.ts`).
