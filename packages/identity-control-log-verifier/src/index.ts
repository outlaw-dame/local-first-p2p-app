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

/* -------------------------------------------------------------------------- */
/*                              auto-registration                             */
/* -------------------------------------------------------------------------- */

/**
 * Derive a `CapabilityProofRecord` from an
 * `identity.capability.granted` signed event.
 *
 * This is the inverse of the verifier — converting a signed event
 * back into the registry shape the verifier later consumes. The
 * returned record is ready to be persisted via
 * `@lfp2p/local-store`'s `putCapabilityProofRecord`.
 *
 * Returns `undefined` (clean dispatch path) when:
 *   - `event` is not a non-null object, OR
 *   - `event.kind !== 'identity.capability.granted'` (a different
 *     identity event is not an authority grant), OR
 *   - any required field on the event or its payload is missing /
 *     malformed (the persistence layer would reject anyway; bail
 *     here so the caller can route the event elsewhere).
 *
 * The returned record always has `verificationState: 'unverified'`.
 * The local app is expected to run `verifyProof` against the
 * hydrated registry afterwards — verification is local-per-device
 * by doctrine, and registration alone does not assert cryptographic
 * authority.
 *
 * Pure on inputs; the returned record is plain-object shaped (not
 * deep-frozen — `validateStoredProofRecord` at the persistence
 * boundary freezes it).
 */
export function deriveProofFromIdentityCapabilityGranted(
  event: SignedEventEnvelope
): CapabilityProofRecord | undefined {
  if (event === null || typeof event !== 'object') return undefined;
  if ((event as { kind?: unknown }).kind !== 'identity.capability.granted') return undefined;

  const eventId = (event as { eventId?: unknown }).eventId;
  if (typeof eventId !== 'string' || eventId.length === 0) return undefined;
  const createdAt = (event as { createdAt?: unknown }).createdAt;
  if (typeof createdAt !== 'string' || createdAt.length === 0) return undefined;

  const signature = (event as { signature?: unknown }).signature;
  if (signature === null || typeof signature !== 'object') return undefined;
  const controllerPublicKey = (signature as { publicKey?: unknown }).publicKey;
  if (typeof controllerPublicKey !== 'string' || controllerPublicKey.length === 0) {
    return undefined;
  }

  const payload = (event as { payload?: unknown }).payload;
  if (payload === null || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;
  const delegateDeviceId = p.delegateDeviceId;
  const expiresAt = p.expiresAt;
  if (
    typeof p.capabilityId !== 'string' || p.capabilityId.length === 0 ||
    typeof delegateDeviceId !== 'string' || delegateDeviceId.length === 0 ||
    typeof expiresAt !== 'string' || expiresAt.length === 0
  ) {
    return undefined;
  }

  return {
    proofId: eventId,
    scheme: 'identity-control-log',
    issuer: { kind: 'controller', id: controllerPublicKey },
    subject: { kind: 'device', id: delegateDeviceId },
    issuedAt: createdAt,
    expiresAt,
    digest: identityControlLogProofDigest(event),
    verificationState: 'unverified'
  };
}

/**
 * Minimal store interface the auto-registration helper depends on —
 * narrower than `@lfp2p/local-store`'s full surface so this package
 * stays free of a hard dep on the persistence implementation.
 * Any object exposing `putCapabilityProofRecord` (including
 * `DexieLocalFirstStore`) satisfies it.
 */
export type CapabilityProofRecordStore = {
  putCapabilityProofRecord(record: CapabilityProofRecord): Promise<void>;
};

/**
 * Auto-register a capability proof from an inbound signed event.
 *
 * Convenience wrapper: derives the proof record via
 * `deriveProofFromIdentityCapabilityGranted` and (on success)
 * persists it through the supplied store. Returns `true` when a
 * record was registered, `false` when the event isn't a granted
 * event the helper can speak to.
 *
 * Intended to be called from an inbound-sync handler after an
 * `identity.capability.granted` event lands. The persistence layer
 * (`putCapabilityProofRecord`) re-validates the record at the
 * write boundary, so a malformed event still surfaces loudly — the
 * helper does not silently swallow validation failures.
 *
 * Errors from the store are NOT caught: a transient write failure
 * MUST surface so the caller can retry or fail closed.
 */
export async function registerIdentityCapabilityProof(
  store: CapabilityProofRecordStore,
  event: SignedEventEnvelope
): Promise<boolean> {
  if (store === null || typeof store !== 'object' || typeof store.putCapabilityProofRecord !== 'function') {
    throw new TypeError('registerIdentityCapabilityProof: store must expose putCapabilityProofRecord');
  }
  const record = deriveProofFromIdentityCapabilityGranted(event);
  if (record === undefined) return false;
  await store.putCapabilityProofRecord(record);
  return true;
}
