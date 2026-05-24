# Threat Model: Title

- Status: Draft | Reviewed | Accepted
- Date: YYYY-MM-DD
- Related ADRs:
- Related PRs:
- Owners:

## Feature / surface

Describe the feature, protocol surface, storage surface, or runtime being modeled.

## Assets

What must be protected?

- Private payloads:
- Private keys:
- Identity/control state:
- Local database state:
- Derived indexes:
- Metadata:
- Availability:

## Trust boundaries

List boundaries crossed by data or control:

- client/device boundary:
- bridge/server boundary:
- peer/super-peer boundary:
- local storage boundary:
- service worker/cache boundary:
- third-party API boundary:

## Actors

- honest local user:
- honest remote peer:
- compromised bridge:
- malicious peer:
- revoked device:
- network attacker:
- malicious public indexer:
- compromised local device:

## Data flow

1. 
2. 
3. 

## Threats

| Threat | Impact | Existing mitigation | Missing mitigation | Test required |
|---|---|---|---|---|
| Forged input | | | | |
| Replay/stale input | | | | |
| Duplicate input | | | | |
| Reordered input | | | | |
| Metadata leakage | | | | |
| Private plaintext leakage | | | | |
| Resource exhaustion | | | | |
| Confused-deputy behavior | | | | |
| Revocation bypass | | | | |

## Logging and telemetry rules

- Private plaintext allowed in logs: No.
- Private keys allowed in logs: No.
- Sensitive identifiers allowed in logs:
- Redaction/hash policy:
- User-visible error policy:

## Required tests before beta

- [ ] Valid happy path.
- [ ] Invalid signature / forged input.
- [ ] Stale/replayed input.
- [ ] Duplicate input.
- [ ] Malformed input.
- [ ] Resource-exhaustion input.
- [ ] Privacy/logging assertion.
- [ ] Revocation/permission change where applicable.

## Residual risk

Document what remains risky even after mitigations.

## Review notes

- 
