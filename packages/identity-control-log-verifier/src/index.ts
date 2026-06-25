import type { CapabilityPartyRef, CapabilityProofRecord } from '@lfp2p/capabilities';
import { sha256, toBase64Url, verifySignedEventEnvelope } from '@lfp2p/crypto';
import { seedIdentityControlProjection } from '@lfp2p/identity';
import { canonicalizeJson, type SignedEventEnvelope } from '@lfp2p/protocol';

export type CapabilityProofCryptoVerdict = 'verified' | 'invalid';
export type CapabilityProofVerifier = (record: CapabilityProofRecord) => CapabilityProofCryptoVerdict | undefined;
export type IdentityControlLogResolver = (proofId: string) => readonly SignedEventEnvelope[] | undefined;

type IdentityControlProjection = ReturnType<typeof seedIdentityControlProjection>;

export type IdentityControlIssuerMatchStrategy = (
  issuer: CapabilityPartyRef,
  projection: IdentityControlProjection,
  proofEvent: SignedEventEnvelope
) => boolean;

export type IdentityControlSubjectMatchStrategy = (
  subject: CapabilityPartyRef,
  projection: IdentityControlProjection,
  proofEvent: SignedEventEnvelope
) => boolean;

export type CreateIdentityControlLogVerifierOptions = Readonly<{
  resolveIdentityControlLog: IdentityControlLogResolver;
  now?: () => number;
  issuerMatches?: IdentityControlIssuerMatchStrategy;
  subjectMatches?: IdentityControlSubjectMatchStrategy;
}>;

const SHA256_PREFIX = 'sha-256:';

export function createIdentityControlLogVerifier(options: CreateIdentityControlLogVerifierOptions): CapabilityProofVerifier {
  if (options === null || typeof options !== 'object') throw new TypeError('createIdentityControlLogVerifier: options must be an object');
  if (typeof options.resolveIdentityControlLog !== 'function') throw new TypeError('createIdentityControlLogVerifier: resolveIdentityControlLog must be a function');
  if (options.now !== undefined && typeof options.now !== 'function') throw new TypeError('createIdentityControlLogVerifier: now must be a function');
  if (options.issuerMatches !== undefined && typeof options.issuerMatches !== 'function') throw new TypeError('createIdentityControlLogVerifier: issuerMatches must be a function');
  if (options.subjectMatches !== undefined && typeof options.subjectMatches !== 'function') throw new TypeError('createIdentityControlLogVerifier: subjectMatches must be a function');

  const clock = options.now ?? (() => Date.now());
  const issuerMatches = options.issuerMatches ?? defaultIssuerMatches;
  const subjectMatches = options.subjectMatches ?? defaultSubjectMatches;

  return function verifyIdentityControlLog(record) {
    if (record === null || typeof record !== 'object') return undefined;
    if (record.scheme !== 'identity-control-log') return undefined;
    if (!hasRequiredRecordFields(record)) return 'invalid';

    let events: readonly SignedEventEnvelope[] | undefined;
    try {
      events = options.resolveIdentityControlLog(record.proofId);
    } catch {
      return 'invalid';
    }
    if (!Array.isArray(events) || events.length === 0) return 'invalid';
    if (!events.every((event) => verifySignedEventEnvelope(event))) return 'invalid';

    const proofEvent = findProofEvent(events, record.proofId);
    if (proofEvent === undefined) return 'invalid';
    if (proofEvent.kind !== 'identity.capability.granted') return 'invalid';
    if (!digestMatches(record.digest, proofEvent)) return 'invalid';

    let projection: IdentityControlProjection;
    try {
      projection = seedIdentityControlProjection(events);
    } catch {
      return 'invalid';
    }

    if (!projectionStillGrants(projection, proofEvent, clock())) return 'invalid';

    try {
      if (issuerMatches(record.issuer, projection, proofEvent) !== true) return 'invalid';
      if (subjectMatches(record.subject, projection, proofEvent) !== true) return 'invalid';
    } catch {
      return 'invalid';
    }

    return 'verified';
  };
}

export function identityControlLogProofDigest(event: SignedEventEnvelope): string {
  if (event === null || typeof event !== 'object') throw new TypeError('identityControlLogProofDigest: event must be a SignedEventEnvelope');
  const bytes = new TextEncoder().encode(canonicalizeJson(event));
  return SHA256_PREFIX + toBase64Url(sha256(bytes));
}

function hasRequiredRecordFields(record: CapabilityProofRecord): boolean {
  return typeof record.proofId === 'string' && record.proofId.length > 0 &&
    record.issuer !== null && typeof record.issuer === 'object' && typeof record.issuer.id === 'string' && record.issuer.id.length > 0 &&
    record.subject !== null && typeof record.subject === 'object' && typeof record.subject.id === 'string' && record.subject.id.length > 0 &&
    typeof record.digest === 'string' && record.digest.length > 0;
}

function findProofEvent(events: readonly SignedEventEnvelope[], proofId: string): SignedEventEnvelope | undefined {
  let found: SignedEventEnvelope | undefined;
  for (const event of events) {
    if (event.eventId !== proofId) continue;
    if (found !== undefined && canonicalizeJson(found) !== canonicalizeJson(event)) return undefined;
    found = event;
  }
  return found;
}

function digestMatches(digest: string, event: SignedEventEnvelope): boolean {
  return digest.startsWith(SHA256_PREFIX) && digest === identityControlLogProofDigest(event);
}

function projectionStillGrants(projection: IdentityControlProjection, proofEvent: SignedEventEnvelope, nowMs: number): boolean {
  const payload = proofEvent.payload as Record<string, unknown>;
  const capabilityId = typeof payload.capabilityId === 'string' ? payload.capabilityId : undefined;
  const delegateDeviceId = typeof payload.delegateDeviceId === 'string' ? payload.delegateDeviceId : undefined;
  const expiresAt = typeof payload.expiresAt === 'string' ? payload.expiresAt : undefined;
  if (capabilityId === undefined || delegateDeviceId === undefined || expiresAt === undefined) return false;

  const capability = projection.capabilities[capabilityId];
  if (capability === undefined || capability.status !== 'granted') return false;
  if (capability.delegateDeviceId !== delegateDeviceId || capability.expiresAt !== expiresAt) return false;

  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs) || nowMs >= expiresAtMs) return false;

  const device = projection.devices[delegateDeviceId];
  return device !== undefined && device.status === 'active';
}

function defaultIssuerMatches(issuer: CapabilityPartyRef, projection: IdentityControlProjection): boolean {
  if (issuer.kind !== 'controller') return false;
  if (projection.controllerPublicKey === undefined) return false;
  return issuer.id === projection.controllerPublicKey || issuer.publicKeyRef === projection.controllerPublicKey;
}

function defaultSubjectMatches(subject: CapabilityPartyRef, _projection: IdentityControlProjection, proofEvent: SignedEventEnvelope): boolean {
  const delegateDeviceId = (proofEvent.payload as Record<string, unknown>).delegateDeviceId;
  return subject.kind === 'device' && typeof delegateDeviceId === 'string' && subject.id === delegateDeviceId;
}
