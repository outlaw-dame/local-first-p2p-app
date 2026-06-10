# Capability reliance PR checklist

Before merge, verify:

```bash
pnpm lint
pnpm typecheck
pnpm test -- packages/capabilities
pnpm test
pnpm build
```

Known cleanup follow-up: `docs/implementation/capability-evaluator-time-note.md` is obsolete after PR #59 and should be removed when the GitHub write path permits it.
