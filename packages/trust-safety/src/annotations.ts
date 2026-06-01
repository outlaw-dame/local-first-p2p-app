import type { EnforcementScope, SafetyAuthority } from './authorities.js';
import { ENFORCEMENT_SCOPES, validateSafetyAuthority } from './authorities.js';
import type { CapabilityProofRef, CredentialRef } from './refs.js';
import {
  validateCapabilityProofRef,
  validateCredentialRef
} from './refs.js';
import type { SafetySubjectRef } from './subjects.js';
import { PRIVATE_BY_NATURE_SUBJECTS, validateSafetySubjectRef } from './subjects.js';
import { tsError } from './errors.js';
import {
  assertExactVersion,
  assertId,
  assertIso8601,
  assertNotBefore,
  assertOneOf,
  assertPlainObject,
  assertReadonlyArray,
  assertText
} from './validation.js';

export const SAFETY_ANNOTATION_VERSION = 'lfp2p.safety-annotation.v1' as const;

export const ANNOTATION_MOTIVATIONS = [
  'classifying',
  'assessing',
  'commenting',
  'describing',
  'tagging'
] as const;
export type AnnotationMotivation = (typeof ANNOTATION_MOTIVATIONS)[number];

export type SafetyAnnotationBody = Readonly<{
  format: 'text/plain' | 'text/markdown' | 'application/lfp2p-tags+json';
  value: string;
}>;

const MAX_ANNOTATION_BODY_BYTES = 64 * 1024;

function validateBody(value: unknown, label: string): SafetyAnnotationBody {
  const record = assertPlainObject(value, label);
  const format = assertOneOf(
    record.format,
    ['text/plain', 'text/markdown', 'application/lfp2p-tags+json'] as const,
    `${label}.format`
  );
  const valueText = assertText(record.value, `${label}.value`, MAX_ANNOTATION_BODY_BYTES);
  return Object.freeze({ format, value: valueText });
}

export type SafetyAnnotation = Readonly<{
  version: typeof SAFETY_ANNOTATION_VERSION;
  annotationId: string;
  issuer: SafetyAuthority;
  subject: SafetySubjectRef;
  motivation: AnnotationMotivation;
  body: SafetyAnnotationBody;
  scope: EnforcementScope;
  policyRef?: string;
  capabilityProofs?: ReadonlyArray<CapabilityProofRef>;
  credentialRefs?: ReadonlyArray<CredentialRef>;
  createdAt: string;
  expiresAt?: string;
}>;

export function validateSafetyAnnotation(
  value: unknown,
  label = 'SafetyAnnotation'
): SafetyAnnotation {
  const record = assertPlainObject(value, label);
  assertExactVersion(record.version, SAFETY_ANNOTATION_VERSION, `${label}.version`);
  const annotationId = assertId(record.annotationId, `${label}.annotationId`);
  const issuer = validateSafetyAuthority(record.issuer, `${label}.issuer`);
  const subject = validateSafetySubjectRef(record.subject, `${label}.subject`);
  const motivation = assertOneOf(
    record.motivation,
    ANNOTATION_MOTIVATIONS,
    `${label}.motivation`
  );
  const body = validateBody(record.body, `${label}.body`);
  const scope = assertOneOf(record.scope, ENFORCEMENT_SCOPES, `${label}.scope`);
  const createdAt = assertIso8601(record.createdAt, `${label}.createdAt`);

  // Private-subject + public-scope cross-check.
  if (
    PRIVATE_BY_NATURE_SUBJECTS.has(subject.type) &&
    (scope === 'index-local' || scope === 'network-advisory')
  ) {
    throw tsError(
      'TS_PRIVATE_LEAK',
      `${label}: subject type "${subject.type}" is private by nature; scope "${scope}" would leak it into public flows`
    );
  }

  const out: { -readonly [K in keyof SafetyAnnotation]: SafetyAnnotation[K] } = {
    version: SAFETY_ANNOTATION_VERSION,
    annotationId,
    issuer,
    subject,
    motivation,
    body,
    scope,
    createdAt
  };
  if (record.policyRef !== undefined) {
    out.policyRef = assertId(record.policyRef, `${label}.policyRef`);
  }
  if (record.capabilityProofs !== undefined) {
    out.capabilityProofs = assertReadonlyArray(
      record.capabilityProofs,
      `${label}.capabilityProofs`,
      32,
      (item, i) => validateCapabilityProofRef(item, `${label}.capabilityProofs[${i}]`)
    );
  }
  if (record.credentialRefs !== undefined) {
    out.credentialRefs = assertReadonlyArray(
      record.credentialRefs,
      `${label}.credentialRefs`,
      32,
      (item, i) => validateCredentialRef(item, `${label}.credentialRefs[${i}]`)
    );
  }
  if (record.expiresAt !== undefined) {
    out.expiresAt = assertIso8601(record.expiresAt, `${label}.expiresAt`);
    assertNotBefore(createdAt, out.expiresAt, `${label}.createdAt`, `${label}.expiresAt`);
  }
  return Object.freeze(out);
}
