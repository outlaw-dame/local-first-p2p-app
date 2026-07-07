/**
 * Phase 3.1.C — Privacy-safe logging audit-pin test.
 *
 * Structural test that walks every production source file under
 * `packages/<pkg>/src/**` and `apps/<app>/src/**` (excluding test
 * files and config files) and asserts that none of them contain
 * forbidden log surfaces.
 *
 * This is INTENTIONALLY a duplicate of the ESLint `no-console`
 * rule from `eslint.config.js`. Defense-in-depth: even if a future
 * change removes or weakens the ESLint rule, the test still fails
 * if a `console.*` or `debugger` call lands in production code.
 *
 * For `confirm`/`alert`/`prompt`, the test pins the inventory of
 * existing intentional consent prompts. A new one must update this
 * list AND add an `eslint-disable-next-line no-alert` marker to
 * the call site (the marker is what ESLint checks; this test
 * verifies the marker exists and the inventory entry is current).
 *
 * Doctrine: `docs/protocol/privacy-safe-logging.md`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
// repo root: ../../../../ from packages/trust-safety/src/__tests__
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');

/**
 * Production source roots. Each entry must be a directory that exists
 * at the repo root.
 */
const PRODUCTION_ROOTS: ReadonlyArray<string> = [
  'packages/content-addressing/src',
  'packages/crypto/src',
  'packages/design-tokens/src',
  'packages/identity/src',
  'packages/local-store/src',
  'packages/platform/src',
  'packages/protocol/src',
  'packages/search/src',
  'packages/sync-client/src',
  'packages/trust-safety/src',
  'packages/ui/src',
  'apps/bridge-service/src',
  'apps/pwa/src'
];

/**
 * File-name patterns excluded from the scan (tests, configs).
 * Mirrors the ESLint `files` / `ignores` lists.
 */
function isTestFile(path: string): boolean {
  return (
    path.endsWith('.test.ts') ||
    path.endsWith('.test.tsx') ||
    path.includes(`${'/'}__tests__${'/'}`) ||
    path.endsWith('.config.ts') ||
    path.endsWith('.config.tsx')
  );
}

function isSourceFile(path: string): boolean {
  return path.endsWith('.ts') || path.endsWith('.tsx');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  for (const name of entries) {
    const full = join(dir, name);
    let s: ReturnType<typeof statSync>;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === '.vite') continue;
      out.push(...walk(full));
    } else if (s.isFile() && isSourceFile(full) && !isTestFile(full)) {
      out.push(full);
    }
  }
  return out;
}

function collectProductionFiles(): string[] {
  const files: string[] = [];
  for (const rel of PRODUCTION_ROOTS) {
    const abs = join(REPO_ROOT, rel);
    files.push(...walk(abs));
  }
  return files;
}

const PRODUCTION_FILES = collectProductionFiles();

// ---------------------------------------------------------------------------
// Sanity: the file collector actually finds files.
// ---------------------------------------------------------------------------

