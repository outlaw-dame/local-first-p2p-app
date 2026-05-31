import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ContentAddressingError,
  validateBlockRef,
  validateBundleRef,
  validateContentLink,
  validateDigestRef,
  validateObjectRef,
  validateStorageLocationHint
} from '../index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(HERE, '..', '..', 'fixtures');

type Validator = (value: unknown) => unknown;

const FIXTURE_VALIDATOR: Readonly<Record<string, Validator>> = {
  // Filename prefix → validator.
  'digest-ref': validateDigestRef,
  'content-link': validateContentLink,
  'block-ref': validateBlockRef,
  'object-ref': validateObjectRef,
  'bundle-ref': validateBundleRef,
  'location-hint': validateStorageLocationHint
};

function validatorForFile(name: string): Validator {
  for (const prefix of Object.keys(FIXTURE_VALIDATOR)) {
    if (name.startsWith(`${prefix}-`) || name === `${prefix}.json`) {
      return FIXTURE_VALIDATOR[prefix]!;
    }
  }
  throw new Error(`No validator mapped for fixture: ${name}`);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function listFixtures(subdir: 'valid' | 'invalid'): string[] {
  const dir = join(FIXTURES_ROOT, subdir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

describe('fixtures — valid', () => {
  const files = listFixtures('valid');
  it('valid/ contains at least the documented files', () => {
    expect(files).toContain('digest-ref-sha256.json');
    expect(files).toContain('content-link-cidv1-raw.json');
    expect(files).toContain('block-ref-raw-public.json');
    expect(files).toContain('block-ref-encrypted-private.json');
    expect(files).toContain('block-ref-compressed-bounded.json');
    expect(files).toContain('object-ref-event.json');
    expect(files).toContain('object-ref-media.json');
    expect(files).toContain('object-ref-report-evidence.json');
    expect(files).toContain('bundle-ref-car-v1.json');
    expect(files).toContain('location-hint-bridge-store.json');
  });

  it.each(files)('valid: %s passes its validator', (name) => {
    const value = readJson(join(FIXTURES_ROOT, 'valid', name));
    const validator = validatorForFile(name);
    expect(() => validator(value)).not.toThrow();
  });
});

describe('fixtures — invalid', () => {
  const files = listFixtures('invalid');
  it('invalid/ contains at least the documented files', () => {
    expect(files).toContain('digest-ref-unknown-algorithm.json');
    expect(files).toContain('digest-ref-malformed-value.json');
    expect(files).toContain('digest-ref-wrong-length.json');
    expect(files).toContain('content-link-cidv0-new-object.json');
    expect(files).toContain('content-link-unsupported-codec.json');
    expect(files).toContain('block-ref-negative-byte-length.json');
    expect(files).toContain('block-ref-non-finite-byte-length.json');
    expect(files).toContain('block-ref-compression-unbounded.json');
    expect(files).toContain('location-hint-url-credentials.json');
    expect(files).toContain('bundle-ref-empty-roots.json');
    expect(files).toContain('object-ref-malformed-url.json');
    expect(files).toContain('object-ref-private-public-hint.json');
  });

  it.each(files)('invalid: %s is rejected with a ContentAddressingError', (name) => {
    const value = readJson(join(FIXTURES_ROOT, 'invalid', name));
    const validator = validatorForFile(name);
    let thrown: unknown;
    try {
      validator(value);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ContentAddressingError);
    expect((thrown as ContentAddressingError).code).toMatch(/^CA_/);
  });
});
