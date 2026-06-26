/**
 * Proof Registry — canonical provenance + verification-state store for
 * capability proofs.
 *
 * Today a `CapabilityProofRef` is just `{ proofId, scheme }` — a
 * dangling pointer. The grant says "there is a UCAN proof with id X"
 * but nothing records who issued it, when it expires, its content
 * digest, or whether it actually verifies. That is why
 * `reliance.ts` treats `capability.unverified-proof` as a blanket
 * deny: there is nothing to verify against.
 *
 * This module adds the missing record:
 *
 *   - `CapabilityProofRecord` — issuer / subject / issuedAt /
 *     expiresAt / revokedAt / digest / verificationState.
 *   - A pure, immutable `ProofRegistry` with `registerProof`,
 *     `getProof`, `verifyProof`, `revokeProof`.
 *
 * Design constraints (match the rest of `@lfp2p/capabilities`):
 *
 *   1. **Zero dependencies.** The package depends on nothing, so this
 *      module performs NO cryptography itself. `verifyProof` takes an
 *      INJECTED `CapabilityProofVerifier` — the caller (who holds
 *      `@lfp2p/crypto`) supplies the actual ed25519 / signature-chain
 *      check. A verifier that cannot speak to a scheme returns
 *      `undefined`, which resolves to `unverified` — an honest "we
 *      have not verified this", never a false `verified`.
 *
 *   2. **Honest verification scope.** Only schemes a supplied
 *      verifier can assess become `verified` / `invalid`. UCAN, VC,
 *      zcap-ld, bearcap, and manual-local-policy proofs stay
 *      `unverified` until a dedicated verifier exists — the registry
 *      never pretends to have validated a credential format it cannot
 *      check.
 *
 *   3. **Deterministic, crypto-independent gates win first.** A
 *      revoked proof is `revoked` and an expired proof is `expired`
 *      regardless of cryptographic validity — those are stronger,
 *      cheaper, fail-closed signals. Verification only runs when the
 *      proof is neither revoked nor expired.
 *
 *   4. **Pure + frozen** per the Phase 3.2 replay/frozen-walk
 *      discipline. Every operation returns a NEW frozen registry +
 *      record; nothing mutates in place. Replaying the same
 *      operations on a second device yields byte-identical state.
 */
import { capabilityError } from './errors.js';
import {
  CAPABILITY_PROOF_SCHEMES,
  type CapabilityPartyRef,
  type CapabilityProofRef,
  type CapabilityProofScheme
} from './types.js';
import {
  assertDigest,
  assertId,
  assertOneOf,
  assertPlainObject,
  assertTimestamp,
  deepFreeze,
  optionalTimestamp,
  validatePartyRef
} from './validation.js';

export const CAPABILITY_PROOF_REGISTRY_VERSION = 'lfp2p.capability.proof-registry.v1' as const;
export type CapabilityProofRegistryVersion = typeof CAPABILITY_PROOF_REGISTRY_VERSION;

/**
 * The six verification states.
 *
 *   - `unverified` — recorded, but not yet cryptographically checked
 *     (or no verifier exists for the scheme). The honest default.
 *   - `possession-confirmed` — an injected verifier confirmed that
 *     the caller demonstrated possession of bytes whose digest
 *     matches `record.digest`, but the scheme does NOT support
 *     cryptographic identity binding (bearer tokens, share URLs,
 *     pre-signed secrets). Strictly weaker than `verified`: the
 *     reliance gate must NOT treat it as authority-establishing,
 *     because anyone who saw the token bytes at any point produces
 *     the same verdict. It exists so that auditors and registry
 *     consumers can distinguish "we never checked" from "we
 *     checked the only thing this scheme admits."
 *   - `verified`   — an injected verifier confirmed the proof's
 *     cryptographic validity (signature + identity binding) AND it
 *     is neither expired nor revoked. The strongest verdict.
 *   - `expired`    — `now >= expiresAt`. Time invalidated it.
 *   - `revoked`    — explicitly revoked (carries `revokedAt`).
 *   - `invalid`    — an injected verifier rejected it (bad signature,
 *     broken chain, subject mismatch, digest mismatch, …).
 */
export const CAPABILITY_PROOF_VERIFICATION_STATES = [
  'unverified',
  'possession-confirmed',
  'verified',
  'expired',
  'revoked',
  'invalid'
] as const;
export type CapabilityProofVerificationState =
  (typeof CAPABILITY_PROOF_VERIFICATION_STATES)[number];

