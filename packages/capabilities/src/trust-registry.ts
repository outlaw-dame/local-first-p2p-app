import { capabilityError } from './errors.js';
import type { CapabilityPartyRef, CapabilityProofRef } from './types.js';
import { validatePartyRef, validateProofRef } from './validation.js';

export const AUTHORITY_TRUST_STATES = [
  'trusted',
  'partially-trusted',
  'unknown',
  'revoked',
  'compromised'
] as const;

export type AuthorityTrustState = (typeof AUTHORITY_TRUST_STATES)[number];

export type AuthorityTrustRecord = Readonly<{
  authority: CapabilityPartyRef;
  trustState: AuthorityTrustState;
  verificationSources: readonly string[];
  proofs: readonly CapabilityProofRef[];
  updatedAt: string;
  revokedAt?: string;
}>;

export type AuthorityTrustRegistry = Readonly<{
  records: Readonly<Record<string, AuthorityTrustRecord>>;
}>;

export function createEmptyTrustRegistry(): AuthorityTrustRegistry {
  return Object.freeze({ records: Object.freeze({}) });
}

export function validateAuthorityTrustRecord(value: unknown): AuthorityTrustRecord {
  const record = assertPlainObject(value, 'AuthorityTrustRecord');
  const authority = validatePartyRef(record.authority, 'AuthorityTrustRecord.authority');
  const trustState = assertTrustState(record.trustState);
  const verificationSources = assertStringList(record.verificationSources, 'AuthorityTrustRecord.verificationSources');
  const proofs = assertProofList(record.proofs, 'AuthorityTrustRecord.proofs');
  const updatedAt = assertTimestamp(record.updatedAt, 'AuthorityTrustRecord.updatedAt');
  const revokedAt = record.revokedAt === undefined ? undefined : assertTimestamp(record.revokedAt, 'AuthorityTrustRecord.revokedAt');
  if (revokedAt !== undefined && Date.parse(revokedAt) > Date.parse(updatedAt)) {
    throw capabilityError('CAP_INVALID_TIMESTAMP', 'revokedAt cannot be after updatedAt');
  }

  return Object.freeze({
    authority,
    trustState,
    verificationSources,
    proofs,
    updatedAt,
    ...(revokedAt === undefined ? {} : { revokedAt })
  });
}

export function setAuthorityTrust(
  registry: AuthorityTrustRegistry,
  value: AuthorityTrustRecord | unknown
): AuthorityTrustRegistry {
  const record = validateAuthorityTrustRecord(value);
  const id = authorityKey(record.authority);
  const existing = registry.records[id];
  if (existing !== undefined && isFinalDistrust(existing.trustState) && !isFinalDistrust(record.trustState)) {
    return registry;
  }
  return freezeRegistry({
    records: {
      ...registry.records,
      [id]: record
    }
  });
}

export function getAuthorityTrust(
  registry: AuthorityTrustRegistry,
  authority: CapabilityPartyRef
): AuthorityTrustRecord | undefined {
  const validated = validatePartyRef(authority, 'authority');
  return registry.records[authorityKey(validated)];
}

export function isAuthorityTrusted(
  registry: AuthorityTrustRegistry,
  authority: CapabilityPartyRef
): boolean {
  return getAuthorityTrust(registry, authority)?.trustState === 'trusted';
}

export function revokeAuthorityTrust(
  registry: AuthorityTrustRegistry,
  authority: CapabilityPartyRef,
  revokedAt: string
): AuthorityTrustRegistry {
  const validatedAuthority = validatePartyRef(authority, 'authority');
  const timestamp = assertTimestamp(revokedAt, 'revokedAt');
  const existing = getAuthorityTrust(registry, validatedAuthority);
  return setAuthorityTrust(registry, {
    authority: validatedAuthority,
    trustState: 'revoked',
    verificationSources: existing?.verificationSources ?? [],
    proofs: existing?.proofs ?? [],
    updatedAt: timestamp,
    revokedAt: timestamp
  });
}

export function markAuthorityCompromised(
  registry: AuthorityTrustRegistry,
  authority: CapabilityPartyRef,
  updatedAt: string
): AuthorityTrustRegistry {
  const validatedAuthority = validatePartyRef(authority, 'authority');
  const timestamp = assertTimestamp(updatedAt, 'updatedAt');
  const existing = getAuthorityTrust(registry, validatedAuthority);
  return setAuthorityTrust(registry, {
    authority: validatedAuthority,
    trustState: 'compromised',
    verificationSources: existing?.verificationSources ?? [],
    proofs: existing?.proofs ?? [],
    updatedAt: timestamp
  });
}

function authorityKey(authority: CapabilityPartyRef): string {
  return `${authority.kind}:${authority.id}`;
}

function isFinalDistrust(state: AuthorityTrustState): boolean {
  return state === 'revoked' || state === 'compromised';
}

function freezeRegistry(registry: AuthorityTrustRegistry): AuthorityTrustRegistry {
  const records: Record<string, AuthorityTrustRecord> = {};
  for (const [id, record] of Object.entries(registry.records)) records[id] = Object.freeze(record);
  return Object.freeze({ records: Object.freeze(records) });
}

function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw capabilityError('CAP_INVALID_INPUT', `${label} must be a plain object`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw capabilityError('CAP_INVALID_INPUT', `${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function assertTrustState(value: unknown): AuthorityTrustState {
  if (typeof value !== 'string' || !(AUTHORITY_TRUST_STATES as readonly string[]).includes(value)) {
    throw capabilityError('CAP_INVALID_ENUM', 'trustState is not supported');
  }
  return value as AuthorityTrustState;
}

function assertStringList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) throw capabilityError('CAP_INVALID_INPUT', `${label} must be an array`);
  const seen = new Set<string>();
  const out = value.map((item, index) => {
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw capabilityError('CAP_INVALID_ID', `${label}[${index}] must be a non-empty string`);
    }
    const trimmed = item.trim();
    if (seen.has(trimmed)) throw capabilityError('CAP_DUPLICATE_VALUE', `${label} contains duplicate values`);
    seen.add(trimmed);
    return trimmed;
  });
  return Object.freeze(out);
}

function assertProofList(value: unknown, label: string): readonly CapabilityProofRef[] {
  if (!Array.isArray(value)) throw capabilityError('CAP_INVALID_INPUT', `${label} must be an array`);
  return Object.freeze(value.map((item, index) => validateProofRef(item, `${label}[${index}]`)));
}

function assertTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw capabilityError('CAP_INVALID_TIMESTAMP', `${label} must be a valid timestamp`);
  }
  return value;
}
