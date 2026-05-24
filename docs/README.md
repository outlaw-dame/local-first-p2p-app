# Documentation Map

This directory separates original architecture planning from the current implementation state so development can resume without losing intent or creating drift.

## Read order for development

1. `implementation/current-state.md` - what the repository actually does today.
2. `implementation/phase-map.md` - how current code maps to the implementation doctrine phases.
3. `implementation/planning-to-code-alignment.md` - what is implemented, partial, deferred, or intentionally different from the planning docs.
4. `implementation/known-deviations.md` - deviations from the original plan and whether they need ADRs.
5. `implementation/next-development-path.md` - the recommended next build sequence.
6. `architecture/README.md` - original planning document set and its intended role.
7. `adr/000-template.md` and `threat-model/template.md` before changing protocol, bridge, identity, media, search, MLS, compression, or naming behavior.

## Important distinction

The architecture documents are planning and doctrine. They were created before code existed. They should not be read as a claim that every subsystem is already implemented.

The implementation documents are the current truth layer. They explain where the code follows the plan, where it implements only a first slice, where it intentionally deviates, and what must happen before the next implementation phase is considered complete.

## Development rule

When code and planning docs differ, do not silently change one to match the other. Record the difference in `implementation/known-deviations.md`; if it changes architecture, add an ADR before implementing more code.
