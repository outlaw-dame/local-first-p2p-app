/**
 * VC authority binding — link a Verifiable Credential (recorded in
 * the proof registry as `scheme: 'vc'`) to a capability it supports
 * **as evidence, not as authority**.
 *
 * The structural invariant this module enforces:
 *
 *   A binding is EVIDENCE. It can never confer authority on its own.
 *
 * Today `reliance.ts` already denies any "credential-only authority"
 * via `capability.vc-only-authority-denied`. That gate stays
 * unchanged. The binding adds three things on top:
 *
 *   1. **Audit linkage.** Connects a recorded VC proof to a specific
 *      capability so a future reviewer can ask "which VC was the
 *      claimed evidence for grant X?" without re-deriving it.
 *   2. **Scope-creep prevention.** A VC supports only the
 *      capabilities a binding explicitly names. The same VC cannot be
 *      silently reused as evidence for unrelated capabilities — a
 *      caller wanting to rely on the VC for a different capability
 *      must register a NEW binding, leaving an audit trail.
 *   3. **Live audit posture.** `resolveVcBindings` joins the binding
 *      registry with the proof registry so a caller sees, for a
 *      capability, the current `verificationState` of every VC behind
 *      it (`unverified` / `verified` / `expired` / `revoked` /
 *      `invalid`) — without this module ever performing crypto.
 *
 * Design parallels the proof registry intentionally:
 *
 *   - Pure + immutable: every op returns a NEW frozen registry +
 *     record. Bindings are immutable once registered — to retire one,
 *     revoke the underlying VC proof in the proof registry; the
 *     binding will surface as `revoked` automatically.
 *   - Zero dependencies. No crypto, no VC parsing. The binding only
 *     references a `vcProofId` that the caller has registered in the
 *     proof registry; the registry's state is the source of truth.
 *   - Replay-deterministic per Phase 3.2 — same ops, same output.
 */
import { capabilityError } from './errors.js';
import type {
  CapabilityProofRecord,
  CapabilityProofVerificationState,
  ProofRegistry
} from './proof-registry.js';
import type { CapabilityPartyRef } from './types.js';
import {
  assertDigest,
  assertId,
  assertPlainObject,
  assertTimestamp,
  deepFreeze,
  validatePartyRef
} from './validation.js';

export const VC_AUTHORITY_BINDING_VERSION = 'lfp2p.capability.vc-authority-binding.v1' as const;
export type VcAuthorityBindingVersion = typeof VC_AUTHORITY_BINDING_VERSION;

const MAX_CLAIM_TYPE_LENGTH = 256;

/**
 * A binding records "VC proof X is the claimed evidence for
 * capability Y, asserting claim Z about subject S".
 *
 * Field choices:
 *
 *   - `vcProofId` MUST refer to a `CapabilityProofRecord` whose
 *     `scheme` is `vc` — enforced when `resolveVcBindings` runs (the
 *     binding registry itself stays decoupled from the proof
 *     registry, so the two layers can ship independently).
 *   - `claimType` is a free-form bounded string. VC claim
 *     vocabularies are deliberately heterogeneous across issuers — we
 *     do NOT bind to an enum here. The string is informational; the
 *     no-authority structural rule (and the existing
 *     `vc-only-authority-denied` gate) is what makes it safe.
 *   - `claimDigest` pins the exact claim payload bytes the binding
 *     was created against, so a future swap of the underlying
 *     credential body is detectable.
 */
export type VcAuthorityBindingV1 = Readonly<{
  version: VcAuthorityBindingVersion;
  bindingId: string;
  vcProofId: string;
  capabilityId: string;
  claimSubject: CapabilityPartyRef;
  claimType: string;
  claimDigest: string;
  recordedAt: string;
}>;

export type VcBindingRegistry = Readonly<{
  version: VcAuthorityBindingVersion;
  /** Indexed by `bindingId`. Look up by capability/VC via the helpers. */
  bindings: ReadonlyMap<string, VcAuthorityBindingV1>;
}>;

export type RegisterVcBindingInput = Readonly<{
  bindingId: string;
  vcProofId: string;
  capabilityId: string;
  claimSubject: CapabilityPartyRef;
  claimType: string;
  claimDigest: string;
  recordedAt: string;
}>;

export type VcBindingRegistryResult = Readonly<{
  registry: VcBindingRegistry;
  binding: VcAuthorityBindingV1;
}>;

