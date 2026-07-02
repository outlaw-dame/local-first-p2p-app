import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TrustSafetyError, validateTransportEvent } from '../index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(HERE, '..', '..', 'fixtures', 'transport-admission');

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

describe('transport-admission fixtures — valid', () => {
  const files = listFixtures('valid');

  it('valid/ contains every documented kind', () => {
    expect(files).toContain('event-accepted.json');
    expect(files).toContain('peer-rate-limited.json');
    expect(files).toContain('peer-quarantined.json');
    expect(files).toContain('media-rejected.json');
  });

  it.each(files)('valid: %s passes the event validator', (name) => {
    const value = readJson(join(FIXTURES_ROOT, 'valid', name));
    expect(() => validateTransportEvent(value)).not.toThrow();
  });
});

describe('transport-admission fixtures — invalid', () => {
  const files = listFixtures('invalid');

  it('invalid/ covers the adversarial cases', () => {
    expect(files).toContain('unknown-kind.json');
    expect(files).toContain('rate-limited-retry-before-create.json');
  });

  it.each(files)('invalid: %s is rejected with a TrustSafetyError', (name) => {
    const value = readJson(join(FIXTURES_ROOT, 'invalid', name));
    let thrown: unknown;
    try {
      validateTransportEvent(value);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TrustSafetyError);
    expect((thrown as TrustSafetyError).code).toMatch(/^TS_/);
  });
});
