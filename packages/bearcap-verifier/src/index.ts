/**
 * `@lfp2p/bearcap-verifier` — bearer-capability scheme verifier for
 * the capability proof registry.
 *
 * Plugs into the registry's `CapabilityProofVerifier` slot
 * (`@lfp2p/capabilities/proof-registry.ts`) and verifies proofs whose
 * `scheme === 'bearcap'`. For every other scheme the verifier
 * abstains (`undefined`), so it composes cleanly with sibling
 * verifiers via `composeVerifiers` from
 * `@lfp2p/native-proof-verifier`.
 *
 * # What "verifying" a bearer token actually means
 *
 * Bearer capabilities (bearcaps) — share URLs, API keys, magic-link
 * tokens, Macaroons, OAuth-style bearer tokens — are
 * **possession-as-authorization**. There is no signature binding
 * the token to an identity; whoever holds the bytes can use them.
 * Consequently, no verifier can ever return `'verified'` for a
 * bearcap honestly: cryptographic authority verification is
 * categorically not available for this scheme.
 *
 * What IS available is **digest-match possession proof**: given
 * the registry record's `digest` (`'sha-256:…'`), the caller
 * presents the bearcap bytes; we compute `sha-256` of those
 * bytes, re-encode in the registry's digest format, and compare.
 * A match means the bytes the caller has are exactly the bytes
 * that were registered — the token hasn't been swapped, the
 * registry's `digest` field is internally consistent with the
 * material it points at, and an attacker who only knows
 * `record.digest` (a deliberately one-way summary) cannot
 * generate matching bytes.
 *
 * The verifier returns `'possession-confirmed'` for a digest
 * match — a verdict tier strictly weaker than `'verified'`. The
 * reliance gate's `proofsState !== 'verified'` check treats it as
 * fail-closed for AUTHORITY decisions; the distinction lives in
 * the registry's audit state so consumers can tell "we checked
 * the only thing this scheme admits and it matched" from "we
 * never checked." See
 * `packages/capabilities/src/proof-registry.ts` for the verdict
 * tier doctrine.
 *
 * # Honest v1 scope
 *
 *   - **Digest format: `sha-256:<base64url>` only.** The registry's
 *     `assertDigest` admits `sha-256`, `sha-512`, and `blake3`
 *     prefixes, but this verifier produces SHA-256 internally and
 *     compares against an exact `sha-256:` digest. A `sha-512`
 *     or `blake3` digest on the registry record resolves to
 *     `'invalid'` — we don't pretend to verify a hash we didn't
 *     compute. (Future expansion would add the corresponding hash
 *     primitives.)
 *   - **No structural validation of the token itself.** Bearcaps
 *     have no required format — they're opaque bytes / opaque
 *     URLs. We only check digest match.
 *   - **No transport-secrecy assertion.** The verifier cannot
 *     speak to whether the bearcap was disclosed over a secure
 *     channel. That responsibility belongs to the layer that
 *     produced the proof (and to the reliance gate's
 *     `BEARCAP_FORBIDDEN_ACTION_PREFIXES` list, which already
 *     denies bearcap-backed proofs for high-privilege actions).
 *
 * # Why `'possession-confirmed'` and not `'verified'`
 *
 * If bearcap returned `'verified'`, the reliance gate's worst-case
 * fold would treat a leaked bearer token equivalently to a
 * cryptographically signed capability. Two parties holding the
 * same leaked token would both produce `'verified'` despite no
 * cryptographic guarantee that either is the legitimate holder.
 * That collapses the registry's strongest invariant — that
 * `'verified'` means cryptographic identity binding — and is
 * exactly the silent-trust-laundering this design exists to
 * prevent.
 */
import type { CapabilityProofRecord } from '@lfp2p/capabilities';
import { sha256, toBase64Url } from '@lfp2p/crypto';

export type CapabilityProofCryptoVerdict = 'verified' | 'possession-confirmed' | 'invalid';
export type CapabilityProofVerifier = (
  record: CapabilityProofRecord
) => CapabilityProofCryptoVerdict | undefined;

/**
 * Resolve a registered bearcap's raw bytes by `proofId`. Returns
 * the bearer token bytes when the caller holds them; `undefined`
 * otherwise. The verifier treats `undefined` as `'invalid'` for
 * `scheme === 'bearcap'` — once the registry has accepted the
 * scheme, "no bytes" must not silently downgrade to "unverified".
 */
export type BearcapBytesResolver = (proofId: string) => Uint8Array | undefined;

export type CreateBearcapVerifierOptions = Readonly<{
  resolveBearcap: BearcapBytesResolver;
}>;

const SHA256_PREFIX = 'sha-256:';

export function createBearcapVerifier(
  options: CreateBearcapVerifierOptions
): CapabilityProofVerifier {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('createBearcapVerifier: options must be an object');
  }
  if (typeof options.resolveBearcap !== 'function') {
    throw new TypeError('createBearcapVerifier: resolveBearcap must be a function');
  }

  return function verifyBearcap(record) {
    if (record === null || typeof record !== 'object') return undefined;
    if (record.scheme !== 'bearcap') return undefined;

    // Once we've accepted the scheme, own the verdict.
    if (
      typeof record.proofId !== 'string' ||
      record.proofId.length === 0 ||
      typeof record.digest !== 'string' ||
      record.digest.length === 0
    ) {
      return 'invalid';
    }

    // Honest scope: SHA-256 only. The registry's assertDigest
    // admits sha-512 / blake3 too, but the v1 verifier won't
    // pretend to verify a hash it didn't compute.
    if (!record.digest.startsWith(SHA256_PREFIX)) {
      return 'invalid';
    }
    const expectedDigest = record.digest.slice(SHA256_PREFIX.length);
    if (expectedDigest.length === 0) return 'invalid';

    let bytes: Uint8Array | undefined;
    try {
      bytes = options.resolveBearcap(record.proofId);
    } catch {
      return 'invalid';
    }
    if (bytes === undefined) return 'invalid';
    // Defense-in-depth: a non-Uint8Array slipping past TS via `as`
    // cast must not let sha256() throw past this boundary.
    if (!(bytes instanceof Uint8Array)) return 'invalid';
    if (bytes.byteLength === 0) return 'invalid';

    let actualDigest: string;
    try {
      actualDigest = toBase64Url(sha256(bytes));
    } catch {
      return 'invalid';
    }

    if (!constantTimeEqual(actualDigest, expectedDigest)) return 'invalid';

    return 'possession-confirmed';
  };
}

/**
 * Constant-time string comparison. Prevents a timing oracle where a
 * caller could probe `record.digest` byte-by-byte by submitting
 * candidate tokens and measuring how long the comparison takes.
 *
 * Length is NOT secret here: the actual digest computed by this
 * verifier is always 43 chars (base64url of a 32-byte SHA-256), and
 * `record.digest`'s payload length is a property of the registry
 * record itself (visible to anyone with read access). An early
 * length-mismatch exit is therefore safe and lets the body loop
 * remain branchless XOR accumulation, which JITs reliably to
 * straight-line code. Caught by gemini review on PR #89.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