describe('Phase 3.1.C — audit-pin file collector', () => {
  it('locates a non-trivial number of production source files', () => {
    // If this drops to zero the test would silently pass — guard against
    // a future refactor moving the source roots.
    expect(PRODUCTION_FILES.length).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------
// `console.*` audit-pin
// ---------------------------------------------------------------------------

/**
 * Match `console.log(`, `console.debug(`, ... with optional whitespace.
 * Conservative — does not match references like `typeof console.log`.
 */
const CONSOLE_PATTERN =
  /\bconsole\s*\.\s*(log|debug|info|warn|error|trace|table|dir|group|groupEnd)\s*\(/g;

describe('Phase 3.1.C — no console.* in production source', () => {
  it('every file is free of console.* calls', () => {
    const offenders: string[] = [];
    for (const file of PRODUCTION_FILES) {
      const text = readFileSync(file, 'utf8');
      let match: RegExpExecArray | null;
      const re = new RegExp(CONSOLE_PATTERN.source, CONSOLE_PATTERN.flags);
      while ((match = re.exec(text)) !== null) {
        // The line:col of the offending call.
        const before = text.slice(0, match.index);
        const line = before.split('\n').length;
        offenders.push(`${relative(REPO_ROOT, file)}:${line}: ${match[0]}`);
      }
    }
    if (offenders.length > 0) {
      // Provide actionable output rather than a useless "false to be true".
      throw new Error(
        `Found ${offenders.length} forbidden console.* call(s) in production source:\n` +
          offenders.map((o) => `  ${o}`).join('\n') +
          `\n\nIf you genuinely need to log, see docs/protocol/privacy-safe-logging.md` +
          `\n— add an eslint-disable-next-line + a test pinning the log format.`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// `debugger` audit-pin
// ---------------------------------------------------------------------------

const DEBUGGER_PATTERN = /\bdebugger\s*;/g;

describe('Phase 3.1.C — no debugger in production source', () => {
  it('every file is free of debugger statements', () => {
    const offenders: string[] = [];
    for (const file of PRODUCTION_FILES) {
      const text = readFileSync(file, 'utf8');
      let match: RegExpExecArray | null;
      const re = new RegExp(DEBUGGER_PATTERN.source, DEBUGGER_PATTERN.flags);
      while ((match = re.exec(text)) !== null) {
        const before = text.slice(0, match.index);
        const line = before.split('\n').length;
        offenders.push(`${relative(REPO_ROOT, file)}:${line}`);
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        `Found ${offenders.length} debugger statement(s) in production source:\n` +
          offenders.map((o) => `  ${o}`).join('\n')
      );
    }
  });
});

// ---------------------------------------------------------------------------
// `alert`/`confirm`/`prompt` inventory
// ---------------------------------------------------------------------------

/**
 * Every call site of `confirm()`, `alert()`, or `prompt()` in
 * production source. The inventory is pinned here so adding a new
 * one is an explicit doctrine-review action, not a silent change.
 *
 * Each entry is a relative path under the repo root. A new entry
 * here MUST be paired with an `eslint-disable-next-line no-alert`
 * marker at the call site, otherwise ESLint will reject the file.
 */
const INTENTIONAL_CONSENT_PROMPT_FILES: ReadonlyArray<string> = [
  'apps/pwa/src/pwa-identity-audit.tsx',
  'apps/pwa/src/pwa-trust-safety-settings.tsx'
];

/**
 * Match `confirm(`, `alert(`, `prompt(` not part of a longer
 * identifier. Allows `globalThis.confirm(` (the leading `.` is
 * acceptable) but skips e.g. `myConfirm(` or `passwordPrompt(`.
 */
const ALERT_FAMILY_PATTERN = /(?<![A-Za-z0-9_$])(?:confirm|alert|prompt)\s*\(/g;

describe('Phase 3.1.C — alert/confirm/prompt inventory is pinned', () => {
  it('every consent-prompt call site is in the inventory', () => {
    const seen = new Set<string>();
    for (const file of PRODUCTION_FILES) {
      const text = readFileSync(file, 'utf8');
      const re = new RegExp(ALERT_FAMILY_PATTERN.source, ALERT_FAMILY_PATTERN.flags);
      if (re.test(text)) {
        seen.add(relative(REPO_ROOT, file));
      }
    }
    const unexpected = [...seen].filter((f) => !INTENTIONAL_CONSENT_PROMPT_FILES.includes(f));
    const missing = INTENTIONAL_CONSENT_PROMPT_FILES.filter((f) => !seen.has(f));
    if (unexpected.length > 0 || missing.length > 0) {
      throw new Error(
        `Inventory drift detected. Update INTENTIONAL_CONSENT_PROMPT_FILES in this test.\n` +
          (unexpected.length > 0
            ? `  Unexpected new consent-prompt site(s):\n` +
              unexpected.map((u) => `    ${u}`).join('\n') +
              '\n'
            : '') +
          (missing.length > 0
            ? `  Inventoried site(s) no longer present:\n` +
              missing.map((m) => `    ${m}`).join('\n') +
              '\n'
            : '') +
          `\nDoctrine: docs/protocol/privacy-safe-logging.md`
      );
    }
  });

  it('every consent-prompt site has an eslint-disable-next-line marker for no-alert', () => {
    const offenders: string[] = [];
    for (const rel of INTENTIONAL_CONSENT_PROMPT_FILES) {
      const abs = join(REPO_ROOT, rel);
      const text = readFileSync(abs, 'utf8');
      const lines = text.split('\n');
      const re = new RegExp(ALERT_FAMILY_PATTERN.source, ALERT_FAMILY_PATTERN.flags);
      lines.forEach((line, idx) => {
        if (re.test(line)) {
          // Look back up to 3 lines for the eslint-disable-next-line marker.
          const lookBack = lines.slice(Math.max(0, idx - 3), idx).join('\n');
          if (!/eslint-disable-next-line[^\n]*no-alert/.test(lookBack)) {
            offenders.push(`${rel}:${idx + 1}: missing eslint-disable-next-line no-alert`);
          }
        }
      });
    }
    if (offenders.length > 0) {
      throw new Error(offenders.join('\n'));
    }
  });
});
