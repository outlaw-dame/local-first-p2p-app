# Revocation Realism

- Status: Draft
- Date: 2026-06-03
- Related ADRs:
  - `docs/adr/001-identity-control-log-v1.md`
  - `docs/adr/002-private-payload-encryption-envelope-v1.md`
- Related protocol docs:
  - `docs/protocol/identity-control-log.md`
  - `docs/protocol/operation-consistency-classes.md`
  - `docs/protocol/local-controls-portability.md`
- Package surface:
  - `@lfp2p/identity` (controller, device, capability lifecycle)
  - `@lfp2p/trust-safety` (local controls, allowlist, label preferences)

## Purpose

Local-first / P2P architectures cannot guarantee what a remote device
has already done with data once that data has been decrypted and
copied. Revocation events in the identity-control log stop _future_
authority, decryption, or admission decisions; they cannot
retroactively delete data a peer has already received, decoded, and
chosen to retain.

This doctrine pins what each revocation primitive actually
guarantees, so the PWA UI, error messages, and downstream feature
docs do not overpromise.

## What revocation guarantees

| Revocation primitive                              | Effective for                                                                                                                                  | Not effective for                                                                                                                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity.device.revoked`                         | Every event signed by the revoked device's key after the revocation event (the verifier rejects the signature against the now-revoked device). | Past events the device signed while still active. Those events remain valid history. The verifier still accepts past events from the now-revoked device.                            |
| `identity.capability.revoked`                     | Every operation requiring that capability after the revocation event.                                                                          | Past actions taken under that capability. Their effects remain in the log.                                                                                                          |
| `identity.device.rotated` (Phase 2.1)             | Future events under the device's new public key. Stops the old key from authorizing new events.                                                | Past events signed under the previous key. Does not invalidate already-replicated content. The `previousPublicKey` cross-check prevents a stale rotation from rolling the key back. |
| Key-epoch rotation (Class D — pending Phase 5/6)  | Future ciphertexts encrypted under the new epoch.                                                                                              | Already-decrypted plaintext on any device the peer chose to retain.                                                                                                                 |
| Local block / mute / hide (`@lfp2p/trust-safety`) | The local viewer's projection on this device, and (via `safety.preferences.snapshot`) the user's other apps.                                   | Anyone else's view of the same content. Not a global delete.                                                                                                                        |
| `safety.label.revoked`                            | The labeler's own future label decisions (the projection's stack stops including the revoked label). Phase 1.66 forbids cross-labeler revoke.  | Other labelers' independent decisions about the same subject.                                                                                                                       |

## What revocation does NOT guarantee

A complete inventory of the guarantees we do not make, written down so
no UX copy or API doc accidentally implies them:

1. **No remote deletion.** Once a peer has received and decrypted an
   event, that peer's local store contains plaintext. A subsequent
   revocation in your log does not delete the peer's copy.
2. **No retroactive invalidation of past signatures.** A device key
   revoked at `epoch=N` does not invalidate events signed at
   `epoch < N`. Past authority chains stay coherent (this is
   intentional: it preserves audit history).
3. **No guaranteed propagation timing.** Until a peer replays the
   revocation event into their projection, they continue to treat
   the prior authority as valid. Sync delay is unavoidable.
4. **No protection against a peer who never participates in sync.**
   A device that left your trust graph long ago and never reconnected
   never learns about the revocation. Anything they cached remains
   cached.
5. **No protection against a malicious bridge.** A bridge that
   refuses to forward a revocation event to a victim's peers cannot
   forge the revocation, but can withhold it. Out-of-band revocation
   discovery (a fresh bootstrap, alternate bridge, contact-card
   re-publication with a new digest) is the user's recourse.
6. **No protection against a malicious peer.** A peer who has
   decrypted private content can copy that content anywhere. The
   protocol cannot prevent this; only the user's choice of whom to
   trust can.

## UI language guide

The PWA MUST NOT use language that implies retroactive deletion or
remote enforcement of local moderation choices. Recommended
substitutions:

| Avoid                                | Use instead                                                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| "Delete this from everywhere"        | "Stop showing this to me" (block / mute / hide is local).                                                               |
| "Erase this account"                 | "Revoke future authority for this device" (`identity.device.revoked`).                                                  |
| "Unsend this message"                | "Mark as withdrawn locally" — and disclose that remote copies may persist.                                              |
| "Take down this post"                | "Recommend takedown to the moderation queue" (Phase 1.67) — the queue is not the same as enforced removal.              |
| "Erase your contact card from peers" | "Publish a superseding contact-card digest. Peers honoring the latest publication will adopt it; older copies persist." |

## What this means for product surfaces

- **Identity rotation UI** (future): show the user the old + new
  fingerprints, and explain that peers who already verified the old
  fingerprint will continue trusting it until their projection
  replays the rotation. Recommend out-of-band fingerprint
  re-verification.
- **Block / mute UI** (shipped): the existing PWA T&S settings
  language already says "block from your feed" and "mute," not
  "ban." Keep that discipline.
- **Contact-card publication** (Phase 2.2): expose the
  most-recently-published digest in the UI and explain that the
  identity-control log retains the _latest_ publication; older
  publications stay in history for audit. Do not call this "deleting
  the old card."
- **Future encrypted-evidence UI** (Phase 1.63 follow-on): never
  imply that an evidence reference's removal deletes the underlying
  bytes from a relay or block store. Removal is "I no longer
  reference this digest"; the bytes' retention is governed by the
  block store's lifecycle policy, which can lag the reference.

## Threat-model linkage

This doctrine narrows the gap between protocol guarantees and user
expectations. It pairs with:

- `docs/threat-model/trust-safety-and-abuse.md` (which already
  covers bridge-side enforcement boundaries),
- `docs/threat-model/bridge-compromise.md` (which covers what an
  adversarial bridge can withhold),
- a future identity-specific threat-model document (deferred per
  Phase 2.1 exit report — will cover stale-rotation-rollback,
  device-resurrection, and post-revocation recovery scenarios).

## Acceptance — Phase 2.2

Phase 2.2 ships:

- This doctrine (the canonical statement of what revocation does
  and does not guarantee).
- The Phase 2.1 follow-on fix that ensures `identity.device.rotated`
  and `identity.contact-card.published` actually update the
  projection on the inbound sync path (regression test in
  `packages/sync-client/src/phase-2.2.test.ts`).
- A `contactCardPublication` snapshot field on
  `StoredIdentityControlProjection` so a downstream verifier (or
  the user's other devices, once account-local sync ships) can
  read the most recent publication digest without replaying the
  log.

Future phases (Phase 2.3 — controller recovery; Phase 5/6 — key
epoch rotation) will extend the table above with the guarantees they
add.
