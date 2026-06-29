# Security Model

- Status: Draft
- Specification series: 0
- Scope: protocol-wide security model scaffold

## Purpose

This document defines the initial security model categories that every later specification document should respect.

It is not a complete threat model. Later specification series will add detailed security requirements for identity, data, sync, mailbox, social primitives, availability providers, MLS integration, recovery, and FROST.

## Security principles

### Cryptographic authority

Protocol authority MUST derive from cryptographic identity, signatures, capabilities, encryption state, and deterministic validation rules.

Transport delivery, provider acceptance, indexing, caching, or byte availability MUST NOT imply authority.

### Verify before apply

Implementations MUST verify required signatures, capabilities, epochs, consistency-class rules, and replay protections before applying authority-sensitive records.

### Delivery is not acceptance

Receiving, relaying, storing, fetching, or acknowledging a record MUST NOT be treated as accepting it into durable local state unless the relevant state machine says so.

### Providers are not plaintext authorities

Mailbox providers, bridges, relays, super-peers, search providers, feed generators, and storage providers MUST NOT require plaintext access to private payloads unless a specific feature explicitly grants and scopes that access.

### Capability scoping

Capabilities SHOULD be least-privilege, scoped, revocable, and auditable where possible.

A provider capability MUST NOT imply unrelated authority.

### Consistency-class enforcement

Security-sensitive state MUST use the correct consistency class.

CRDT-style merge, LWW, mutable path overwrite, or app-level storage semantics MUST NOT be used for authority, lifecycle, revocation, key epoch, moderation, report/appeal, or security-critical state unless explicitly permitted by the relevant specification.

### Metadata minimization

Private delivery, sealed recipients, local discovery, mailbox routes, and low-bandwidth sync SHOULD minimize metadata exposure.

### Degraded-mode safety

Offline, nearby, Bluetooth, file-import, and portable-sync-drop modes MUST preserve validation requirements.

Low-bandwidth mode may defer payloads. It MUST NOT skip required authority validation for records it applies.

## Threat categories

Later documents SHOULD consider:

- key compromise;
- lost devices;
- stolen devices;
- malicious devices;
- replay attacks;
- downgrade attacks;
- stale epoch attacks;
- capability confusion;
- provider equivocation;
- mailbox metadata leakage;
- malicious bridges/relays/super-peers;
- censorship and blocking;
- traffic analysis;
- spam and abuse;
- moderation bypass;
- malicious feed generators;
- malicious search indexes;
- poisoned portable sync drops;
- partial payload attacks;
- malicious low-bandwidth peers;
- denial of service;
- storage exhaustion;
- privacy leaks through receipts/ACKs;
- unsafe forwarding;
- group membership/key-epoch desynchronization.

## Required security sections

Every normative feature specification SHOULD include:

- threat model assumptions;
- required verification;
- replay/idempotency behavior;
- downgrade behavior;
- privacy considerations;
- provider trust assumptions;
- degraded-mode behavior;
- abuse/DoS considerations;
- safe failure behavior;
- logging/audit constraints.

## Recovery and threshold authority

Threshold authority, including FROST-style signing, is intended for high-risk actions such as account recovery, controller rotation, space governance, emergency recovery, high-value capability grants, and shared infrastructure authority.

Threshold authority SHOULD NOT be required for ordinary posts, messages, mailbox envelopes, or routine local events.

Detailed threshold authority requirements are deferred to a later security specification series.

## MLS integration

MLS protects private/group payloads and group-control state where applicable.

Delivery services may carry MLS-related records but MUST NOT become MLS membership, epoch, plaintext, or latest-state authorities.

Detailed MLS integration requirements are deferred to later Messaging/Security specifications.
