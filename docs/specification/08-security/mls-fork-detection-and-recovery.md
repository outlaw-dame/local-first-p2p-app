# MLS Fork Detection and Recovery

- Status: Draft
- Specification series: 8
- Specification version: 0.x
- Scope: detecting and resolving concurrent MLS commits without a serializing Delivery Service
- Profiles: Messaging, Security, Offline
- Related:
  - `docs/specification/08-security/mls-group-keying.md`
  - `docs/specification/08-security/mls-virtual-delivery-service.md`
  - `docs/adr/012-mls-dependency-and-group-keying-v1.md`

## Purpose

MLS requires a linear epoch sequence per group. Central deployments get linearity from a serializing Delivery Service. This protocol has no such authority: partitioned devices, multi-path delivery, offline catch-up, and Portable Sync Drops can all expose concurrent commits for the same epoch.

This document defines how implementations detect forks, hold them safely, and resolve them through signed, auditable recovery records — never by silently accepting arbitrary remote state.

## Scope

Covers fork detection conditions, quarantine behavior, the recovery record, deterministic-fallback constraints, and stale-epoch handling. Group state validation generally is covered by `mls-group-keying.md`.

## Terminology

- **Fork**: two or more valid, conflicting commits that each claim to advance the same parent epoch of the same group.
- **Fork candidate**: a queued conflicting commit that has passed structural validation but has not been accepted.
- **Recovery record**: a signed `mls.fork.recovery.published` Group-Control Record that selects the surviving branch.
- **Policy authority**: the controller/admin Device (or threshold authority) authorized by group policy to publish recovery records.

## Requirements

- Implementations MUST detect a fork when a structurally valid commit references a parent epoch for which a different commit has already been accepted, or when two unaccepted valid commits reference the same parent epoch.
- On detection, implementations MUST:
  - keep the last accepted epoch stable;
  - queue conflicting candidates as fork candidates (bounded queue);
  - record a `mls.fork.detected` Group-Control Record with diagnostics;
  - surface the fork to local diagnostics and policy.
- Implementations MUST NOT:
  - silently accept whichever conflicting commit arrives first-by-wall-clock from a remote path;
  - heal a fork by adopting arbitrary remote state;
  - accept a scope-widening commit (one that adds members or capabilities) through any tie-breaker;
  - let delivery surfaces arbitrate the winner.
- Fork resolution MUST be represented by a signed recovery record from an authorized policy authority, or by the deterministic fallback below where group policy explicitly allows it.

## Detection inputs

Fork detection consumes:

- accepted epoch chain (`previousControlId` linkage and epoch numbers);
- membership digests on epoch-advancing records;
- commit object references;
- ordering hints from delivery surfaces (advisory only — a hint mismatch MAY prompt earlier detection but MUST NOT decide acceptance).

A gap (received epoch N+2 with no N+1) is not a fork; it is missing-record state and SHOULD trigger catch-up fetch before any fork logic runs.

## State machine

Per group:

```txt
linear → forked → (recovering) → linear
```

- `linear`: one accepted head epoch.
- `forked`: one accepted head plus one or more queued fork candidates for the same parent. Application messages for the accepted head remain processable; messages for candidate branches are held.
- `recovering`: a recovery record has been observed and is being validated/applied.
- Return to `linear`: the surviving branch's commits apply in order; losing candidates are discarded with a diagnostic record retained.

Replay of detection and recovery records MUST be idempotent, and a projection rebuilt from the event log MUST reach the same final state (replay equivalence).

## Recovery record

`mls.fork.recovery.published` MUST include:

- `groupId`, the forked parent `epoch`, and `previousControlId`;
- the selected surviving commit reference;
- the recovery method: `policy-authority` or `deterministic-fallback`;
- issuer Device id; the issuer MUST hold recovery authority under group policy at the time of issuance.

Validation MUST reject recovery records that: come from unauthorized issuers, select a commit that was never a queued/observable candidate, select a scope-widening commit, or target an epoch that is not actually forked.