/**
 * Severity order, most → least severe (least → most trustworthy).
 * Used by `summarizeProofStates` to fold many proof states into the
 * single worst (least trustworthy) state, so a capability backed by
 * one revoked proof is treated as revoked even if its other proofs
 * verify. Fail-closed by construction.
 *
 * `possession-confirmed` sits BETWEEN `unverified` and `verified`:
 * more informative than "we never checked" (it confirms the bytes
 * match what was registered) but strictly weaker than cryptographic
 * authority verification. The reliance gate's existing
 * `proofsState !== 'verified'` check therefore treats it as
 * fail-closed for AUTHORITY decisions while the registry still
 * surfaces the distinction in its audit state.
 */
const VERIFICATION_SEVERITY: readonly CapabilityProofVerificationState[] = [
  'revoked',
  'invalid',
  'expired',
  'unverified',
  'possession-confirmed',
  'verified'
];

export type CapabilityProofRecord = Readonly<{
  proofId: string;
  scheme: CapabilityProofScheme;
  /** The party that issued the underlying proof. */
  issuer: CapabilityPartyRef;
  /** The party the proof is about / vouches for. */
  subject: CapabilityPartyRef;
  issuedAt: string;
  expiresAt: string;
  /** Present iff the proof has been revoked. */
  revokedAt?: string;
  /** Content digest of the underlying proof bytes (`sha-256:…`). */
  digest: string;
  verificationState: CapabilityProofVerificationState;
}>;

export type RegisterProofInput = Readonly<{
  proofId: string;
  scheme: CapabilityProofScheme;
  issuer: CapabilityPartyRef;
  subject: CapabilityPartyRef;
  issuedAt: string;
  expiresAt: string;
  revokedAt?: string;
  digest: string;
}>;

/**
 * The verdict an injected verifier may return.
 *
 *   - `'verified'`            — full cryptographic verification
 *                               (signature + identity binding).
 *   - `'possession-confirmed'` — the scheme does not admit
 *                               cryptographic authority verification
 *                               (bearer tokens) but the verifier
 *                               confirmed the bytes match
 *                               `record.digest`. Strictly weaker
 *                               than `'verified'`.
 *   - `'invalid'`             — the verifier rejected the proof.
 *   - `undefined`             — this verifier cannot assess this
 *                               scheme → resolves to `unverified`.
 *
 * Expiry and revocation are handled deterministically by the
 * registry, not the verifier.
 */
export type CapabilityProofCryptoVerdict = 'verified' | 'possession-confirmed' | 'invalid';
export type CapabilityProofVerifier = (
  record: CapabilityProofRecord
) => CapabilityProofCryptoVerdict | undefined;

export type VerifyProofOptions = Readonly<{
  now: string;
  verifier?: CapabilityProofVerifier;
}>;

export type ProofRegistry = Readonly<{
  version: CapabilityProofRegistryVersion;
  proofs: ReadonlyMap<string, CapabilityProofRecord>;
}>;

export type ProofRegistryResult = Readonly<{
  registry: ProofRegistry;
  record: CapabilityProofRecord;
}>;

/* -------------------------------------------------------------------------- */
/*                                 factory                                    */
/* -------------------------------------------------------------------------- */

export function createProofRegistry(): ProofRegistry {
  return Object.freeze({
    version: CAPABILITY_PROOF_REGISTRY_VERSION,
    proofs: freezeMap(new Map())
  });
}

/* -------------------------------------------------------------------------- */
/*                              registerProof                                 */
/* -------------------------------------------------------------------------- */

/**
 * Record a new proof. Proofs are immutable once registered — a
 * duplicate `proofId` throws (use `verifyProof` / `revokeProof` to
 * advance state). The initial state is `revoked` when `revokedAt` is
 * supplied, otherwise `unverified` (the honest default — registration
 * does not imply verification).
 */
export function registerProof(registry: ProofRegistry, input: unknown): ProofRegistryResult {
  assertRegistry(registry);
  const record = validateRegisterProofInput(input);
  if (registry.proofs.has(record.proofId)) {
    throw capabilityError('CAP_DUPLICATE_VALUE', `proofId ${record.proofId} is already registered`);
  }
  const next = new Map(registry.proofs);
  next.set(record.proofId, record);
  return freezeResult(registry.version, next, record);
}

/* -------------------------------------------------------------------------- */
/*                                getProof                                    */
/* -------------------------------------------------------------------------- */

export function getProof(
  registry: ProofRegistry,
  proofId: string
): CapabilityProofRecord | undefined {
  assertRegistry(registry);
  return registry.proofs.get(assertId(proofId, 'proofId'));
}

/* -------------------------------------------------------------------------- */
/*                               verifyProof                                  */
/* -------------------------------------------------------------------------- */

