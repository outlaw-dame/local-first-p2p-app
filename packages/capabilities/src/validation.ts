import { capabilityError } from './errors.js';
import {
  CAPABILITY_ACTIONS,
  CAPABILITY_CAVEAT_KINDS,
  CAPABILITY_GRANT_VERSION,
  CAPABILITY_INVOCATION_VERSION,
  CAPABILITY_PARTY_KINDS,
  CAPABILITY_PROOF_SCHEMES,
  CAPABILITY_RESOURCE_KINDS,
  CAPABILITY_REVOCATION_REASONS,
  CAPABILITY_REVOCATION_VERSION,
  CAPABILITY_SCOPE_KINDS,
  type CapabilityAction,
  type CapabilityCaveat,
  type CapabilityCaveatKind,
  type CapabilityGrantV1,
  type CapabilityInvocationV1,
  type CapabilityJsonValue,
  type CapabilityPartyKind,
  type CapabilityPartyRef,
  type CapabilityProofRef,
  type CapabilityProofScheme,
  type CapabilityResourceKind,
  type CapabilityResourceRef,
  type CapabilityRevocationReason,
  type CapabilityRevocationRef,
  type CapabilityRevocationV1,
  type CapabilityScopeKind,
  type CapabilityScopeRef
} from './types.js';

const MAX_ID_LENGTH = 256;
const MAX_REF_LENGTH = 512;
const MAX_CAVEAT_JSON_LENGTH = 4096;
const FORBIDDEN_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toString',
  'toLocaleString',
  'valueOf'
]);
const DIGEST_RE = /^(sha-256|sha-512|blake3):[A-Za-z0-9_-]{8,512}$/u;

export function validateCapabilityGrant(value: unknown): CapabilityGrantV1 {
  const record = assertPlainObject(value, 'CapabilityGrantV1');
  const version = assertVersion(record.version, CAPABILITY_GRANT_VERSION, 'CapabilityGrantV1.version');
  const capabilityId = assertId(record.capabilityId, 'CapabilityGrantV1.capabilityId');
  const issuer = validatePartyRef(record.issuer, 'CapabilityGrantV1.issuer');
  const audience = validatePartyRef(record.audience, 'CapabilityGrantV1.audience');
  const resource = validateResourceRef(record.resource, 'CapabilityGrantV1.resource');
  const actions = validateActions(record.actions, 'CapabilityGrantV1.actions');
  const scope = validateScopeRef(record.scope, 'CapabilityGrantV1.scope');
  const caveats = validateCaveats(record.caveats, 'CapabilityGrantV1.caveats');
  const notBefore = optionalTimestamp(record.notBefore, 'CapabilityGrantV1.notBefore');
  const expiresAt = assertTimestamp(record.expiresAt, 'CapabilityGrantV1.expiresAt');
  const createdAt = assertTimestamp(record.createdAt, 'CapabilityGrantV1.createdAt');
  if (notBefore !== undefined && Date.parse(notBefore) >= Date.parse(expiresAt)) {
    throw capabilityError('CAP_INVALID_TIMESTAMP', 'CapabilityGrantV1.notBefore must be before expiresAt');
  }
  const delegationDepth = assertSafeNonNegativeInteger(record.delegationDepth, 'CapabilityGrantV1.delegationDepth');
  const revocationRef = record.revocationRef === undefined ? undefined : validateRevocationRef(record.revocationRef, 'CapabilityGrantV1.revocationRef');
  const nonce = assertId(record.nonce, 'CapabilityGrantV1.nonce');
  const proofRefs = validateProofRefs(record.proofRefs, 'CapabilityGrantV1.proofRefs');

  return deepFreeze({
    version,
    capabilityId,
    issuer,
    audience,
    resource,
    actions,
    scope,
    caveats,
    ...(notBefore === undefined ? {} : { notBefore }),
    expiresAt,
    delegationDepth,
    ...(revocationRef === undefined ? {} : { revocationRef }),
    nonce,
    proofRefs,
    createdAt
  });
}

