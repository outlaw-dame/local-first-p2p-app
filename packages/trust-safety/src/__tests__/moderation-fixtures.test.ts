import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TrustSafetyError, validateModerationEvent } from '../index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(HERE, '..', '..', 'fixtures', 'moderation');

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

describe('moderation fixtures — valid', () => {
  const files = listFixtures('valid');

  it('valid/ contains the documented examples', () => {
    expect(files).toContain('policy-created.json');
    expect(files).toContain('queue-item-created.json');
    expect(files).toContain('decision-recorded.json');
  });

  it.each(files)('valid: %s passes the event validator', (name) => {
    const value = readJson(join(FIXTURES_ROOT, 'valid', name));
    expect(() => validateModerationEvent(value)).not.toThrow();
  });
});

describe('moderation fixtures — invalid (shape-level)', () => {
  const files = listFixtures('invalid');

  it('invalid/ covers documented adversarial cases', () => {
    expect(files).toContain('policy-version-zero.json');
    expect(files).toContain('policy-supersedes-not-less-than-version.json');
    expect(files).toContain('queue-resolved-unknown-resolution.json');
  });

  it.each(files)('invalid: %s is rejected with a TrustSafetyError', (name) => {
    const value = readJson(join(FIXTURES_ROOT, 'invalid', name));
    let thrown: unknown;
    try {
      validateModerationEvent(value);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TrustSafetyError);
    expect((thrown as TrustSafetyError).code).toMatch(/^TS_/);
  });
});
