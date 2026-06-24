/**
 * `@lfp2p/zcap-ld-verifier` — Authorization Capabilities for Linked
 * Data (zcap-ld) scheme verifier for the capability proof registry.
 *
 * Plugs into the registry's `CapabilityProofVerifier` slot
 * (`@lfp2p/capabilities/proof-registry.ts`) and verifies proofs whose
 * `scheme === 'zcap-ld'`. For every other scheme the verifier
 * abstains (`undefined`), so it composes cleanly with sibling
 * verifiers via `composeVerifiers` from
 * `@lfp2p/native-proof-verifier`.
 *
 * Honest v1 scope:
 *
 *   - **DataIntegrityProof + `eddsa-jcs-2022` only.** The verifier
 *     deliberately rejects every zcap-ld variant whose proof relies
 *     on URDNA2015 JSON-LD canonicalization
 *     (`Ed25519Signature2020`, `eddsa-rdfc-2022`,
 *     `ecdsa-rdfc-2019`, etc.) because shipping a URDNA2015 + JSON-LD
 *     context resolver inside a synchronous verifier slot is
 *     architecturally incompatible (URDNA2015 requires async
 *     context resolution and would need either an offline-cached
 *     context set or a sync-only restricted canonicalizer). Picking
 *     `eddsa-jcs-2022` lets us reuse the JCS (RFC 8785) primitive
 *     already shipped in `@lfp2p/crypto` for `@lfp2p/vc-verifier`.
 *
 *     Any other `proof.type` or `proof.cryptosuite` resolves to
 *     `'invalid'`, NEVER abstain — once the registry has accepted
 *     `scheme === 'zcap-ld'` the verifier owns the verdict.
 *
 *   - **`did:key` controllers and verification methods only.** Other
 *     DID methods (`did:web`, `did:ion`, …) resolve to `'invalid'`.
 *
 *   - **Inline `parentCapability` chain only.** Each zcap in the
 *     chain MUST inline its parent as a full object on
 *     `parentCapability` (recursive). String references to capability
 *     IDs are out of scope for v1 (they would require a second
 *     resolver injection and an async lookup pattern). A
 *     `parentCapability` that is a string → `'invalid'`.
 *
 *   - **Single proof per zcap.** Multi-proof zcaps (proof arrays
 *     with multiple entries) resolve to `'invalid'`.
 *
 *   - **`proofPurpose === 'capabilityDelegation'`.** Invocation
 *     proofs (`capabilityInvocation`) are a different surface —
 *     they sign over the action being invoked, not the
 *     delegation itself. The proof registry stores delegations
 *     (grants), so invocation proofs resolve to `'invalid'`.
 *
 *   - **Bounded chain depth.** Default 16 levels of
 *     `parentCapability`; overridable per verifier instance. A
 *     chain that exceeds the bound resolves to `'invalid'`.
 *
 * Returning `'verified'` means:
 *
 *   1. The resolved zcap parses as plain JSON.
 *   2. Its `@context` array contains
 *      `'https://w3id.org/zcap/v1'`.
 *   3. `id`, `controller`, `invocationTarget` are non-empty strings.
 *   4. `proof` is a single DataIntegrityProof with
 *      `cryptosuite === 'eddsa-jcs-2022'`,
 *      `proofPurpose === 'capabilityDelegation'`,
 *      a `did:key` `verificationMethod`, and a multibase
 *      `z<base58btc>` 64-byte Ed25519 `proofValue`.
 *   5. The leaf zcap's `controller` matches `record.subject.id`.
 *   6. The root zcap's `controller` matches `record.issuer.id`
 *      (the original authority).
 *   7. `expires` (if present on any link) is strictly in the future.
 *   8. For every parent/child link in the chain:
 *      - the child's signing key (proof.verificationMethod base DID)
 *        equals the PARENT's `controller` (the delegator),
 *      - `child.invocationTarget` equals OR is a prefix-subset of
 *        `parent.invocationTarget` (URL-prefix attenuation),
 *      - `child.allowedAction` is a subset of
 *        `parent.allowedAction` (string-set subset; `'*'` =
 *        all-actions; absent = inherit),
 *      - `child.expires` (if present) is ≤ `parent.expires` (if
 *        present),
 *      - the parent zcap's own proof also verifies (recursive).
 *   9. At the root (no `parentCapability`), the proof's
 *      verification method base DID equals the root's `controller`
 *      (self-signed root grant — trust comes from the registry
 *      record's `issuer.id` pin in step 6, not from the zcap itself).
 *
 * The verifier is synchronous, pure on its inputs, and performs NO
 * network IO.
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
 * Resolve a registered zcap-ld delegation by `proofId`. Returns the
 * zcap as a plain JSON value (the LEAF delegation, with its full
 * `parentCapability` chain inlined) when the caller holds it;
 * `undefined` otherwise.
 */