/**
 * Compute and persist the live verification state of a proof.
 *
 * Precedence (fail-closed; deterministic gates before cryptography):
 *   1. `revokedAt` present              → `revoked`
 *   2. `now >= expiresAt`               → `expired`
 *   3. injected verifier says `invalid` → `invalid`
 *   4. injected verifier says `verified`→ `verified`
 *   5. no verifier / verifier abstains  → `unverified`
 *
 * Returns a new registry with the proof's `verificationState`
 * updated. Pure: the input registry is untouched.
 */
export function verifyProof(
  registry: ProofRegistry,
  proofId: string,
  options: VerifyProofOptions
): ProofRegistryResult {
  assertRegistry(registry);
  const id = assertId(proofId, 'proofId');
  const existing = registry.proofs.get(id);
  if (existing === undefined) {
    throw capabilityError('CAP_INVALID_INPUT', `unknown proofId ${id}`);
  }
  if (options === null || typeof options !== 'object') {
    throw capabilityError('CAP_INVALID_INPUT', 'verifyProof options must be an object');
  }
  const now = assertTimestamp(options.now, 'verifyProof.now');
  if (options.verifier !== undefined && typeof options.verifier !== 'function') {
    throw capabilityError('CAP_INVALID_INPUT', 'verifyProof.verifier must be a function');
  }

  const state = computeVerificationState(existing, now, options.verifier);
  if (state === existing.verificationState) {
    // No-op transition. Return the ORIGINAL registry reference (not
    // a fresh allocation) so callers can detect "nothing changed"
    // via reference equality and skip downstream work cheaply.
    return Object.freeze({ registry, record: existing });
  }
  const updated = deepFreeze({ ...existing, verificationState: state });
  const next = new Map(registry.proofs);
  next.set(id, updated);
  return freezeResult(registry.version, next, updated);
}

/* -------------------------------------------------------------------------- */
/*                               revokeProof                                  */
/* -------------------------------------------------------------------------- */

/**
 * Revoke a proof. Monotonic: revoking an already-revoked proof keeps
 * the original `revokedAt` (the first revocation wins) and is a
 * no-op. Sets `verificationState` to `revoked`.
 */
export function revokeProof(
  registry: ProofRegistry,
  proofId: string,
  options: Readonly<{ revokedAt: string }>
): ProofRegistryResult {
  assertRegistry(registry);
  const id = assertId(proofId, 'proofId');
  const existing = registry.proofs.get(id);
  if (existing === undefined) {
    throw capabilityError('CAP_INVALID_INPUT', `unknown proofId ${id}`);
  }
  if (options === null || typeof options !== 'object') {
    throw capabilityError('CAP_INVALID_INPUT', 'revokeProof options must be an object');
  }
  const revokedAt = assertTimestamp(options.revokedAt, 'revokeProof.revokedAt');

  if (existing.revokedAt !== undefined) {
    // Already revoked — monotonic no-op. Return the ORIGINAL
    // registry reference so callers can detect "nothing changed"
    // via reference equality.
    return Object.freeze({ registry, record: existing });
  }
  const updated = deepFreeze({ ...existing, revokedAt, verificationState: 'revoked' as const });
  const next = new Map(registry.proofs);
  next.set(id, updated);
  return freezeResult(registry.version, next, updated);
}

/* -------------------------------------------------------------------------- */
/*                       aggregate over a set of proofs                       */
/* -------------------------------------------------------------------------- */

/**
 * Fold the registry's view of a capability's `proofRefs` into a
 * single worst-case (least trustworthy) state, so a downstream
 * authority decision can gate on one value.
 *
 *   - An empty ref list → `unverified` (no proof backs the claim).
 *   - A ref pointing at a proof not in the registry → `unverified`
 *     (we hold no provenance for it; fail closed).
 *   - Otherwise the most-severe state across all referenced proofs
 *     (revoked > invalid > expired > unverified > verified).
 *
 * This is the value `reliance.ts` consults to turn its blanket
 * `unverified-proof` deny into a real verification outcome.
 */
