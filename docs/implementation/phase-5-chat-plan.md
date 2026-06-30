# Phase 5 — Chat Vertical Slice: Implementation Plan

- Status: In progress
- Date: 2026-06-29
- Depends on: Phase 4.4 (Durable Streams), Phase 4.5/4.6 (production bridge runtime), Phase 5.0E (private payload envelope)
- ADR: ADR-002 (private payload encryption), ADR-003 (sync offsets)
- Promotion note: this original implementation plan is now governed by `docs/implementation/phase-5-chat-spec-promotion.md`, which maps the existing `chat.*` slice into the newer mailbox, social, sync, data, and identity specifications. Future chat work MUST follow the promotion gates there before expanding user-facing features.

## Scope

The chat slice delivers the minimum viable encrypted DM and small-group thread: compose, send, receive, and locally project messages — fully encrypted at rest and in transit, bridged without the bridge ever reading payload content.

Out of scope for this phase: reactions, read receipts, file attachments, public channels, search indexing of message content, group voice/video.

## Phase 5.0 — ADR-002 completion (prerequisite, mostly done)

All ADR-002 exit criteria:

| Criterion | Status |
|-----------|--------|
| Encrypted payload envelope schema + validators | Done — `packages/protocol` `validatePrivatePayloadEnvelope` |
| Scope policy enforcement (dm/group/self → must have envelope) | Done — `validatePayloadPrivacyScope` in `packages/protocol` |
| `packages/envelope` builder (encrypt + sign) | Done |
| `packages/private-payload` decrypt side | Done |
| X25519 key wrapping / unwrapping | Done — `packages/crypto` |
| Fixture pack (valid + malformed envelope cases) | Done — `packages/private-payload/src/index.test.ts` |
| Bridge stays ciphertext-opaque (MUST NOT decrypt) | Enforced by doctrine; needs an explicit CI-pinned test |
| Logging policy tests prevent private plaintext emission | Inherits Phase 3.1 ESLint enforcement; needs envelope-specific audit-pin |
| Cross-device account-local wrapping for `self`-scope events | **Deferred to Phase 5.2** — Phase 5.0 ADR is satisfied without it |

Remaining 5.0 gap: one explicit test in `packages/sync-client` or `apps/bridge-service` asserting that a `dm`-scoped `SignedEventEnvelope` with a `PrivatePayloadEnvelopeV1` payload passes through the bridge admission + storage layer WITHOUT the bridge touching the ciphertext. Pin it in the Phase 3.1 no-leak suite.

## Phase 5.1 — Chat event kinds + Class D (this slice)

### Event kinds (add to `packages/protocol/src/index.ts`)

| Kind | Privacy | Consistency class |
|------|---------|-------------------|
| `chat.thread.created` | `dm` or `group` | D |
| `chat.message.sent` | `dm` or `group` | D |
| `chat.message.edited` | `dm` or `group` | D |
| `chat.message.deleted` | `dm` or `group` | B (append-only lifecycle: sent → deleted) |
| `chat.thread.accepted` | `dm` | D |

Doctrine non-negotiables:
- ALL of these are `dm` or `group` privacy — they MUST carry a `PrivatePayloadEnvelopeV1`. Enforced at `createUnsignedEvent` (existing invariant).
- NO `chat.*` kind is ever `public` or `device-local`. Enforce with `validatePayloadForKind`.
- Bridge MUST NOT decrypt to perform admission — it operates on envelope metadata only.

### Payload schemas

`chat.thread.created` payload (inside the encrypted envelope):
```
{ threadId: string; participantIds: readonly string[]; threadName?: string; createdAt: string }
```

`chat.message.sent` payload (inside the encrypted envelope):
```
{ threadId: string; messageId: string; body: string; replyToMessageId?: string; sentAt: string }
```

`chat.message.edited` payload:
```
{ threadId: string; messageId: string; newBody: string; editedAt: string; editReason?: string }
```

`chat.message.deleted` payload:
```
{ threadId: string; messageId: string; deletedAt: string }
```

`chat.thread.accepted` payload:
```
{ threadId: string; acceptedAt: string }
```

Payloads are encrypted; their JSON schemas are validated at decrypt time by `packages/chat-projection`, NOT at the bridge.

### Class D entries in `packages/protocol/src/consistency-classes.ts`

All `chat.*` kinds → Class D (`encrypted-payload`). Class D guarantees:
- Apply consults the current key-epoch.
- Ciphertext is transported opaquely.
- Projection requires the decrypted plaintext (local device only).
- Bridge inspects only the outer `SignedEventEnvelope` fields.

## Phase 5.2 — `packages/chat-projection`

