# Low-Bandwidth Sync Profile

- Status: Draft
- Specification series: 4
- Specification version: 0.x
- Scope: constrained, nearby, intermittent, and degraded-infrastructure synchronization
- Profiles: Offline, Core, Messaging, Social
- Related:
  - `docs/specification/04-sync/selective-replica-sync.md`
  - `docs/specification/04-sync/sync-interests.md`
  - `docs/specification/04-sync/checkpoints.md`

## Purpose

This document defines low-bandwidth sync behavior for constrained or degraded conditions.

Low-bandwidth sync is part of protocol resilience, not just an optimization.

## Supported conditions

The profile should support:

- unstable mobile networks;
- high-latency links;
- metered bandwidth;
- local Wi-Fi or hotspot transfer;
- Bluetooth or nearby transfer;
- file import/export;
- intermittent connectivity;
- censored or blocked hosted infrastructure;
- media-unavailable operation;
- partial replicas.

## Requirements

- Low-bandwidth sync MUST preserve authority validation.
- Low-bandwidth sync MUST NOT apply records solely because they were received.
- Implementations SHOULD exchange small control records before large payloads.
- Implementations SHOULD support headers-only sync.
- Implementations SHOULD support lazy payload fetch.
- Implementations SHOULD support narrow Sync Interests.
- Implementations SHOULD degrade to local chronological or partial views when rich infrastructure is unavailable.

## Priority order

Low-bandwidth sync SHOULD prioritize:

1. Identity Root proofs;
2. Device authorization and revocation;
3. Capability grants and revocations;
4. key epoch / MLS control state;
5. Space and Channel membership checkpoints;
6. mailbox headers, receipts, and ACKs;
7. recent small text/control records;
8. Object References and digests;
9. compact feed or Channel heads;
10. small previews where policy permits.

Low-bandwidth sync SHOULD defer:

- large media;
- thumbnails unless requested;
- generated summaries;
- embeddings;
- search indexes;
- long history windows;
- analytics or nonessential metadata;
- payloads above negotiated thresholds.

## Headers-first behavior

Headers-first sync SHOULD provide enough information to decide whether to fetch payloads later.

Headers may include:

- record type;
- signer reference;
- target partition;
- timestamp or sequence marker;
- object digest/reference;
- payload size;
- privacy scope;
- required capability;
- checkpoint reference.

Headers MUST NOT leak private data beyond the relevant privacy policy.

## Payload caps

Peers SHOULD be able to negotiate maximum inline payload size.

Payloads above the cap SHOULD be replaced by Object References or deferred fetch hints.

## Local/nearby transfer

Local/nearby transfer SHOULD preserve the same validation requirements as hosted sync.

Nearby discovery SHOULD minimize metadata exposure.

A device discovered nearby MUST NOT be trusted as an authorized Device merely because it is physically nearby.

## Media behavior

Applications MAY display placeholders when media payloads are unavailable but safe metadata is available.

Media fetch SHOULD be explicit, lazy, resumable, and verifiable where practical.

## Failure behavior

When bandwidth or infrastructure is unavailable, implementations SHOULD:

- keep local writes queued;
- preserve local projections;
- expose stale-state indicators where useful;
- exchange compact checkpoints;
- defer large payloads;
- retry with backoff;
- offer Portable Sync Drop export/import where supported.

## Security considerations

Implementations MUST guard against:

- skipping validation to save bandwidth;
- nearby peer impersonation;
- metadata leakage through discovery;
- malicious compact summaries;
- stale revocation state;
- large payload DoS;
- private object identifier leakage;
- unsafe auto-fetch of media.

## Open questions

- Required transports for Offline Profile.
- Initial maximum recommended payload sizes.
- Privacy-preserving nearby discovery mechanism.
- Whether low-bandwidth profile requires Portable Sync Drop support.