export type ZcapLdResolver = (proofId: string) => unknown | undefined;

export const DEFAULT_MAX_CHAIN_DEPTH = 16 as const;

export type CreateZcapLdVerifierOptions = Readonly<{
  resolveCapability: ZcapLdResolver;
  /** Defaults to `DEFAULT_MAX_CHAIN_DEPTH`. */
  maxChainDepth?: number;
  /**
   * Override the time source. Defaults to `Date.now()`. Used only
   * for embedded `expires` fields; the proof registry has its own
   * deterministic `revokedAt`/`expiresAt` gate.
   */
  now?: () => number;
}>;

const ZCAP_V1_CONTEXT = 'https://w3id.org/zcap/v1';

export function createZcapLdVerifier(
  options: CreateZcapLdVerifierOptions
): CapabilityProofVerifier {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('createZcapLdVerifier: options must be an object');
  }
  if (typeof options.resolveCapability !== 'function') {
    throw new TypeError('createZcapLdVerifier: resolveCapability must be a function');
  }
  if (
    options.maxChainDepth !== undefined &&
    (!Number.isInteger(options.maxChainDepth) || options.maxChainDepth < 0)
  ) {
    throw new TypeError(
      'createZcapLdVerifier: maxChainDepth must be a non-negative integer'
    );
  }
  if (options.now !== undefined && typeof options.now !== 'function') {
    throw new TypeError('createZcapLdVerifier: now must be a function');
  }

  const maxChainDepth = options.maxChainDepth ?? DEFAULT_MAX_CHAIN_DEPTH;
  const clock = options.now ?? (() => Date.now());

  return function verifyZcap(record) {
    if (record === null || typeof record !== 'object') return undefined;
    if (record.scheme !== 'zcap-ld') return undefined;

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
      raw = options.resolveCapability(record.proofId);
    } catch {
      return 'invalid';
    }
    if (raw === undefined) return 'invalid';

    let zcap: unknown;
    try {
      zcap = JSON.parse(JSON.stringify(raw));
    } catch {
      return 'invalid';
    }
    if (zcap === undefined) return 'invalid';

    const nowMs = clock();
    return verifyZcapChain(zcap, {
      expectedLeafController: record.subject.id,
      expectedRootController: record.issuer.id,
      depthRemaining: maxChainDepth,
      nowMs,
      // Constraints inherited from the descendant we recursed from.
      // For the leaf call these are undefined (no descendant yet).
      childTarget: undefined,
      childAllowedActions: undefined,
      childExpiresMs: undefined,
      childVerificationMethodBase: undefined
    });
  };
}

/* -------------------------------------------------------------------------- */
/*                             chain walker                                   */
/* -------------------------------------------------------------------------- */

type ChainContext = Readonly<{
  /** record.subject.id — leaf's controller MUST match. */
  expectedLeafController: string;
  /** record.issuer.id — root's controller MUST match. */
  expectedRootController: string;
  depthRemaining: number;
  nowMs: number;
  /**
   * When recursing INTO `parentCapability` we carry the CHILD's
   * constraints so we can check parent attenuation invariants
   * (parent's invocationTarget covers child's; parent's
   * allowedAction covers child's; parent's expires ≥ child's;
   * parent's controller equals child's verificationMethod base).
   * Undefined for the leaf (no descendant constraints).
   */
  childTarget: string | undefined;
  childAllowedActions: ReadonlySet<string> | undefined;
  childExpiresMs: number | undefined;
  childVerificationMethodBase: string | undefined;
}>;

