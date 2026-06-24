/**
 * `@lfp2p/vc-verifier` — W3C Verifiable Credentials scheme verifier
 * for the capability proof registry.
 *
 * Plugs into the registry's `CapabilityProofVerifier` slot
 * (`@lfp2p/capabilities/proof-registry.ts`) and verifies proofs whose
 * `scheme === 'vc'`. For every other scheme the verifier abstains
 * (`undefined`), so it composes cleanly with sibling verifiers via
 * `composeVerifiers` from `@lfp2p/native-proof-verifier`.
 *
 * Honest v1 scope:
 *
 *   - **One proof type only.** `proof.type === 'DataIntegrityProof'`
 *     with `cryptosuite === 'eddsa-jcs-2022'`. Every other proof
 *     type — `Ed25519Signature2020`, `JsonWebSignature2020`,
 *     `DataIntegrityProof` with a different cryptosuite,
 *     `BbsBlsSignature2020`, etc. — resolves to `'invalid'`. The
 *     verifier never silently "abstains on unknown proof type"
 *     because the scheme `'vc'` has already been claimed at the
 *     registry level; abstaining there would let a broken / forged
 *     credential land at `'unverified'` and slip past the reliance
 *     gate.
 *   - **`did:key` issuers and verification methods only.** Other
 *     DID methods resolve to `'invalid'`.
 *   - **Ed25519 signatures only.** Mandated by the chosen
 *     cryptosuite. Signature is multibase `z<base58btc>` of the
 *     64-byte detached signature.
 *   - **JCS canonicalization (RFC 8785), not URDNA2015.** Picking
 *     `eddsa-jcs-2022` deliberately avoids JSON-LD canonicalization
 *     and its `@context`-resolution dependency.
 *   - **No status-list / revocation lookup.** The proof registry's
 *     deterministic `revokedAt` gate is the authoritative revocation
 *     surface; the verifier does NOT chase
 *     `credentialStatus.statusListCredential` URLs.
 *
 * Returning `'verified'` means:
 *
 *   1. The resolved credential parses as plain JSON.
 *   2. It has a `proof` (or single-entry `proof[]`) with
 *      `type === 'DataIntegrityProof'` and
 *      `cryptosuite === 'eddsa-jcs-2022'`.
 *   3. `credential.issuer` (string or `{ id }`) matches
 *      `record.issuer.id` exactly.
 *   4. `proof.verificationMethod` is a `did:key:z…` (optionally
 *      with a fragment) whose base DID equals
 *      `record.issuer.id`. The verifier extracts the Ed25519
 *      public key bytes from that DID.
 *   5. `validFrom`/`issuanceDate` (if present) is in the past
 *      relative to `now`; `validUntil`/`expirationDate` (if
 *      present) is strictly in the future.
 *   6. `credentialSubject.id` matches `record.subject.id` — a
 *      credential about Alice cannot back a registry record whose
 *      subject is Bob.
 *   7. The eddsa-jcs-2022 signature over
 *      `sha256(JCS(proofConfig)) || sha256(JCS(unsecuredDoc))`
 *      verifies against the resolved public key.
 *
 * The verifier is synchronous, pure on its inputs, and performs NO
 * network IO. The caller injects `resolveCredential(proofId)` so
 * the verifier stays agnostic about credential storage.
 */
import type { CapabilityProofRecord } from '@lfp2p/capabilities';
import {
  canonicalizeJcs,
  didKeyToEd25519PublicKey,
  decodeBase58Btc,
  sha256,
  verifyEd25519
} from '@lfp2p/crypto';

export type CapabilityProofCryptoVerdict = 'verified' | 'invalid';
export type CapabilityProofVerifier = (
  record: CapabilityProofRecord
) => CapabilityProofCryptoVerdict | undefined;

/**
 * Resolve a registered VC proof's parsed JSON body by `proofId`.
 * Returns the credential as a plain JSON value when the caller
 * holds it; `undefined` otherwise. The verifier treats `undefined`
 * as `'invalid'` for `scheme === 'vc'`.
 */
export type VcCredentialResolver = (proofId: string) => unknown | undefined;

export type CreateVcVerifierOptions = Readonly<{
  resolveCredential: VcCredentialResolver;
  /**
   * Override the time source. Defaults to `Date.now()`. Used only
   * for the credential's own `validFrom`/`validUntil` (and the
   * VC-DM 1.1 aliases `issuanceDate`/`expirationDate`). The proof
   * registry has its own deterministic expiry/revocation gate.
   */
  now?: () => number;
}>;