/**
 * Audit-friendly join of a binding with the live state of its VC
 * proof. `proofState` is `unverified` when the binding references a
 * proof that is not (yet) in the proof registry — fail closed, never
 * silently assume verified.
 */
export type ResolvedVcBinding = Readonly<{
  binding: VcAuthorityBindingV1;
  proofState: CapabilityProofVerificationState;
  /** Present iff the proof exists in the proof registry. */
  proof?: CapabilityProofRecord;
}>;

/* -------------------------------------------------------------------------- */

export function createVcBindingRegistry(): VcBindingRegistry {
  return Object.freeze({
    version: VC_AUTHORITY_BINDING_VERSION,
    bindings: freezeMap(new Map())
  });
}

export function registerVcBinding(
  registry: VcBindingRegistry,
  input: unknown
): VcBindingRegistryResult {
  assertRegistry(registry);
  const binding = validateRegisterVcBindingInput(input);
  if (registry.bindings.has(binding.bindingId)) {
    throw capabilityError('CAP_DUPLICATE_VALUE', `bindingId ${binding.bindingId} is already registered`);
  }
  const next = new Map(registry.bindings);
  next.set(binding.bindingId, binding);
  return Object.freeze({
    registry: Object.freeze({
      version: registry.version,
      bindings: freezeMap(next)
    }),
    binding
  });
}

export function getBinding(
  registry: VcBindingRegistry,
  bindingId: string
): VcAuthorityBindingV1 | undefined {
  assertRegistry(registry);
  return registry.bindings.get(assertId(bindingId, 'bindingId'));
}

export function getBindingsForCapability(
  registry: VcBindingRegistry,
  capabilityId: string
): readonly VcAuthorityBindingV1[] {
  assertRegistry(registry);
  const id = assertId(capabilityId, 'capabilityId');
  return filterFrozenSorted(registry, (b) => b.capabilityId === id);
}

export function getBindingsForVc(
  registry: VcBindingRegistry,
  vcProofId: string
): readonly VcAuthorityBindingV1[] {
  assertRegistry(registry);
  const id = assertId(vcProofId, 'vcProofId');
  return filterFrozenSorted(registry, (b) => b.vcProofId === id);
}

/**
 * Join the binding registry with the proof registry for a given
 * capability. Returns one `ResolvedVcBinding` per binding, each
 * carrying the live `verificationState` of the referenced VC proof.
 *
 * Safety:
 *   - A binding that references a `vcProofId` NOT in the proof
 *     registry surfaces as `proofState: 'unverified'` with `proof`
 *     omitted. Never silently assumed verified.
 *   - A binding whose referenced proof has `scheme !== 'vc'` is
 *     dropped — it is not a VC binding under the v1 contract. We do
 *     not silently re-interpret a non-VC proof as a VC.
 *   - A binding whose referenced proof has a `subject` that differs
 *     from the binding's `claimSubject` is dropped — a verified
 *     credential about one party MUST NOT be reported as verified
 *     evidence about another party (confused-deputy defense).
 */
export function resolveVcBindings(
  bindingsRegistry: VcBindingRegistry,
  proofsRegistry: ProofRegistry,
  capabilityId: string
): readonly ResolvedVcBinding[] {
  assertRegistry(bindingsRegistry);
  // Defense-in-depth: don't just check object-ness — a malformed but
  // non-null object would slip past the previous check and then
  // crash on `proofsRegistry.proofs.get(...)` with an unhandled
  // TypeError. Match proof-registry.ts's own `assertRegistry`
  // discipline and require an actual `Map` at `.proofs`.
  if (
    proofsRegistry === null ||
    typeof proofsRegistry !== 'object' ||
    !(proofsRegistry.proofs instanceof Map)
  ) {
    throw capabilityError('CAP_INVALID_INPUT', 'invalid proofs registry');
  }
  const id = assertId(capabilityId, 'capabilityId');
  const matches = filterFrozenSorted(bindingsRegistry, (b) => b.capabilityId === id);
  const out: ResolvedVcBinding[] = [];
  for (const binding of matches) {
    const proof = proofsRegistry.proofs.get(binding.vcProofId);
    if (proof === undefined) {
      out.push(Object.freeze({ binding, proofState: 'unverified' as CapabilityProofVerificationState }));
      continue;
    }
    if (proof.scheme !== 'vc') {
      // Mismatch — the bound proofId resolves to a non-VC scheme.
      // Drop it; this binding is structurally invalid. We do NOT
      // throw: a single mis-bound entry must not poison the audit
      // surface for the others.
      continue;
    }
    // Subject-mismatch defense (codex review on PR #75). If the proof
    // registry's recorded `subject` for this VC differs from the
    // binding's `claimSubject`, a verified credential about one party
    // would be reported as verified evidence about another party —
    // the confused-deputy hazard the whole binding layer exists to
    // prevent. Drop the entry quietly, same as the scheme mismatch
    // above; a single mis-bound row must not poison the audit
    // surface for the others.
    if (
      proof.subject.kind !== binding.claimSubject.kind ||
      proof.subject.id !== binding.claimSubject.id
    ) {
      continue;
    }
    out.push(Object.freeze({ binding, proofState: proof.verificationState, proof }));
  }
  return Object.freeze(out);
}

