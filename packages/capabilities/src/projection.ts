import type {
  CapabilityGrantV1,
  CapabilityInvocationV1,
  CapabilityRevocationV1
} from './types.js';
import {
  validateCapabilityGrant,
  validateCapabilityInvocation,
  validateCapabilityRevocation
} from './validation.js';

export type CapabilityProjectionGrantState = 'active' | 'revoked';

export type CapabilityProjectionGrant = Readonly<{
  grant: CapabilityGrantV1;
  state: CapabilityProjectionGrantState;
  revokedAt?: string;
  revocationIds: readonly string[];
}>;

export type CapabilityProjection = Readonly<{
  grants: Readonly<Record<string, CapabilityProjectionGrant>>;
  revocations: Readonly<Record<string, CapabilityRevocationV1>>;
  invocationIds: Readonly<Record<string, true>>;
}>;

export function createEmptyCapabilityProjection(): CapabilityProjection {
  return deepFreeze({
    grants: {},
    revocations: {},
    invocationIds: {}
  });
}

export function applyCapabilityGrant(
  projection: CapabilityProjection,
  value: CapabilityGrantV1 | unknown
): CapabilityProjection {
  const grant = validateCapabilityGrant(value);
  const existing = projection.grants[grant.capabilityId];
  const priorRevocations = revocationsForCapability(projection, grant.capabilityId);
  if (existing?.state === 'revoked' || priorRevocations.length > 0) {
    const revokedAt = existing?.revokedAt ?? priorRevocations[0]?.createdAt;
    const revokedGrant: CapabilityProjectionGrant = {
      grant: existing?.grant ?? grant,
      state: 'revoked',
      ...(revokedAt === undefined ? {} : { revokedAt }),
      revocationIds: Object.freeze([
        ...new Set([
          ...(existing?.revocationIds ?? []),
          ...priorRevocations.map((revocation) => revocation.revocationId)
        ])
      ])
    };
    return freezeProjection({
      ...projection,
      grants: {
        ...projection.grants,
        [grant.capabilityId]: revokedGrant
      }
    });
  }
  return freezeProjection({
    ...projection,
    grants: {
      ...projection.grants,
      [grant.capabilityId]: {
        grant,
        state: 'active',
        revocationIds: Object.freeze([])
      }
    }
  });
}

export function applyCapabilityRevocation(
  projection: CapabilityProjection,
  value: CapabilityRevocationV1 | unknown
): CapabilityProjection {
  const revocation = validateCapabilityRevocation(value);
  const existingGrant = projection.grants[revocation.capabilityId];
  const revocationIds = existingGrant === undefined
    ? Object.freeze([revocation.revocationId])
    : Object.freeze([...new Set([...existingGrant.revocationIds, revocation.revocationId])]);

  return freezeProjection({
    ...projection,
    revocations: {
      ...projection.revocations,
      [revocation.revocationId]: revocation
    },
    grants: existingGrant === undefined
      ? projection.grants
      : {
          ...projection.grants,
          [revocation.capabilityId]: {
            ...existingGrant,
            state: 'revoked',
            revokedAt: existingGrant.revokedAt ?? revocation.createdAt,
            revocationIds
          }
        }
  });
}

export function applyCapabilityInvocationRecord(
  projection: CapabilityProjection,
  value: CapabilityInvocationV1 | unknown
): CapabilityProjection {
  const invocation = validateCapabilityInvocation(value);
  return freezeProjection({
    ...projection,
    invocationIds: {
      ...projection.invocationIds,
      [invocation.invocationId]: true
    }
  });
}

export function isCapabilityRevoked(
  projection: CapabilityProjection,
  capabilityId: string
): boolean {
  if (projection.grants[capabilityId]?.state === 'revoked') return true;
  return revocationsForCapability(projection, capabilityId).length > 0;
}

export function hasInvocationReplay(
  projection: CapabilityProjection,
  invocationId: string
): boolean {
  return projection.invocationIds[invocationId] === true;
}

function revocationsForCapability(
  projection: CapabilityProjection,
  capabilityId: string
): readonly CapabilityRevocationV1[] {
  return Object.freeze(Object.values(projection.revocations).filter((revocation) => revocation.capabilityId === capabilityId));
}

function freezeProjection(projection: CapabilityProjection): CapabilityProjection {
  const grants: Record<string, CapabilityProjectionGrant> = {};
  for (const [id, grant] of Object.entries(projection.grants)) grants[id] = deepFreeze(grant);
  const revocations: Record<string, CapabilityRevocationV1> = {};
  for (const [id, revocation] of Object.entries(projection.revocations)) revocations[id] = deepFreeze(revocation);
  const invocationIds: Record<string, true> = {};
  for (const id of Object.keys(projection.invocationIds)) invocationIds[id] = true;
  return deepFreeze({ grants, revocations, invocationIds });
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  return Object.freeze(value);
}
