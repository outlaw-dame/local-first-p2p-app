import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TrustSafetyError, validateReportAppealEvent } from '../index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(HERE, '..', '..', 'fixtures', 'reports-appeals');

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function listFixtures(subdir: 'valid' | 'invalid'): string[] {
  const dir = join(FIXTURES_ROOT, subdir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort();
}

describe('reports-appeals fixtures — valid', () => {
  const files = listFixtures('valid');

  it('valid/ contains every documented lifecycle event', () => {
    expect(files).toContain('report-created.json');
    expect(files).toContain('report-acknowledged.json');
    expect(files).toContain('report-resolved-upheld.json');
    expect(files).toContain('appeal-created.json');
    expect(files).toContain('appeal-resolved.json');
  });

  it.each(files)('valid: %s passes the event validator', (name) => {
    const value = readJson(join(FIXTURES_ROOT, 'valid', name));
    expect(() => validateReportAppealEvent(value)).not.toThrow();
  });
});

describe('reports-appeals fixtures — invalid', () => {
  const files = listFixtures('invalid');

  it('invalid/ covers documented adversarial cases', () => {
    expect(files).toContain('report-created-unknown-version.json');
    expect(files).toContain('report-resolved-unknown-resolution.json');
    expect(files).toContain('report-resolved-escalated-without-target.json');
    expect(files).toContain('appeal-resolved-overturned-without-new-decision.json');
  });

  it.each(files)('invalid: %s is rejected with a TrustSafetyError', (name) => {
    const value = readJson(join(FIXTURES_ROOT, 'invalid', name));
    let thrown: unknown;
    try {
      validateReportAppealEvent(value);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TrustSafetyError);
    expect((thrown as TrustSafetyError).code).toMatch(/^TS_/);
  });
});
