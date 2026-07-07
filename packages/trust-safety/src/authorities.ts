import type { ObjectRef } from '@lfp2p/content-addressing';
import { validateObjectRef } from '@lfp2p/content-addressing';
import type { CapabilityProofRef, CredentialRef } from './refs.js';
import { validateCapabilityProofRef, validateCredentialRef } from './refs.js';
import {
  assertExactVersion,
  assertId,
  assertIso8601,
  assertNotBefore,
  assertOneOf,
  assertPlainObject,
  assertReadonlyArray
} from './validation.js';

/**
 * Product-facing roles. These are display concepts; protocol authority is
 * conveyed by the SafetyAuthority's `scope` and capability proofs.
 */
export const PRODUCT_ROLES = [
  'owner',
  'admin',
  'moderator',
  'reviewer',
  'bot',
  'labeler',
  'curator',
  'bridge-operator',
  'relay-operator',
  'super-peer-operator'
] as const;
export type ProductRole = (typeof PRODUCT_ROLES)[number];

/** Authority scopes. `network-advisory` carries no enforcement weight. */
export const SAFETY_AUTHORITY_SCOPES = [
  'device-local',
  'account-local',
  'community-local',
  'bridge-local',
  'relay-local',
  'super-peer-local',
  'index-local',
  'network-advisory'
] as const;
export type SafetyAuthorityScope = (typeof SAFETY_AUTHORITY_SCOPES)[number];

/** Enforcement scopes — superset of authority scopes plus `app-surface-local`. */
export const ENFORCEMENT_SCOPES = [
  'device-local',
  'account-local',
  'community-local',
  'bridge-local',
  'relay-local',
  'super-peer-local',
  'index-local',
  'app-surface-local',
  'network-advisory'
] as const;
export type EnforcementScope = (typeof ENFORCEMENT_SCOPES)[number];

export const SAFETY_AUTHORITY_VERSION = 'lfp2p.safety-authority.v1' as const;

const MAX_PROOFS_PER_AUTHORITY = 32;
const MAX_CREDENTIALS_PER_AUTHORITY = 32;

export type SafetyAuthority = Readonly<{
  version: typeof SAFETY_AUTHORITY_VERSION;
  authorityId: string;
  actorId: string;
  role?: ProductRole;
  scope: SafetyAuthorityScope;
  resourceRef?: ObjectRef;
  capabilityProofs?: ReadonlyArray<CapabilityProofRef>;
  credentialRefs?: ReadonlyArray<CredentialRef>;
  createdAt: string;
  expiresAt?: string;
}>;

export function validateSafetyAuthority(
  value: unknown,
  label = 'SafetyAuthority'
): SafetyAuthority {
  const record = assertPlainObject(value, label);
  assertExactVersion(record.version, SAFETY_AUTHORITY_VERSION, `${label}.version`);
  const authorityId = assertId(record.authorityId, `${label}.authorityId`);
  const actorId = assertId(record.actorId, `${label}.actorId`);
  const scope = assertOneOf(record.scope, SAFETY_AUTHORITY_SCOPES, `${label}.scope`);
  const createdAt = assertIso8601(record.createdAt, `${label}.createdAt`);

  let role: ProductRole | undefined;
  if (record.role !== undefined) {
    role = assertOneOf(record.role, PRODUCT_ROLES, `${label}.role`);
  }

  let resourceRef: ObjectRef | undefined;
  if (record.resourceRef !== undefined) {
    resourceRef = validateObjectRef(record.resourceRef);
  }

  let capabilityProofs: ReadonlyArray<CapabilityProofRef> | undefined;
  if (record.capabilityProofs !== undefined) {
    capabilityProofs = assertReadonlyArray(
      record.capabilityProofs,
      `${label}.capabilityProofs`,
      MAX_PROOFS_PER_AUTHORITY,
      (item, i) => validateCapabilityProofRef(item, `${label}.capabilityProofs[${i}]`)
    );
  }

  let credentialRefs: ReadonlyArray<CredentialRef> | undefined;
  if (record.credentialRefs !== undefined) {
    credentialRefs = assertReadonlyArray(
      record.credentialRefs,
      `${label}.credentialRefs`,
      MAX_CREDENTIALS_PER_AUTHORITY,
      (item, i) => validateCredentialRef(item, `${label}.credentialRefs[${i}]`)
    );
  }

  let expiresAt: string | undefined;
  if (record.expiresAt !== undefined) {
    expiresAt = assertIso8601(record.expiresAt, `${label}.expiresAt`);
    assertNotBefore(createdAt, expiresAt, `${label}.createdAt`, `${label}.expiresAt`);
  }

  const out: { -readonly [K in keyof SafetyAuthority]: SafetyAuthority[K] } = {
    version: SAFETY_AUTHORITY_VERSION,
    authorityId,
    actorId,
    scope,
    createdAt
  };
  if (role !== undefined) out.role = role;
  if (resourceRef !== undefined) out.resourceRef = resourceRef;
  if (capabilityProofs !== undefined) out.capabilityProofs = capabilityProofs;
  if (credentialRefs !== undefined) out.credentialRefs = credentialRefs;
  if (expiresAt !== undefined) out.expiresAt = expiresAt;
  return Object.freeze(out);
}
