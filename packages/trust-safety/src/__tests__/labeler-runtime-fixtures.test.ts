import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TrustSafetyError, validateLabelerEvent } from '../index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(HERE, '..', '..', 'fixtures', 'labelers');

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

describe('labelers fixtures — valid', () => {
  const files = listFixtures('valid');

  it('valid/ contains every documented kind', () => {
    expect(files).toContain('profile-published-automated.json');
    expect(files).toContain('profile-published-aggregator.json');
    expect(files).toContain('subscribed.json');
    expect(files).toContain('label-applied.json');
    expect(files).toContain('label-revoked.json');
    expect(files).toContain('annotation-created.json');
  });

  it.each(files)('valid: %s passes the event validator', (name) => {
    const value = readJson(join(FIXTURES_ROOT, 'valid', name));
    expect(() => validateLabelerEvent(value)).not.toThrow();
  });
});

describe('labelers fixtures — invalid', () => {
  const files = listFixtures('invalid');

  it('invalid/ covers documented adversarial cases', () => {
    expect(files).toContain('aggregator-without-sources.json');
    expect(files).toContain('aggregator-self-loop.json');
    expect(files).toContain('non-aggregator-with-aggregatorOf.json');
  });

  it.each(files)('invalid: %s is rejected with a TrustSafetyError', (name) => {
    const value = readJson(join(FIXTURES_ROOT, 'invalid', name));
    let thrown: unknown;
    try {
      validateLabelerEvent(value);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TrustSafetyError);
    expect((thrown as TrustSafetyError).code).toMatch(/^TS_/);
  });
});
