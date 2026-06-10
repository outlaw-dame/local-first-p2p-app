import { capabilityError } from './errors.js';
import type {
  CapabilityGrantV1
} from './types.js';

export type CapabilityDelegationEdge = Readonly<{
  from: string;
  to: string;
}>;

export type CapabilityDelegationPath = Readonly<{
  edges: readonly CapabilityDelegationEdge[];
  grants: readonly CapabilityGrantV1[];
}>;

export type CapabilityRevocationRecord = Readonly<{
  capabilityId: string;
  revokedAt: string;
  revokedBy: string;
  reason: string;
}>;

export function validateCapabilityRevocationRecord(value: unknown): CapabilityRevocationRecord {
  const record = assertPlainObject(value, 'CapabilityRevocationRecord');
  const capabilityId = assertId(record.capabilityId, 'CapabilityRevocationRecord.capabilityId');
  const revokedAt = assertTimestamp(record.revokedAt, 'CapabilityRevocationRecord.revokedAt');
  const revokedBy = assertId(record.revokedBy, 'CapabilityRevocationRecord.revokedBy');
  const reason = assertNonEmptyString(record.reason, 'CapabilityRevocationRecord.reason');

  return Object.freeze({
    capabilityId,
    revokedAt,
    revokedBy,
    reason
  });
}

export class CapabilityDelegationGraph {
  public readonly grants: Map<string, CapabilityGrantV1> = new Map();
  public readonly revocations: Map<string, readonly CapabilityRevocationRecord[]> = new Map();

  constructor(
    grants: readonly CapabilityGrantV1[] = [],
    revocations: readonly CapabilityRevocationRecord[] = []
  ) {
    for (const grant of grants) {
      this.grants.set(grant.capabilityId, grant);
    }
    for (const revocation of revocations) {
      this.addRevocation(revocation);
    }
  }

  public addGrant(grant: CapabilityGrantV1): void {
    this.grants.set(grant.capabilityId, grant);
  }

  public addRevocation(revocation: CapabilityRevocationRecord): void {
    const list = this.revocations.get(revocation.capabilityId) ?? [];
    this.revocations.set(revocation.capabilityId, [...list, revocation]);
  }
}

export function detectDelegationCycle(graph: CapabilityDelegationGraph): boolean {
  const visited = new Set<string>();
  const recStack = new Set<string>();

  function hasCycle(id: string): boolean {
    if (recStack.has(id)) return true;
    if (visited.has(id)) return false;

    visited.add(id);
    recStack.add(id);

    const grant = graph.grants.get(id);
    if (grant) {
      for (const proof of grant.proofRefs) {
        if (graph.grants.has(proof.proofId)) {
          if (hasCycle(proof.proofId)) return true;
        }
      }
    }

    recStack.delete(id);
    return false;
  }

  for (const id of graph.grants.keys()) {
    if (hasCycle(id)) return true;
  }

  return false;
}

export function buildCapabilityProofGraph(
  graph: CapabilityDelegationGraph,
  capabilityId: string
): CapabilityDelegationPath[] {
  const paths: CapabilityDelegationPath[] = [];

  function traverse(
    currentId: string,
    currentGrants: CapabilityGrantV1[],
    visited: Set<string>
  ) {
    const grant = graph.grants.get(currentId);
    if (!grant) {
      if (currentGrants.length > 0) {
        paths.push(createPath(currentGrants));
      }
      return;
    }

    if (visited.has(currentId)) {
      return;
    }

    const newVisited = new Set(visited).add(currentId);
    const newGrants = [grant, ...currentGrants];

    const parents = grant.proofRefs.filter(proof => graph.grants.has(proof.proofId));
    if (parents.length === 0) {
      if (grant.proofRefs.length === 0) {
        paths.push(createPath(newGrants));
      }
      return;
    }

    for (const parent of parents) {
      traverse(parent.proofId, newGrants, newVisited);
    }
  }

  traverse(capabilityId, [], new Set());
  return paths;
}