export function validateCapabilityInvocation(value: unknown): CapabilityInvocationV1 {
  const record = assertPlainObject(value, 'CapabilityInvocationV1');
  const version = assertVersion(record.version, CAPABILITY_INVOCATION_VERSION, 'CapabilityInvocationV1.version');
  const invocationId = assertId(record.invocationId, 'CapabilityInvocationV1.invocationId');
  const capabilityId = assertId(record.capabilityId, 'CapabilityInvocationV1.capabilityId');
  const invoker = validatePartyRef(record.invoker, 'CapabilityInvocationV1.invoker');
  const device = record.device === undefined ? undefined : validatePartyRef(record.device, 'CapabilityInvocationV1.device');
  const resource = validateResourceRef(record.resource, 'CapabilityInvocationV1.resource');
  const action = assertOneOf(record.action, CAPABILITY_ACTIONS, 'CapabilityInvocationV1.action', 'CAP_INVALID_ACTION');
  const scope = validateScopeRef(record.scope, 'CapabilityInvocationV1.scope');
  const argumentsDigest = record.argumentsDigest === undefined ? undefined : assertDigest(record.argumentsDigest, 'CapabilityInvocationV1.argumentsDigest');
  const nonce = assertId(record.nonce, 'CapabilityInvocationV1.nonce');
  const createdAt = assertTimestamp(record.createdAt, 'CapabilityInvocationV1.createdAt');
  const expiresAt = optionalTimestamp(record.expiresAt, 'CapabilityInvocationV1.expiresAt');
  if (expiresAt !== undefined && Date.parse(createdAt) >= Date.parse(expiresAt)) {
    throw capabilityError('CAP_INVALID_TIMESTAMP', 'CapabilityInvocationV1.expiresAt must be after createdAt');
  }
  const proofRefs = validateProofRefs(record.proofRefs, 'CapabilityInvocationV1.proofRefs');

  return deepFreeze({
    version,
    invocationId,
    capabilityId,
    invoker,
    ...(device === undefined ? {} : { device }),
    resource,
    action,
    scope,
    ...(argumentsDigest === undefined ? {} : { argumentsDigest }),
    nonce,
    createdAt,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    proofRefs
  });
}

export function validateCapabilityRevocation(value: unknown): CapabilityRevocationV1 {
  const record = assertPlainObject(value, 'CapabilityRevocationV1');
  const version = assertVersion(record.version, CAPABILITY_REVOCATION_VERSION, 'CapabilityRevocationV1.version');
  const revocationId = assertId(record.revocationId, 'CapabilityRevocationV1.revocationId');
  const capabilityId = assertId(record.capabilityId, 'CapabilityRevocationV1.capabilityId');
  const issuer = validatePartyRef(record.issuer, 'CapabilityRevocationV1.issuer');
  const audience = record.audience === undefined ? undefined : validatePartyRef(record.audience, 'CapabilityRevocationV1.audience');
  const reasonCode = assertOneOf(record.reasonCode, CAPABILITY_REVOCATION_REASONS, 'CapabilityRevocationV1.reasonCode', 'CAP_INVALID_ENUM');
  const createdAt = assertTimestamp(record.createdAt, 'CapabilityRevocationV1.createdAt');
  const proofRefs = validateProofRefs(record.proofRefs, 'CapabilityRevocationV1.proofRefs');

  return deepFreeze({
    version,
    revocationId,
    capabilityId,
    issuer,
    ...(audience === undefined ? {} : { audience }),
    reasonCode,
    createdAt,
    proofRefs
  });
}

export function validatePartyRef(value: unknown, label = 'CapabilityPartyRef'): CapabilityPartyRef {
  const record = assertPlainObject(value, label);
  const kind = assertOneOf(record.kind, CAPABILITY_PARTY_KINDS, `${label}.kind`, 'CAP_INVALID_PARTY');
  const id = assertId(record.id, `${label}.id`);
  const digest = record.digest === undefined ? undefined : assertDigest(record.digest, `${label}.digest`);
  const publicKeyRef = record.publicKeyRef === undefined ? undefined : assertBoundedText(record.publicKeyRef, `${label}.publicKeyRef`, MAX_REF_LENGTH, 'CAP_INVALID_ID');
  return deepFreeze({ kind, id, ...(digest === undefined ? {} : { digest }), ...(publicKeyRef === undefined ? {} : { publicKeyRef }) });
}