export function summarizeProofStates(
  registry: ProofRegistry,
  refs: readonly CapabilityProofRef[]
): CapabilityProofVerificationState {
  assertRegistry(registry);
  if (!Array.isArray(refs)) {
    throw capabilityError('CAP_INVALID_PROOF', 'refs must be an array');
  }
  if (refs.length === 0) return 'unverified';
  let worstIndex = VERIFICATION_SEVERITY.indexOf('verified'); // start at most trustworthy
  for (const ref of refs) {
    if (ref === null || typeof ref !== 'object') {
      throw capabilityError('CAP_INVALID_PROOF', 'each ref must be an object');
    }
    // Defense-in-depth: validate via the same `assertId` the rest of
    // the capability system uses (length cap + prototype-pollution /
    // forbidden-key guard) before letting the value touch the
    // registry map.
    const proofId = assertId(ref.proofId, 'ref.proofId');
    const record = registry.proofs.get(proofId);
    const state: CapabilityProofVerificationState =
      record === undefined ? 'unverified' : record.verificationState;
    const idx = VERIFICATION_SEVERITY.indexOf(state);
    if (idx < worstIndex) worstIndex = idx;
  }
  return VERIFICATION_SEVERITY[worstIndex] as CapabilityProofVerificationState;
}

/* -------------------------------------------------------------------------- */
/*                                internals                                   */
/* -------------------------------------------------------------------------- */

function computeVerificationState(
  record: CapabilityProofRecord,
  now: string,
  verifier: CapabilityProofVerifier | undefined
): CapabilityProofVerificationState {
  if (record.revokedAt !== undefined) return 'revoked';
  const nowMs = Date.parse(now);
  const expMs = Date.parse(record.expiresAt);
  if (Number.isFinite(nowMs) && Number.isFinite(expMs) && nowMs >= expMs) {
    return 'expired';
  }
  // Defensive: an injected verifier is foreign code. A throw must
  // not crash the registry (DoS), and we treat it as `invalid` —
  // more severe than `unverified` in `summarizeProofStates`'s
  // worst-case fold, so a buggy/adversarial verifier gates the
  // reliance decision MORE aggressively (fail closed).
  let verdict: CapabilityProofCryptoVerdict | undefined;
  try {
    verdict = verifier?.(record);
  } catch {
    return 'invalid';
  }
  if (verdict === 'verified') return 'verified';
  if (verdict === 'possession-confirmed') return 'possession-confirmed';
  if (verdict === 'invalid') return 'invalid';
  return 'unverified';
}

/**
 * Reconstruct a `ProofRegistry` from a set of already-stamped
 * `CapabilityProofRecord`s — the inverse of "iterate registry.proofs".
 *
 * Use this when loading a persisted registry from disk: each row in
 * the table is a fully-stamped record (issuer, subject, digest,
 * expires, verificationState). The factory rehydrates them into a
 * frozen registry as-is, without running any verifier or mutating
 * any state. Verification IS local-per-device by doctrine — the
 * persisted `verificationState` is the cache of "what THIS device's
 * verifier stack decided last time"; loading it back trusts that
 * cache.
 *
 * Validation:
 *   - Every record is validated through the same field-level
 *     guards as `registerProof`: scheme is in the enum, party refs
 *     are well-formed, digest matches DIGEST_RE, timestamps parse.
 *   - `verificationState` must be in
 *     `CAPABILITY_PROOF_VERIFICATION_STATES` — a corrupt row at
 *     rest cannot inject an unknown state value.
 *   - Duplicate `proofId` throws — the persistence-layer index has
 *     this as its primary key, so a duplicate signals storage
 *     corruption or programmer error, not a recoverable case.
 *
 * Pure on inputs; the returned registry is deep-frozen.
 */
export function seedProofRegistry(records: Iterable<unknown>): ProofRegistry {
  if (records === null || typeof records !== 'object' || typeof (records as Iterable<unknown>)[Symbol.iterator] !== 'function') {
    throw capabilityError('CAP_INVALID_INPUT', 'seedProofRegistry: records must be iterable');
  }
  const map = new Map<string, CapabilityProofRecord>();
  for (const raw of records as Iterable<unknown>) {
    const record = validateStoredProofRecord(raw);
    if (map.has(record.proofId)) {
      throw capabilityError(
        'CAP_DUPLICATE_VALUE',
        `seedProofRegistry: duplicate proofId ${record.proofId}`
      );
    }
    map.set(record.proofId, record);
  }
  return Object.freeze({
    version: CAPABILITY_PROOF_REGISTRY_VERSION,
    proofs: freezeMap(map)
  });
}

/**
 * Validates an already-stamped record. Mirrors
 * `validateRegisterProofInput` but ALSO accepts (and enforces) the
 * `verificationState` field instead of deriving it. Used by
 * `seedProofRegistry` only — for fresh registrations the derived
 * version in `validateRegisterProofInput` is correct.
 */
