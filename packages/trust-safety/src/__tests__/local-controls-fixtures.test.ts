import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TrustSafetyError, validateLocalControlEvent } from '../index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(HERE, '..', '..', 'fixtures', 'local-controls');

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

describe('local-control fixtures — valid', () => {
  const files = listFixtures('valid');

  it('valid/ contains every documented kind', () => {
    expect(files).toContain('account-blocked.json');
    expect(files).toContain('account-blocked-with-ttl.json');
    expect(files).toContain('account-muted.json');
    expect(files).toContain('account-allowlisted.json');
    expect(files).toContain('domain-blocked.json');
    expect(files).toContain('keyword-muted-substring.json');
    expect(files).toContain('keyword-muted-word.json');
    expect(files).toContain('keyword-muted-semantic.json');
    expect(files).toContain('thread-muted.json');
    expect(files).toContain('post-hidden.json');
    expect(files).toContain('label-preference-set.json');
    expect(files).toContain('policy-list-subscribed.json');
    expect(files).toContain('policy-list-unsubscribed.json');
    expect(files).toContain('notification-preference.json');
    expect(files).toContain('preferences-snapshot.json');
  });

  it.each(files)('valid: %s passes the event validator', (name) => {
    const value = readJson(join(FIXTURES_ROOT, 'valid', name));
    expect(() => validateLocalControlEvent(value)).not.toThrow();
  });
});

describe('local-control fixtures — invalid', () => {
  const files = listFixtures('invalid');

  it('invalid/ covers the documented adversarial cases', () => {
    expect(files).toContain('unknown-kind.json');
    expect(files).toContain('unknown-version.json');
    expect(files).toContain('missing-target.json');
    expect(files).toContain('keyword-regex-not-supported.json');
    expect(files).toContain('keyword-semantic-missing-embedding.json');
    expect(files).toContain('keyword-substring-with-embedding.json');
    expect(files).toContain('label-preference-unknown.json');
    expect(files).toContain('domain-with-scheme.json');
    expect(files).toContain('expiry-before-creation.json');
    expect(files).toContain('policy-list-empty-kinds.json');
    expect(files).toContain('notification-unknown-channel.json');
  });

  it.each(files)('invalid: %s is rejected with a TrustSafetyError', (name) => {
    const value = readJson(join(FIXTURES_ROOT, 'invalid', name));
    let thrown: unknown;
    try {
      validateLocalControlEvent(value);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TrustSafetyError);
    expect((thrown as TrustSafetyError).code).toMatch(/^TS_/);
  });
});
