# Threat Model: Adaptive Reachability and Temporary Infrastructure

- Status: Draft
- Date: 2026-06-23
- Related ADR: `docs/adr/008-adaptive-reachability-and-ephemeral-infrastructure-v1.md`
- Related protocol docs:
  - `docs/protocol/infrastructure-capability-surfaces.md`
  - `docs/protocol/bridge-admission-doctrine.md`

## Scope

This threat model covers future adaptive reachability work:

- bridges;
- relays;
- super peers;
- dynamic infrastructure descriptors;
- handoff, signaling, mailbox, forwarding, streaming, discovery, availability, and replication capabilities;
- Durable Streams adapters;
- WebRTC signaling, DataChannels, and media tracks;
- optional tunnel adapters;
- future full-peer runtime adapters;
- temporary infrastructure flows;
- optional content-addressed storage providers.

It does not replace bridge compromise, content-addressing abuse, identity-control, or trust-safety threat models.

## Assets

Protect:

- local device identity material;
- controller/root identity authority;
- capability grants and revocations;
- signed event integrity;
- private payload confidentiality;
- MLS group state once adopted;
- local store correctness;
- sync checkpoint correctness;
- descriptor authenticity and freshness;
- user expectation that infrastructure is helper infrastructure, not account or data authority.

## Trust boundaries

Local trusted boundary:

- local device key material;
- local store;
- local trust policy;
- deterministic projection/apply logic;
- verified capability state.

Constrained boundary:

- known bridge selected by user or local policy;
- known super peer with authorized scope;
- known relay with forwarding-only expectations;
- cached descriptors with valid continuity.

Untrusted boundary:

- newly discovered descriptors;
- public bootstrap records;
- third-party relays;
- temporary infrastructure started by another user;
- storage providers;
- signaling metadata from the network;
- tunnel connection material;
- public indexes.

Unknown infrastructure is neutral for eligibility after validation, but untrusted for authority.

## Threats and mitigations

### Malicious descriptor

An attacker advertises a reachable surface with attractive capabilities.

Mitigations:

- require signatures;
- require expiry;
- validate surface, capability, transport, and safe-scope compatibility;
- reject URL credentials;
- apply local policy before use;
- start unknown descriptors in a constrained state;
- never grant decryption authority through descriptor presence alone.

### Stale descriptor replay

An attacker replays an old descriptor for a revoked or deprecated surface.

Mitigations:

- require created-at and expiration timestamps;
- enforce maximum TTL;
- track key continuity where available;
- reject descriptors older than known revocation/supersession markers.

### Key-continuity downgrade

A descriptor swaps keys and tries to inherit trust from an older surface.

Mitigations:

- track operator/surface key continuity;
- require explicit rotation/supersession for known infrastructure;
- downgrade unexpected key changes to constrained unknown state;
- never silently inherit positive reputation across unproven key changes.

### Discovery spam

An attacker floods clients with descriptors.

Mitigations:

- cap descriptor size;
- cap addresses and capabilities;
- cap stored descriptors per source;
- expire aggressively;
- dedupe by digest/surface ref;
- rate-limit ingestion;
- do not connect during validation.

### Signaling impersonation

An attacker injects session-establishment metadata so peers connect to the wrong endpoint.

Mitigations:

- bind signaling sessions to expected peer/device/controller fingerprints where practical;
- expire sessions quickly;
- cap signaling message size and count;
- do not mutate protocol state on signaling alone;
- verify signed envelopes after a session is established.

### Forwarding mistaken for replication

A relay or tunnel forwards bytes and clients treat that as accepted protocol state.

Mitigations:

- distinguish transport delivery from bridge admission and deterministic apply;
- require signed-envelope validation after transport;
- require replay/idempotency checks;
- only projection/apply success counts as replicated state.

### Mailbox retention abuse

A mailbox stores messages longer than expected or claims delivery authority.

Mitigations:

- encrypted payloads only for private data;
- retention TTL;
- byte caps;
- recipient/group capability binding;
- explicit expiry behavior;
- mailbox is not durable source of truth.

### Super-peer availability overclaim

A super peer claims availability but drops, withholds, or serves stale bytes.

Mitigations:

- verify fetched bytes by digest/content link;
- track observed availability separately from claims;
- use multiple storage hints where appropriate;
- never treat availability as latest-state authority.

### Storage provider poisoning or unavailability

A storage provider returns wrong, incomplete, slow, or unexpectedly large bytes.

Mitigations:

- verify bytes after fetch;
- enforce byte and decoded-size caps;
- treat failure as normal unavailability;
- never treat provider metadata as authorization.

### Temporary infrastructure operator mistake

A user starts temporary infrastructure with excessive scope, long expiry, or unclear authority boundaries.

Mitigations:

- short default expiry;
- constrained default capabilities;
- clear UI explanation;
- explicit stop/revoke action;
- no private decryption authority by default;
- descriptor preview before sharing.

### Trust-score incumbency

Old infrastructure becomes privileged only because it has history, making new community services unusable.

Mitigations:

- unknown means neutral/constrained, not bad;
- separate lack of history from negative evidence;
- decay reputation toward neutral;
- require negative evidence for quarantine or denial;
- allow user-approved introductions to bootstrap trust.

### WebRTC layer confusion

Implementation mixes media, signaling, and DataChannel sync semantics.

Mitigations:

- keep signaling as session setup;
- keep DataChannels for sync/event/control traffic;
- keep media tracks for voice/video/screen sharing;
- test each path independently.

### MLS layer confusion

Implementation treats MLS as transport or treats transport encryption as a replacement for group key management.

Mitigations:

- document MLS as group key management only;
- bind MLS group state to identity/capability policy;
- keep delivery paths transport-agnostic;
- require MLS-specific ADR and fixtures before group encrypted messaging.

## Tests required before runtime adoption

Add tests for:

- valid/invalid descriptors;
- expired descriptor rejection;
- no-expiry rejection;
- scope widening rejection;
- URL credential rejection;
- unsupported transport rejection;
- malformed signature rejection;
- key-continuity mismatch downgrade;
- unknown descriptor starts constrained, not denied solely for newness;
- forwarding does not bypass signed-envelope validation;
- Durable Streams adapter semantics remain source-of-truth safe;
- WebRTC DataChannel sync cannot carry media assumptions;
- WebRTC media cannot mutate durable protocol state;
- MLS state is not transport state.

## Exit criteria

Adaptive reachability implementation should not begin until:

- ADR-008 is accepted or revised;
- this threat model is reviewed;
- descriptor schemas are fixture-backed;
- sync-client transport contracts exist;
- current bridge admission invariants remain preserved;
- Durable Streams semantics are tested independently from adapter behavior.