export function validateResourceRef(value: unknown, label = 'CapabilityResourceRef'): CapabilityResourceRef {
  const record = assertPlainObject(value, label);
  const kind = assertOneOf(record.kind, CAPABILITY_RESOURCE_KINDS, `${label}.kind`, 'CAP_INVALID_RESOURCE');
  const id = assertId(record.id, `${label}.id`);
  const digest = record.digest === undefined ? undefined : assertDigest(record.digest, `${label}.digest`);
  const scopeHint = record.scopeHint === undefined ? undefined : assertBoundedText(record.scopeHint, `${label}.scopeHint`, MAX_REF_LENGTH, 'CAP_INVALID_SCOPE');
  return deepFreeze({ kind, id, ...(digest === undefined ? {} : { digest }), ...(scopeHint === undefined ? {} : { scopeHint }) });
}

export function validateScopeRef(value: unknown, label = 'CapabilityScopeRef'): CapabilityScopeRef {
  const record = assertPlainObject(value, label);
  const kind = assertOneOf(record.kind, CAPABILITY_SCOPE_KINDS, `${label}.kind`, 'CAP_INVALID_SCOPE');
  const id = assertId(record.id, `${label}.id`);
  return deepFreeze({ kind, id });
}

export function validateProofRef(value: unknown, label = 'CapabilityProofRef'): CapabilityProofRef {
  const record = assertPlainObject(value, label);
  const proofId = assertId(record.proofId, `${label}.proofId`);
  const scheme = assertOneOf(record.scheme, CAPABILITY_PROOF_SCHEMES, `${label}.scheme`, 'CAP_INVALID_PROOF');
  return deepFreeze({ proofId, scheme });
}

function validateRevocationRef(value: unknown, label: string): CapabilityRevocationRef {
  const record = assertPlainObject(value, label);
  return deepFreeze({
    revocationId: assertId(record.revocationId, `${label}.revocationId`),
    capabilityId: assertId(record.capabilityId, `${label}.capabilityId`)
  });
}

function validateActions(value: unknown, label: string): readonly CapabilityAction[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw capabilityError('CAP_INVALID_ACTION', `${label} must be a non-empty array`);
  }
  const seen = new Set<string>();
  const out = value.map((item, index) => {
    if (item === '*') throw capabilityError('CAP_INVALID_ACTION', `${label}[${index}] wildcard actions are forbidden in v1`);
    const action = assertOneOf(item, CAPABILITY_ACTIONS, `${label}[${index}]`, 'CAP_INVALID_ACTION');
    if (seen.has(action)) throw capabilityError('CAP_DUPLICATE_VALUE', `${label} contains duplicate action ${action}`);
    seen.add(action);
    return action;
  });
  return Object.freeze(out);
}

function validateCaveats(value: unknown, label: string): readonly CapabilityCaveat[] {
  if (!Array.isArray(value)) throw capabilityError('CAP_INVALID_CAVEAT', `${label} must be an array`);
  return Object.freeze(value.map((item, index) => validateCaveat(item, `${label}[${index}]`)));
}

function validateCaveat(value: unknown, label: string): CapabilityCaveat {
  const record = assertPlainObject(value, label);
  const kind = assertOneOf(record.kind, CAPABILITY_CAVEAT_KINDS, `${label}.kind`, 'CAP_INVALID_CAVEAT');
  const caveatValue = validateJsonValue(record.value, `${label}.value`);
  const encoded = JSON.stringify(caveatValue);
  if (encoded.length > MAX_CAVEAT_JSON_LENGTH) {
    throw capabilityError('CAP_INVALID_CAVEAT', `${label}.value is too large`);
  }
  return deepFreeze({ kind, value: caveatValue });
}

