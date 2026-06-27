# Phase 2 Private / Account-Local Payload Envelope

- Status: Draft implementation note
- Date: 2026-06-25
- Package: `@lfp2p/private-payload`

## Purpose

Phase 2 adds a small encryption helper package for private and account-local payloads. The package sits above `@lfp2p/protocol` and below future MLS, mailbox, group messaging, and runtime adapter work.

## Implemented package boundary

`@lfp2p/private-payload` depends only on `@lfp2p/protocol`.

It provides:

- `generatePrivatePayloadKeyMaterial()` for 32-byte AES-GCM key material encoded as base64url;
- `buildPrivatePayloadAad()` for canonical associated data tied to event metadata;
- `encryptPrivatePayload()` for JSON payload encryption into `PrivatePayloadEnvelopeV1`;
- `decryptPrivatePayload()` for JSON payload recovery;
- `validatePrivatePayloadEnvelopeShape()` for strict envelope shape validation.

## Security invariants

1. Private payload encryption uses AES-GCM-256.
2. Payload plaintext is canonicalized before encryption.
3. Ciphertext is bound to event metadata through AAD.
4. AAD includes event id, kind, author, device id, creation time, privacy, and schema version.
5. AAD is only valid for `self`, `dm`, and `group` privacy scopes.
6. Public and device-local contexts are rejected.
7. The envelope contains only version, algorithm, ciphertext, nonce, key id, and optional recipient wraps.
8. Recipient wraps are structurally validated and duplicate recipient device ids are rejected.
9. The protocol package remains crypto-runtime-free.

## Account-local reputation path

Account-local reputation events can now use `self` privacy with a real private payload envelope instead of the earlier placeholder helper.

The encrypted inner payload remains bound to the outer event metadata through AAD. If event id, kind, author, device id, creation time, privacy, or schema version changes, decryption fails.

## Explicit non-goals

This phase does not implement:

- MLS;
- encrypted mailbox actor;
- group key management;
- key backup or recovery;
- device key discovery;
- production recipient-key wrapping UX;
- bridge storage changes;
- runtime adapter changes.

## Test coverage

`packages/private-payload/src/index.test.ts` covers:

- encrypt/decrypt round trip;
- plaintext absence from envelope JSON;
- AAD tamper failure;
- deterministic AAD generation;
- protocol-valid `self` privacy event construction;
- duplicate recipient wrap rejection;
- rejection of public/device-local private payload contexts.

## Follow-up

Next phase remains Phase 3: MLS ADR and dependency decision.
