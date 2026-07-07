# Encrypted Evidence

- Status: Draft
- Specification series: 8
- Specification version: 0.x
- Scope: how report evidence from private and encrypted-group content is packaged, delivered, retrieved, and decrypted
- Profiles: Messaging, Social, Security
- Related:
  - `docs/specification/08-security/mls-group-keying.md`
  - `docs/specification/03-data/content-refs.md`
  - `docs/specification/03-data/object-references.md`
  - `docs/protocol/trust-safety-event-policy.md`
  - `docs/implementation/phase-1.63-exit-report.md`
  - `docs/adr/002-private-payload-encryption-envelope-v1.md`

## Purpose

Phase 1.63 shipped the evidence _reference_ rules: reports about private-by-nature subjects must carry encrypted evidence refs, and bridges must forward reports without decrypting anything. What it deferred — and what this document specifies — is the **retrieval path**: how an authorized moderation authority actually obtains and decrypts evidence bytes, and how evidence for MLS-protected group content is produced without leaking group keys.

## Scope

Covers evidence packaging, the re-encryption model, retrieval discipline, authorization, and retention. Report/appeal lifecycle events are owned by the Trust & Safety specifications; block fetching mechanics are owned by the block-store runtime (Phase 7.0).

## Terminology

- **Encrypted Evidence**: content bytes attached to a safety report, encrypted so that only the report's target moderation authority can decrypt them. See `GLOSSARY.md`.
- **Evidence re-encryption**: the reporter-side act of decrypting content it can legitimately read and re-encrypting it to the moderation authority.
- **Moderation authority**: the authority named by `targetAuthority` on a safety report, resolved through the identity/capability model.

## Design goals

Evidence must be verifiable and retrievable by exactly the authority a report targets, while providers stay ciphertext-only and group encryption keys never widen scope. This trades storage duplication (re-encrypted copies) for strict key isolation.

## Requirements

- Evidence for private-by-nature subjects MUST be carried as encrypted content: media evidence with `privacy=private` and an encryption descriptor, or bundle evidence with `encrypted=true` (Phase 1.63 rules).
- Evidence MUST be encrypted **to the moderation authority** named on the report. Group keys, MLS epochs, or account-local keys of the reported content MUST NOT be shared with, exported to, or derivable by the authority.
- Delivery surfaces (bridge, relay, mailbox host, super-peer, storage provider) MUST NOT decrypt, require plaintext of, or index the contents of evidence.
- Identity-kind object references MUST NOT be used as an `encryptedBodyRef` (Phase 1.63 rule).
- Retrieval MUST follow content-addressed fetch discipline: fetch → byte cap → verify digest → bounded decode → decrypt. Digest verification happens on ciphertext bytes _before_ decryption; decryption failure after a valid digest is diagnostic state, not retry-forever state.
- An authority MUST NOT apply moderation consequences based on evidence it could not decrypt and verify.

## Evidence re-encryption model

For content in an MLS-protected group or other encrypted context:

1. The reporter decrypts the content locally, exactly as it does for normal display. Reporting requires no extra read authority.
2. The reporter packages the evidence (message bytes, media blocks, or a bounded bundle) and encrypts it to the moderation authority's public key using the private payload envelope model (ADR-002): recipient-wrapped content key, event-scoped AAD binding the evidence to the report's idempotency key.
3. The reporter uploads the ciphertext blocks to available storage (mailbox attachment store, bridge blob store, or any content-addressed store) and places the resulting encrypted refs on the `safety.report.created` event.
4. The original group ciphertext, group id, and epoch MAY be referenced as corroborating metadata, but the evidence plaintext path is always the re-encrypted copy.

Consequences of this model:

- The moderation authority sees what the reporter saw — evidence is a **claim by the reporter**, not a protocol-verified transcript. Authorities SHOULD weigh evidence accordingly and MAY seek corroborating reports.
- A malicious reporter can fabricate evidence; mitigations are reporter identity binding (reports are signed), corroboration across reporters, and reporter-reputation policy — not key escrow.
- Group members other than the reporter leak nothing; the group's forward secrecy and post-compromise security are unaffected.

## Retrieval path

When a moderation authority processes a report with evidence refs:

```txt
resolve targetAuthority key material (own keys)
  ↓
authorize: does this actor hold the moderation capability for this report?
  ↓
fetch ciphertext blocks by BlockRef (block-store runtime)
  ↓
enforce byte caps and compression bounds
  ↓
verify digest against the ref (ciphertext)
  ↓
unwrap content key (recipient-wrapped to this authority)
  ↓
bounded decode/decrypt → plaintext evidence in authority-local store
```

- Fetch MAY use any storage location hint on the ref; hints are hints, and a failed hint falls through to other sources.
- Missing blocks yield `payload-unavailable`; the report remains actionable as a claim without evidence, per authority policy.
- Decrypted evidence MUST live only in the authority's local store under its own at-rest encryption; it MUST NOT be re-published, re-indexed, or forwarded except into an explicit escalation that re-encrypts to the next authority.

## State machine

Evidence attachment state, per report: `referenced → retrievable → retrieved → (verified | undecryptable | unavailable)`; `verified`, `undecryptable`, and `unavailable` are terminal per attempt but MAY be retried while the report is unresolved. Evidence state never mutates report lifecycle state directly.

## Validation

Before accepting a report for local processing, an authority MUST re-run the Phase 1.63 structural guards (private-subject/private-evidence pairing, no identity refs as evidence bodies). Before trusting retrieved bytes it MUST have verified digest, caps, and AAD binding to the report.

## Consistency model

Evidence refs are immutable content references on Class B report lifecycle events. Retrieval state is authority-local projection state and never replicates as protocol authority.

## Replication and sync behavior

Evidence ciphertext blocks replicate like any content-addressed private content: over mailbox attachment flows, bridge blob storage, or Portable Sync Drops. Evidence SHOULD be retained by the reporter's outbox until the target authority acknowledges the report, so expiry-based stores do not orphan refs prematurely.

## Privacy considerations

- Evidence duplicates private content into an authority's custody; UX MUST make this explicit to the reporter before submission.
- Refs on reports expose ciphertext digests and sizes; digests of private content are already required to be redaction-safe (Phase 1.64 audit rules truncate them).
- `private-only` reports MUST NOT feed public curation surfaces (Phase 1.65 rule), and evidence MUST NOT leak through moderation tooling logs.

## Security considerations

- **Fabricated evidence**: signed reports, corroboration, reputation — see re-encryption model above.
- **Evidence bombing**: byte caps and compression bounds enforced before decode; per-reporter rate limits at admission.
- **Wrong-recipient decryption**: recipient wrapping plus AAD binding; an envelope for another authority fails key unwrap.
- **Ref/ciphertext substitution**: digest verification over ciphertext defeats substitution; AAD binds ciphertext to the specific report.
- **Authority key compromise**: exposes evidence encrypted to that authority; it does NOT expose group keys or unrelated content — the blast radius is the re-encrypted copies.
- **Coercive escalation**: forwarding evidence to another authority requires explicit re-encryption to that authority; there is no transitive decryption.

## Interoperability considerations

The evidence ref shapes (Phase 1.63), the recipient-wrapping envelope (ADR-002), AAD binding rule, and the retrieval discipline order are the interoperable surface.

## Low-bandwidth behavior

Reports (small, signed) sync before evidence bytes. Authorities SHOULD fetch evidence lazily and MAY triage on report metadata alone. Deferred evidence keeps state `referenced`.

## Censorship-resilience behavior

Evidence blocks can travel in Portable Sync Drops; a report and its evidence can reach an authority with no shared hosted infrastructure.

## Provider behavior

Providers store and forward evidence ciphertext under caps, TTL, and admission policy. They MUST NOT decrypt, index contents, or condition forwarding on plaintext access (`canBridgeForwardReport` remains the structural gate).

## Registry impact

- Error Code Registry: `payload-unavailable` (existing), `evidence-undecryptable`, `evidence-digest-mismatch`.
- No new object types: evidence uses existing `BlockRef`/`BundleRef` with encryption descriptors.

## Conformance impact

Security and Social profiles: fixtures MUST cover re-encrypted evidence round-trip, wrong-authority unwrap failure, digest mismatch rejection, cap enforcement before decode, identity-ref-as-evidence rejection, and provider ciphertext-opacity.

## Open questions

- Whether corroborating group-ciphertext references (group id + epoch + ciphertext digest) should be normative or advisory metadata.
- Evidence retention ceilings for resolved reports (interaction with legal/safety retention is deliberately out of protocol scope).
- Whether escalation re-encryption deserves its own event kind or rides `safety.report.resolved` escalation fields.
