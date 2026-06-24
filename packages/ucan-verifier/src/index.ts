/**
 * `@lfp2p/ucan-verifier` — UCAN scheme verifier for the capability
 * proof registry.
 *
 * Plugs into the registry's `CapabilityProofVerifier` slot
 * (`@lfp2p/capabilities/proof-registry.ts`) and verifies proofs whose
 * `scheme === 'ucan'`. For every other scheme the verifier abstains
 * (`undefined`), so it composes cleanly with sibling verifiers via
 * `composeVerifiers` from `@lfp2p/native-proof-verifier`.
 *
 * Honest v1 scope (documented in the public surface):
 *
 *   - **Ed25519 signatures only.** Tokens whose `header.alg` is
 *     anything other than `'EdDSA'` resolve to `'invalid'`. The
 *     verifier never falls through to "abstain on unknown algorithm"
 *     because the scheme has already been claimed.
 *   - **`did:key` issuers only.** Tokens whose `iss` is a DID method
 *     other than `did:key` resolve to `'invalid'`. Multibase /
 *     multicodec parsing supports only the Ed25519 codec prefix
 *     (`0xed01`). Other DID methods (`did:web`, `did:ion`, …) are
 *     out of scope for v1.
 *   - **Inline JWT proofs only.** Each token's `prf` array MUST
 *     contain bare JWT strings, not CIDs / IPFS refs. A `prf` entry
 *     that does not look like a JWT resolves the WHOLE chain to
 *     `'invalid'` — we never silently skip evidence we cannot
 *     evaluate.
 *   - **Bounded chain depth.** The verifier walks at most
 *     `DEFAULT_MAX_CHAIN_DEPTH` (16) levels of `prf` chain before
 *     bailing with `'invalid'`. The default is overridable per
 *     verifier instance.
 *   - **No CBOR / UCAN 0.10+.** The decoder supports the JWT-shape
 *     UCAN only (`header.payload.signature`, base64url segments).
 *
 * The verifier is synchronous (matches the registry's
 * `CapabilityProofVerifier` shape), pure on its inputs, and performs
 * NO network IO. The caller injects `resolveUcanToken(proofId)` so
 * the verifier can stay agnostic about storage. A resolver that
 * cannot produce the bytes returns `undefined`, which the verifier
 * surfaces as `'invalid'` — the scheme is claimed, we have nothing
 * to verify against. (Contrast with `native-proof-verifier`, which
 * abstains in that case because the native scheme is by-design
 * caller-resolved; UCAN tokens, once registered in the proof
 * registry, are evidence the caller asserted exists.)
 *
 * Returning `'verified'` means:
 *
 *   1. The token decoded as a JWT with `header.alg === 'EdDSA'`.
 *   2. The signature over `header.payload` verifies against the
 *      Ed25519 public key embedded in `payload.iss` (`did:key:z…`).
 *   3. `payload.iss` matches `record.issuer.id` exactly (verifier
 *      enforced — a token bound to a different issuer is
 *      `'invalid'`).
 *   4. `payload.nbf` (if present) is in the past relative to `now`,
 *      and `payload.exp` (if present) is in the future.
 *   5. Each `prf` ancestor token also verifies, and the chain
 *      satisfies attenuation:
 *         - child.iss === parent.aud (delegation linkage)
 *         - child.exp ≤ parent.exp (no expiry expansion)
 *         - child.att ⊆ parent.att (no capability expansion)
 *     for every link.
 */
import type {
  CapabilityProofRecord
} from '@lfp2p/capabilities';
import { didKeyToEd25519PublicKey, verifyEd25519 } from '@lfp2p/crypto';

export type CapabilityProofCryptoVerdict = 'verified' | 'invalid';
export type CapabilityProofVerifier = (
  record: CapabilityProofRecord
) => CapabilityProofCryptoVerdict | undefined;

/**
 * Resolve a registered UCAN proof's JWT bytes by `proofId`. Returns
 * the bare JWT string (`header.payload.signature` in base64url) when
 * the caller holds the token; `undefined` otherwise. The verifier
 * treats `undefined` as `'invalid'` for `scheme === 'ucan'` — see
 * the module-level comment for the rationale.
 */
export type UcanTokenResolver = (proofId: string) => string | undefined;

/** Default chain-depth bound. Sized for typical UCAN delegations. */
export const DEFAULT_MAX_CHAIN_DEPTH = 16 as const;

export type CreateUcanVerifierOptions = Readonly<{
  resolveUcanToken: UcanTokenResolver;
  /** Defaults to `DEFAULT_MAX_CHAIN_DEPTH`. */
  maxChainDepth?: number;
  /**
   * Override the time source. Defaults to `Date.now()`. The proof
   * registry has its own deterministic expiry/revocation gate; this
   * clock is only consulted for the token's own `nbf`/`exp`.
   */
  now?: () => number;
}>;

