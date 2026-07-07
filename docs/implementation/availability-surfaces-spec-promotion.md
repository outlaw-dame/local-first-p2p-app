# Availability Surfaces → Protocol Specification Promotion

- Status: Draft
- Date: 2026-06-30
- Scope: map existing bridge, relay, super-peer, and public-index planning into the newer Series 7 availability-provider specification model
- Related implementation:
  - `apps/bridge-service`
  - `docs/implementation/phase-4.5-production-bridge-hardening-plan.md`
  - `docs/implementation/phase-4.6-relay-superpeer-policy-plan.md`
  - `docs/protocol/bridge-admission-doctrine.md`
  - `docs/protocol/protocol-architecture-synthesis.md`
  - `docs/implementation/specification-reconciliation.md`
- Related specifications:
  - future `docs/specification/07-availability/bridges.md`
  - future `docs/specification/07-availability/relays.md`
  - future `docs/specification/07-availability/super-peers.md`
  - future `docs/specification/07-availability/public-indexes.md`
  - future `docs/specification/07-availability/provider-descriptors.md`
  - future `docs/specification/07-availability/admission-policy.md`
  - future `docs/specification/07-availability/advisory-reputation.md`
  - `docs/specification/04-sync/`
  - `docs/specification/05-mailbox/`

## Purpose

The bridge, relay, super-peer, and public-index work predates the `docs/specification/` tree.

This document promotes those surfaces into the newer availability-provider model so they remain optional infrastructure instead of becoming hidden protocol authority.

## Specification mapping

| Existing area       | Specification owner                       | Promotion rule                                                                                            |
| ------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Bridge service      | `07-availability/bridges.md`              | Bridge is a transport and availability surface, not identity or state authority.                          |
| Relay surface       | `07-availability/relays.md`               | Relay improves reach and fanout but does not grant validity or recipient acceptance.                      |
| Super-peer surface  | `07-availability/super-peers.md`          | Super-peer may assist caching, routing, indexing, or sync, but remains capability-bounded infrastructure. |
| Public index        | `07-availability/public-indexes.md`       | Public indexing is discovery infrastructure and must respect visibility and local policy.                 |
| Provider descriptor | `07-availability/provider-descriptors.md` | Describes service capabilities and limits without creating protocol authority.                            |
| Admission policy    | `07-availability/admission-policy.md`     | Provider-local admission must not be represented as global validity.                                      |
| Advisory reputation | `07-availability/advisory-reputation.md`  | Reputation input can inform local or provider decisions but must not create global authority.             |
| Mailbox route       | `05-mailbox/mailbox.md`                   | Mailbox/provider acceptance is delivery state, not durable recipient acceptance.                          |
| Sync adapter        | `04-sync/selective-replica-sync.md`       | Availability providers can assist sync but cannot bypass validation or apply rules.                       |

## Required boundaries

- Providers are optional infrastructure, not protocol authority.
- Provider acceptance is not durable user acceptance.
- Provider policy is scoped to that provider unless a signed capability grants a narrow service role.
- Super-peers improve availability but must not be required for local-first operation.
- Advisory reputation is an input to decisions, not canonical identity state.
- Visibility, encryption, local policy, and capability scope still apply on indexed/provider-assisted surfaces.
- Providers must not modify, re-sign, or decrypt end-to-end encrypted payload content, preserving end-to-end protocol integrity.

## Promotion stages

### Stage AV-P1 — Documentation promotion

Status: this document.

Exit criteria:

- Existing bridge/relay/super-peer planning maps into Series 7 availability specs.
- Provider-local and protocol-authority boundaries are explicit.
- Future infrastructure work cites this promotion document or the resulting Series 7 specs.

### Stage AV-P2 — Series 7 availability provider specs

Create:

- `docs/specification/07-availability/bridges.md`;
- `docs/specification/07-availability/relays.md`;
- `docs/specification/07-availability/super-peers.md`;
- `docs/specification/07-availability/public-indexes.md`;
- `docs/specification/07-availability/provider-descriptors.md`.

### Stage AV-P3 — Admission and advisory specs

Create:

- `docs/specification/07-availability/admission-policy.md`;
- `docs/specification/07-availability/advisory-reputation.md`.

These should align with the Trust & Safety promotion and preserve provider-local scoping.

### Stage AV-P4 — Runtime provider descriptor plan

Define runtime descriptor records for providers that advertise:

- supported transport roles;
- supported privacy scopes;
- mailbox capabilities;
- sync capabilities;
- object/cache capabilities;
- rate limits;
- retention policy;
- operator policy URL or policy object reference;
- supported conformance profile;
- supported protocol/specification versions.

### Stage AV-P5 — Implementation audit

Audit existing and future code paths where provider success could be confused with protocol success:

- bridge admission response;
- relay delivery/forwarding success;
- sync-client response;
- mailbox acceptance;
- feed generator candidate output;
- search index inclusion;
- super-peer cache hit;
- object storage availability;
- advisory reputation output.

## Deferred work

Known deferrals preserved by this promotion:

- Series 7 specification documents;
- runtime provider descriptor records;
- multi-provider policy subscriptions;
- advisory reputation exchange format;
- bridge-side report/appeal hooks;
- super-peer cache policy;
- public-index visibility gates;
- mailbox/provider acceptance state machine;
- sync adapter conformance tests.

## Current status

The existing bridge/relay/super-peer planning is foundational infrastructure work.

It should be promoted into Series 7 availability specs rather than treated as protocol authority or replaced by app-specific server assumptions.
