# Phase 5.11 — Threshold Authority Prototype Plan

- Status: Draft
- Date: 2026-06-30
- ADR: ADR-014 (threshold authority and FROST v1)
- Related spec: `docs/specification/02-identity/user-data-root.md`
- Depends on: Phase 5.0 (private payload envelope), ADR-014 (FROST decisions)

## Scope

Implement the trusted-dealer FROST prototype for account recovery (ADR-014 §Recovery threshold model). This plan covers share generation, encrypted local storage, and the signing ceremony helper. It does NOT implement the PWA recovery UI flow, DKG, space governance threshold enforcement, or the `identity.recovery.configured` event kind (all deferred to Phase 5.10 follow-ups).

## Step 1 — FROST library evaluation and adapter boundary

Before any code: evaluate candidate libraries and record the decision in a follow-up ADR addendum.

Candidates (no implementation yet):

| Library                                           | Language   | Browser? | Ed25519 ciphersuite? |
| ------------------------------------------------- | ---------- | -------- | -------------------- |
| `@noble/curves` frost helpers                     | TypeScript | Yes      | Ed25519 ✅           |
| `frost-core` (via WASM)                           | Rust       | Possible | Ed25519 ✅           |
| In-house Ed25519 FROST (from RFC 9591 Appendix C) | TypeScript | Yes      | Ed25519 ✅           |

Decision requirement from ADR-014: the Ed25519 FROST ciphersuite MUST be used so output signatures pass the existing `verifySignedEventEnvelope` path without modification.

Deliverable: 1-page ADR addendum in `docs/adr/014-frost-library-decision.md` recording the choice and rationale. No code yet.

One PR (docs only).

## Step 2 — `@lfp2p/frost-adapter` package (adapter boundary)

New package `packages/frost-adapter/`:

```ts
interface SyncTransport {
  /* not used here; shown only in sync plan */
}

interface FrostProvider {
  generateShares(
    groupSecret: Uint8Array,
    threshold: number,
    totalShares: number
  ): Promise<ReadonlyArray<FrostShare>>;

  sign(share: FrostShare, nonce: FrostNonce, message: Uint8Array): Promise<FrostSignatureShare>;

  aggregate(
    signatureShares: ReadonlyArray<FrostSignatureShare>,
    verificationKey: Uint8Array,
    message: Uint8Array
  ): Promise<Uint8Array>;

  verify(signature: Uint8Array, message: Uint8Array, verificationKey: Uint8Array): boolean;
}

type FrostShare = Readonly<{ index: number; scalar: Uint8Array; verificationKey: Uint8Array }>;
type FrostNonce = Readonly<{ hiding: Uint8Array; binding: Uint8Array }>;
type FrostSignatureShare = Readonly<{ index: number; scalar: Uint8Array }>;
```

Stub implementation (`NullFrostProvider`) for tests. Concrete implementation added once library is selected.

One PR. Types + stub + tests against stub. Does not import any FROST library yet.

## Step 3 — `StoredFrostShare` schema in `@lfp2p/local-store`

New type and Dexie table:

```ts
type StoredFrostShare = Readonly<{
  shareId: string;
  identityId: string;
  shareIndex: number;
  threshold: number;
  totalShares: number;
  verificationKey: string;
  encryptedShare: EncryptedKeyMaterial;
  protectionKeyId: string;
  trustees: ReadonlyArray<{ identityId: string; deviceId: string }>;
  createdAt: string;
}>;
```

Dexie schema v15/v16: `frostShares` table (PK: `shareId`, index: `identityId, createdAt`).

Storage discipline (from ADR-014):

- Share scalar encrypted via `EncryptedKeyMaterial` under `localProtectionKeys`.
- NEVER logged, NEVER synced, NEVER emitted in any audit record.

One PR.

## Step 4 — Trusted-dealer share generation

`@lfp2p/frost-adapter` dealer helper:

```ts
async function generateRecoveryShares(
  controllerPrivateKey: Uint8Array,
  threshold: number,
  trustees: ReadonlyArray<{ identityId: string; devicePublicKey: Uint8Array }>,
  provider: FrostProvider
): Promise<DealerOutput>;

type DealerOutput = Readonly<{
  localShare: FrostShare;
  encryptedSharesForTrustees: ReadonlyArray<{
    trusteeIdentityId: string;
    encryptedShare: PrivatePayloadEnvelopeV1;
  }>;
  verificationKey: Uint8Array;
  threshold: number;
  totalShares: number;
}>;
```

- Generates `n` shares from the controller key scalar via `FrostProvider.generateShares`.
- Encrypts each trustee share to that trustee's device public key using ADR-002 `PrivatePayloadEnvelopeV1`.
- Returns the local share (unencrypted; caller stores via Step 3 schema) and encrypted shares ready for distribution via mailbox.

One PR. Unit tests with `NullFrostProvider` stub.

## Step 5 — Threshold signing ceremony helper

`@lfp2p/frost-adapter` signing helper:

```ts
async function runThresholdSigningCeremony(
  localShare: FrostShare,
  threshold: number,
  remoteSignatureShares: ReadonlyArray<FrostSignatureShare>,
  message: Uint8Array,
  provider: FrostProvider
): Promise<Uint8Array>;
```

- Verifies `threshold >= 1` and `remoteSignatureShares.length >= threshold - 1` before proceeding.
- Aggregates via `FrostProvider.aggregate`.
- Returns raw signature bytes ready to place in `SignedEventEnvelope.signature.value`.
- Does NOT construct the full `SignedEventEnvelope` — caller assembles it (existing `createSignedEvent` path).

One PR. Tests verify the output signature passes `verifySignedEventEnvelope` and that too few shares are rejected locally before aggregate.

## Step 6 — `identity.recovery.configured` event kind (new kind in protocol)

New event kind:

| Kind                           | Privacy | Consistency class |
| ------------------------------ | ------- | ----------------- |
| `identity.recovery.configured` | `self`  | B                 |

Payload (inside encrypted envelope):

```ts
{
  threshold: number;
  totalShares: number;
  trustees: ReadonlyArray<{ identityId: string; deviceId: string }>;
  configuredAt: string;
}
```

No share material in the payload. This event records configuration for audit only.

One PR. Adds kind + `validatePayloadForKind` rule; 3 valid + 2 invalid fixtures.

## Step 7 — PWA recovery setup flow (basic)

`apps/pwa/src/pwa-threshold-ceremony.ts`:

- `emitRecoveryConfigured(store, threshold, trustees)` — emits `identity.recovery.configured` event.
- `getStoredLocalShare(store, identityId) → StoredFrostShare | undefined`.
- Confirmation screen: displays t, n, trustee fingerprints; requires explicit user approval before generating shares.

One PR. Does NOT implement the actual recovery flow (reconstructing the controller key from shares). That is a separate follow-up requiring cross-device coordination.

## Package boundary rules

- `@lfp2p/frost-adapter` MUST NOT import local-store, sync-client, bridge, or app packages.
- The selected FROST library is an implementation detail behind `FrostProvider`; it MUST NOT be imported outside `@lfp2p/frost-adapter`.
- Share distribution uses the encrypted mailbox path from the mailbox plan — no new transport primitives needed.

## Constraints

- Ed25519 FROST ciphersuite required (ADR-014): the aggregated signature MUST pass `verifySignedEventEnvelope` without any change to the verification path.
- Share scalar MUST be zeroed from memory after encryption (best-effort in JS; TypeScript has no memory control guarantee — document this limitation).
- UX constraint (ADR-014): no ceremony starts without explicit user confirmation of `t`, `n`, and trustee identities.
- Recovery ceremony (reconstructing the controller key) is NOT in scope here; it requires cross-device share collection which depends on the mailbox implementation plan.