function validateProofRefs(value: unknown, label: string): readonly CapabilityProofRef[] {
  if (!Array.isArray(value)) throw capabilityError('CAP_INVALID_PROOF', `${label} must be an array`);
  const seen = new Set<string>();
  return Object.freeze(value.map((item, index) => {
    const proof = validateProofRef(item, `${label}[${index}]`);
    if (seen.has(proof.proofId)) throw capabilityError('CAP_DUPLICATE_VALUE', `${label} contains duplicate proofId ${proof.proofId}`);
    seen.add(proof.proofId);
    return proof;
  }));
}

function validateJsonValue(value: unknown, label: string): CapabilityJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw capabilityError('CAP_INVALID_CAVEAT', `${label} must not be NaN or Infinity`);
    return value;
  }
  if (Array.isArray(value)) return Object.freeze(value.map((item, index) => validateJsonValue(item, `${label}[${index}]`)));
  const record = assertPlainObject(value, label);
  const out: Record<string, CapabilityJsonValue> = {};
  for (const [key, item] of Object.entries(record)) {
    assertAllowedKey(key, `${label}.${key}`);
    out[key] = validateJsonValue(item, `${label}.${key}`);
  }
  return deepFreeze(out);
}

function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw capabilityError('CAP_INVALID_INPUT', `${label} must be a plain object`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw capabilityError('CAP_INVALID_INPUT', `${label} must be a plain object`);
  }
  for (const key of Object.keys(value)) assertAllowedKey(key, `${label}.${key}`);
  return value as Record<string, unknown>;
}

function assertAllowedKey(key: string, label: string): void {
  if (FORBIDDEN_KEYS.has(key)) throw capabilityError('CAP_FORBIDDEN_KEY', `${label} uses a forbidden key`);
}

function assertVersion<const T extends string>(value: unknown, expected: T, label: string): T {
  if (value !== expected) throw capabilityError('CAP_UNKNOWN_VERSION', `${label} must be ${expected}`);
  return expected;
}

function assertId(value: unknown, label: string): string {
  return assertBoundedText(value, label, MAX_ID_LENGTH, 'CAP_INVALID_ID');
}

function assertBoundedText(value: unknown, label: string, max: number, code: 'CAP_INVALID_ID' | 'CAP_INVALID_SCOPE'): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw capabilityError(code, `${label} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (FORBIDDEN_KEYS.has(trimmed)) throw capabilityError('CAP_FORBIDDEN_KEY', `${label} uses a forbidden value`);
  if (trimmed.length > max) throw capabilityError(code, `${label} exceeds ${max} characters`);
  return trimmed;
}

function assertTimestamp(value: unknown, label: string): string {
  const text = assertBoundedText(value, label, MAX_REF_LENGTH, 'CAP_INVALID_ID');
  if (!Number.isFinite(Date.parse(text))) throw capabilityError('CAP_INVALID_TIMESTAMP', `${label} must be a valid timestamp`);
  return text;
}

function optionalTimestamp(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return assertTimestamp(value, label);
}

function assertDigest(value: unknown, label: string): string {
  const text = assertBoundedText(value, label, MAX_REF_LENGTH, 'CAP_INVALID_ID');
  if (!DIGEST_RE.test(text)) throw capabilityError('CAP_INVALID_DIGEST', `${label} must be a supported digest ref`);
  return text;
}

function assertSafeNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw capabilityError('CAP_INVALID_NUMBER', `${label} must be a safe non-negative integer`);
  }
  return value as number;
}

function assertOneOf<const T extends readonly string[]>(value: unknown, allowed: T, label: string, code: 'CAP_INVALID_ENUM' | 'CAP_INVALID_ACTION' | 'CAP_INVALID_PARTY' | 'CAP_INVALID_RESOURCE' | 'CAP_INVALID_SCOPE' | 'CAP_INVALID_CAVEAT' | 'CAP_INVALID_PROOF'): T[number] {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw capabilityError(code, `${label} is not supported`);
  }
  return value as T[number];
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  return Object.freeze(value);
}
