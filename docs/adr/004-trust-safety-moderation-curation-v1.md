# ADR-004: Trust, Safety, Moderation, and Curation v1

- Status: Proposed
- Date: 2026-05-27
- Deciders: Damon / project maintainers
- Related docs:
  - `docs/implementation/trust-safety-readiness-plan.md`
  - `docs/protocol/trust-safety-event-policy.md`
  - `docs/threat-model/trust-safety-and-abuse.md`
  - `docs/adr/001-identity-control-log-v1.md`
  - `docs/adr/002-private-payload-encryption-envelope-v1.md`
  - `docs/adr/003-sync-offsets-and-cursors-v1.md`
  - `docs/adr/005-content-addressing-and-object-references-v1.md`
- Related PRs: TBD

## Context

The repository is a local-first P2P/hybrid product monorepo. The current implementation is a PWA light peer with signed events, local storage, identity bootstrap, bridge delivery primitives, and sync hardening. The project has not yet implemented production chat, MLS, media manifests, public social outbox, naming/discovery, public search, semantic recommendation intelligence, or production bridge deployment.

Trust and safety must be designed before those surfaces become user-facing. It cannot be added later as only a moderation dashboard or UI overlay. In this architecture, trust and safety affects:

- what the local client displays,
- what a local feed or search surface ranks or excludes,
- what a bridge accepts, rejects, rate-limits, or quarantines,
- what a relay or super-peer stores, forwards, deduplicates, or refuses,
- what a public index stores or omits,
- how user-local preferences remain private,
- how reports, appeals, and evidence are routed,
- how community rules differ from global network claims,
- how content-addressed objects, media, and bundles are scanned or quarantined,
- how future full-peer and cross-protocol adapters preserve safety semantics without pretending there is one global authority.

The project should borrow from ATProto's composable moderation model, Nostr's lightweight labels/reports and Tagger-bot pattern, Matrix-style policy-list subscription and moderation tooling, W3C Web Annotation for portable annotation shape, object capabilities for scoped authority, and Verifiable Credentials for portable claims. None of those should be copied blindly. This system needs a model tailored to local-first PWA, bridge-assisted sync, future full peers, and privacy-preserving user-owned state.

External reference anchors:

- ATProto labels and moderation: https://atproto.com/specs/label and https://docs.bsky.app/docs/advanced-guides/moderation
- Nostr NIP-32 labeling: https://github.com/nostr-protocol/nips/blob/master/32.md
- Nostr NIP-56 reporting: https://github.com/nostr-protocol/nips/blob/master/56.md
- W3C Web Annotation Data Model: https://www.w3.org/TR/annotation-model/
- Nos Social Tagger/Tagr references: `planetary-social/nos` issues `#936`, `#1119`, `#1448`, and PR `#1475`

## Decision

Adopt a layered trust and safety architecture:

1. **Product roles** remain user-facing and familiar.
   - Owner/founder, admin, moderator, reviewer, bot, labeler, curator, bridge operator, relay operator, and super-peer operator are valid product concepts.
   - The protocol must not treat `admin` as an unbounded magic permission.
   - Product roles resolve to explicit capability bundles, policy scopes, and audit requirements.

2. **Capabilities decide authority.**
   - A T&S decision is valid only if the issuer has authority for the action, subject, resource, scope, and policy version.
   - Capability-bound authority is the internal model for community admins, moderators, bots, labelers, curators, scanners, and bridge admission agents.
   - Capability design is refined separately by the future capability/credential authority model, but T&S objects must reserve fields for capability proofs.

3. **Credentials and issuer trust are advisory inputs.**
   - Verifiable Credentials can attest that a labeler, scanner, moderator, bridge, curator, or organization has a claim from an issuer.
   - A valid credential is not proof that a claim is true or that the local user should rely on it.
   - Local policy decides which issuers are trusted for which claim types and scopes.

4. **Annotations and labels are advisory by default.**
   - A labeler/Tagger agent may publish signed labels, annotations, reports, or curation tags.
   - Labels do not enforce themselves.
   - Enforcement requires local policy, trusted issuer/labeler configuration, capability proof where applicable, and scope-specific policy decision logic.

5. **Policy decisions are separate from labels.**
   - A label says something about a subject.
   - A report asks an authority to review a subject.
   - A policy decision records an authority's action under a policy.
   - A transport admission decision records infrastructure self-protection.
   - A curation decision records reach/ranking/search/feed behavior.

