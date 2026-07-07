import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TrustSafetyError, validateCurationEvent } from '../index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(HERE, '..', '..', 'fixtures', 'curation');

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

describe('curation fixtures — valid', () => {
  const files = listFixtures('valid');

  it('valid/ contains every documented kind', () => {
    expect(files).toContain('rule-created.json');
    expect(files).toContain('rule-disabled.json');
    expect(files).toContain('item-boosted.json');
    expect(files).toContain('item-downranked.json');
    expect(files).toContain('item-excluded.json');
    expect(files).toContain('explanation-recorded.json');
  });

  it.each(files)('valid: %s passes the validator', (name) => {
    const value = readJson(join(FIXTURES_ROOT, 'valid', name));
    expect(() => validateCurationEvent(value)).not.toThrow();
  });
});

describe('curation fixtures — invalid', () => {
  const files = listFixtures('invalid');

  it('invalid/ covers adversarial cases', () => {
    expect(files).toContain('rule-disabled-unknown-version.json');
    expect(files).toContain('item-boosted-negative-delta.json');
    expect(files).toContain('item-excluded-unknown-excludeFrom.json');
  });

  it.each(files)('invalid: %s rejected with a TrustSafetyError', (name) => {
    const value = readJson(join(FIXTURES_ROOT, 'invalid', name));
    let thrown: unknown;
    try {
      validateCurationEvent(value);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TrustSafetyError);
    expect((thrown as TrustSafetyError).code).toMatch(/^TS_/);
  });
});
