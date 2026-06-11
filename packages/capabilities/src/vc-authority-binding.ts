import { capabilityError } from './errors.js';
import type { CapabilityAction, CapabilityPartyRef, CapabilityProofRef, CapabilityResourceRef, CapabilityScopeRef } from './types.js';
import { CAPABILITY_ACTIONS } from './types.js';
import { validatePartyRef, validateProofRef, validateResourceRef, validateScopeRef } from './validation.js';

export type VcAuthorityBinding = Readonly<{
  bindingId: string;
  credential: CapabilityProofRef;
  authority: CapabilityPartyRef;
  resource: CapabilityResourceRef;
  scope: CapabilityScopeRef;
  eligibleActions: readonly CapabilityAction[];
  issuedAt: string;
  expiresAt?: string;
}>;

export function validateVcAuthorityBinding(value: unknown): VcAuthorityBinding {
  const record = assertPlainObject(value, 'VcAuthorityBinding');
  const bindingId = assertId(record.bindingId, 'VcAuthorityBinding.bindingId');
  const credential = validateProofRef(record.credential, 'VcAuthorityBinding.credential');
  if (credential.scheme !== 'vc') {
    throw capabilityError('CAP_INVALID_PROOF', 'VcAuthorityBinding.credential must use vc proof scheme');
  }
  const authority = validatePartyRef(record.authority, 'VcAuthorityBinding.authority');
  const resource = validateResourceRef(record.resource, 'VcAuthorityBinding.resource');
  const scope = validateScopeRef(record.scope, 'VcAuthorityBinding.scope');
  const eligibleActions = validateActions(record.eligibleActions);
  const issuedAt = assertTimestamp(record.issuedAt, 'VcAuthorityBinding.issuedAt');
  const expiresAt = record.expiresAt === undefined ? undefined : assertTimestamp(record.expiresAt, 'VcAuthorityBinding.expiresAt');
  if (expiresAt !== undefined && Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    throw capabilityError('CAP_INVALID_TIMESTAMP', 'VcAuthorityBinding.expiresAt must be after issuedAt');
  }
  return Object.freeze({
    bindingId,
    credential,
    authority,
    resource,
    scope,
    eligibleActions,
    issuedAt,
    ...(expiresAt === undefined ? {} : { expiresAt })
  });
}

export function isVcBindingEligibleForAction(
  binding: VcAuthorityBinding,
  action: CapabilityAction,
  now: string
): boolean {
  const validated = validateVcAuthorityBinding(binding);
  const parsedNow = Date.parse(now);
  if (!Number.isFinite(parsedNow)) return false;
  if (validated.expiresAt !== undefined && Date.parse(validated.expiresAt) <= parsedNow) return false;
  return validated.eligibleActions.includes(action);
}

function validateActions(value: unknown): readonly CapabilityAction[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw capabilityError('CAP_INVALID_ACTION', 'eligibleActions must be a non-empty array');
  }
  const seen = new Set<string>();
  const out = value.map((item) => {
    if (typeof item !== 'string' || !(CAPABILITY_ACTIONS as readonly string[]).includes(item)) {
      throw capabilityError('CAP_INVALID_ACTION', 'eligible action is not supported');
    }
    if (seen.has(item)) throw capabilityError('CAP_DUPLICATE_VALUE', 'eligibleActions contains duplicate action');
    seen.add(item);
    return item as CapabilityAction;
  });
  return Object.freeze(out);
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
