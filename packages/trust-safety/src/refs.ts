// Reserved extension-point reference types.
//
// The full capability/credential/actor/identity model is owned by ADR-001
// (identity control log) and a future capability/credential ADR. Until
// those land, T&S accepts these refs by shape only and never elevates
// authority based on their contents. This is the "fail safely when proofs
// are required but unavailable" boundary specified by the phase plan.

import { tsError } from './errors.js';
import {
  assertId,
  assertNonEmptyString,
  assertOneOf,
  assertPlainObject
} from './validation.js';

/** Lightweight reference to an actor identity. */
export type ActorRef = Readonly<{
  actorId: string;
  displayHint?: string;
}>;

export function validateActorRef(value: unknown, label = 'ActorRef'): ActorRef {
  const record = assertPlainObject(value, label);
  const actorId = assertId(record.actorId, `${label}.actorId`);
  const out: { -readonly [K in keyof ActorRef]: ActorRef[K] } = { actorId };
  if (record.displayHint !== undefined) {
    out.displayHint = assertId(record.displayHint, `${label}.displayHint`);
  }
  return Object.freeze(out);
}

/**
 * Reporter reference. May be an actor, a community surface, or an opaque
 * pseudonym handled by an authority. The protocol does not de-anonymize
 * pseudonymous reports; downstream surfaces handle disclosure policy.
 */
export type ReporterRef =
  | Readonly<{ kind: 'actor'; actor: ActorRef }>
  | Readonly<{ kind: 'community'; communityId: string }>
  | Readonly<{ kind: 'pseudonym'; pseudonymId: string }>;

export function validateReporterRef(value: unknown, label = 'ReporterRef'): ReporterRef {
  const record = assertPlainObject(value, label);
  const kind = assertOneOf(record.kind, ['actor', 'community', 'pseudonym'] as const, `${label}.kind`);
  if (kind === 'actor') {
    return Object.freeze({ kind: 'actor', actor: validateActorRef(record.actor, `${label}.actor`) });
  }
  if (kind === 'community') {
    return Object.freeze({
      kind: 'community',
      communityId: assertId(record.communityId, `${label}.communityId`)
    });
  }
  return Object.freeze({
    kind: 'pseudonym',
    pseudonymId: assertId(record.pseudonymId, `${label}.pseudonymId`)
  });
}

/**
 * Capability proof reference (UCAN-style or similar). Shape-only check —
 * full verification belongs to the future capability runtime.
 */
export type CapabilityProofRef = Readonly<{
  proofId: string;
  scheme: string;
}>;

const MAX_CAPABILITY_SCHEME_LENGTH = 128;

export function validateCapabilityProofRef(
  value: unknown,
  label = 'CapabilityProofRef'
): CapabilityProofRef {
  const record = assertPlainObject(value, label);
  const proofId = assertId(record.proofId, `${label}.proofId`);
  const scheme = assertNonEmptyString(record.scheme, `${label}.scheme`);
  if (scheme.length > MAX_CAPABILITY_SCHEME_LENGTH) {
    throw tsError(
      'TS_INVALID_CAPABILITY_PROOF',
      `${label}.scheme length ${scheme.length} exceeds ${MAX_CAPABILITY_SCHEME_LENGTH}`
    );
  }
  return Object.freeze({ proofId, scheme });
}

/**
 * Verifiable Credential reference. Shape-only check — issuer/subject/
 * trust evaluation belongs to the future trust-policy engine (ADR-006).
 */
export type CredentialRef = Readonly<{
  credentialId: string;
  issuerId: string;
  claimType: string;
}>;

export function validateCredentialRef(
  value: unknown,
  label = 'CredentialRef'
): CredentialRef {
  const record = assertPlainObject(value, label);
  return Object.freeze({
    credentialId: assertId(record.credentialId, `${label}.credentialId`),
    issuerId: assertId(record.issuerId, `${label}.issuerId`),
    claimType: assertId(record.claimType, `${label}.claimType`)
  });
}