export function createVcVerifier(
  options: CreateVcVerifierOptions
): CapabilityProofVerifier {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('createVcVerifier: options must be an object');
  }
  if (typeof options.resolveCredential !== 'function') {
    throw new TypeError('createVcVerifier: resolveCredential must be a function');
  }
  if (options.now !== undefined && typeof options.now !== 'function') {
    throw new TypeError('createVcVerifier: now must be a function');
  }

  const clock = options.now ?? (() => Date.now());

  return function verifyVc(record) {
    if (record === null || typeof record !== 'object') return undefined;
    if (record.scheme !== 'vc') return undefined;

    if (
      typeof record.proofId !== 'string' ||
      record.proofId.length === 0 ||
      record.issuer === null ||
      typeof record.issuer !== 'object' ||
      typeof record.issuer.id !== 'string' ||
      record.issuer.id.length === 0 ||
      record.subject === null ||
      typeof record.subject !== 'object' ||
      typeof record.subject.id !== 'string' ||
      record.subject.id.length === 0
    ) {
      return 'invalid';
    }

    let raw: unknown;
    try {
      raw = options.resolveCredential(record.proofId);
    } catch {
      return 'invalid';
    }
    if (raw === undefined) return 'invalid';

    // Defuse non-JSON shapes (typed arrays, Maps, class instances,
    // prototype-polluted objects) by round-tripping through JSON.
    // After this `credential` is plain-JSON-shaped or we fail.
    let credential: unknown;
    try {
      credential = JSON.parse(JSON.stringify(raw));
    } catch {
      return 'invalid';
    }
    if (credential === undefined) return 'invalid';

    return verifyVcCredential(
      credential,
      record.issuer.id,
      record.subject.id,
      clock()
    );
  };
}

/* -------------------------------------------------------------------------- */
/*                           credential verification                          */
/* -------------------------------------------------------------------------- */

function verifyVcCredential(
  credential: unknown,
  expectedIssuerId: string,
  expectedSubjectId: string,
  nowMs: number
): CapabilityProofCryptoVerdict {
  if (credential === null || typeof credential !== 'object' || Array.isArray(credential)) {
    return 'invalid';
  }
  const cred = credential as Record<string, unknown>;

  const issuerId = extractIssuerId(cred.issuer);
  if (issuerId === undefined) return 'invalid';
  if (issuerId !== expectedIssuerId) return 'invalid';

  // credentialSubject: single subject only in v1 (multi-subject
  // credentials cannot map to a single registry record's subject).
  const subjectId = extractSubjectId(cred.credentialSubject);
  if (subjectId === undefined) return 'invalid';
  if (subjectId !== expectedSubjectId) return 'invalid';

  if (!checkValidityWindow(cred, nowMs)) return 'invalid';

  // Multi-proof credentials are out of scope for v1 — we cannot
  // honestly fold multiple proof states into a single verdict.
  const proof = extractSingleProof(cred.proof);
  if (proof === undefined) return 'invalid';

  if (proof.type !== 'DataIntegrityProof') return 'invalid';
  if (proof.cryptosuite !== 'eddsa-jcs-2022') return 'invalid';
  if (typeof proof.proofValue !== 'string' || proof.proofValue.length === 0) return 'invalid';
  if (typeof proof.verificationMethod !== 'string' || proof.verificationMethod.length === 0) {
    return 'invalid';
  }
  // proofPurpose is required by the DI spec; we don't enforce a
  // particular value, only that it's present and non-empty.
  if (typeof proof.proofPurpose !== 'string' || proof.proofPurpose.length === 0) {
    return 'invalid';
  }

  // verificationMethod → did:key → Ed25519 pubkey. Strip any fragment.
  const vmBase = stripFragment(proof.verificationMethod);
  const publicKey = didKeyToEd25519PublicKey(vmBase);
  if (publicKey === undefined) return 'invalid';

  // The verification method's base DID MUST equal the credential
  // issuer — otherwise any did:key holder could sign credentials
  // claiming to be from any issuer.
  if (vmBase !== expectedIssuerId) return 'invalid';

  // eddsa-jcs-2022 proofValue = multibase 'z' + base58btc + 64-byte
  // raw Ed25519 signature (NO multicodec — different from did:key).
  const signature = decodeProofValueMultibase(proof.proofValue);
  if (signature === undefined) return 'invalid';
  if (signature.byteLength !== 64) return 'invalid';

  // Build the signing input per W3C VC-DI eddsa-jcs-2022:
  //   1. proofConfig  = JCS(proof without proofValue)
  //   2. unsecuredDoc = JCS(credential without proof)
  //   3. hashData     = sha256(proofConfig) || sha256(unsecuredDoc)
  //   4. verify       = Ed25519.verify(hashData, signature, pubkey)
  let proofOptionsBytes: Uint8Array;
  let unsecuredDocBytes: Uint8Array;
  try {
    const proofWithoutProofValue = stripField(proof, 'proofValue');
    const credentialWithoutProof = stripField(cred, 'proof');
    proofOptionsBytes = new TextEncoder().encode(canonicalizeJcs(proofWithoutProofValue));
    unsecuredDocBytes = new TextEncoder().encode(canonicalizeJcs(credentialWithoutProof));
  } catch {
    // canonicalizeJcs throws on non-finite numbers / unsupported
    // types. A credential we cannot canonicalize cannot be
    // verified — fail closed.
    return 'invalid';
  }

  const proofConfigHash = sha256(proofOptionsBytes);
  const transformedDataHash = sha256(unsecuredDocBytes);
  const hashData = new Uint8Array(proofConfigHash.byteLength + transformedDataHash.byteLength);
  hashData.set(proofConfigHash, 0);
  hashData.set(transformedDataHash, proofConfigHash.byteLength);

  if (!verifyEd25519(hashData, signature, publicKey)) return 'invalid';

  return 'verified';
}

