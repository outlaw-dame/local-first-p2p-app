# Bearcap metadata profile

This package includes `src/bearcaps.ts` for redacted metadata validation around short-lived possession tokens.

Rules:

- the module never generates or stores secrets;
- only redacted identifiers and digests are accepted;
- URL-like or query-token-like identifiers are rejected;
- purpose is restricted to invite bootstrap, encrypted bundle pickup, temporary media fetch, bridge pickup, and recovery handoff bootstrap;
- expiry, single-use, and max-use checks are explicit.

The module is currently imported directly as `@lfp2p/capabilities/src/bearcaps.ts` in tests until the root package export can be updated by the normal write path.
