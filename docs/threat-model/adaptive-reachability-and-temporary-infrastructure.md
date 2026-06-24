# Threat Model: Adaptive Reachability and Temporary Infrastructure

- Status: Draft
- Date: 2026-06-23
- Related ADR: `docs/adr/008-adaptive-reachability-and-ephemeral-infrastructure-v1.md`
- Related protocol docs:
  - `docs/protocol/infrastructure-capability-surfaces.md`
  - `docs/protocol/bridge-admission-doctrine.md`
  - `docs/protocol/privacy-safe-logging.md`
  - `docs/protocol/content-addressing.md`

## Scope

This threat model covers adaptive reachability infrastructure:

- bridges;
- relays;
- super peers;
- dynamic infrastructure descriptors;
- handoff/signaling/mailbox capabilities;
- Durable Streams adapters;
- WebRTC signaling and DataChannel setup;
- Holesail-like tunnel adapters;
- Relay Button / temporary bridge or relay flows;
- IPFS-compatible storage hints and availability providers.

It does not replace the bridge compromise, content-addressing abuse, identity-control, or trust/safety threat models. It adds threats specific to dynamic and ephemeral infrastructure.

## Assets

Protect:

- local device identity material;
- controller/root identity authority;
- capability grants and revocations;
- signed event integrity;
- private payload confidentiality;
- mailbox confidentiality and retention boundaries;
- local store correctness;
- sync checkpoint/cursor correctness;
- descriptor authenticity;
- descriptor freshness;
- storage-location safety;
- user expectation that infrastructure is helper infrastructure, not account/data authority.

## Trust boundaries

### Local trusted boundary

- local device key material;
- local store;
- local trust policy;
- deterministic projection/apply logic;
- verified capability state.

### Semi-trusted / constrained boundary

- known bridge selected by the user or local policy;
- known super peer with authorized scope;
- known relay with forwarding-only expectations;
- cached descriptors with valid key continuity.

### Untrusted boundary

- newly discovered descriptors;
- public bootstrap records;
- third-party relays;
- temporary infrastructure started by another user;
- IPFS-compatible gateways/providers;
- WebRTC signaling metadata from the network;
- Holesail-like connection material received from outside local policy;
- public indexes.

Unknown infrastructure is neutral for eligibility after validation, but untrusted for authority.

## Non-negotiable assumptions

- Infrastructure can disappear at any time.
- Network-provided descriptors are hints, not authority.
- A successful network connection does not prove protocol trust.
- A CID/content link proves byte identity after verification, not authorization or availability.
- Bridge-local rejection, quarantine, or rate-limit is not global deletion/moderation.
- WebSocket is an adapter for Durable Streams, not the canonical live-stream layer.
- Holesail-like tunnels are reachability adapters, not identity/trust/replication authorities.
- A new service with no reputation is not malicious by default.

## Threats and mitigations

### 1. Malicious infrastructure descriptor

Attack:

An attacker publishes a bridge/relay/super-peer descriptor with attractive capabilities to capture traffic or metadata.

Mitigations:

- require descriptor signatures;
- require expiry;
- validate surface/capability/safe-scope compatibility;
- reject URL credentials;
- reject unsupported transports;
- apply local policy before use;
- start unknown descriptors in `allow-with-limits` at most;
- never grant decryption authority through descriptor presence alone.

### 2. Stale descriptor replay

Attack:

An attacker replays an old descriptor for a revoked, compromised, or deprecated infrastructure surface.

Mitigations:

- require `createdAt` and `expiresAt`;
- enforce maximum TTL by surface;
- bind descriptors to key-continuity refs;
- record most recent known descriptor version/epoch where available;
- reject descriptors older than a known revocation marker;
- prefer fresh descriptors from trusted introductions.

### 3. Key-continuity downgrade

Attack:

A descriptor swaps the infrastructure key or operator key and tricks clients into treating it as the same bridge/relay/super peer.

Mitigations:

- track operator/surface key continuity;
- require explicit rotation/supersession event for known infrastructure;
- downgrade to constrained unknown state after unexpected key change;
- surface fingerprint change in UI for manual flows;
- never silently inherit positive reputation across unproven key changes.

### 4. Descriptor flood / discovery spam

Attack:

An attacker floods clients or bootstrap surfaces with descriptors to cause memory pressure, bad selection, or denial of service.

Mitigations:

- cap descriptor size;
- cap addresses/capabilities per descriptor;
- cap stored descriptors per operator/surface/source;
- expire aggressively;
- dedupe by descriptor digest/surface ref;
- rate-limit discovery ingestion;
- avoid fetching address metadata during validation.

### 5. Private-network URL abuse

Attack:

A malicious descriptor points to localhost, private IPs, metadata services, or credential-bearing URLs.

Mitigations:

- reject URL credentials;
- enforce scheme allowlists by transport kind;
- block private-network targets unless runtime policy explicitly permits local/LAN pairing;
- never fetch during validation;
- separate browser-safe and server-runtime fetch policies;
- privacy-safe error reporting.

### 6. Tunnel endpoint confusion

Attack:

A Holesail-like or other tunnel endpoint is presented as if it were a trusted peer, bridge, or super peer.

Mitigations:

- tunnel connection material only grants reachability;
- verify expected controller/device fingerprint after connection;
- run normal signed-envelope validation and admission;
- keep tunnel adapters behind `sync-client` transport contracts;
- do not import tunnel libraries into protocol/identity/trust packages;
- prefer bridge-over-tunnel before direct full-peer streams.

### 7. WebRTC signaling impersonation

Attack:

An attacker injects or swaps signaling material so peers connect to the wrong endpoint.

Mitigations:

- bind signaling sessions to expected peer/device fingerprints;
- expire signaling sessions quickly;
- cap signaling message size and count;
- authenticate signaling surface where practical;
- do not mutate protocol state on signaling alone;
- verify signed envelopes after DataChannel establishment.

### 8. Relay traffic correlation

Attack:

A relay that cannot decrypt content still learns timing, sizes, peer relationships, or group activity.

Mitigations:

- prefer direct P2P when possible;
- use relays as fallback;
- allow user/local policy to prefer known relays;
- minimize metadata in relay-visible addresses;
- batch/pad only if later threat models justify cost;
- keep logs rounded/redacted;
- expose relay use in diagnostics without leaking private payloads.

### 9. Mailbox retention abuse

Attack:

A bridge mailbox keeps messages longer than expected, builds metadata profiles, or claims delivery authority.

Mitigations:

- encrypted payloads only for private user data;
- retention TTL;
- byte caps;
- recipient/group capability binding;
- explicit delete/expiry behavior;
- delivery receipts must be signed/verified if they affect UX;
- mailbox is not durable source of truth.

### 10. Super-peer availability overclaim

Attack:

A super peer claims to keep data available but drops it, withholds it, serves stale versions, or prioritizes some peers unfairly.

Mitigations:

- verify fetched bytes by digest/CID/content link;
- use multiple storage hints where appropriate;
- track observed availability separately from operator claims;
- do not treat super-peer availability as latest-state authority;
- use local replication/apply rules to reject stale or invalid state;
- allow failover to other descriptors/providers.

### 11. IPFS-compatible storage poisoning

Attack:

A gateway/provider returns wrong bytes, incomplete bytes, slow responses, or maliciously large/compressed content.

Mitigations:

- verify digest/content link after fetch;
- enforce byte and decoded-size caps;
- enforce compression-ratio caps;
- treat gateway failures as normal unavailability;
- never trust gateway metadata as authorization;
- never log full private refs;
- never fetch private encrypted blocks unless local policy allows the fetch.

### 12. Relay Button operator mistake

Attack:

A user starts temporary infrastructure with excessive scope, long expiry, bad logging, or unclear authority boundaries.

Mitigations:

- default short expiry;
- default constrained capabilities;
- plain UI explanation of what helper can/cannot do;
- explicit stop/revoke action;
- no private decryption authority by default;
- descriptor preview before sharing;
- warnings for public exposure or paid resources;
- generated configs should be privacy-safe by default.

### 13. Trust-score incumbency

Attack:

Old infrastructure becomes privileged merely by age/history, making new community services unusable.

Mitigations:

- unknown means neutral/constrained, not bad;
- use `allow-with-limits` for valid new descriptors;
- separate lack of history from negative evidence;
- decay reputation toward neutral;
- require negative evidence for quarantine/deny;
- allow user-approved introductions to bootstrap trust.

### 14. Trust-score laundering

Attack:

A malicious operator abandons a bad descriptor and republishes as a new service to reset reputation.

Mitigations:

- track key/operator continuity when available;
- weight introductions and observed behavior;
- rate-limit new unknown descriptors;
- constrain unknown services;
- do not allow unknown services privileged routes immediately;
- keep abuse evidence local and advisory, not globally authoritative.

### 15. Durable Streams adapter confusion

Attack:

Implementation treats WebSocket behavior as canonical and later SSE/long-poll/WebTransport adapters drift semantically.

Mitigations:

- define Durable Streams semantics in tests/contracts;
- keep adapter-specific behavior behind runtime bindings;
- require same source-of-truth store behavior;
- require privacy-safe frames/errors;
- require backpressure/heartbeat/timeout policy per adapter;
- do not cache record bodies durably in brokers.

### 16. Forwarding mistaken for replication

Attack:

A relay forwards bytes successfully and clients treat that as accepted/applied protocol state.

Mitigations:

- distinguish transport delivery, bridge admission, store insert, and deterministic apply;
- require signed-envelope verification after transport;
- require idempotency/replay checks;
- only application/projection success counts as replicated state;
- relay surfaces should not issue replication claims.

## Testing requirements before runtime adoption

Before any descriptor or temporary infrastructure runtime lands, add tests for:

- valid/invalid infrastructure descriptors;
- expired descriptor rejection;
- no-expiry rejection;
- scope widening rejection;
- URL credential rejection;
- private-network target rejection where policy disallows it;
- unsupported transport rejection;
- malformed signature rejection;
- key-continuity mismatch downgrade;
- unknown descriptor starts constrained, not denied solely for newness;
- relay forwarding does not bypass signed-envelope validation;
- Durable Streams adapter contract behavior remains source-of-truth safe.

## Operational logging rules

Logs must not include:

- private payload bytes;
- bearer tokens;
- full private CIDs/digests where redaction helpers exist;
- encryption-key refs;
- unrounded high-resolution timing where fingerprinting risk exists;
- raw signaling payloads if they may include local network details.

Logs may include privacy-safe:

- surface kind;
- stable reason codes;
- redacted refs;
- coarse timestamps;
- descriptor validation status;
- bounded counters;
- operator-local rate-limit/quarantine decisions.

## Exit criteria

Adaptive reachability implementation should not begin until:

- ADR-008 is accepted or revised;
- this threat model is reviewed;
- descriptor schemas are fixture-backed;
- sync-client transport contracts exist;
- current bridge admission invariants remain preserved;
- Durable Streams semantics are tested independently from WebSocket adapter behavior.