function createPath(grants: CapabilityGrantV1[]): CapabilityDelegationPath {
  const edges: CapabilityDelegationEdge[] = [];
  for (let i = 0; i < grants.length - 1; i++) {
    const fromGrant = grants[i];
    const toGrant = grants[i + 1];
    if (fromGrant && toGrant) {
      edges.push({
        from: fromGrant.capabilityId,
        to: toGrant.capabilityId
      });
    }
  }
  return {
    edges,
    grants
  };
}

export function validateDelegationStep(parent: CapabilityGrantV1, child: CapabilityGrantV1): boolean {
  // child issuer must match parent audience
  if (child.issuer.kind !== parent.audience.kind || child.issuer.id !== parent.audience.id) {
    return false;
  }

  // child resource must match parent resource
  if (child.resource.kind !== parent.resource.kind || child.resource.id !== parent.resource.id) {
    return false;
  }

  // action subset never expands
  const parentActions = new Set(parent.actions);
  for (const action of child.actions) {
    if (!parentActions.has(action)) {
      return false;
    }
  }

  // scope never expands (identical scope kind and ID)
  if (child.scope.kind !== parent.scope.kind || child.scope.id !== parent.scope.id) {
    return false;
  }

  // expiry never extends
  const parentExpiry = Date.parse(parent.expiresAt);
  const childExpiry = Date.parse(child.expiresAt);
  if (isNaN(parentExpiry) || isNaN(childExpiry) || childExpiry > parentExpiry) {
    return false;
  }

  // validity start (notBefore) never moves earlier
  if (parent.notBefore !== undefined) {
    if (child.notBefore === undefined) {
      return false;
    }
    const parentNotBefore = Date.parse(parent.notBefore);
    const childNotBefore = Date.parse(child.notBefore);
    if (isNaN(parentNotBefore) || isNaN(childNotBefore) || childNotBefore < parentNotBefore) {
      return false;
    }
  }

  // parent must have delegation depth > 0 to delegate, and child depth must be strictly less than parent depth
  if (parent.delegationDepth <= 0 || child.delegationDepth >= parent.delegationDepth) {
    return false;
  }

  return true;
}

export function validateDelegationPath(path: CapabilityDelegationPath): boolean {
  if (path.grants.length === 0) return false;
  for (let i = 0; i < path.grants.length - 1; i++) {
    const parent = path.grants[i];
    const child = path.grants[i + 1];
    if (!parent || !child || !validateDelegationStep(parent, child)) {
      return false;
    }
  }
  return true;
}

export function isDelegationPathValid(
  graph: CapabilityDelegationGraph,
  path: CapabilityDelegationPath,
  now: string
): boolean {
  if (!validateDelegationPath(path)) {
    return false;
  }

  const parsedNow = Date.parse(now);
  if (!Number.isFinite(parsedNow)) {
    return false;
  }

  for (const grant of path.grants) {
    const expiresAt = Date.parse(grant.expiresAt);
    if (isNaN(expiresAt) || expiresAt <= parsedNow) {
      return false;
    }

    if (grant.notBefore !== undefined) {
      const notBefore = Date.parse(grant.notBefore);
      if (isNaN(notBefore) || notBefore > parsedNow) {
        return false;
      }
    }

    const revocations = graph.revocations.get(grant.capabilityId) ?? [];
    for (const revocation of revocations) {
      if (revocation.revokedBy === grant.issuer.id) {
        const revokedAt = Date.parse(revocation.revokedAt);
        if (!isNaN(revokedAt) && revokedAt <= parsedNow) {
          return false;
        }
      }
    }
  }

  return true;
}

export function isCapabilityAuthorized(
  graph: CapabilityDelegationGraph,
  capabilityId: string,
  now: string
): boolean {
  if (detectDelegationCycle(graph)) {
    return false;
  }
  const paths = buildCapabilityProofGraph(graph, capabilityId);
  if (paths.length === 0) {
    return false;
  }
  return paths.some(path => isDelegationPathValid(graph, path, now));
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

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw capabilityError('CAP_INVALID_INPUT', `${label} must be a non-empty string`);
  }
  return value.trim();
}
