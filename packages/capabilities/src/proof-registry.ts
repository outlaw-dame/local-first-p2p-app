import { capabilityError } from './errors.js';
import type { CapabilityPartyRef, CapabilityProofScheme } from './types.js';
import { validatePartyRef } from './validation.js';

export const CAPABILITY_PROOF_VERIFICATION_STATES = [
  'unverified',
  'verified',
  'expired',
  'revoked',
  'invalid'
] as const;

export type CapabilityProofVerificationState = (typeof CAPABILITY_PROOF_VERIFICATION_STATES)[number];

export type CapabilityProofRecord = Readonly<{
  proofId: string;
  scheme: CapabilityProofScheme;
  issuer: CapabilityPartyRef;
  subject: CapabilityPartyRef;
  issuedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  digest: string;
  verificationState: CapabilityProofVerificationState;
}>;

export type CapabilityProofRegistry = Readonly<{
  proofs: Readonly<Record<string, CapabilityProofRecord>>;
}>;

const DIGEST_RE = /^(sha-256|sha-512|blake3):[A-Za-z0-9_-]{8,512}$/u;
const PROOF_SCHEMES: readonly CapabilityProofScheme[] = [
  'native-signed-event',
  'identity-control-log',
  'ucan',
  'zcap-ld',
  'vc',
  'bearcap',
  'manual-local-policy'
];

export function createEmptyProofRegistry(): CapabilityProofRegistry {
  return Object.freeze({ proofs: Object.freeze({}) });
}

export function validateCapabilityProofRecord(value: unknown): CapabilityProofRecord {
  const record = assertPlainObject(value, 'CapabilityProofRecord');
  const proofId = assertId(record.proofId, 'CapabilityProofRecord.proofId');
  const scheme = assertScheme(record.scheme);
  const issuer = validatePartyRef(record.issuer, 'CapabilityProofRecord.issuer');
  const subject = validatePartyRef(record.subject, 'CapabilityProofRecord.subject');
  const issuedAt = assertTimestamp(record.issuedAt, 'CapabilityProofRecord.issuedAt');
  const expiresAt = record.expiresAt === undefined ? undefined : assertTimestamp(record.expiresAt, 'CapabilityProofRecord.expiresAt');
  if (expiresAt !== undefined && Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    throw capabilityError('CAP_INVALID_TIMESTAMP', 'CapabilityProofRecord.expiresAt must be after issuedAt');
  }
  const revokedAt = record.revokedAt === undefined ? undefined : assertTimestamp(record.revokedAt, 'CapabilityProofRecord.revokedAt');
  const digest = assertDigest(record.digest, 'CapabilityProofRecord.digest');
  const verificationState = assertVerificationState(record.verificationState);

  return Object.freeze({
    proofId,
    scheme,
    issuer,
    subject,
    issuedAt,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(revokedAt === undefined ? {} : { revokedAt }),
    digest,
    verificationState
  });
}

export function registerProof(
  registry: CapabilityProofRegistry,
  proof: CapabilityProofRecord | unknown
): CapabilityProofRegistry {
  const validated = validateCapabilityProofRecord(proof);
  const existing = registry.proofs[validated.proofId];
  if (existing !== undefined && existing.digest !== validated.digest) {
    throw capabilityError('CAP_DUPLICATE_VALUE', 'proofId already exists with a different digest');
  }
  return freezeRegistry({
    proofs: {
      ...registry.proofs,
      [validated.proofId]: mergeProof(existing, validated)
    }
  });
}

export function getProof(
  registry: CapabilityProofRegistry,
  proofId: string
): CapabilityProofRecord | undefined {
  return registry.proofs[assertId(proofId, 'proofId')];
}

export function verifyProof(
  registry: CapabilityProofRegistry,
  proofId: string,
  now: string
): CapabilityProofRegistry {
  const parsedNow = Date.parse(now);
  if (!Number.isFinite(parsedNow)) {
    throw capabilityError('CAP_INVALID_TIMESTAMP', 'now must be a valid timestamp');
  }
  const existing = getRequiredProof(registry, proofId);
  const nextState = deriveState(existing, parsedNow);
  return freezeRegistry({
    proofs: {
      ...registry.proofs,
      [existing.proofId]: Object.freeze({ ...existing, verificationState: nextState })
    }
  });
}

export function revokeProof(
  registry: CapabilityProofRegistry,
  proofId: string,
  revokedAt: string
): CapabilityProofRegistry {
  const parsedRevokedAt = Date.parse(revokedAt);
  if (!Number.isFinite(parsedRevokedAt)) {
    throw capabilityError('CAP_INVALID_TIMESTAMP', 'revokedAt must be a valid timestamp');
  }
  const existing = getRequiredProof(registry, proofId);
  return freezeRegistry({
    proofs: {
      ...registry.proofs,
      [existing.proofId]: Object.freeze({
        ...existing,
        revokedAt,
        verificationState: 'revoked' as const
      })
    }
  });
}

function mergeProof(existing: CapabilityProofRecord | undefined, next: CapabilityProofRecord): CapabilityProofRecord {
  if (existing === undefined) return next;
  if (existing.verificationState === 'revoked') return existing;
  if (next.verificationState === 'revoked') return next;
  return next;
}

function deriveState(proof: CapabilityProofRecord, now: number): CapabilityProofVerificationState {
  if (proof.revokedAt !== undefined && Date.parse(proof.revokedAt) <= now) return 'revoked';
  if (proof.expiresAt !== undefined && Date.parse(proof.expiresAt) <= now) return 'expired';
  if (proof.verificationState === 'invalid') return 'invalid';
  return 'verified';
}

function getRequiredProof(registry: CapabilityProofRegistry, proofId: string): CapabilityProofRecord {
  const proof = getProof(registry, proofId);
  if (proof === undefined) {
    throw capabilityError('CAP_INVALID_PROOF', 'proof is not registered');
  }
  return proof;
}

function freezeRegistry(registry: CapabilityProofRegistry): CapabilityProofRegistry {
  const proofs: Record<string, CapabilityProofRecord> = {};
  for (const [id, proof] of Object.entries(registry.proofs)) proofs[id] = Object.freeze(proof);
  return Object.freeze({ proofs: Object.freeze(proofs) });
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

function assertId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw capabilityError('CAP_INVALID_ID', `${label} must be a non-empty string`);
  }
  return value.trim();
}

function assertTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw capabilityError('CAP_INVALID_TIMESTAMP', `${label} must be a valid timestamp`);
  }
  return value;
}

function assertDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !DIGEST_RE.test(value)) {
    throw capabilityError('CAP_INVALID_DIGEST', `${label} must be a supported digest ref`);
  }
  return value;
}

function assertScheme(value: unknown): CapabilityProofScheme {
  if (typeof value !== 'string' || !PROOF_SCHEMES.includes(value as CapabilityProofScheme)) {
    throw capabilityError('CAP_INVALID_PROOF', 'proof scheme is not supported');
  }
  return value as CapabilityProofScheme;
}

function assertVerificationState(value: unknown): CapabilityProofVerificationState {
  if (typeof value !== 'string' || !(CAPABILITY_PROOF_VERIFICATION_STATES as readonly string[]).includes(value)) {
    throw capabilityError('CAP_INVALID_ENUM', 'verificationState is not supported');
  }
  return value as CapabilityProofVerificationState;
}
