# Phase 0 Checklist

- Status: Draft
- Date: 2026-06-23

## Completed in this branch

- Added ADR-008 placeholder for adaptive reachability and ephemeral infrastructure.
- Added infrastructure capability surface doctrine.
- Added adaptive reachability integration plan.
- Added adaptive reachability and temporary infrastructure threat model.
- Added roadmap ordering reference.
- Added current-state addendum to avoid rewriting the larger implementation truth document in place.

## Confirmed repo state used for this pass

- Phase 1.8 reputation graph is documented as complete in `docs/implementation/current-state.md`.
- Capability proof verifier work from Issue #84 is complete according to recent PR state: native, UCAN, and VC verifier schemes are live; zcap-ld and bearcap remain intentionally unsupported/abstaining unless a later ADR changes that.
- Durable Streams is the live-delivery architecture; WebSocket is the current adapter.

## Intentional non-changes

- No code was changed.
- Existing docs were not rewritten in place.
- Existing implementation truth docs remain available for comparison and rollback.
- Adaptive reachability is documented as planned, not implemented.

## Follow-up after merge

1. Decide whether to update `docs/implementation/current-state.md` directly in a later narrow docs PR.
2. Add capability proof verifier completion summary.
3. Begin private/account-local payload envelope work.
4. Begin MLS ADR and dependency decision.
