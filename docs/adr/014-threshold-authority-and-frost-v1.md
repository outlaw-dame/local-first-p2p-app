# ADR-014: Threshold Authority and FROST v1

- Status: Proposed
- Date: 2026-06-30
- Roadmap phase: Phase 5.10 — Threshold Authority / FROST ADR
- Related docs:
  - `docs/implementation/phase-5-foundation-roadmap.md`
  - `docs/implementation/phase-map.md`
  - `docs/adr/001-identity-control-log-v1.md`
  - `docs/adr/007-capability-authority-model-v1.md`
  - `docs/adr/012-mls-dependency-and-group-keying-v1.md`
  - `docs/specification/02-identity/user-data-root.md`
  - `docs/specification/06-social/spaces.md`
- Depends on:
  - Phase 2 private payload envelope (ADR-002)
  - Phase 5.0 Class D encrypted event infrastructure
  - ADR-001 controller/device identity model
  - ADR-007 capability authority model

## Context

The protocol currently binds every signing operation to a single authorized device key. This is correct for ordinary events — posts, chat messages, sync state, trust/safety decisions — because single-device signing is fast, auditable, and trivially verifiable.

However, a class of high-risk authority events benefit from a stronger authorization model:

- **Account recovery**: If a user loses all authorized devices, the protocol has no recovery path. A threshold recovery ceremony allows recovery using shares held across designated trustees without any single trustee having unilateral access.
- **Controller key rotation**: Rotating the root controller key is an irreversible authority transfer. It is the highest-risk single-signature operation in the identity model; requiring a threshold co-signature raises the bar for attackers who compromise one device.
- **Space governance**: Spaces with multiple administrators need a mechanism to authorize governance actions (kick, ban, dissolve, policy change) that cannot be triggered by a single compromised account.
- **Moderator council actions**: Community moderation councils may want t-of-n approval for high-consequence labeling or suppression events.
- **High-value capability grants**: Delegating capabilities with wide scope or long expiry is irreversible until an explicit revocation event. Requiring threshold approval mirrors offline t-of-n authorization patterns.
- **Shared infrastructure operator authority**: A team of bridge/relay operators sharing responsibility for a resource may want joint custody of the signing key for configuration changes.

FROST (Flexible Round-Optimized Schnorr Threshold Signatures, IETF RFC 9591) is a t-of-n threshold signature scheme over Ristretto255/Ed25519 that produces a standard single Schnorr signature indistinguishable from a normal Ed25519 signature to a verifier. This property means:

- The protocol verifier stack does not need a new verification code path for threshold-signed events.
- The `signature` field on `SignedEventEnvelope` remains a standard `ed25519` signature regardless of how many signers participated.
- Threshold authority is entirely a signer-side coordination ceremony invisible at the protocol object layer.

## Decision

Adopt FROST as the optional threshold signature primitive for the authority operations listed in the Allowed Uses section below.

Single-device Ed25519 signing remains the mandatory default for all ordinary protocol events. FROST is never required for normal protocol operation.

The FROST signing session is a coordinator-driven off-chain ceremony that produces a standard Ed25519 signature. The resulting signature is placed in `SignedEventEnvelope.signature` exactly as a single-device signature would be. The protocol layer sees no difference.

## Allowed uses

Threshold signing is permitted and encouraged for:

- **Account recovery**: Reconstruct or rotate the controller key from t-of-n trustee shares.
- **Controller key rotation**: Require t-of-n device co-signature for the `identity.controller.rotated` event.
- **Emergency recovery**: Recover access when all active devices are lost or compromised.
- **Space governance key actions**: Threshold authorization for dissolve, ownership transfer, or policy reset events on a Space.
- **Moderator council decisions**: t-of-n approval for high-consequence curation or suppression events.
- **High-value capability grants**: Wide-scope or long-expiry `identity.capability.granted` events optionally requiring multiple co-signers.
- **Shared infrastructure operator authority**: Operators sharing custody of bridge/relay signing keys may coordinate a FROST session for configuration changes.

## Disallowed default uses

The following uses are explicitly prohibited. The overhead and coordination round-trips of threshold signing must not become a default path for routine operations.

- Every `note.created`, `chat.message.sent`, or similar ordinary content event.
- Every mailbox delivery envelope.
- Every sync checkpoint or outbox flush.
- Every trust/safety label or observation event.
- Every MLS group-control proposal or commit.
- Any event that must complete within a user-perceptible interactive latency window without explicit user understanding of a signing ceremony.

Implementations MUST NOT gate ordinary event signing on threshold availability. If threshold infrastructure is unavailable, ordinary events proceed with single-device signatures as always.

## Authority boundary

Threshold authority is subordinate to the controller identity model. FROST adds a co-signer requirement at the signer layer; it does not change what the signed event authorizes. The authority chain remains:

```txt
controller identity
→ device identity + capability grants
→ signed protocol event (Ed25519 — single or threshold-derived)
→ local projection / verifier
```

FROST does not replace the identity-control log, capability model, trust policy engine, or MLS group membership authority.

## Key models

### Recovery threshold model

Recovery shares are derived from the controller private key using Shamir Secret Sharing as a pre-computation step. The FROST DKG or dealer (see Dealer vs DKG section) produces the per-trustee shares.

Required constraints:

- Shares must be encrypted to each trustee's device public key using the Phase 2 private payload envelope before storage or transport.
- Trustees are named controller-authorized devices or explicit trustee identities in the identity-control log.
- The threshold `t` and total share count `n` are recorded in a signed `identity.recovery.configured` event (new kind, Phase 5.10 follow-up) for auditability.
- Share refresh follows a FROST resharing protocol. Old shares are invalidated on every controller key rotation.
- The protocol does not define a transport for share distribution; applications may use the encrypted mailbox, direct encrypted transfer, or out-of-band ceremony.

### Space governance threshold model

Spaces may declare a governance threshold in their `SpacePolicy`. When declared:

- The governance threshold `t` is embedded in the `SpacePolicy.governanceThreshold` field.
- The space admin devices form the signer set.
- High-consequence governance events (dissolve, policy-reset, membership-override) require a FROST session among at least `t` of the declared admin devices.
- Ordinary space operations (post, moderate, member-add) continue with single-device signing.

### Infrastructure operator threshold model

Bridge, relay, and super-peer operators sharing custody of a signing key may use FROST to require t-of-n operator co-signature for:

- operator authority key rotation (`gateway.rotateOperatorAuthority`);
- admission config changes that widen scope or raise rate limits;
- token registry additions that grant privileged access.

Ordinary bridge operation (admit/reject per-event decisions) does not require threshold coordination.

## Dealer vs DKG

### Dealer model (Phase 5.10 scope)

Phase 5.10 defers full Distributed Key Generation (DKG) and adopts a **trusted dealer** model for initial prototype implementations:

- A single trusted device acts as dealer.
- The dealer generates the group secret, computes t-of-n Shamir shares, encrypts each share to the recipient's device key, and distributes shares via the encrypted mailbox or direct transfer.
- The dealer then destroys its local copy of the group secret.
- Trust in the dealer is bounded to the key-generation moment; forward security after share distribution does not require trusting the dealer.

The dealer model is simpler to implement and audit than DKG and is acceptable when:

- the dealer is a device the user controls (e.g., the primary controller device);
- the ceremony is a one-time setup with auditable signing of a `identity.recovery.configured` event;
- the user explicitly accepts that share generation was centralized at setup time.

### DKG (deferred to Phase 5.10 follow-up)

Full FROST DKG (where no single party ever holds the group secret) is deferred. It is the correct long-term target for:

- adversarial trustee sets where no single trustee should be trusted at setup;
- space governance with externally selected admins;
- infrastructure operator joint custody without a lead operator.

DKG requires additional round-trip coordination, is harder to audit in a local-first PWA context, and requires a protocol for synchronizing the DKG state across devices without a central coordinator. Phase 5.10 records the DKG direction and defers it to a follow-up ADR.

## Share storage guidance

Shares are high-value key material. Storage rules:

- Shares MUST be encrypted at rest using the Phase 2 private payload envelope before any persistent storage.
- Shares MUST be stored in the `device-local` privacy scope. They MUST NOT be published to public or group-scoped stores.
- The local Dexie store may hold an encrypted share under a protection key from `localProtectionKeys`. The stored shape mirrors `StoredDeviceIdentity.encryptedPrivateKey`.
- Shares MUST NOT be logged in any audit log, even in redacted form. Share material is not a DigestRef-eligible artifact.
- On device wipe or revocation, the local share MUST be deleted. Share deletion does not immediately invalidate the threshold key — the remaining shares still form a valid t-of-n set. Invalidation requires a resharing ceremony.

## Lost or stolen device behavior

When a device holding a recovery share is lost or stolen:

1. The user triggers standard device revocation via `identity.device.revoked`.
2. The recovery threshold is still satisfiable if remaining valid devices meet `t`.
3. If remaining valid devices are fewer than `t`, the account is in a recovery-impaired state. The protocol surfaces this to the user as an explicit warning.
4. The correct resolution is to initiate a resharing ceremony on a new device to regenerate a fresh threshold key set with the revised trustee list.
5. No special FROST-specific revocation event is needed; device revocation in the identity-control log is the authority event. FROST share material is derivative of that authority.

## UX requirements

Implementations MUST surface the following to users before initiating any threshold ceremony:

- The number of signers required (`t`) and total trustees (`n`).
- The identity (petname or short fingerprint) of each trustee.
- What action will be authorized by the completed signature (e.g., "This will rotate your controller key").
- An explicit confirmation step distinct from ordinary event submission.