Recovery records for high-consequence groups MAY require threshold authorization (see ADR-014); the resulting signature is a standard Ed25519 signature and validates through the normal path.

## Deterministic fallback

Where group policy explicitly opts in, implementations MAY resolve a fork without a policy-authority record using a deterministic tie-breaker. The tie-breaker MUST be:

- pure over signed candidate contents (e.g., lowest lexicographic commit digest) — never wall-clock arrival, delivery path, or surface hints;
- identical across all conforming implementations;
- auditable: the loser records why it lost;
- replay-safe;
- incapable of selecting a scope-widening commit — if any candidate widens scope, deterministic fallback MUST abstain and require a policy-authority record.

The fallback result is still recorded as a `mls.fork.recovery.published` record with method `deterministic-fallback` so the log is self-describing.

## Stale epochs

A message or commit for an epoch older than the accepted head MUST be rejected fail-closed and MAY be recorded as `mls.stale-epoch.rejected` with diagnostics. Stale-epoch rejection is not fork handling; it needs no recovery.

## Validation

Fork candidates MUST pass full structural and authorization validation (member, non-revoked Device, correct binding) before queueing. Invalid conflicting commits are ordinary rejections, not fork candidates.

The candidate queue MUST be bounded per group; on overflow, implementations MUST keep the earliest candidates, record a diagnostic, and surface degraded fork state rather than evicting silently.

## Consistency model

Fork detection and recovery records are Class D key-epoch transitions. The accepted epoch chain is monotonic; recovery never rewinds an accepted epoch — it selects among candidates for the next epoch.

## Replication and sync behavior

Fork state is local projection state; fork candidates and recovery records replicate as ordinary signed records. Offline members catching up MUST process recovery records in order and end on the surviving branch regardless of the order candidates arrived.

## Privacy considerations

Fork diagnostics reference commit digests and Device ids; diagnostics exported off-device MUST follow privacy-safe logging rules and MUST NOT include payload plaintext or key material.

## Security considerations

- **Malicious insider forking deliberately**: bounded queue plus surfaced diagnostics prevent silent fragmentation; recovery authority decides.
- **Attacker racing a scope-widening commit**: structurally blocked — no tie-breaker may select it.
- **Forged recovery record**: signature plus policy-authority validation; unauthorized issuers rejected.
- **Partition abuse** (feeding different halves different branches): membership digests plus recovery records converge the group when partitions heal; equivocating surfaces are detectable from conflicting signed records.
- **Queue flooding**: bounded queue, per-sender rate limits at admission, structural validation before queueing.

## Interoperability considerations

The detection conditions, record shapes, deterministic tie-breaker definition, and scope-widening prohibition are normative for interoperability. Diagnostic formats are implementation-local.

## Low-bandwidth behavior

Fork candidates and recovery records are small control records and sync at key-epoch priority. A device in degraded mode MUST still hold (not resolve) forks it cannot yet validate completely.

## Censorship-resilience behavior

Fork handling assumes no infrastructure: detection and recovery work identically over direct sessions and Portable Sync Drops.

## Registry impact

- Event Type Registry: `mls.fork.detected`, `mls.fork.recovery.published`, `mls.stale-epoch.rejected` (registered with the Group-Control Record family).
- Error Code Registry: `stale-epoch` (existing), `fork-unresolved`, `recovery-unauthorized`.

## Conformance impact

Messaging and Security profiles: fixtures MUST cover two-candidate fork detection, policy-authority recovery, deterministic-fallback recovery, scope-widening abstention, unauthorized recovery rejection, stale-epoch rejection, bounded-queue overflow, and replay equivalence of the full detect→recover sequence.

## Open questions

- Default deterministic tie-breaker choice (lowest commit digest is the working candidate).
- Whether `recovering` deserves explicit projection state or remains transient.
- How long losing-branch diagnostics must be retained.
