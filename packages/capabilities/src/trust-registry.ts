/**
 * Authority trust registry — read-only composition over the three
 * existing trust sources.
 *
 * This module replaces the original ACL-style trust registry (a
 * `trustState` field plus a boolean `isAuthorityTrusted` predicate)
 * that violated `docs/protocol/trust-boundaries.md`. The doctrine
 * forbids a trust registry from being an authority input on its own;
 * see issue #76 for the full rationale.
 *
 * What this module DOES (per doctrine):
 *
 *   - Composes a *labelled view* over three sources for a given
 *     authority — capability decisions, reputation band, and identity-
 *     control device status — each clearly attributed to its source.
 *   - Caches a `worstCasePrecheck` value (`'block'` or `'continue'`)
 *     so callers can fail closed quickly before evaluating any
 *     capability or admission flow. `'block'` is returned ONLY when
 *     one of the underlying sources says no in a hard, structural
 *     way: a `deny` capability decision, an `untrusted` reputation
 *     band, or a `revoked` device state.
 *
 * What this module DELIBERATELY does NOT do (per doctrine):
 *
 *   - It does not store any trust state. There is no
 *     `setAuthorityTrust`, no ACL-by-party-id keyed registry, no
 *     `trustState` enum that downstream code can branch on. The
 *     compositional view is *derived* fresh from caller-supplied
 *     resolvers every time. There is nothing here that can be
 *     written to.
 *   - It does not introduce a boolean trust predicate
 *     (`isAuthorityTrusted`). Authority is always the capability
 *     decision; this module never returns "yes/no" to a question
 *     about authority.
 *   - It does not re-implement reputation, identity-control, or
 *     capability semantics. It only *references* outputs of those
 *     subsystems through the injected resolver functions.
 *
 * Inversion of dependence: this module declares the *shapes* it
 * consumes (`CapabilityPosture`, `ReputationPosture`,
 * `IdentityPosture`) so it does not need to import from
 * `@lfp2p/trust-safety` or `@lfp2p/identity`. The caller maps from
 * those packages to these shapes — keeping the boundary clean.
 */
import { capabilityError } from './errors.js';
import {
  CAPABILITY_DECISION_STATUSES,
  type CapabilityDecisionStatus,
  type CapabilityPartyRef
} from './types.js';
import { assertPlainObject, validatePartyRef } from './validation.js';

export const AUTHORITY_VIEW_VERSION = 'lfp2p.capability.authority-view.v1' as const;
export type AuthorityViewVersion = typeof AUTHORITY_VIEW_VERSION;

/**
 * Posture surfaced by `@lfp2p/capabilities` (the project's actual
 * authority source). The shape is intentionally minimal — only what
 * the composition layer needs to label the source and compute a
 * worst-case pre-check.
 *
 * `decision` mirrors the existing `CapabilityDecisionStatus`. Local
 * extension `'unknown'` is added for the case where the caller has
 * not yet evaluated a capability for this authority but wants to
 * include the source slot in the view (for audit consistency).
 */
export type CapabilityPostureDecision = CapabilityDecisionStatus | 'unknown';

export type CapabilityPosture = Readonly<{
  source: 'capability';
  decision: CapabilityPostureDecision;
  /**
   * Audit-only list of capability ids contributing to the decision.
   * Surface only — this list does NOT participate in any trust math.
   * The composition layer never sums, scores, or thresholds it.
   */
  capabilityIds?: readonly string[];
}>;

/**
 * Posture surfaced by `@lfp2p/trust-safety`'s Phase 1.8 reputation
 * graph. The composition layer never re-derives a band — it only
 * forwards what the reputation runtime already computed.
 */
export const REPUTATION_POSTURE_BANDS = [
  'high',
  'mid',
  'low',
  'untrusted'
] as const;
export type ReputationPostureBand = (typeof REPUTATION_POSTURE_BANDS)[number];

export type ReputationPosture = Readonly<{
  source: 'reputation';
  band: ReputationPostureBand;
}>;

/**
 * Posture surfaced by `@lfp2p/identity`'s device-control projection.
 * The composition layer treats `'revoked'` as a hard-fail signal —
 * a revoked device key authorizes nothing regardless of any other
 * source's opinion.
 */
export const IDENTITY_POSTURE_STATES = [
  'active',
  'revoked',
  'rotated',
  'unknown'
] as const;
export type IdentityPostureState = (typeof IDENTITY_POSTURE_STATES)[number];

export type IdentityPosture = Readonly<{
  source: 'identity-control';
  status: IdentityPostureState;
}>;

/**
 * Per-source resolvers. Each is optional — if the caller does NOT
 * supply a resolver, that posture is *omitted* from the view (no
 * default-trust signal manufactured from missing data). A resolver
 * that returns `undefined` for a specific authority means "this
 * subsystem has no opinion on this party right now" — distinct from
 * "I was not asked at all" (resolver omitted). Both fail closed at
 * the worst-case pre-check: an absent posture does NOT contribute to
 * `'continue'`.
 */
