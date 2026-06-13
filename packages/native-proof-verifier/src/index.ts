/**
 * `@lfp2p/native-proof-verifier` — the smallest honest adapter that
 * plugs into the Phase-1 capability proof registry.
 *
 * The proof registry (`@lfp2p/capabilities/proof-registry.ts`)
 * exposes an injection slot for cryptographic verification via the
 * `CapabilityProofVerifier` type:
 *
 *   (record: CapabilityProofRecord) => 'verified' | 'invalid' | undefined
 *
 * Returning `undefined` means "this verifier cannot assess this
 * record" and is resolved by the registry to `unverified`. That
 * design lets multiple verifiers compose without any one of them
 * being able to falsely promote a proof to `verified`.
 *
 * This package fills the slot for ONE scheme — `native-signed-event`
 * — and is intentionally honest about everything else:
 *
 *   - It does NOT attempt to verify UCAN, VC, zcap-ld, bearcap, or
 *     manual-local-policy proofs. For those the verifier abstains
 *     (`undefined`), so the registry continues to treat them as
 *     `unverified`. Verifiers for those schemes can be plugged in
 *     side-by-side via composition (`composeVerifiers`).
 *
 *   - It does NOT store the signed event bytes. The caller injects a
 *     `resolveSignedEvent(proofId)` function. If the resolver returns
 *     `undefined`, the verifier abstains — fail closed without
 *     pretending the proof is invalid for the wrong reason.
 *
 *   - It does NOT recompute the proof record's `digest` field. The
 *     digest is the *integrity binding* between the proof registry
 *     entry and the underlying signed event bytes, and is the caller's
 *     responsibility to maintain when they wire up
 *     `resolveSignedEvent`. (`assertNativeProofDigest` is provided as
 *     a separate helper for callers who want to add an async digest
 *     check at registration time; see the doctrine note below.)
 *
 * The verifier is pure on its inputs and synchronous — matches the
 * `CapabilityProofVerifier` type the registry expects. It performs no
 * network IO. The only side-effect is calling
 * `verifySignedEventEnvelope` from `@lfp2p/crypto`, which is itself a
 * pure ed25519 check.
 */
import type { CapabilityPartyRef, CapabilityProofRecord } from '@lfp2p/capabilities';
import { canonicalizeJson, type SignedEventEnvelope } from '@lfp2p/protocol';
import { sha256Base64Url, verifySignedEventEnvelope } from '@lfp2p/crypto';

export type CapabilityProofCryptoVerdict = 'verified' | 'invalid';
export type CapabilityProofVerifier = (
  record: CapabilityProofRecord
) => CapabilityProofCryptoVerdict | undefined;

/**
 * Resolve a stored signed event by the `proofId` recorded in a
 * `CapabilityProofRecord`. Returns `undefined` when the caller does
 * not hold the bytes — the verifier interprets that as "abstain",
 * NOT as "invalid", so the registry stays at `unverified` (honest).
 *
 * Synchronous on purpose: the verifier itself is synchronous to
 * match the registry's `CapabilityProofVerifier` shape, so the
 * resolver must be too. Callers with async storage should hydrate a
 * synchronous lookup map before invoking `verifyProof`.
 */
export type SignedEventResolver = (
  proofId: string
) => SignedEventEnvelope | undefined;

/**
 * Strategy for matching a `CapabilityProofRecord.issuer` against the
 * `author` of a resolved `SignedEventEnvelope`. The default is strict
 * equality between the issuer's bare `id` field and `event.author`.
 *
 * Callers who use a different id-mapping (e.g., `controller:<id>`
 * vs. `identity:<id>` namespaces, or DID resolution) can supply
 * their own. Returning `false` from the strategy resolves to
 * `'invalid'`, NOT to abstain — a present-but-mismatched issuer is a
 * positive signal that the proof does not back the claim.
 */
export type IssuerMatchStrategy = (
  issuer: CapabilityPartyRef,
  event: SignedEventEnvelope
) => boolean;

export type CreateNativeProofVerifierOptions = Readonly<{
  resolveSignedEvent: SignedEventResolver;
  issuerMatches?: IssuerMatchStrategy;
}>;

/**
 * Construct a `CapabilityProofVerifier` that can speak to the
 * `native-signed-event` scheme. For every other scheme the verifier
 * abstains (returns `undefined`).
 *
 * Verifier precedence:
 *
 *   1. record.scheme !== 'native-signed-event'  → undefined (abstain)
 *   2. resolveSignedEvent(record.proofId) is undefined → undefined
 *      (abstain — caller does not hold the bytes; we don't have an
 *      opinion)
 *   3. issuerMatches(record.issuer, event) === false → 'invalid'
 *      (positive mismatch — the proof does NOT back the issuer
 *      claim)
 *   4. verifySignedEventEnvelope(event) === false → 'invalid'
 *      (signature/version/structure check failed)
 *   5. otherwise → 'verified'
 *
 * The function never throws on its own inputs — a bad
 * `resolveSignedEvent` or `issuerMatches` callback is wrapped via the
 * registry's own try/catch on the verifier slot (see
 * `@lfp2p/capabilities/proof-registry.ts`), so a buggy caller can
 * never crash the registry. As belt-and-suspenders, this module
 * additionally returns `'invalid'` if the strategy throws — fail
 * closed at the adapter layer too.
 */
