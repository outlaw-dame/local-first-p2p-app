import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.vite/**', '**/coverage/**']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }]
    }
  },
  // Phase 3.1.B — privacy-safe logging structural enforcement.
  //
  // Rationale and full doctrine: `docs/protocol/privacy-safe-logging.md`.
  //
  // `no-console` / `no-debugger` / `no-alert` are blanket-rejected in
  // production source (`packages/*/src/**`, `apps/*/src/**`). The whole
  // codebase today has ZERO violating call sites; this rule converts
  // "accidentally safe" into "structurally enforced." A future call
  // site that legitimately needs to log MUST add an
  // `eslint-disable-next-line` comment with a per-line justification
  // and a test pinning the output format.
  //
  // The two existing `globalThis.confirm(...)` consent prompts in the
  // PWA (identity rotation; adult-content gate enable) are intentional
  // user-facing prompts whose strings have already been authored under
  // the doctrine; each is annotated with an `eslint-disable-next-line`
  // marker explaining why.
  {
    files: ['packages/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}', '**/*.config.{ts,tsx}'],
    rules: {
      'no-console': 'error',
      'no-debugger': 'error',
      'no-alert': 'error'
    }
  }
);