function validateStoredProofRecord(value: unknown): CapabilityProofRecord {
  const record = assertPlainObject(value, 'StoredProofRecord');
  const proofId = assertId(record.proofId, 'StoredProofRecord.proofId');
  const scheme = assertOneOf(
    record.scheme,
    CAPABILITY_PROOF_SCHEMES,
    'StoredProofRecord.scheme',
    'CAP_INVALID_PROOF'
  );
  const issuer = validatePartyRef(record.issuer, 'StoredProofRecord.issuer');
  const subject = validatePartyRef(record.subject, 'StoredProofRecord.subject');
  const issuedAt = assertTimestamp(record.issuedAt, 'StoredProofRecord.issuedAt');
  const expiresAt = assertTimestamp(record.expiresAt, 'StoredProofRecord.expiresAt');
  if (Date.parse(issuedAt) >= Date.parse(expiresAt)) {
    throw capabilityError(
      'CAP_INVALID_TIMESTAMP',
      'StoredProofRecord.issuedAt must be before expiresAt'
    );
  }
  const revokedAt = optionalTimestamp(record.revokedAt, 'StoredProofRecord.revokedAt');
  if (revokedAt !== undefined && Date.parse(revokedAt) < Date.parse(issuedAt)) {
    throw capabilityError(
      'CAP_INVALID_TIMESTAMP',
      'StoredProofRecord.revokedAt must not predate issuedAt'
    );
  }
  const digest = assertDigest(record.digest, 'StoredProofRecord.digest');
  const verificationState = assertOneOf(
    record.verificationState,
    CAPABILITY_PROOF_VERIFICATION_STATES,
    'StoredProofRecord.verificationState',
    'CAP_INVALID_PROOF'
  );
  return deepFreeze({
    proofId,
    scheme,
    issuer,
    subject,
    issuedAt,
    expiresAt,
    ...(revokedAt === undefined ? {} : { revokedAt }),
    digest,
    verificationState
  });
}

function validateRegisterProofInput(value: unknown): CapabilityProofRecord {
  const record = assertPlainObject(value, 'RegisterProofInput');
  const proofId = assertId(record.proofId, 'RegisterProofInput.proofId');
  const scheme = assertOneOf(
    record.scheme,
    CAPABILITY_PROOF_SCHEMES,
    'RegisterProofInput.scheme',
    'CAP_INVALID_PROOF'
  );
  const issuer = validatePartyRef(record.issuer, 'RegisterProofInput.issuer');
  const subject = validatePartyRef(record.subject, 'RegisterProofInput.subject');
  const issuedAt = assertTimestamp(record.issuedAt, 'RegisterProofInput.issuedAt');
  const expiresAt = assertTimestamp(record.expiresAt, 'RegisterProofInput.expiresAt');
  if (Date.parse(issuedAt) >= Date.parse(expiresAt)) {
    throw capabilityError('CAP_INVALID_TIMESTAMP', 'RegisterProofInput.issuedAt must be before expiresAt');
  }
  const revokedAt = optionalTimestamp(record.revokedAt, 'RegisterProofInput.revokedAt');
  if (revokedAt !== undefined && Date.parse(revokedAt) < Date.parse(issuedAt)) {
    throw capabilityError('CAP_INVALID_TIMESTAMP', 'RegisterProofInput.revokedAt must not predate issuedAt');
  }
  const digest = assertDigest(record.digest, 'RegisterProofInput.digest');
  const verificationState: CapabilityProofVerificationState =
    revokedAt === undefined ? 'unverified' : 'revoked';

  return deepFreeze({
    proofId,
    scheme,
    issuer,
    subject,
    issuedAt,
    expiresAt,
    ...(revokedAt === undefined ? {} : { revokedAt }),
    digest,
    verificationState
  });
}

function assertRegistry(registry: ProofRegistry): void {
  if (
    registry === null ||
    typeof registry !== 'object' ||
    registry.version !== CAPABILITY_PROOF_REGISTRY_VERSION ||
    !(registry.proofs instanceof Map)
  ) {
    throw capabilityError('CAP_INVALID_INPUT', 'invalid ProofRegistry');
  }
}

function freezeResult(
  version: CapabilityProofRegistryVersion,
  proofs: Map<string, CapabilityProofRecord>,
  record: CapabilityProofRecord
): ProofRegistryResult {
  return Object.freeze({
    registry: Object.freeze({ version, proofs: freezeMap(proofs) }),
    record
  });
}

function freezeMap(
  map: Map<string, CapabilityProofRecord>
): ReadonlyMap<string, CapabilityProofRecord> {
  // A Map's internal slots stay mutable, but freezing the object
  // restores the structural marker discipline used across the
  // codebase (Phase 3.2). Callers receive it typed ReadonlyMap.
  return Object.freeze(map) as ReadonlyMap<string, CapabilityProofRecord>;
}