export type CapabilityPostureResolver = (
  authority: CapabilityPartyRef
) => CapabilityPosture | undefined;
export type ReputationPostureResolver = (
  authority: CapabilityPartyRef
) => ReputationPosture | undefined;
export type IdentityPostureResolver = (
  authority: CapabilityPartyRef
) => IdentityPosture | undefined;

export type ComposeAuthorityViewOptions = Readonly<{
  authority: CapabilityPartyRef;
  /** Recorded on the view for replay-determinism per Phase 3.2. */
  now: string;
  resolveCapabilityPosture?: CapabilityPostureResolver;
  resolveReputationPosture?: ReputationPostureResolver;
  resolveIdentityPosture?: IdentityPostureResolver;
}>;

/**
 * Worst-case pre-check signal. `'block'` is returned ONLY when at
 * least one source says no in a hard, structural way. Otherwise the
 * caller should `'continue'` to the normal capability-evaluation
 * path — the pre-check is a fast fail-closed shortcut, never a
 * grant.
 */
export const AUTHORITY_PRECHECK_OUTCOMES = ['block', 'continue'] as const;
export type AuthorityPrecheckOutcome = (typeof AUTHORITY_PRECHECK_OUTCOMES)[number];

export type AuthorityTrustView = Readonly<{
  version: AuthorityViewVersion;
  authority: CapabilityPartyRef;
  capabilityPosture?: CapabilityPosture;
  reputationPosture?: ReputationPosture;
  identityPosture?: IdentityPosture;
  worstCasePrecheck: AuthorityPrecheckOutcome;
  /**
   * Per-source reasons that contributed to a `'block'` result. Empty
   * tuple when `worstCasePrecheck === 'continue'`. Audit-only.
   */
  blockReasons: readonly AuthorityPrecheckReason[];
  composedAt: string;
}>;

export const AUTHORITY_PRECHECK_REASONS = [
  'capability-deny',
  'reputation-untrusted',
  'identity-revoked'
] as const;
export type AuthorityPrecheckReason = (typeof AUTHORITY_PRECHECK_REASONS)[number];

/* -------------------------------------------------------------------------- */

/**
 * Compose a labelled view over the three trust sources for a party.
 * Pure on its inputs. Returns a deep-frozen `AuthorityTrustView`.
 *
 * Boundary discipline:
 *
 *   - Postures are stamped with their `source` field by the resolver
 *     (caller's responsibility). The composition layer validates the
 *     marker is present and well-formed; it does NOT mint sources of
 *     its own. This prevents the registry from silently becoming a
 *     source of trust facts.
 *
 *   - `worstCasePrecheck` is `'block'` iff:
 *       - the capability posture's `decision` is `'deny'`, OR
 *       - the reputation posture's `band` is `'untrusted'`, OR
 *       - the identity posture's `status` is `'revoked'`.
 *     Any other combination — including all three resolvers omitted
 *     — yields `'continue'`. A `'continue'` pre-check is NEVER a
 *     positive trust signal; it just means "no hard-fail surfaced
 *     here; the caller must still run the normal capability gate".
 */
export function composeAuthorityView(
  input: ComposeAuthorityViewOptions
): AuthorityTrustView {
  assertOptions(input);
  const authority = validatePartyRef(input.authority, 'composeAuthorityView.authority');
  const composedAt = assertTimestamp(input.now, 'composeAuthorityView.now');

  const capabilityPosture =
    input.resolveCapabilityPosture === undefined
      ? undefined
      : validateCapabilityPosture(input.resolveCapabilityPosture(authority));
  const reputationPosture =
    input.resolveReputationPosture === undefined
      ? undefined
      : validateReputationPosture(input.resolveReputationPosture(authority));
  const identityPosture =
    input.resolveIdentityPosture === undefined
      ? undefined
      : validateIdentityPosture(input.resolveIdentityPosture(authority));

  const blockReasons: AuthorityPrecheckReason[] = [];
  if (capabilityPosture?.decision === 'deny') blockReasons.push('capability-deny');
  if (reputationPosture?.band === 'untrusted') blockReasons.push('reputation-untrusted');
  if (identityPosture?.status === 'revoked') blockReasons.push('identity-revoked');
  const worstCasePrecheck: AuthorityPrecheckOutcome =
    blockReasons.length === 0 ? 'continue' : 'block';

  return Object.freeze({
    version: AUTHORITY_VIEW_VERSION,
    authority,
    ...(capabilityPosture === undefined ? {} : { capabilityPosture }),
    ...(reputationPosture === undefined ? {} : { reputationPosture }),
    ...(identityPosture === undefined ? {} : { identityPosture }),
    worstCasePrecheck,
    blockReasons: Object.freeze(blockReasons),
    composedAt
  });
}