function verifyZcapChain(
  zcap: unknown,
  ctx: ChainContext
): CapabilityProofCryptoVerdict {
  if (ctx.depthRemaining < 0) return 'invalid';
  if (zcap === null || typeof zcap !== 'object' || Array.isArray(zcap)) {
    return 'invalid';
  }
  const z = zcap as Record<string, unknown>;

  // @context MUST include the zcap v1 context.
  if (!containsZcapContext(z['@context'])) return 'invalid';

  // Required fields.
  if (typeof z.id !== 'string' || z.id.length === 0) return 'invalid';
  if (typeof z.controller !== 'string' || z.controller.length === 0) return 'invalid';
  if (typeof z.invocationTarget !== 'string' || z.invocationTarget.length === 0) {
    return 'invalid';
  }

  // expires (optional) — parse + future-bound.
  let myExpiresMs: number | undefined;
  if (z.expires !== undefined) {
    if (typeof z.expires !== 'string') return 'invalid';
    const ms = Date.parse(z.expires);
    if (!Number.isFinite(ms)) return 'invalid';
    if (ctx.nowMs >= ms) return 'invalid';
    myExpiresMs = ms;
  }

  // allowedAction (optional) — coerce to set.
  const myActions = parseAllowedAction(z.allowedAction);
  if (myActions === 'invalid') return 'invalid';

  // proof (single object only).
  const proof = extractSingleProof(z.proof);
  if (proof === undefined) return 'invalid';

  if (proof.type !== 'DataIntegrityProof') return 'invalid';
  if (proof.cryptosuite !== 'eddsa-jcs-2022') return 'invalid';
  if (proof.proofPurpose !== 'capabilityDelegation') return 'invalid';
  if (typeof proof.proofValue !== 'string' || proof.proofValue.length === 0) {
    return 'invalid';
  }
  if (
    typeof proof.verificationMethod !== 'string' ||
    proof.verificationMethod.length === 0
  ) {
    return 'invalid';
  }

  const vmBase = stripFragment(proof.verificationMethod);
  const publicKey = didKeyToEd25519PublicKey(vmBase);
  if (publicKey === undefined) return 'invalid';

  // Decode multibase z<base58btc> 64-byte signature.
  const signature = decodeProofValueMultibase(proof.proofValue);
  if (signature === undefined) return 'invalid';
  if (signature.byteLength !== 64) return 'invalid';

  // Cryptographic signature check first (cheapest fail-closed signal
  // once we've decoded everything).
  let proofOptionsBytes: Uint8Array;
  let unsecuredDocBytes: Uint8Array;
  try {
    const proofWithoutProofValue = stripField(proof, 'proofValue');
    const zcapWithoutProof = stripField(z, 'proof');
    proofOptionsBytes = new TextEncoder().encode(canonicalizeJcs(proofWithoutProofValue));
    unsecuredDocBytes = new TextEncoder().encode(canonicalizeJcs(zcapWithoutProof));
  } catch {
    return 'invalid';
  }
  const proofConfigHash = sha256(proofOptionsBytes);
  const docHash = sha256(unsecuredDocBytes);
  const hashData = new Uint8Array(proofConfigHash.byteLength + docHash.byteLength);
  hashData.set(proofConfigHash, 0);
  hashData.set(docHash, proofConfigHash.byteLength);
  if (!verifyEd25519(hashData, signature, publicKey)) return 'invalid';

  // Descendant-imposed invariants. We're the PARENT relative to the
  // descendant that recursed into us, so check that we cover them.
  if (ctx.childVerificationMethodBase !== undefined) {
    // The descendant was signed by ME — my controller MUST equal
    // their verification method's base DID.
    if (ctx.childVerificationMethodBase !== z.controller) return 'invalid';
  }
  if (ctx.childTarget !== undefined) {
    if (!coversInvocationTarget(z.invocationTarget, ctx.childTarget)) return 'invalid';
  }
  if (ctx.childAllowedActions !== undefined) {
    if (!actionsCover(myActions, ctx.childAllowedActions)) return 'invalid';
  }
  if (ctx.childExpiresMs !== undefined) {
    if (myExpiresMs !== undefined && ctx.childExpiresMs > myExpiresMs) return 'invalid';
  }

  // Recurse on parentCapability if present.
  const parent = z.parentCapability;
  if (parent === undefined) {
    // We are the ROOT. The root's controller MUST equal the
    // registry record's issuer.id (the original authority pin),
    // and the proof MUST be self-signed by that same controller
    // (root grants are self-asserted; trust comes from the
    // registry's issuer pin, not from the zcap itself).
    if (z.controller !== ctx.expectedRootController) return 'invalid';
    if (vmBase !== z.controller) return 'invalid';
  } else if (typeof parent === 'string') {
    // ID-string-only parents would require a second resolver
    // injection; out of scope for v1.
    return 'invalid';
  } else {
    // Inline parent — recurse.
    //
    // SECURITY: when this link omits `allowedAction` or `expires`,
    // it "inherits" from above — which means the DESCENDANT's
    // constraint must continue propagating up so the parent still
    // sees it. Falling back to undefined here would drop the
    // descendant's claim at the first intermediate that inherits,
    // letting a grandchild expand actions or expiry beyond what
    // the root ever granted. Caught by gemini review on PR #87.
    const parentVerdict = verifyZcapChain(parent, {
      expectedLeafController: ctx.expectedLeafController,
      expectedRootController: ctx.expectedRootController,
      depthRemaining: ctx.depthRemaining - 1,
      nowMs: ctx.nowMs,
      childTarget: z.invocationTarget,
      childAllowedActions: myActions ?? ctx.childAllowedActions,
      childExpiresMs: myExpiresMs ?? ctx.childExpiresMs,
      childVerificationMethodBase: vmBase
    });
    if (parentVerdict !== 'verified') return 'invalid';
  }

  // Leaf identity pin — only at the topmost call (no descendant
  // recursed into us).
  if (ctx.childVerificationMethodBase === undefined) {
    if (z.controller !== ctx.expectedLeafController) return 'invalid';
  }

  return 'verified';
}