6. **Moderation and curation remain separate.**
   - Moderation controls warning, blurring, hiding, quarantine, local removal, community removal, rejection, escalation, and appeals.
   - Curation controls ranking, grouping, recommendation, search eligibility, feed inclusion, downranking, topic classification, duplicate suppression, and explanation records.
   - A curation downrank must not masquerade as a moderation removal.
   - A moderation hide must not masquerade as a global delete.

7. **Bridge/relay/super-peer self-protection is first-class.**
   - Infrastructure operators may reject, quarantine, rate-limit, or decline to replicate content according to local policy.
   - Those actions are scoped to the infrastructure surface unless explicitly represented as advisory labels.
   - A bridge-local rejection is not a global deletion.
   - A relay/super-peer refusal is not a claim that other peers must refuse.

8. **Local user controls are private by default.**
   - User mutes, hides, keyword filters, label preferences, feed preferences, trust preferences, and most curation weights are `device-local` or `self` scope by default.
   - Blocks may have transport implications, but private block graphs must not be leaked by default.
   - User-local state must not become bridge analytics or public label streams.

9. **W3C Web Annotation is an interoperability projection, not the enforcement model.**
   - The canonical protocol objects are signed event envelopes with explicit authority, scope, policy version, subject refs, reason codes, and appealability.
   - W3C Web Annotation can be generated from safety annotations for interoperability, export, import, and external tooling.
   - Raw Web Annotation JSON-LD is not sufficient to prove authority or enforce policy.

10. **Tagger agents are supported as a first-class pattern.**
    - A Tagger agent may be a bot, human-operated service, community account, bridge-local scanner, media scanner, curator, or hybrid human/AI review system.
    - Tagger output is advisory unless explicitly bound to a community, bridge, relay, index, or user-local policy.
    - Automated Tagger actions with high-impact consequences require explicit capability and audit support.

## Scope

This decision applies to:

- protocol objects:
  - safety annotations,
  - labels,
  - label definitions,
  - labeler profiles,
  - labeler subscriptions,
  - reports,
  - appeals,
  - policy decisions,
  - transport admission decisions,
  - curation rules,
  - curation explanations,
  - moderation queue items,
  - quarantine records.
- storage schemas:
  - local user controls,
  - local T&S projections,
  - bridge-local quarantine/admission projections,
  - future public index/search/recommendation exclusion state.
- runtime adapters:
  - PWA local enforcement,
  - bridge admission and abuse controls,
  - future relay/super-peer admission,
  - future full-peer replication,
  - future cross-protocol adapters.
- security/privacy boundaries:
  - private preferences,
  - encrypted reports/evidence,
  - bridge log redaction,
  - capability checks,
  - issuer trust policy.
- tests/fixtures:
  - valid and invalid safety objects,
  - scope misrouting,
  - private state leakage,
  - malformed labels/reports,
  - bridge-local rejection vs global deletion.

This decision does not apply to:

- implementing production moderation automation immediately,
- implementing ML classifiers immediately,
- implementing public labeler hosting immediately,
- implementing full W3C Web Annotation import/export immediately,
- implementing legal compliance workflows beyond reserving policy hooks,
- requiring all communities to use the same policies,
- requiring a global source of moderation truth.

## Options considered

### Option A: Centralized moderation service

A central service reviews reports, applies global labels, bans accounts, and publishes takedowns.

Pros:

- Easier to explain.
- Easier to implement first.
- Familiar from centralized platforms.

Cons:

- Conflicts with local-first and P2P goals.
- Creates a single moderation authority and single abuse target.
- Does not map cleanly to user-local controls, communities, bridges, relays, super-peers, or full peers.
- Encourages false global-deletion semantics.
- Creates high privacy risk for reports, evidence, and user preference graphs.

### Option B: Purely local-only moderation

Every user handles all moderation locally through mutes, blocks, and filters.

Pros:

- Strong user autonomy.
- Avoids centralized enforcement.
- Easy to keep preferences private.

Cons:

- Fails to protect bridge/relay/super-peer operators.
- Does not handle community governance.
- Does not handle media abuse, malware, spam floods, brigading, or illegal content risk.
- Burdens users with too much review work.
- Makes shared spaces fragile.

### Option C: Composable, scoped, local-first trust and safety

Use local controls, community policy, bridge/relay/super-peer admission policy, signed labels/annotations, capability-bound authority, issuer trust policy, reports/appeals, and curation explanations.

Pros:

