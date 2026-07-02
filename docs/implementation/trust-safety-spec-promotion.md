# Trust & Safety → Protocol Specification Promotion

- Status: Draft
- Date: 2026-06-30
- Scope: promote the existing trust-and-safety stack into the newer social, availability, security, and profile specification model
- Related implementation:
  - `packages/trust-safety`
  - `docs/implementation/trust-safety-complete-summary.md`
  - `docs/protocol/trust-safety-event-policy.md`
  - `docs/protocol/local-controls-portability.md`
  - `docs/protocol/bridge-admission-doctrine.md`
  - `docs/protocol/curation-doctrine.md`
  - `docs/protocol/labeler-runtime-doctrine.md`
  - `docs/protocol/moderation-runtime-doctrine.md`
  - `docs/protocol/reputation-graph-doctrine.md`
- Related specifications:
  - `docs/specification/06-social/`
  - future `docs/specification/07-availability/`
  - future `docs/specification/08-security/`
  - future `docs/specification/09-profiles/`

## Purpose

The trust-and-safety stack is one of the most complete older implementation slices in the repository. It includes local controls, reports and appeals, admission policy, curation and reach controls, labeler runtime, moderation runtime, and reputation graph work.

This document promotes that stack into the newer specification model so the implemented package remains first-class and does not remain anchored only to older doctrine docs.

## Current implemented slice

The existing stack includes:

- top-level safety object shapes and validators;
- local user controls and visibility decisions;
- reports, appeals, and evidence references;
- bridge/relay/super-peer admission decision logic;
- curation and reach projection logic;
- composable labeler runtime;
- moderation queue and decision lifecycle;
- reputation graph primitives and downstream integration notes.

## Specification mapping

| Existing area       | Specification owner                                                                | Promotion rule                                                                                |
| ------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Local controls      | `06-social/local-controls.md`                                                      | User controls are user-owned social preference state, not provider policy.                    |
| Reports and appeals | `06-social/reports-and-appeals.md`                                                 | Report lifecycle is social/safety state with privacy and evidence boundaries.                 |
| Labels / labelers   | `06-social/moderation-labels.md`                                                   | Labels are composable signals; they do not override local controls unless policy says so.     |
| Curation / reach    | `06-social/curation-and-reach.md`                                                  | Ranking, reach, and exclusion are separate from transport admission and deletion.             |
| Transport admission | `07-availability/transport-admission.md`                                           | Bridge/relay/super-peer admission is provider-local unless explicit capability grants more.   |
| Reputation graph    | `07-availability/advisory-reputation.md` and `09-profiles/trust-safety-profile.md` | Reputation can inform local/provider decisions but must not become global protocol authority. |
| Moderation runtime  | `06-social/moderation-runtime.md` and `09-profiles/trust-safety-profile.md`        | Queue and decision lifecycles need profile-level conformance rules.                           |

## Required doctrine boundaries

### Local controls outrank remote signals

User-level blocks, mutes, filters, and visibility preferences are local user policy. Labeler and provider signals may inform them, but must not silently override them.

### Labels are signals, not universal truth

A label can represent a provider, labeler, moderator, or user assessment. It must carry source and scope. It must not be treated as a universal protocol fact.

### Admission is provider-local

Bridge, relay, super-peer, and public-index admission decisions apply to that availability surface. They do not delete content, revoke identity, or define global validity.

### Reports are privacy-sensitive

Reports and appeals can expose private context, social graph information, safety preferences, and evidence references. They require careful visibility and storage boundaries.

### Curation is not moderation enforcement

Ranking and reach controls may hide, downrank, exclude, or prioritize items for a surface. They must remain distinct from enforcement actions and transport admission.

### Reputation is not authority

Reputation is an input to local or provider decisions. It must not become canonical identity state, global ban state, or an irreversible protocol verdict.

## Promotion stages

### Stage TS-P1 — Documentation promotion

Status: this document.

Exit criteria:

- Existing submodules are mapped into the new specification tree.
- Provider-local versus user-local versus social-state boundaries are explicit.
- Future T&S work cites this promotion document or the resulting spec docs.

### Stage TS-P2 — Series 6 social safety specs

Create:

- `docs/specification/06-social/local-controls.md`;
- `docs/specification/06-social/reports-and-appeals.md`;
- `docs/specification/06-social/moderation-labels.md`;
- `docs/specification/06-social/curation-and-reach.md`;
- `docs/specification/06-social/moderation-runtime.md`.

### Stage TS-P3 — Series 7 availability safety specs

Create:

- `docs/specification/07-availability/transport-admission.md`;
- `docs/specification/07-availability/advisory-reputation.md`.

These should be written together with the broader bridge/relay/super-peer availability specs.

### Stage TS-P4 — Profile and conformance rules

Create:

- `docs/specification/09-profiles/trust-safety-profile.md`.

The profile should define which safety objects and state machines are required for compatible apps, bridges, relays, super-peers, public indexes, and moderation tools.

### Stage TS-P5 — Runtime integration audit

Audit downstream consumers:

- `packages/local-store` projection persistence;
- `apps/pwa` local controls UI;
- `apps/bridge-service` admission wiring;
- future labeler service;
- future moderation tools;
- feed/search/recommendation runtime consumers.

## Deferred work

Known deferrals preserved by this promotion:

- account-local sync wiring;
- bridge-service HTTP wiring;
- policy-list resolution runtime;
- labeler API;
- moderation tools API and UI;
- feed/search runtime integration;
- profile-level conformance tests.

## Immediate engineering gates

Before expanding moderation, labelers, public indexing, super-peer policy, or feed ranking, future PRs should ensure:

1. the relevant state machine has a spec-tree home;
2. provider-local decisions are not represented as global protocol truth;
3. local controls remain portable and user-owned;
4. reports and appeals preserve privacy boundaries;
5. curation/ranking is distinct from enforcement;
6. reputation does not become authority;
7. Object References are used for evidence and subject references where exactness matters.

## Current status

The existing trust-and-safety stack remains foundational and should be promoted rather than replaced.

It is a set of local, social, and provider-surface policy mechanisms. It is not a single global moderation authority and must not be treated as one.
