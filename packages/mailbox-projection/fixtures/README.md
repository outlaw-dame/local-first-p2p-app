# Mailbox Projection Fixtures

Data-driven conformance fixtures for the seven `mailbox.*` **decrypted
payload** schemas (Phase 5.11 Step 2). Each fixture is a small scenario
run through the real `applyMailboxEvent` state machine by
`src/__tests__/mailbox-fixtures.test.ts`. These pin the payload schema
surface so drift is caught here, not downstream in `@lfp2p/local-store`
or the PWA. No runtime code is exercised beyond the pure projection.

Payloads here are already-decrypted app plaintext; the ciphertext
envelope and privacy-scope rules are the protocol package's concern.

## Fixture shape

**valid/** — `{ name, identityId, log[], assert{ inbox?, outbox?, checkpoint? } }`.
The `log` is applied in order; `assert` checks the resulting projected
entry. `assert.*.envelope` can pin `recipientDeviceId` /
`recipientDeviceIdAbsent` (sealed vs visible addressing) and
`forwardedFrom`.

**invalid/** — `{ name, identityId, setup?[], event, errorCode }`. The
optional `setup` must itself apply cleanly; the fixture's `event` is the
payload under test and must be rejected with the declared stable
`MAILBOX_*` code (never with payload content in the message).

## Coverage

10 valid: every one of the seven kinds, plus visible vs sealed
addressing, a forward (`forwardedFrom`), a self-to-self envelope
(populates both sides), and the sender-outbox `providerId` + ack path.

8 invalid: missing required fields (`recipientIdentityId`, `deliveredAt`,
`recipientDeviceId`, `cursor`), out-of-vocabulary enums (expiry reason,
receipt kind, ack kind), and the **IDOR** case — a `queued` envelope
whose projecting identity is neither sender nor recipient, rejected with
`MAILBOX_RECIPIENT_MISMATCH`.