/* -------------------------------------------------------------------------- */

/**
 * Validate a fully-formed binding (e.g. read from disk or replayed
 * from an event log) including its `version` sentinel. For
 * registration, use `registerVcBinding`, which accepts a
 * version-less input and stamps the version itself.
 */
export function validateVcAuthorityBinding(value: unknown): VcAuthorityBindingV1 {
  const record = assertPlainObject(value, 'VcAuthorityBindingV1');
  if (record.version !== VC_AUTHORITY_BINDING_VERSION) {
    throw capabilityError(
      'CAP_UNKNOWN_VERSION',
      `VcAuthorityBindingV1.version must be ${VC_AUTHORITY_BINDING_VERSION}`
    );
  }
  return buildBinding(record, 'VcAuthorityBindingV1');
}

function validateRegisterVcBindingInput(value: unknown): VcAuthorityBindingV1 {
  const record = assertPlainObject(value, 'RegisterVcBindingInput');
  return buildBinding(record, 'RegisterVcBindingInput');
}

function buildBinding(record: Record<string, unknown>, label: string): VcAuthorityBindingV1 {
  const bindingId = assertId(record.bindingId, `${label}.bindingId`);
  const vcProofId = assertId(record.vcProofId, `${label}.vcProofId`);
  const capabilityId = assertId(record.capabilityId, `${label}.capabilityId`);
  const claimSubject = validatePartyRef(record.claimSubject, `${label}.claimSubject`);
  const claimType = assertClaimType(record.claimType, `${label}.claimType`);
  const claimDigest = assertDigest(record.claimDigest, `${label}.claimDigest`);
  const recordedAt = assertTimestamp(record.recordedAt, `${label}.recordedAt`);
  return deepFreeze({
    version: VC_AUTHORITY_BINDING_VERSION,
    bindingId,
    vcProofId,
    capabilityId,
    claimSubject,
    claimType,
    claimDigest,
    recordedAt
  });
}

/* -------------------------------------------------------------------------- */

function assertRegistry(registry: VcBindingRegistry): void {
  if (
    registry === null ||
    typeof registry !== 'object' ||
    registry.version !== VC_AUTHORITY_BINDING_VERSION ||
    !(registry.bindings instanceof Map)
  ) {
    throw capabilityError('CAP_INVALID_INPUT', 'invalid VcBindingRegistry');
  }
}

function assertClaimType(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw capabilityError('CAP_INVALID_INPUT', `${label} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_CLAIM_TYPE_LENGTH) {
    throw capabilityError(
      'CAP_INVALID_INPUT',
      `${label} exceeds ${MAX_CLAIM_TYPE_LENGTH} characters`
    );
  }
  return trimmed;
}

function filterFrozenSorted(
  registry: VcBindingRegistry,
  predicate: (b: VcAuthorityBindingV1) => boolean
): readonly VcAuthorityBindingV1[] {
  const out: VcAuthorityBindingV1[] = [];
  for (const b of registry.bindings.values()) {
    if (predicate(b)) out.push(b);
  }
  out.sort((a, b) =>
    a.bindingId < b.bindingId ? -1 : a.bindingId > b.bindingId ? 1 : 0
  );
  return Object.freeze(out);
}

function freezeMap(
  map: Map<string, VcAuthorityBindingV1>
): ReadonlyMap<string, VcAuthorityBindingV1> {
  return Object.freeze(map) as ReadonlyMap<string, VcAuthorityBindingV1>;
}
