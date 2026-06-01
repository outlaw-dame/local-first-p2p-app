import type { ObjectRef } from '@lfp2p/content-addressing';
import { validateObjectRef } from '@lfp2p/content-addressing';
import type { SafetyAuthority } from './authorities.js';
import { validateSafetyAuthority } from './authorities.js';
import { tsError } from './errors.js';
import type { SafetyReasonCode } from './reason-codes.js';
import { SAFETY_REASON_CODES } from './reason-codes.js';
import type { SafetySubjectRef } from './subjects.js';
import { validateSafetySubjectRef } from './subjects.js';
import {
  assertExactVersion,
  assertId,
  assertIso8601,
  assertNotBefore,
  assertOneOf,
  assertPlainObject,
  assertReadonlyArray
} from './validation.js';

export const TRANSPORT_ADMISSION_DECISION_VERSION =
  'lfp2p.transport-admission-decision.v1' as const;

export const TRANSPORT_SURFACES = [
  'bridge',
  'relay',
  'super-peer',
  'public-index',
  'media-store'
] as const;
export type TransportSurface = (typeof TRANSPORT_SURFACES)[number];

export const TRANSPORT_ACTIONS = [
  'accept',
  'accept-limited',
  'quarantine',
  'reject',
  'rate-limit',
  'drop-duplicate'
] as const;
export type TransportAction = (typeof TRANSPORT_ACTIONS)[number];

/**
 * Authority scopes that may emit transport admission decisions. Local user
 * authorities (`device-local`, `account-local`) and community/index
 * authorities cannot author transport decisions — that authority belongs
 * to infrastructure operators only.
 */
const TRANSPORT_OPERATOR_SCOPES: ReadonlySet<string> = new Set([
  'bridge-local',
  'relay-local',
  'super-peer-local'
]);

const MAX_EVIDENCE_REFS = 32;
const MAX_POLICY_VERSION_LENGTH = 128;
const MAX_IDEMPOTENCY_LENGTH = 256;

export type TransportAdmissionDecision = Readonly<{
  version: typeof TRANSPORT_ADMISSION_DECISION_VERSION;
  decisionId: string;
  operatorAuthority: SafetyAuthority;
  subject: SafetySubjectRef;
  surface: TransportSurface;
  action: TransportAction;
  reasonCode: SafetyReasonCode;
  policyVersion: string;
  idempotencyKey?: string;
  evidenceRefs?: ReadonlyArray<ObjectRef>;
  createdAt: string;
  expiresAt?: string;
}>;

export function validateTransportAdmissionDecision(
  value: unknown,
  label = 'TransportAdmissionDecision'
): TransportAdmissionDecision {
  const record = assertPlainObject(value, label);
  assertExactVersion(record.version, TRANSPORT_ADMISSION_DECISION_VERSION, `${label}.version`);
  const decisionId = assertId(record.decisionId, `${label}.decisionId`);
  const operatorAuthority = validateSafetyAuthority(
    record.operatorAuthority,
    `${label}.operatorAuthority`
  );
  const subject = validateSafetySubjectRef(record.subject, `${label}.subject`);
  const surface = assertOneOf(record.surface, TRANSPORT_SURFACES, `${label}.surface`);
  const action = assertOneOf(record.action, TRANSPORT_ACTIONS, `${label}.action`);
  const reasonCode = assertOneOf(record.reasonCode, SAFETY_REASON_CODES, `${label}.reasonCode`);
  const policyVersion = assertId(
    record.policyVersion,
    `${label}.policyVersion`,
    MAX_POLICY_VERSION_LENGTH
  );
  const createdAt = assertIso8601(record.createdAt, `${label}.createdAt`);

  // Operator authority cross-check: only infrastructure operators may
  // emit transport admission decisions.
  if (!TRANSPORT_OPERATOR_SCOPES.has(operatorAuthority.scope)) {
    throw tsError(
      'TS_INVALID_ADMISSION',
      `${label}: operatorAuthority.scope "${operatorAuthority.scope}" cannot author transport admission (must be bridge-local, relay-local, or super-peer-local)`
    );
  }

  // Surface/scope sanity: a bridge operator cannot author admission for the
  // relay surface, etc.
  const surfaceToScope: Readonly<Record<TransportSurface, string | undefined>> = {
    bridge: 'bridge-local',
    relay: 'relay-local',
    'super-peer': 'super-peer-local',
    // public-index / media-store are operated by various surface owners;
    // we leave their cross-check to downstream phases.
    'public-index': undefined,
    'media-store': undefined
  };
  const expectedScope = surfaceToScope[surface];
  if (expectedScope !== undefined && operatorAuthority.scope !== expectedScope) {
    throw tsError(
      'TS_INVALID_ADMISSION',
      `${label}: surface "${surface}" requires operatorAuthority.scope "${expectedScope}" (got "${operatorAuthority.scope}")`
    );
  }

  const out: {
    -readonly [K in keyof TransportAdmissionDecision]: TransportAdmissionDecision[K];
  } = {
    version: TRANSPORT_ADMISSION_DECISION_VERSION,
    decisionId,
    operatorAuthority,
    subject,
    surface,
    action,
    reasonCode,
    policyVersion,
    createdAt
  };
  if (record.idempotencyKey !== undefined) {
    out.idempotencyKey = assertId(
      record.idempotencyKey,
      `${label}.idempotencyKey`,
      MAX_IDEMPOTENCY_LENGTH
    );
  }
  if (record.evidenceRefs !== undefined) {
    out.evidenceRefs = assertReadonlyArray(
      record.evidenceRefs,
      `${label}.evidenceRefs`,
      MAX_EVIDENCE_REFS,
      (item) => validateObjectRef(item)
    );
  }
  if (record.expiresAt !== undefined) {
    out.expiresAt = assertIso8601(record.expiresAt, `${label}.expiresAt`);
    assertNotBefore(createdAt, out.expiresAt, `${label}.createdAt`, `${label}.expiresAt`);
  }
  return Object.freeze(out);
}