/* -------------------------------------------------------------------------- */

function assertOptions(input: unknown): asserts input is ComposeAuthorityViewOptions {
  // `typeof [] === 'object'` in JS — guard against arrays slipping
  // past the object check. (Per gemini review on PR #80.)
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw capabilityError('CAP_INVALID_INPUT', 'composeAuthorityView: input must be an object');
  }
  const record = input as Record<string, unknown>;
  for (const key of [
    'resolveCapabilityPosture',
    'resolveReputationPosture',
    'resolveIdentityPosture'
  ] as const) {
    if (record[key] !== undefined && typeof record[key] !== 'function') {
      throw capabilityError(
        'CAP_INVALID_INPUT',
        `composeAuthorityView: ${key} must be a function when supplied`
      );
    }
  }
}

function validateCapabilityPosture(value: unknown): CapabilityPosture | undefined {
  if (value === undefined) return undefined;
  // assertPlainObject also guards against arrays + non-Object
  // prototypes + forbidden keys (e.g. __proto__). Defense in depth
  // against prototype pollution per gemini review on PR #80.
  const record = assertPlainObject(value, 'CapabilityPosture');
  if (record.source !== 'capability') {
    throw capabilityError(
      'CAP_INVALID_ENUM',
      'CapabilityPosture.source must equal "capability"'
    );
  }
  if (typeof record.decision !== 'string' || !isCapabilityDecision(record.decision)) {
    throw capabilityError(
      'CAP_INVALID_ENUM',
      'CapabilityPosture.decision is not supported'
    );
  }
  const capabilityIds =
    record.capabilityIds === undefined
      ? undefined
      : assertStringList(record.capabilityIds, 'CapabilityPosture.capabilityIds');
  return Object.freeze({
    source: 'capability',
    decision: record.decision as CapabilityPostureDecision,
    ...(capabilityIds === undefined ? {} : { capabilityIds })
  });
}

function validateReputationPosture(value: unknown): ReputationPosture | undefined {
  if (value === undefined) return undefined;
  // assertPlainObject also guards against arrays + non-Object
  // prototypes + forbidden keys per gemini review on PR #80.
  const record = assertPlainObject(value, 'ReputationPosture');
  if (record.source !== 'reputation') {
    throw capabilityError(
      'CAP_INVALID_ENUM',
      'ReputationPosture.source must equal "reputation"'
    );
  }
  if (
    typeof record.band !== 'string' ||
    !(REPUTATION_POSTURE_BANDS as readonly string[]).includes(record.band)
  ) {
    throw capabilityError(
      'CAP_INVALID_ENUM',
      'ReputationPosture.band is not supported'
    );
  }
  return Object.freeze({
    source: 'reputation',
    band: record.band as ReputationPostureBand
  });
}

function validateIdentityPosture(value: unknown): IdentityPosture | undefined {
  if (value === undefined) return undefined;
  // assertPlainObject also guards against arrays + non-Object
  // prototypes + forbidden keys per gemini review on PR #80.
  const record = assertPlainObject(value, 'IdentityPosture');
  if (record.source !== 'identity-control') {
    throw capabilityError(
      'CAP_INVALID_ENUM',
      'IdentityPosture.source must equal "identity-control"'
    );
  }
  if (
    typeof record.status !== 'string' ||
    !(IDENTITY_POSTURE_STATES as readonly string[]).includes(record.status)
  ) {
    throw capabilityError(
      'CAP_INVALID_ENUM',
      'IdentityPosture.status is not supported'
    );
  }
  return Object.freeze({
    source: 'identity-control',
    status: record.status as IdentityPostureState
  });
}

function isCapabilityDecision(value: string): value is CapabilityPostureDecision {
  // Reuse the canonical statuses from `./types.js` so a future
  // addition to `CAPABILITY_DECISION_STATUSES` is automatically
  // supported here, with no drift surface. Per gemini review on
  // PR #80.
  return (
    value === 'unknown' ||
    (CAPABILITY_DECISION_STATUSES as readonly string[]).includes(value)
  );
}

function assertStringList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw capabilityError('CAP_INVALID_INPUT', `${label} must be an array`);
  }
  const seen = new Set<string>();
  const out = value.map((item, index) => {
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw capabilityError('CAP_INVALID_ID', `${label}[${index}] must be a non-empty string`);
    }
    const trimmed = item.trim();
    if (seen.has(trimmed)) {
      throw capabilityError('CAP_DUPLICATE_VALUE', `${label} contains duplicate values`);
    }
    seen.add(trimmed);
    return trimmed;
  });
  return Object.freeze(out);
}

function assertTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw capabilityError('CAP_INVALID_TIMESTAMP', `${label} must be a valid timestamp`);
  }
  return value;
}
