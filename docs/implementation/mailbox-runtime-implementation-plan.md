# Mailbox Runtime Implementation Plan

- Status: Draft
- Date: 2026-06-30
- Scope: implementation plan for the first mailbox runtime slice after the mailbox specification, chat promotion, sync promotion, availability promotion, and MLS promotion work

## Runtime primitives

### `MailboxDeliveryEnvelope`

Minimum fields:

- `schemaVersion`;
- `envelopeId`;
- `authorId`;
- `submitterId`;
- `recipientScopes`;
- `conversationRef`;
- `payloadRef` or protected inline payload;
- `createdAt`;
- `expiresAt`;
- `routeHints`;
- `dedupeKey`;
- `signature` or proof reference.

## Implementation phases

### Phase MB-2 — Local inbox/outbox state

Add local-store tables or schemas registered in `LocalFirstTableName` and a new Dexie schema version in `packages/local-store/src/index.ts` for:

- mailbox outbox route state, indexed by `envelopeId` and `status`;
- mailbox inbox route state, indexed by `envelopeId` and `status`;
- mailbox receipt log, indexed by `receiptId` and `envelopeId`;
- mailbox ACK log, indexed by `ackId` and `envelopeId`.

### Phase MB-4 — Chat integration

Tests:

- delete tombstones local plaintext projection by clearing the body and marking the message deleted without pretending to delete provider history.