export function createUcanVerifier(
  options: CreateUcanVerifierOptions
): CapabilityProofVerifier {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('createUcanVerifier: options must be an object');
  }
  if (typeof options.resolveUcanToken !== 'function') {
    throw new TypeError('createUcanVerifier: resolveUcanToken must be a function');
  }
  if (
    options.maxChainDepth !== undefined &&
    (!Number.isInteger(options.maxChainDepth) || options.maxChainDepth < 0)
  ) {
    throw new TypeError('createUcanVerifier: maxChainDepth must be a non-negative integer');
  }
  if (options.now !== undefined && typeof options.now !== 'function') {
    throw new TypeError('createUcanVerifier: now must be a function');
  }

  const maxChainDepth = options.maxChainDepth ?? DEFAULT_MAX_CHAIN_DEPTH;
  const clock = options.now ?? (() => Date.now());

  return function verifyUcan(record) {
    if (record === null || typeof record !== 'object') return undefined;
    if (record.scheme !== 'ucan') return undefined;
    // Once we've accepted the scheme we own the verdict — be strict
    // about the record shape so a malformed entry surfaces as
    // 'invalid' rather than abstaining (which would resolve to
    // 'unverified' downstream).
    if (
      typeof record.proofId !== 'string' ||
      record.proofId.length === 0 ||
      record.issuer === null ||
      typeof record.issuer !== 'object' ||
      typeof record.issuer.id !== 'string' ||
      record.issuer.id.length === 0
    ) {
      return 'invalid';
    }

    let token: string | undefined;
    try {
      token = options.resolveUcanToken(record.proofId);
    } catch {
      // A throwing resolver is a caller bug. We've accepted the
      // scheme — we cannot honestly say 'verified', so fail closed.
      return 'invalid';
    }
    if (typeof token !== 'string' || token.length === 0) return 'invalid';

    const nowSec = Math.floor(clock() / 1000);

    return verifyChain(token, {
      expectedLeafIssuer: record.issuer.id,
      nowSec,
      depthRemaining: maxChainDepth,
      // The leaf (outermost token) is exact-issuer-pinned against
      // the registry record; ancestors are checked via the
      // child.iss === parent.aud linkage rule.
      enforceLeafIssuer: true,
      childPayload: undefined
    });
  };
}

/* -------------------------------------------------------------------------- */
/*                            chain verification                              */
/* -------------------------------------------------------------------------- */

/**
 * Recursion shape. Each call verifies one UCAN token (`token`). The
 * `childPayload` field, if present, names the DESCENDANT this token
 * delegated authority to (i.e., the entry whose `prf` array contains
 * this token). When `childPayload === undefined`, this token IS the
 * leaf — the one whose claim the registry record asserts.
 *
 * For each prf entry of the current token we recurse: that prf
 * entry is THIS token's PARENT (delegated to us), so on the
 * recursive call we pass `childPayload = currentPayload`.
 */
type ChainContext = Readonly<{
  expectedLeafIssuer: string | undefined;
  nowSec: number;
  depthRemaining: number;
  enforceLeafIssuer: boolean;
  childPayload: UcanPayload | undefined;
}>;

function verifyChain(
  token: string,
  ctx: ChainContext
): CapabilityProofCryptoVerdict {
  if (ctx.depthRemaining < 0) return 'invalid';

  const parsed = parseUcanToken(token);
  if (parsed === undefined) return 'invalid';
  const { header, payload, signingInput, signature } = parsed;

  if (header.alg !== 'EdDSA') return 'invalid';

  // Signature: verify with the issuer's did:key public key.
  const publicKey = didKeyToEd25519PublicKey(payload.iss);
  if (publicKey === undefined) return 'invalid';
  const signingBytes = new TextEncoder().encode(signingInput);
  if (!verifyEd25519(signingBytes, signature, publicKey)) return 'invalid';

  // Time bounds (the registry's deterministic gates run separately;
  // these guard the token's own embedded nbf/exp).
  if (payload.nbf !== undefined && ctx.nowSec < payload.nbf) return 'invalid';
  if (payload.exp !== undefined && ctx.nowSec >= payload.exp) return 'invalid';

  // Exact-issuer pin: only applies to the leaf (the token whose
  // proofId is the registry record's). Ancestors are checked via
  // the linkage rule below.
  if (
    ctx.enforceLeafIssuer &&
    ctx.expectedLeafIssuer !== undefined &&
    payload.iss !== ctx.expectedLeafIssuer
  ) {
    return 'invalid';
  }

  // If we have a child (we're an ancestor of someone), check the
  // delegation invariants between THIS token (the parent) and the
  // child:
  //
  //   - linkage: child.iss === parent.aud (parent delegated TO child)
  //   - expiry monotonic: child.exp <= parent.exp (child cannot
  //     outlive parent)
  //   - attenuation: child.att ⊆ parent.att (child cannot expand
  //     beyond parent's grant)
  if (ctx.childPayload !== undefined) {
    if (ctx.childPayload.iss !== payload.aud) return 'invalid';
    if (
      payload.exp !== undefined &&
      ctx.childPayload.exp !== undefined &&
      ctx.childPayload.exp > payload.exp
    ) {
      return 'invalid';
    }
    if (!isAttenuationSubset(payload.att, ctx.childPayload.att)) return 'invalid';
  }

  // Recurse into prf chain — each prf entry is THIS token's PARENT.
  // Per the doctrine, EVERY entry must verify (no silent skips).
  if (payload.prf.length > 0 && ctx.depthRemaining === 0) {
    return 'invalid';
  }
  for (const prfToken of payload.prf) {
    const parentResult = verifyChain(prfToken, {
      expectedLeafIssuer: undefined,
      nowSec: ctx.nowSec,
      depthRemaining: ctx.depthRemaining - 1,
      enforceLeafIssuer: false,
      childPayload: payload
    });
    if (parentResult !== 'verified') return 'invalid';
  }

  return 'verified';
}

