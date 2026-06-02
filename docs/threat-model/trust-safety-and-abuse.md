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