New package: `@lfp2p/chat-projection`.

Exports:
- `ChatThreadState` — frozen projection: `{ threadId, participants, messages: Map<messageId, ChatMessageRecord>, createdAt, lastActivity, acceptedBy }`
- `ChatMessageRecord` — `{ messageId, authorDeviceId, plaintextBody, sentAt, editedAt?, deletedAt?, deleted: boolean }`
- `createEmptyChatThreadState()` → `ChatThreadState`
- `applyChatThreadEvent(state, decryptedPayload, eventMeta) → ChatThreadState` — pure state machine
- Decrypt-and-apply helper: `decryptAndApplyChatEvent(state, encryptedEvent, decryptOptions) → Promise<ChatThreadState>`
- `isChatEventKind(kind)` — type guard

Lifecycle rules:
- `chat.thread.created` must be the first event in a thread (reject if thread already exists — state machine non-negotiable).
- `chat.message.sent` appends to `messages` map (deduplicated by `messageId`).
- `chat.message.edited` finds message by `messageId`; updates `plaintextBody`, sets `editedAt`.
- `chat.message.deleted` sets `deleted: true`, clears `plaintextBody` (plaintext purge on local delete).
- Unknown/future event kinds: projection passes through without mutating state (forward-compat).
- `appliedEventIds: ReadonlySet<string>` — replay idempotency per Phase 3.2 invariants.

Phase 3.2 invariant: all projected state is deeply frozen.

### Dexie schema (packages/local-store, v9)

New tables:
- `chatThreads` — `{ threadId, encryptedState, lastActivityAt, schemaVersion }` (encrypted at rest)
- `chatEventLog` — `{ eventId, threadId, kind, sequence, createdAt }` (event-log for replay)

Schema migration: purely additive, v8 rows unchanged.

## Phase 5.3 — PWA chat UI

Components:
- `ThreadList` — lists active DM threads sorted by `lastActivity`.
- `ThreadView` — message feed with infinite-upward scroll; compose box.
- `ComposeBox` — text input; on send, calls `createSignedEnvelopeEvent` from `packages/envelope`, pushes to outbox.

Encryption contract:
- Compose → encrypt (AES-GCM, recipients from identity control) → `PrivatePayloadEnvelopeV1` → `chat.message.sent` event → outbox → bridge.
- Receive → `decryptPrivatePayload` from `packages/private-payload` → `applyChatThreadEvent` → Dexie.
- Local thread view is NEVER reconstructed from raw ciphertext — only from the locally-projected state. If decryption fails, show a "message undecryptable" placeholder.

## Phase 5.4 — Bridge + T&S wiring

- `chat.*` kinds added to bridge kind allowlist with `dm` and `group` scope only.
- T&S: local block list (`safety.account.blocked`) gates whether a DM thread can be created with a blocked peer. Wired at compose time in the PWA, not at the bridge.
- Explicit bridge no-decrypt test added to Phase 3.1 audit suite.
- Phase 4.5 `acceptReportDelivery` HTTP route wired (now that we have a chat surface to report from).

## Implementation order (this PR)

1. Add `chat.*` event kinds to `EVENT_KINDS` in `packages/protocol/src/index.ts`.
2. Add `validatePayloadForKind` rules: `chat.*` → `dm` or `group` only; kind-specific payload structure validated on decrypt side (not at envelope layer).
3. Add Class D entries to `packages/protocol/src/consistency-classes.ts`.
4. Create `packages/chat-projection/src/index.ts` with the projection state machine.
5. Dexie schema v9 in `packages/local-store/src/index.ts`.
6. Adversarial test suite for the chat projection (≥20 tests).
7. Bridge ciphertext-opaqueness pin test.

## Non-negotiables (doctrine constraints)

- Bridge MUST NOT decrypt to perform admission or routing.
- `chat.*` kinds with `public` privacy are rejected at `createUnsignedEvent` time.
- Deleted message `plaintextBody` is purged from local projection (not just flagged).
- `appliedEventIds` replay guard per Phase 3.2 frozen-state doctrine.
- Decryption failures produce a placeholder record, not an exception that crashes the thread view.
- `recipients` in the key-wrap MUST include the sender's own device (so the sender can decrypt their own sent messages).

## Specification promotion gates

Before adding more user-facing chat features, follow `docs/implementation/phase-5-chat-spec-promotion.md`:

1. persist chat projection and event-log state in local-store;
2. introduce mailbox-compatible Delivery Envelope / inbox / outbox boundaries;
3. align chat replay with Selective Replica Sync interests and checkpoints;
4. add Space/Channel/Thread context without overloading `threadId`;
5. only then wire the PWA chat UI.
