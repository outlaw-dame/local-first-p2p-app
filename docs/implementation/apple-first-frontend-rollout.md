# Apple-First Frontend Rollout Brief

This brief defines how to deliver an Apple-like product feel while staying aligned with the current architecture and implementation doctrine.

It is intentionally implementation-focused: no framework swap, no duplicate state layers, and no sync-boundary drift.

## 1) Architecture guardrails

Keep these boundaries unchanged:

- Shell stays Framework7 React + TypeScript + Vite.
- Local-first operational state stays Dexie-backed through existing packages.
- Bridge/public index remote state stays behind TanStack Query boundaries.
- Sync behavior stays in sync-client boundaries and must not be hidden in UI components.
- Apple-like UX is delivered through tokens, component wrappers, platform adaptation, and copy/icon polish.

Reference docs:

- `docs/frontend_architecture.md`
- `docs/implementation/current-state.md`
- `docs/implementation/planning-to-code-alignment.md`

## 2) Repo mapping (where changes should live)

Core visual language:

- `packages/design-tokens/src/tokens.css`
- `packages/design-tokens/src/index.ts`

Platform adaptation and OS detection:

- `packages/platform/src/index.ts`

Reusable UI wrappers and primitives:

- `packages/ui/src/`

PWA shell wiring and usage:

- `apps/pwa/src/root-app.tsx`
- `apps/pwa/src/styles.css`

## 3) Apple-first target behavior

### 3.1 Typography and spacing

- Keep SF-style stack on Apple platforms.
- Use platform-adaptive body and control density through tokens, not one-off CSS.
- Keep minimum touch target at 44px for iOS posture.

### 3.2 Materials and surfaces

- Preserve material blur/elevated surfaces through semantic tokens.
- Keep high contrast between label and secondary label in both light and dark themes.
- Ensure list/card/sheet radius values stay tokenized and consistent.

### 3.3 Platform adaptation

- Use detected platform/runtime to tune shell details: titles, spacing, icon weight, and interaction hints.
- Keep adaptation deterministic and testable (no hidden UA conditionals inside random components).

### 3.4 Icon and emoji strategy

- Use native emoji rendering (do not replace with image emoji packs).
- Prefer platform-native icon style where possible, with explicit fallback set for non-Apple targets.
- Do not mix multiple icon visual languages in the same view.

### 3.5 Motion policy

- Add a small set of meaningful transitions (page transition, list reveal, action confirmation).
- Respect prefers-reduced-motion and keep motion optional.
- Motion should communicate state change, not become decorative noise.

## 4) Phased rollout plan

### Phase A - Token hardening (small PRs)

Scope:

- Expand semantic tokens for platform-specific typography, spacing density, and icon sizing.
- Keep current token names stable where possible; add aliases only when needed.

Files:

- `packages/design-tokens/src/tokens.css`
- `packages/design-tokens/src/index.ts`

Exit criteria:

- PWA shell consumes semantic tokens only for typography/surface/radius/spacing.
- No hardcoded color/radius/spacing remains in feature components for core shell surfaces.

### Phase B - Platform profile layer

Scope:

- Add a lightweight platform profile helper derived from existing capabilities.
- Profiles: iOS, Android, Desktop web.
- Keep output focused on UX knobs (density, icon style, title treatment), not business logic.

Files:

- `packages/platform/src/index.ts`
- `packages/ui/src/` (if profile helpers are consumed by components)

Exit criteria:

- PWA can request a single profile object and style accordingly.
- No component performs duplicated user-agent parsing.

### Phase C - UI wrapper alignment

Scope:

- Add or refine shared UI wrappers for list blocks, cards, nav bars, status rows, and action buttons.
- Ensure wrappers apply tokenized classes and platform profile variants consistently.

Files:

- `packages/ui/src/`
- `apps/pwa/src/root-app.tsx`
- `apps/pwa/src/styles.css`

Exit criteria:

- Root shell screens use wrappers for major surfaces.
- Visual consistency increases without changing sync/storage architecture.

### Phase D - Icon and emoji rollout

Scope:

- Introduce explicit icon policy and mapping utilities.
- Keep native emoji only.

Files:

- `packages/ui/src/`
- `apps/pwa/src/root-app.tsx`

Exit criteria:

- One icon policy is used across PWA shell.
- Apple platforms receive Apple-first icon treatment with tested fallback elsewhere.

### Phase E - Motion and accessibility polish

Scope:

- Add targeted transitions for shell-level interactions.
- Respect reduced-motion and maintain touch target/accessibility rules.

Files:

- `apps/pwa/src/styles.css`
- `packages/ui/src/`

Exit criteria:

- Motion is subtle, consistent, and disabled where user preference requires.
- No regression in legibility, contrast, or hit-area behavior.

## 5) What not to do

- Do not replace Framework7 shell with another UI framework in this phase.
- Do not introduce Tailwind/Konsta migration while architecture guardrails are still being hardened.
- Do not blend sync transport behavior into UI wrappers.
- Do not add platform-specific behavior that changes protocol or persistence semantics.

## 6) PR template for this rollout

Each PR should include:

1. Brief intent and phase label (A through E).
2. Explicit list of files touched.
3. Screenshots for iOS-like, Android-like, and desktop rendering.
4. Accessibility notes (contrast, reduced motion, touch targets).
5. Statement confirming no changes to local-first write path, outbox semantics, or sync transport contracts.

## 7) Suggested first slice

Start with Phase A only:

- add missing semantic tokens,
- wire token usage through current PWA shell surfaces,
- no icon library migration yet,
- no motion library introduction yet.

This gives immediate visual quality gains with minimal architectural risk.