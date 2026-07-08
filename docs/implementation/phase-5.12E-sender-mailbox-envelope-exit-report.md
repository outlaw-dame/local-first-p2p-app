# Phase 5.12E sender-side mailbox envelope slice — exit report

Status: partial implementation complete.

## Scope

This slice adds the first sender-side Phase 5.12E mailbox wiring without replacing the older
caller-supplied `ConversationKey` path yet.

Implemented:

- `apps/pwa/src/pwa-mailbox-envelope-sender.ts`
  - Adds `emitMailboxEnvelopeQueuedToRecipients`.
  - Accepts Phase 5.12D `ResolvedRecipient[]` values produced from synced identity-control
    projections.
  - Generates a fresh per-envelope AES content key.
  - Wraps that key once per resolved recipient device with X25519 using each device's
    published `wrapPublicKey` / `wrapKeyRef`.
  - Encrypts a `mailbox.envelope.queued` payload with `recipientWraps` included on the
    `PrivatePayloadEnvelopeV1`.
  - Signs the event and appends it locally with the one-time content key so the sender outbox
    can project.
  - Returns the signed event, key id, recipient device ids, and append result, but never
    returns raw key material.
- `apps/pwa/src/pwa-mailbox-envelope-sender.test.ts`
  - Covers sender projection.
  - Resolves the event content key with the recipient device wrap private key and projects the
    recipient inbox.
  - Covers recipient-identity mismatch rejection.
  - Covers duplicate recipient-device rejection.

## Safety properties

- Raw per-envelope key material is local to the helper and local-store append call; it is not
  returned to UI or caller code.
- Recipient wrapping is exact-match to the mailbox `recipientIdentityId`.
- Duplicate recipient devices are rejected before encryption.
- Sender identity is pinned from the emit context and cannot be supplied by caller payload.
- Plaintext payload is only passed into the private-payload encryption boundary and does not
  appear in returned envelope metadata.

## Remaining work

- Wire mailbox UI/send callers to resolve recipient projections through
  `resolveEnvelopeRecipientsFromIdentityProjections` and call this helper.
- Add the equivalent chat sender adapter if chat currently has a separate emit surface.
- Enable `mailboxRouting` and foreground sweep only after app bootstrap supplies both:
  - local device wrap resolver for inbound/sweep, and
  - sender recipient resolution for outbound.
- Consider retiring or narrowing the older `ConversationKey` sender API once all app send paths
  use per-envelope recipient wraps.

## Validation

Connector-only change. I could not run local `pnpm test`, `pnpm build`, or `pnpm lint` because
this environment still cannot resolve `github.com` for a local checkout. The implementation is
additive and isolated to a new helper/test/doc path.
