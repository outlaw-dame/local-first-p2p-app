# Capability reliance helper slice

Status: implemented on `cap-reliance`
Date: 2026-06-09

This slice adds a pure helper in `@lfp2p/capabilities` that prepares the later trust-policy integration boundary without adding a cross-package dependency yet.

Implemented behavior:

- credential evidence without a capability decision denies with `capability.vc-only-authority-denied`;
- missing capability authority denies with `capability.unverified-proof`;
- bearcap proofs are denied for protected action families such as identity-control, role assignment, labels, relays, and super-peers;
- already-denied capability decisions pass through unchanged;
- allowed non-bearcap capability decisions pass through unchanged.

This preserves the project doctrine: VCs prove claims, capabilities grant authority, and bearcaps remain restricted to low-risk short-lived bootstrap/fetch flows.
