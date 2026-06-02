// @lfp2p/trust-safety — Phase 1.61 protocol core.
//
// Pure protocol/type/validator surface. No runtime enforcement, no
// projection tables, no bridge admission runtime, no UI. Downstream
// phases (1.62–1.65) consume these types to build runtime behavior on
// top of signed local events.

export const TRUST_SAFETY_VERSION = 'lfp2p.trust-safety.v1' as const;
export type TrustSafetyVersion = typeof TRUST_SAFETY_VERSION;

export {
  TS_ERROR_CODES,
  TrustSafetyError,
  tsError
} from './errors.js';
export type { TSErrorCode } from './errors.js';

export {
  MAX_ID_LENGTH,
  MAX_TEXT_LENGTH,
  PRIVATE_SUBJECT_TYPES,
  assertExactVersion,
  assertFiniteNumberInRange,
  assertId,
  assertIso8601,
  assertNonEmptyString,
  assertNotBefore,
  assertOneOf,
  assertPlainObject,
  assertReadonlyArray,
  assertText,
  isForbiddenIdKey,
  isPlainObject
} from './validation.js';

export {
  withFrozenAppliedEventId,
  withFrozenBucketAppend,
  withFrozenRecordDelete,
  withFrozenRecordSet
} from './projection-helpers.js';

export {
  validateActorRef,
  validateCapabilityProofRef,
  validateCredentialRef,
  validateReporterRef
} from './refs.js';
export type { ActorRef, CapabilityProofRef, CredentialRef, ReporterRef } from './refs.js';

export {
  CURATION_ACTIONS,
  LABEL_CATEGORIES,
  MODERATION_ACTIONS,
  SAFETY_ACTIONS,
  SEVERITIES,
  SEVERITY_RANK,
  TRANSPORT_SCOPES,
  assertActionScopeCompatible
} from './actions.js';
export type { LabelCategory, SafetyAction, Severity } from './actions.js';

export {
  ENFORCEMENT_SCOPES,
  PRODUCT_ROLES,
  SAFETY_AUTHORITY_SCOPES,
  SAFETY_AUTHORITY_VERSION,
  validateSafetyAuthority
} from './authorities.js';
export type {
  EnforcementScope,
  ProductRole,
  SafetyAuthority,
  SafetyAuthorityScope
} from './authorities.js';

export {
  PRIVATE_BY_NATURE_SUBJECTS,
  SAFETY_SUBJECT_TYPES,
  validateSafetySubjectRef
} from './subjects.js';
export type { SafetySubjectRef, SafetySubjectType } from './subjects.js';

export {
  ANNOTATION_MOTIVATIONS,
  SAFETY_ANNOTATION_VERSION,
  validateSafetyAnnotation
} from './annotations.js';
export type {
  AnnotationMotivation,
  SafetyAnnotation,
  SafetyAnnotationBody
} from './annotations.js';

export {
  SAFETY_LABEL_DEFINITION_VERSION,
  SAFETY_LABEL_VERSION,
  validateSafetyLabel,
  validateSafetyLabelDefinition
} from './labels.js';
export type { SafetyLabel, SafetyLabelDefinition } from './labels.js';

export {
  LABELER_KINDS,
  LABELER_SUBSCRIPTION_SCOPES,
  SAFETY_LABELER_PROFILE_VERSION,
  SAFETY_LABELER_SUBSCRIPTION_VERSION,
  STANDARD_LABELER_CAPABILITIES,
  isStandardCapability,
  validateSafetyLabelerProfile,
  validateSafetyLabelerSubscription
} from './labelers.js';
export type {
  LabelerCapability,
  LabelerKind,
  LabelerSubscriptionScope,
  SafetyLabelActionOverride,
  SafetyLabelerProfile,
  SafetyLabelerSubscription
} from './labelers.js';

export { SAFETY_REASON_CODES } from './reason-codes.js';
export type { SafetyReasonCode } from './reason-codes.js';

export {
  SAFETY_POLICY_VERSION,
  validateSafetyPolicy
} from './policies.js';
export type { SafetyPolicy } from './policies.js';

export {
  REPORTER_PRIVACY_LEVELS,
  SAFETY_REPORT_VERSION,
  validateSafetyReport
} from './reports.js';
export type { ReporterPrivacyLevel, SafetyReport } from './reports.js';

export {
  SAFETY_APPEAL_VERSION,
  validateSafetyAppeal
} from './appeals.js';
export type { SafetyAppeal } from './appeals.js';

export {
  SAFETY_POLICY_DECISION_VERSION,
  validateSafetyPolicyDecision
} from './policy-decisions.js';
export type { SafetyPolicyDecision } from './policy-decisions.js';

export {
  TRANSPORT_ACTIONS,
  TRANSPORT_ADMISSION_DECISION_VERSION,
  TRANSPORT_SURFACES,
  validateTransportAdmissionDecision
} from './transport-admission.js';
export type {
  TransportAction,
  TransportAdmissionDecision,
  TransportSurface
} from './transport-admission.js';

export {
  CURATION_ACTION_KINDS,
  CURATION_EXPLANATION_VERSION,
  CURATION_RULE_VERSION,
  CURATION_SURFACES,
  validateCurationExplanation,
  validateCurationRule
} from './curation.js';
export type {
  CurationActionKind,
  CurationExplanation,
  CurationRule,
  CurationSubjectMatcher,
  CurationSurface
} from './curation.js';

export * from './local-controls/index.js';
export * from './reports-appeals/index.js';
export * from './transport-admission/index.js';
export * from './curation-runtime/index.js';
export * from './labelers-runtime/index.js';
export * from './moderation-runtime/index.js';
export * from './content-categories/index.js';