export function createNativeProofVerifier(
  options: CreateNativeProofVerifierOptions
): CapabilityProofVerifier {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('createNativeProofVerifier: options must be an object');
  }
  if (typeof options.resolveSignedEvent !== 'function') {
    throw new TypeError('createNativeProofVerifier: resolveSignedEvent must be a function');
  }
  if (
    options.issuerMatches !== undefined &&
    typeof options.issuerMatches !== 'function'
  ) {
    throw new TypeError('createNativeProofVerifier: issuerMatches must be a function when supplied');
  }
  const issuerMatches = options.issuerMatches ?? defaultIssuerMatches;
  const resolveSignedEvent = options.resolveSignedEvent;

  return function verifyNativeProof(record) {
    if (record === null || typeof record !== 'object') return undefined;
    if (record.scheme !== 'native-signed-event') return undefined;
    let event: SignedEventEnvelope | undefined;
    try {
      event = resolveSignedEvent(record.proofId);
    } catch {
      // A throwing resolver is a caller bug. Treat as "we don't hold
      // the bytes" — abstain rather than asserting `invalid`, so a
      // misconfigured resolver does not poison every native proof
      // into `invalid`. The registry's outer try/catch would also
      // have caught this; this is belt-and-suspenders.
      return undefined;
    }
    if (event === undefined) return undefined;

    let issuerOk: boolean;
    try {
      issuerOk = issuerMatches(record.issuer, event) === true;
    } catch {
      // Strategy bugs are positive evidence we cannot rely on the
      // match — fail closed at the adapter layer.
      return 'invalid';
    }
    if (!issuerOk) return 'invalid';

    let signatureOk: boolean;
    try {
      signatureOk = verifySignedEventEnvelope(event);
    } catch {
      return 'invalid';
    }
    return signatureOk ? 'verified' : 'invalid';
  };
}

/**
 * Compose two `CapabilityProofVerifier`s into one. The composed
 * verifier asks each in order; the first NON-undefined verdict wins.
 * Pure on its inputs. This is the recommended way to add support for
 * new schemes (e.g., a future UCAN verifier) without modifying the
 * native one.
 *
 * Order matters only when two verifiers can both speak to the same
 * scheme — list the more authoritative one first.
 */
export function composeVerifiers(
  ...verifiers: readonly CapabilityProofVerifier[]
): CapabilityProofVerifier {
  if (verifiers.length === 0) {
    return () => undefined;
  }
  for (const v of verifiers) {
    if (typeof v !== 'function') {
      throw new TypeError('composeVerifiers: every argument must be a function');
    }
  }
  return function composedVerifier(record) {
    for (const v of verifiers) {
      let verdict: CapabilityProofCryptoVerdict | undefined;
      try {
        verdict = v(record);
      } catch {
        // A throwing sub-verifier abstains, matching the spirit of
        // the proof-registry's own DoS hardening.
        verdict = undefined;
      }
      if (verdict !== undefined) return verdict;
    }
    return undefined;
  };
}

/**
 * Optional helper: assert that a proof record's `digest` field
 * matches the SHA-256 of the canonical bytes of a signed event. This
 * is the *integrity binding* between the proof registry entry and
 * the underlying event. The native verifier deliberately does NOT
 * call this (it would require an async sha-256 inside the sync
 * verifier path), but callers can use this at registration time to
 * be confident the binding holds.
 *
 * Returns the digest if it matches; throws `Error('digest mismatch')`
 * otherwise.
 */
export async function assertNativeProofDigest(
  record: Pick<CapabilityProofRecord, 'digest'>,
  event: SignedEventEnvelope
): Promise<string> {
  const canonical = canonicalizeJson(event);
  const computed = await sha256Base64Url(canonical);
  const expected = stripDigestPrefix(record.digest);
  if (computed !== expected) {
    throw new Error('digest mismatch');
  }
  return record.digest;
}

/* -------------------------------------------------------------------------- */

function defaultIssuerMatches(issuer: CapabilityPartyRef, event: SignedEventEnvelope): boolean {
  // Bare-id equality: `record.issuer.id === event.author`. The party
  // `kind` and the optional `digest`/`publicKeyRef` pins are NOT
  // matched here — the signature itself binds the public key, and
  // `kind` is metadata about the registry record, not the on-wire
  // event. Callers needing stricter matching can supply their own
  // strategy.
  return typeof event.author === 'string' && event.author === issuer.id;
}

function stripDigestPrefix(digest: string): string {
  // `assertDigest` in `@lfp2p/capabilities` accepts
  // `(sha-256|sha-512|blake3):<base64url>`. We compare the
  // body. The caller is responsible for matching algorithm — this
  // helper assumes sha-256 (the algorithm `sha256Base64Url` uses).
  const idx = digest.indexOf(':');
  return idx === -1 ? digest : digest.slice(idx + 1);
}
