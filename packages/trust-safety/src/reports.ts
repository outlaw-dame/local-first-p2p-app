import type { ObjectRef } from '@lfp2p/content-addressing';
import { validateObjectRef } from '@lfp2p/content-addressing';
import type { EnforcementScope, SafetyAuthority } from './authorities.js';
import { ENFORCEMENT_SCOPES, validateSafetyAuthority } from './authorities.js';
import { tsError } from './errors.js';
import type { ReporterRef } from './refs.js';
import { validateReporterRef } from './refs.js';
import type { SafetyReasonCode } from './reason-codes.js';
import { SAFETY_REASON_CODES } from './reason-codes.js';
import type { SafetySubjectRef } from './subjects.js';
import { PRIVATE_BY_NATURE_SUBJECTS, validateSafetySubjectRef } from './subjects.js';
import {
  assertExactVersion,
  assertId,
  assertIso8601,
  assertOneOf,
  assertPlainObject,
  assertReadonlyArray
} from './validation.js';

export const SAFETY_REPORT_VERSION = 'lfp2p.safety-report.v1' as const;

export const REPORTER_PRIVACY_LEVELS = [
  'identified-to-authority',
  'pseudonymous-to-authority',
  'anonymous-to-authority-if-supported'
] as const;
export type ReporterPrivacyLevel = (typeof REPORTER_PRIVACY_LEVELS)[number];

const MAX_EVIDENCE_REFS = 32;
const MAX_IDEMPOTENCY_LENGTH = 256;

export type SafetyReport = Readonly<{
  version: typeof SAFETY_REPORT_VERSION;
  reportId: string;
  reporter: ReporterRef;
  subject: SafetySubjectRef;
  targetAuthority: SafetyAuthority;
  reasonCode: SafetyReasonCode;
  scope: EnforcementScope;
  idempotencyKey: string;
  createdAt: string;
  encryptedBodyRef?: ObjectRef;
  evidenceRefs?: ReadonlyArray<ObjectRef>;
  reporterPrivacy: ReporterPrivacyLevel;
}>;

export function validateSafetyReport(value: unknown, label = 'SafetyReport'): SafetyReport {
  const record = assertPlainObject(value, label);
  assertExactVersion(record.version, SAFETY_REPORT_VERSION, `${label}.version`);
  const reportId = assertId(record.reportId, `${label}.reportId`);
  const reporter = validateReporterRef(record.reporter, `${label}.reporter`);
  const subject = validateSafetySubjectRef(record.subject, `${label}.subject`);
  const targetAuthority = validateSafetyAuthority(
    record.targetAuthority,
    `${label}.targetAuthority`
  );
  const reasonCode = assertOneOf(record.reasonCode, SAFETY_REASON_CODES, `${label}.reasonCode`);
  const scope = assertOneOf(record.scope, ENFORCEMENT_SCOPES, `${label}.scope`);
  const idempotencyKey = assertId(
    record.idempotencyKey,
    `${label}.idempotencyKey`,
    MAX_IDEMPOTENCY_LENGTH
  );
  const createdAt = assertIso8601(record.createdAt, `${label}.createdAt`);
  const reporterPrivacy = assertOneOf(
    record.reporterPrivacy,
    REPORTER_PRIVACY_LEVELS,
    `${label}.reporterPrivacy`
  );

  // Reports about private-by-nature subjects must not be issued at index/network
  // scope. Reports about private content stay scoped to the target authority
  // (community/bridge/etc.) — they do not enter public label/search/curation flows.
  if (
    PRIVATE_BY_NATURE_SUBJECTS.has(subject.type) &&
    (scope === 'index-local' || scope === 'network-advisory')
  ) {
    throw tsError(
      'TS_PRIVATE_LEAK',
      `${label}: subject type "${subject.type}" is private by nature; scope "${scope}" would route this report into public flows`
    );
  }

  const out: { -readonly [K in keyof SafetyReport]: SafetyReport[K] } = {
    version: SAFETY_REPORT_VERSION,
    reportId,
    reporter,
    subject,
    targetAuthority,
    reasonCode,
    scope,
    idempotencyKey,
    createdAt,
    reporterPrivacy
  };
  if (record.encryptedBodyRef !== undefined) {
    out.encryptedBodyRef = validateObjectRef(record.encryptedBodyRef);
  }
  if (record.evidenceRefs !== undefined) {
    out.evidenceRefs = assertReadonlyArray(
      record.evidenceRefs,
      `${label}.evidenceRefs`,
      MAX_EVIDENCE_REFS,
      (item) => validateObjectRef(item)
    );
  }
  return Object.freeze(out);
}