/* -------------------------------------------------------------------------- */
/*                               field helpers                                */
/* -------------------------------------------------------------------------- */

function extractIssuerId(issuer: unknown): string | undefined {
  if (typeof issuer === 'string') {
    return issuer.length > 0 ? issuer : undefined;
  }
  if (issuer !== null && typeof issuer === 'object' && !Array.isArray(issuer)) {
    const id = (issuer as Record<string, unknown>).id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return undefined;
}

function extractSubjectId(subject: unknown): string | undefined {
  if (subject === null || subject === undefined) return undefined;
  if (Array.isArray(subject)) return undefined;
  if (typeof subject !== 'object') return undefined;
  const id = (subject as Record<string, unknown>).id;
  if (typeof id === 'string' && id.length > 0) return id;
  return undefined;
}

function extractSingleProof(proof: unknown): Record<string, unknown> | undefined {
  if (proof === null || proof === undefined) return undefined;
  if (Array.isArray(proof)) {
    if (proof.length !== 1) return undefined;
    const entry = proof[0];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
    return entry as Record<string, unknown>;
  }
  if (typeof proof !== 'object') return undefined;
  return proof as Record<string, unknown>;
}

function checkValidityWindow(
  cred: Record<string, unknown>,
  nowMs: number
): boolean {
  // VC-DM 2.0: validFrom / validUntil
  // VC-DM 1.1: issuanceDate / expirationDate
  // Accept either set; if a field is present it MUST be parseable
  // and the window must hold. now === expiry is expired
  // (fail-closed; matches ucan-verifier).
  for (const startField of ['validFrom', 'issuanceDate'] as const) {
    const v = cred[startField];
    if (v === undefined) continue;
    if (typeof v !== 'string') return false;
    const startMs = Date.parse(v);
    if (!Number.isFinite(startMs)) return false;
    if (nowMs < startMs) return false;
  }
  for (const endField of ['validUntil', 'expirationDate'] as const) {
    const v = cred[endField];
    if (v === undefined) continue;
    if (typeof v !== 'string') return false;
    const endMs = Date.parse(v);
    if (!Number.isFinite(endMs)) return false;
    if (nowMs >= endMs) return false;
  }
  return true;
}

function stripFragment(uri: string): string {
  const hashIdx = uri.indexOf('#');
  return hashIdx === -1 ? uri : uri.slice(0, hashIdx);
}

function stripField(
  obj: Record<string, unknown>,
  field: string
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    if (k === field) continue;
    out[k] = obj[k];
  }
  return out;
}

/**
 * Decode a multibase-encoded VC proofValue. eddsa-jcs-2022 mandates
 * the base58btc prefix `'z'` followed by the raw 64-byte Ed25519
 * signature (NOT multicodec-prefixed — different from did:key).
 */
function decodeProofValueMultibase(value: string): Uint8Array | undefined {
  if (value.length < 2) return undefined;
  if (value[0] !== 'z') return undefined;
  return decodeBase58Btc(value.slice(1));
}
