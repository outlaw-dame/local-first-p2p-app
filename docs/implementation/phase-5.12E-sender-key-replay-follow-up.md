# Phase 5.12E sender key replay follow-up

Status: implementation follow-up complete.

## Why this exists

A late PR #168 review found a correctness and safety gap in the first sender-side mailbox envelope helper: outbound mailbox events generated a fresh per-envelope content key and wrapped it only to recipient devices. The sender could project the outbox immediately because the helper still had the raw key in memory, but after reload/replay the sender device could no longer recover that key from the event. That would make sender outbox replay and TTL expiry sweeps brittle.

## Implemented

- `emitMailboxEnvelopeQueuedToRecipients` now requires `senderDeviceWrap` metadata:
  - `wrapPublicKey`
  - `wrapKeyRef`
- The helper writes an additional `recipientWraps` entry addressed to the local sender identity/device.
- Remote recipient delivery semantics stay unchanged:
  - `recipientDeviceIds` still reports only remote resolved recipient devices.
  - sealed `recipientDeviceId` delivery still excludes other recipient devices.
- Sender wrap and recipient wraps are de-duplicated by identity/device/wrap-key ref to avoid duplicate entries for self-send or overlapping devices.
- Raw per-envelope key material is still not returned to caller code.

## Tests added/updated

- The normal send-path test now proves both sender and recipient can resolve the same per-envelope key from their respective wraps.
- A replay/sweep regression test proves the sender can recover the content key using only its local device wrap after the helper returns, then run `loadMailboxInboxState` and `sweepExpiredMailboxEnvelopes` successfully.
- The sealed-addressing test now proves:
  - the requested recipient device receives the recipient wrap,
  - other recipient devices do not,
  - the sender still keeps replay access through its own wrap.

## Security notes

This is intentionally a sender-local recoverability fix, not a widening of recipient access. The sender wrap is addressed to the event author identity and signing device. Recipient-device sealing still applies only to the mailbox recipient identity. This preserves the cryptographic seal for remote recipients while keeping sender-owned outbox state rebuildable and sweepable.

## Validation

Connector-only change. Local `pnpm test`, `pnpm build`, and `pnpm lint` were not run in this environment. The branch is based on the PR #168 merge commit and only changes the sender helper, its tests, and this follow-up note.