- Matches architecture.
- Lets users subscribe to trusted labels without surrendering local policy.
- Lets communities have admins/moderators without global ambient authority.
- Lets infrastructure protect itself.
- Keeps moderation, curation, transport, search, and storage decisions separate.
- Supports future full-peer and cross-protocol adapters.

Cons:

- More complex.
- Requires careful protocol fixtures and validation.
- Requires strong UI explanations so users understand which authority acted.
- Requires privacy discipline around reports, evidence, and local preferences.

## Consequences

Positive consequences:

- Communities can have familiar roles without unsafe global authority.
- Labelers/Tagger agents can be human, automated, service-run, bridge-run, or community-run.
- Users can choose labelers/curators while retaining final local policy control.
- Bridges, relays, and super-peers get explicit self-protection tools.
- Media, search, recommendation, and public social outbox work will have safety gates before implementation.
- Future cross-protocol bridges can map labels/reports/annotations without conflating them with enforcement.

Negative consequences / tradeoffs:

- More objects and projection tables must be designed before feature work.
- Implementers must understand role/capability/policy/decision separation.
- UI must explain authority and scope or users will confuse local hiding with global deletion.
- Automatic moderation must be conservative to avoid label spam, report brigading, and bot-driven suppression.

## Security and privacy impact

- Private data affected:
  - user mutes/blocks/hides,
  - local label preferences,
  - report bodies,
  - appeal bodies,
  - evidence bundles,
  - trust preferences,
  - curation weights.
- Metadata exposed:
  - subject refs,
  - label values,
  - policy version refs,
  - reason codes,
  - authority refs,
  - transport admission state,
  - redacted audit identifiers.
- New trust assumptions:
  - users may trust labelers/curators for specific scopes,
  - communities may trust admins/moderators/bots for scoped actions,
  - bridges may trust security labelers or media scanners for admission decisions,
  - indexes may trust exclusion/downrank labels for public surfaces.
- Abuse/failure modes:
  - label spam,
  - report brigading,
  - malicious labelers,
  - compromised moderator/admin devices,
  - bot-driven over-enforcement,
  - policy-list poisoning,
  - bridge confused-deputy behavior,
  - private preference leakage,
  - global-deletion misrepresentation,
  - curation suppression hidden as neutral ranking.
- Required tests:
  - invalid labels rejected,
  - invalid authorities rejected,
  - invalid scopes rejected,
  - missing policy version rejected for policy decisions,
  - local mutes/blocks private by default,
  - bridge-local rejection not treated as global deletion,
  - curation downrank not treated as moderation hide,
  - private reports/evidence cannot enter public search/curation flows,
  - malformed safety objects fail closed.

## Migration and compatibility

- Existing code affected:
  - `packages/protocol` for event kind reservation and subject refs,
  - `packages/local-store` for local projections,
  - `apps/bridge-service` for admission/quarantine/rate limit objects,
  - `packages/sync-client` for routing and private/public flow restrictions,
  - future `packages/trust-safety` for pure protocol validation.
- Storage migration needed:
  - none for this ADR alone.
  - future implementation will require versioned local-store tables.
- Fixture updates needed:
  - valid/invalid safety annotation fixtures,
  - valid/invalid label fixtures,
  - valid/invalid report fixtures,
  - valid/invalid policy decision fixtures,
  - valid/invalid bridge admission fixtures,
  - private-scope misrouting fixtures.
- Full-peer compatibility notes:
  - full peers must be able to evaluate the same safety objects locally,
  - full peers must not rely on one bridge as the source of truth,
  - full peers may maintain their own admission/quarantine policy,
  - Hypercore/Bare or other full-peer storage adapters must preserve signed event semantics and content object references.

## Exit criteria

This ADR is implemented when:

- [ ] `docs/protocol/trust-safety-event-policy.md` exists.
- [ ] `docs/threat-model/trust-safety-and-abuse.md` exists.
- [ ] `packages/trust-safety` exists as a pure protocol package.
- [ ] Valid and invalid fixtures exist for labels, reports, policy decisions, and transport admission decisions.
- [ ] Tests cover malformed safety objects, invalid authority, invalid scope, and unsafe private/public routing.
- [ ] Local user controls are implemented before networked moderation queues.
- [ ] Reports/appeals require private payload/evidence routing rules before bridge transport.
- [ ] Bridge/relay/super-peer admission policy is separated from global deletion semantics.
- [ ] Curation/reach controls remain separate from moderation enforcement.
- [ ] Documentation explains owner/admin/moderator/bot/labeler/curator roles as product concepts backed by scoped capabilities.
