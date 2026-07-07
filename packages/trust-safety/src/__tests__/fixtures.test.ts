import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  TrustSafetyError,
  validateCurationExplanation,
  validateCurationRule,
  validateSafetyAnnotation,
  validateSafetyAppeal,
  validateSafetyAuthority,
  validateSafetyLabel,
  validateSafetyLabelDefinition,
  validateSafetyLabelerProfile,
  validateSafetyLabelerSubscription,
  validateSafetyPolicyDecision,
  validateSafetyReport,
  validateSafetySubjectRef,
  validateTransportAdmissionDecision
} from '../index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(HERE, '..', '..', 'fixtures');

type Validator = (value: unknown) => unknown;

/**
 * Filename prefix → validator. Longer prefixes are matched first to
 * disambiguate (e.g. `safety-label-definition-` must match before
 * `safety-label-`).
 */
// Longer (more specific) prefixes must come first so that
// 'safety-label-definition' matches before 'safety-label', and
// 'safety-labeler-*' matches before 'safety-label-*'.
const FIXTURE_VALIDATORS: ReadonlyArray<readonly [string, Validator]> = [
  ['safety-label-definition', validateSafetyLabelDefinition],
  ['safety-labeler-profile', validateSafetyLabelerProfile],
  ['safety-labeler-subscription', validateSafetyLabelerSubscription],
  ['safety-policy-decision', validateSafetyPolicyDecision],
  ['safety-annotation', validateSafetyAnnotation],
  ['safety-authority', validateSafetyAuthority],
  ['safety-appeal', validateSafetyAppeal],
  ['safety-report', validateSafetyReport],
  ['safety-subject', validateSafetySubjectRef],
  ['safety-label', validateSafetyLabel],
  ['transport-admission', validateTransportAdmissionDecision],
  ['curation-explanation', validateCurationExplanation],
  ['curation-rule', validateCurationRule]
];

function validatorForFile(name: string): Validator {
  for (const [prefix, validator] of FIXTURE_VALIDATORS) {
    if (name.startsWith(prefix)) return validator;
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
    expect(files).toContain('safety-authority-device-local.json');
    expect(files).toContain('safety-authority-community-moderator.json');
    expect(files).toContain('safety-subject-event.json');
    expect(files).toContain('safety-subject-actor.json');
    expect(files).toContain('safety-subject-blob.json');
    expect(files).toContain('safety-subject-url.json');
    expect(files).toContain('safety-annotation-classifying.json');
    expect(files).toContain('safety-label-definition-abuse.json');
    expect(files).toContain('safety-label-spam.json');
    expect(files).toContain('safety-labeler-profile.json');
    expect(files).toContain('safety-labeler-subscription.json');
    expect(files).toContain('safety-report.json');
    expect(files).toContain('safety-appeal.json');
    expect(files).toContain('safety-policy-decision-hide.json');
    expect(files).toContain('safety-policy-decision-reject-transport.json');
    expect(files).toContain('transport-admission-decision-accept.json');
    expect(files).toContain('curation-rule-downrank.json');
    expect(files).toContain('curation-explanation.json');
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
    expect(files).toContain('safety-authority-unknown-version.json');
    expect(files).toContain('safety-authority-invalid-scope.json');
    expect(files).toContain('safety-authority-missing-required.json');
    expect(files).toContain('safety-subject-unknown-type.json');
    expect(files).toContain('safety-label-invalid-confidence.json');
    expect(files).toContain('safety-label-invalid-category.json');
    expect(files).toContain('safety-label-private-evidence-in-public-flow.json');
    expect(files).toContain('safety-label-definition-hard-safety-downgrade.json');
    expect(files).toContain('safety-report-missing-idempotency.json');
    expect(files).toContain('safety-report-private-subject-public-scope.json');
    expect(files).toContain('safety-policy-decision-reject-transport-wrong-scope.json');
    expect(files).toContain('safety-policy-decision-unknown-action.json');
    expect(files).toContain('transport-admission-non-operator-authority.json');
    expect(files).toContain('curation-rule-moderation-action-in-curation.json');
    expect(files).toContain('safety-annotation-unknown-motivation.json');
  });

  it.each(files)(
    'invalid: %s is rejected with a TrustSafetyError or upstream validation error',
    (name) => {
      const value = readJson(join(FIXTURES_ROOT, 'invalid', name));
      const validator = validatorForFile(name);
      let thrown: unknown;
      try {
        validator(value);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(Error);
      // Trust-safety errors are TrustSafetyError; ObjectRef/BlockRef/DigestRef
      // upstream errors from @lfp2p/content-addressing are also acceptable.
      const err = thrown as Error & { code?: string };
      if (err instanceof TrustSafetyError) {
        expect(err.code).toMatch(/^TS_/);
      } else {
        expect(err.message).toMatch(/^\[CA_/);
      }
    }
  );
});