/* -------------------------------------------------------------------------- */
/*                              field helpers                                 */
/* -------------------------------------------------------------------------- */

function containsZcapContext(ctx: unknown): boolean {
  if (typeof ctx === 'string') return ctx === ZCAP_V1_CONTEXT;
  if (Array.isArray(ctx)) {
    for (const entry of ctx) {
      if (entry === ZCAP_V1_CONTEXT) return true;
    }
  }
  return false;
}

/**
 * Parse `allowedAction` into a frozen set of action strings.
 *
 * Returns:
 *   - `undefined`     — field absent (parent's actions inherited)
 *   - `Set<string>`   — finite action set (may include the literal
 *                       `'*'` token meaning "all actions")
 *   - `'invalid'`     — field present but malformed
 */
function parseAllowedAction(
  value: unknown
): ReadonlySet<string> | undefined | 'invalid' {
  if (value === undefined) return undefined;
  if (typeof value === 'string') {
    if (value.length === 0) return 'invalid';
    return new Set([value]);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return 'invalid';
    const out = new Set<string>();
    for (const entry of value) {
      if (typeof entry !== 'string' || entry.length === 0) return 'invalid';
      out.add(entry);
    }
    return out;
  }
  return 'invalid';
}

/**
 * Parent covers child's allowedAction iff every action the child
 * claims is also granted by the parent. The literal `'*'` on the
 * parent side covers any child action. An undefined child set
 * (inherit) is always covered.
 */
function actionsCover(
  parent: ReadonlySet<string> | undefined | 'invalid',
  child: ReadonlySet<string> | undefined
): boolean {
  if (parent === 'invalid') return false;
  if (child === undefined) return true;
  // Absent parent means parent inherits, which (at the root) means
  // "all" by zcap-ld convention. We treat undefined parent as
  // permissive here; the root's own actions are bounded only by
  // the registry record's reliance gate, not by the chain.
  if (parent === undefined) return true;
  if (parent.has('*')) return true;
  for (const action of child) {
    if (action === '*') return false; // child cannot expand to *
    if (!parent.has(action)) return false;
  }
  return true;
}

/**
 * Parent covers child's invocationTarget iff the parent's URI is a
 * prefix of the child's. We use exact match OR strict slash-bounded
 * prefix to avoid the `https://example.com/foo` vs
 * `https://example.com/foobar` ambiguity (a child can specialize to
 * a sub-path but not jump to a sibling resource). Full URI semantics
 * (host case-folding, query normalization, path canonicalization)
 * are out of scope for v1 — this is intentionally conservative
 * (fail-closed) rather than permissive.
 */
function coversInvocationTarget(parent: string, child: string): boolean {
  if (parent === child) return true;
  if (!child.startsWith(parent)) return false;
  // Boundary char: must be '/' or end-of-string at parent boundary so
  // 'https://x/foo' does not cover 'https://x/foobar'.
  const boundary = child.charAt(parent.length);
  if (boundary === '/') return true;
  if (parent.endsWith('/')) return true;
  return false;
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

function decodeProofValueMultibase(value: string): Uint8Array | undefined {
  if (value.length < 2) return undefined;
  if (value[0] !== 'z') return undefined;
  return decodeBase58Btc(value.slice(1));
}
