# Phase 5.12 — Conversation content-key subsystem (dm/group E2EE key layer)

## Why

`dm`/`group` events (mailbox delivery, chat messages) are encrypted with a
`PrivatePayloadEnvelopeV1`. Sending already works: `@lfp2p/envelope`'s
`createEnvelopeEvent` generates a **per-event content key**, wraps it to each
recipient device's X25519 public key, and embeds the wraps in the envelope
(`recipientWraps`). What is missing is the **recipient side** — turning an
inbound envelope back into the content key a recipient can decrypt with — plus
the **device wrap-keypair lifecycle** and **recipient resolution** that make the
loop usable end to end.

This is the single dependency that gates:

- mailbox inbound sync routing (`resolveKeyMaterial`, Phase 5.11) and the expiry
  sweep (`resolveEnvelopeKey`), and
- chat `dm`/`group` inbound decryption (same envelope model, same gap).

It is deliberately **not** mailbox- or chat-specific: it is the shared E2EE
content-key layer both sit on.

## Model (already established, not changed here)

- **Per-event content keys, not long-lived conversation keys.** Each `dm`/`group`
  event carries its own random AES-256 content key, wrapped once per recipient
  device. There is no shared standing key to roll over or leak; compromise of one
  event's key does not extend to others.
- **X25519 sealed wrapping.** `wrapPayloadKeyWithX25519` (ephemeral-sender
  `nacl.box`) wraps the content key to a device's X25519 **wrap public key**;
  `unwrapPayloadKeyWithX25519` reverses it with the device's wrap **private key**.
- **`recipientWraps`** entries are `{ recipientIdentityId, recipientDeviceId,
keyAgreement: 'x25519-v1', wrappedKey, wrappingKeyRef }`. `wrappingKeyRef`
  names _which_ of the recipient device's wrap keys was used, so rotation is
  expressible.

## Decomposition (each part a correct, tested, independently mergeable increment)

### A. Recipient content-key resolver — keystone (this PR)

`@lfp2p/envelope`: `resolvePayloadKeyForDevice(envelope, localWrapKeys)`.
Given an inbound envelope and the local device's wrap key(s), find the wrap
addressed to this device, select the private key by `wrappingKeyRef`
(rotation-aware), unwrap, and validate the recovered content key. Pure crypto;
no store, no network. Result is a discriminated status —
`resolved | no-wrap | no-key | unwrap-failed` — so callers self-heal (a
not-yet-decryptable event is stored durably and retried) rather than throwing.
This is exactly what `resolveKeyMaterial` / `resolveEnvelopeKey` call.

Hardening: adversarial-envelope guards (malformed/duplicate/oversized wraps),
strict `x25519-v1` check, 32-byte recovered-key validation (blocks key-confusion
/ short-key injection), and optional identity+device binding so a wrap that
claims this `deviceId` under a _different_ identity is not honoured.

### B. Device wrap-keypair lifecycle

Generate an X25519 wrap keypair when a device identity is created; store the
private key **encrypted at rest** (the same protection as the Ed25519 signing
key in `StoredDeviceIdentity`); expose the public key + a stable `wrapKeyRef`.
Additive Dexie migration. Rotation-ready (keys are addressed by `wrapKeyRef`).

### C. Wrap-key publication

Carry `wrapPublicKey` + `wrapKeyRef` on the device record surfaced in the
identity contact card / `identity.device.authorized` projection, so a sender's
`resolveRecipients` can find a peer's active devices' wrap keys.

### D. Recipient resolution from local data

Build `RecipientIdentity[]` (for `resolveRecipients`) from stored contact
profiles / the identity-control projection — active, non-revoked devices only.

### E. Wiring

- Recipient: `resolveKeyMaterial(event)` = load the local device wrap key(s)
  from the store, run **A**, and return the content key (or `undefined`).
- Sender: mailbox/chat emit uses `createEnvelopeEvent` with recipients from
  **D**, replacing the placeholder single-symmetric-key inputs.
- Enable `mailboxRouting` + `sweepAfterForegroundSync` in the app shell once the
  above resolve to real keys.

## Security invariants (whole subsystem)

- A device only ever unwraps the wrap addressed to **it**; there is no path that
  tries another device's wrap.
- Wrap **private** keys never leave the device and are encrypted at rest.
- Recovered content keys are length-validated before use; a malformed wrap is a
  coarse `unwrap-failed`, never a partial/ambiguous key.
- Revoked devices are excluded from recipient resolution (**D**) so new events
  are not wrapped to them.
- Failure is self-healing, not lossy: an event that cannot be decrypted yet is
  retained and retried (mailbox event log already does this).

## Status

- **A (recipient resolver): shipped** (#159).
- **B (device wrap-keypair lifecycle): this PR.** `DeviceIdentityManager` now
  provisions an X25519 wrap keypair on device creation (private key encrypted at
  rest under the device protection key), surfaces it on `LocalDeviceSession.wrap`
  (`{ keyRef, keypair }`), and self-heals a pre-5.12B record on restore
  (race-safe: concurrent contexts converge on one wrap key). `StoredDeviceIdentity`
  gains additive `wrapPublicKey` / `wrapKeyRef` / `encryptedWrapPrivateKey`
  (all-or-nothing, validated).
- C–E: subsequent PRs. C publishes the wrap public key on the contact card /
  device projection; D resolves peer recipients from local data; E wires the
  session wrap key into the resolver (`resolveKeyMaterial`) and the send path.
