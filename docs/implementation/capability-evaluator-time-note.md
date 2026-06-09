# Capability evaluator time note

Status: open follow-up
Date: 2026-06-09

`packages/capabilities/src/evaluate.ts` should use only the caller supplied `input.now` value when creating capability decision timestamps.

Required change:

- normalize `input.now` once at the start of `evaluateCapabilityInvocation`;
- use the normalized value for every returned decision;
- remove ambient wall-clock fallback from invalid-time handling;
- add a regression test proving two identical evaluations produce identical decision records.

Reason: capability policy decisions must be replayable from the same evidence and policy inputs.