/* -------------------------------------------------------------------------- */
/*                            JWT-shape UCAN decode                           */
/* -------------------------------------------------------------------------- */

type UcanHeader = Readonly<{ alg: string; typ?: string; ucv?: string }>;
type UcanCapability = Readonly<{ with: string; can: string }>;
type UcanPayload = Readonly<{
  iss: string;
  aud: string;
  nbf?: number;
  exp?: number;
  att: readonly UcanCapability[];
  prf: readonly string[];
}>;

type ParsedUcan = Readonly<{
  header: UcanHeader;
  payload: UcanPayload;
  signingInput: string;
  signature: Uint8Array;
}>;

function parseUcanToken(token: string): ParsedUcan | undefined {
  if (typeof token !== 'string') return undefined;
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  const [headerB64, payloadB64, signatureB64] = parts;
  if (
    headerB64 === undefined ||
    payloadB64 === undefined ||
    signatureB64 === undefined ||
    headerB64.length === 0 ||
    payloadB64.length === 0 ||
    signatureB64.length === 0
  ) {
    return undefined;
  }
  const header = decodeJsonSegment<UcanHeader>(headerB64, isUcanHeader);
  if (header === undefined) return undefined;
  const payload = decodeJsonSegment<UcanPayload>(payloadB64, isUcanPayload);
  if (payload === undefined) return undefined;
  const signature = decodeBase64UrlBytes(signatureB64);
  if (signature === undefined) return undefined;
  // Signing input is the exact `header.payload` substring of the
  // token — we must preserve the on-wire base64url, NOT
  // re-serialize.
  return {
    header,
    payload,
    signingInput: `${headerB64}.${payloadB64}`,
    signature
  };
}

function isUcanHeader(value: unknown): value is UcanHeader {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  if (typeof r.alg !== 'string') return false;
  if (r.typ !== undefined && typeof r.typ !== 'string') return false;
  if (r.ucv !== undefined && typeof r.ucv !== 'string') return false;
  return true;
}

function isUcanPayload(value: unknown): value is UcanPayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  if (typeof r.iss !== 'string' || r.iss.length === 0) return false;
  if (typeof r.aud !== 'string' || r.aud.length === 0) return false;
  if (r.nbf !== undefined && !Number.isFinite(r.nbf)) return false;
  if (r.exp !== undefined && !Number.isFinite(r.exp)) return false;
  if (r.nbf !== undefined && r.exp !== undefined && (r.nbf as number) > (r.exp as number)) {
    return false;
  }
  if (!Array.isArray(r.att)) return false;
  for (const cap of r.att) {
    if (cap === null || typeof cap !== 'object' || Array.isArray(cap)) return false;
    const capRecord = cap as Record<string, unknown>;
    if (typeof capRecord.with !== 'string' || capRecord.with.length === 0) return false;
    if (typeof capRecord.can !== 'string' || capRecord.can.length === 0) return false;
  }
  if (!Array.isArray(r.prf)) return false;
  for (const p of r.prf) {
    if (typeof p !== 'string' || p.length === 0) return false;
  }
  return true;
}

function decodeJsonSegment<T>(
  segment: string,
  guard: (value: unknown) => value is T
): T | undefined {
  const bytes = decodeBase64UrlBytes(segment);
  if (bytes === undefined) return undefined;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  return guard(json) ? json : undefined;
}

/* -------------------------------------------------------------------------- */
/*                          attenuation comparison                            */
/* -------------------------------------------------------------------------- */

function isAttenuationSubset(
  parent: readonly UcanCapability[],
  child: readonly UcanCapability[]
): boolean {
  for (const c of child) {
    let matched = false;
    for (const p of parent) {
      if (p.with === c.with && p.can === c.can) {
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/*                                base64url                                   */
/* -------------------------------------------------------------------------- */

function decodeBase64UrlBytes(input: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) return undefined;
  let standard = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = standard.length % 4;
  if (pad === 2) standard += '==';
  else if (pad === 3) standard += '=';
  else if (pad !== 0) return undefined;
  let binary: string;
  try {
    binary = atob(standard);
  } catch {
    return undefined;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
