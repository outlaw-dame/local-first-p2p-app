import type { ObjectRef } from '@lfp2p/content-addressing';
import { validateObjectRef } from '@lfp2p/content-addressing';
import type { ActorRef } from './refs.js';
import { validateActorRef } from './refs.js';
import type { SafetyAuthority } from './authorities.js';
import { validateSafetyAuthority } from './authorities.js';
import {
  assertExactVersion,
  assertId,
  assertIso8601,
  assertPlainObject,
  assertReadonlyArray
} from './validation.js';

export const SAFETY_APPEAL_VERSION = 'lfp2p.safety-appeal.v1' as const;

const MAX_EVIDENCE_REFS = 32;
const MAX_IDEMPOTENCY_LENGTH = 256;
const MAX_REASON_CODE_LENGTH = 256;

export type SafetyAppeal = Readonly<{
  version: typeof SAFETY_APPEAL_VERSION;
  appealId: string;
  appellant: ActorRef;
  decisionId: string;
  targetAuthority: SafetyAuthority;
  reasonCode: string;
  idempotencyKey: string;
  createdAt: string;
  encryptedBodyRef?: ObjectRef;
  evidenceRefs?: ReadonlyArray<ObjectRef>;
}>;

export function validateSafetyAppeal(value: unknown, label = 'SafetyAppeal'): SafetyAppeal {
  const record = assertPlainObject(value, label);
  assertExactVersion(record.version, SAFETY_APPEAL_VERSION, `${label}.version`);
  const appealId = assertId(record.appealId, `${label}.appealId`);
  const appellant = validateActorRef(record.appellant, `${label}.appellant`);
  // Appeals target *policy decisions* by their decisionId. The protocol does
  // not allow appealing labels or annotations directly — those have their
  // own negation flow via `negatesLabelId`.
  const decisionId = assertId(record.decisionId, `${label}.decisionId`);
  const targetAuthority = validateSafetyAuthority(
    record.targetAuthority,
    `${label}.targetAuthority`
  );
  const reasonCode = assertId(record.reasonCode, `${label}.reasonCode`, MAX_REASON_CODE_LENGTH);
  const idempotencyKey = assertId(
    record.idempotencyKey,
    `${label}.idempotencyKey`,
    MAX_IDEMPOTENCY_LENGTH
  );
  const createdAt = assertIso8601(record.createdAt, `${label}.createdAt`);

  const out: { -readonly [K in keyof SafetyAppeal]: SafetyAppeal[K] } = {
    version: SAFETY_APPEAL_VERSION,
    appealId,
    appellant,
    decisionId,
    targetAuthority,
    reasonCode,
    idempotencyKey,
    createdAt
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