Implementations MUST NOT:

- initiate a FROST signing session silently in the background for authority events;
- proceed with a threshold authority event if fewer than `t` trustees respond within a reasonable ceremony window;
- surface raw share material or group secret material in any UI.

## Audit requirements

- Every FROST-signed authority event carries the same `SignedEventEnvelope` structure as single-device events. The event itself is the audit record.
- The `identity.recovery.configured` event (Phase 5.10 follow-up kind) records the threshold parameters and trustee list at setup time without embedding share material.
- Resharing ceremonies produce a new `identity.recovery.configured` event superseding the prior configuration.
- Governance threshold changes to a Space produce a signed `SpacePolicy` update event.

## Scope

This ADR applies to:

- protocol event signing for the authority operations listed in Allowed Uses;
- share storage discipline in `@lfp2p/local-store`;
- identity-control log extensions for recovery configuration (Phase 5.10 follow-up);
- Space governance policy schema (Phase 5.9 follow-up);
- UX discipline for signing ceremony surfaces in `apps/pwa`.

This ADR does not apply to:

- ordinary content event signing (always single-device, unaffected);
- MLS group keying (governed by ADR-012; FROST is not an MLS substitute);
- bridge/relay admission decisions (always single-device verification path);
- trust/safety label computation or aggregation (always single-device path).

## Non-goals

- FROST is not a replacement for MLS group confidentiality. MLS handles group encryption epoch by epoch; FROST handles signing authority t-of-n.
- FROST is not a general distributed computing primitive. It is narrowly scoped to the authority operations listed above.
- This ADR does not implement FROST. Phase 5.10 is a doctrine document. Implementation follows in Phase 5.11 planning.
- This ADR does not select a FROST library. A follow-up implementation plan will evaluate candidates (`frost-core` Rust/WASM, a TypeScript FROST prototype, or a minimal in-house Ed25519-based implementation behind an adapter boundary).

## Threat model

| Threat | Mitigation |
|---|---|
| Single compromised trustee device leaks share | Shares encrypted to device keys; t-of-n means one share is insufficient |
| Attacker forces threshold ceremony for ordinary events | Disallowed by doctrine and should be enforced at UX layer; protocol verifier is unchanged |
| Malicious dealer at setup generates weak shares | Dealer model bounded to user's own controller device; DKG deferred for adversarial trustee sets |
| Replay of completed threshold signature | No special handling needed; normal event `eventId` + `lamport` replay protection covers threshold-signed events |
| Share enumeration via timing/metadata | Shares are `device-local` privacy scope only; never in bridge logs; audit redaction rules (Phase 3.1) apply |
| Recovery ceremony with stale/revoked trustee | Trustee list tied to identity-control log; revoked device shares should be excluded and threshold re-evaluated |
| Governance threshold bypass via admin compromise below `t` | Below-threshold signed governance events MUST be rejected by the projection validator (Phase 5.10 follow-up enforcement) |
| Loss of all trustee devices below `t` | Protocol surfaces recovery-impaired state; no silent degradation to single-device fallback for threshold-declared events |

## Security and privacy impact

- Private data affected: share material is the most sensitive key material in the protocol; `device-local` constraint is non-negotiable.
- Metadata exposed: the existence of a recovery configuration (`identity.recovery.configured` event) is visible to controller-authorized devices but contains no share material.
- New trust assumptions: the trusted dealer at setup; mitigated by DKG direction for adversarial settings.
- Abuse modes: coercing a user into a threshold ceremony; mitigated by explicit UX confirmation requirements.

## Follow-up

Phase 5.10 follow-up (outside this ADR's scope):

- New event kind: `identity.recovery.configured` (records threshold parameters without share material).
- `@lfp2p/local-store` schema addition: encrypted share storage row type mirroring `StoredDeviceIdentity`.
- Space governance: `governanceThreshold` field in `SpacePolicy`.
- FROST library evaluation and adapter boundary definition.
- DKG ADR (follow-up to this ADR) for adversarial trustee sets.
- PWA threshold ceremony UX component.
- Fixture suite: valid and invalid threshold-signed events, resharing scenario, recovery-impaired state.

## References

- IETF RFC 9591: The Flexible Round-Optimized Schnorr Threshold (FROST) Protocol for Two-Round Schnorr Signatures.
- Chelsea Komlo and Ian Goldberg, "FROST: Flexible Round-Optimized Schnorr Threshold Signatures" (2020).
- ADR-001: Identity Control Log v1 (controller/device authority model).
- ADR-002: Private Payload Encryption Envelope v1 (share encryption foundation).
- ADR-007: Capability Authority Model v1 (high-value capability grants).
- ADR-012: MLS Dependency and Group Keying v1 (MLS is orthogonal, not replaced by FROST).
