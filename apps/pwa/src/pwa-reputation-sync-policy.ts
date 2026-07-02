/**
 * Phase 1.8.13 — cross-device sync opt-in policy.
 *
 * The Phase 1.8 doctrine non-negotiable #2 ("Reputation never leaves
 * the device unless the user opts in") is enforced structurally at
 * the PWA emit layer today: helpers persist to the local Dexie log
 * only, never to a `SignedEventEnvelope`. This module ships the
 * per-event-kind PREFERENCE the user can set ahead of an actual
 * cross-device sync flow.
 *
 * What this slice DOES ship:
 *
 *   - The `ReputationSyncPolicy` shape + a stable, conservative
 *     `DEFAULT_REPUTATION_SYNC_POLICY` (all kinds device-local).
 *   - Frozen runtime constants for the allowed scope choices per
 *     event kind. Observation / attestation / revocation may be
 *     elevated to `account-local` (sync across the user's own
 *     devices) but NOT to `public`. Aggregator events are not
 *     emitted by the user — they originate at the aggregator —
 *     so they have no per-user policy slot.
 *   - A pure `resolveReputationPrivacy(policy, kind, override?)`
 *     helper that returns the effective scope. An explicit
 *     per-call override always wins; otherwise the user's stored
 *     preference; otherwise the doctrine default
 *     (`device-local`).
 *   - localStorage-backed `loadReputationSyncPolicy` /
 *     `saveReputationSyncPolicy` so the user's preference survives
 *     reload. The policy is intentionally per-device today —
 *     cross-device sync of the policy itself is a deferred slice.
 *
 * What this slice does NOT yet ship:
 *
 *   - Actual envelope-wrapping of reputation events. That requires
 *     the Phase 5.0 private payload envelope to land first;
 *     `account-local` events MUST be encrypted under the user's
 *     own key material.
 *   - Sync-client outbound wiring. Once the envelope is wrapped,
 *     the outbox would route account-local events to the bridge.
 *   - Bridge-side propagation policy. The bridge admission engine
 *     already accepts `account-local` scope; what's missing is
 *     the bridge-to-other-device delivery contract.
 *   - Sync-client inbound consumption for observation /
 *     attestation / revocation kinds. The Phase 1.8.12 inbound
 *     pipeline today drops these with `policy-not-subscribable`;
 *     future code will check this policy per-author and admit
 *     the user's own other-device events.
 *
 * The doctrine bar this slice satisfies: the user can express
 * their intent now; the wiring that consumes that intent ships
 * with the Phase 5.0 private payload envelope.
 */

export const REPUTATION_SYNC_POLICY_VERSION = 'lfp2p.reputation-sync-policy.v1' as const;

export const REPUTATION_SYNC_SCOPES = Object.freeze(['device-local', 'account-local'] as const);
export type ReputationSyncScope = (typeof REPUTATION_SYNC_SCOPES)[number];

/**
 * The three reputation event kinds whose privacy the USER controls.
 * `reputation.aggregator.published` and `.score.removed` originate
 * at the aggregator, not the user — they have no entry here.
 */
export const REPUTATION_USER_EMIT_KINDS = Object.freeze([
  'observation',
  'attestation',
  'revocation'
] as const);
export type ReputationUserEmitKind = (typeof REPUTATION_USER_EMIT_KINDS)[number];

export type ReputationSyncPolicy = Readonly<{
  version: typeof REPUTATION_SYNC_POLICY_VERSION;
  observation: ReputationSyncScope;
  attestation: ReputationSyncScope;
  revocation: ReputationSyncScope;
}>;

/**
 * Doctrine non-negotiable #2 default: every kind stays device-local
 * until the user explicitly elevates it.
 */
export const DEFAULT_REPUTATION_SYNC_POLICY: ReputationSyncPolicy = Object.freeze({
  version: REPUTATION_SYNC_POLICY_VERSION,
  observation: 'device-local',
  attestation: 'device-local',
  revocation: 'device-local'
});

/* -------------------------------------------------------------------------- */
/*                            resolver                                        */
/* -------------------------------------------------------------------------- */

/**
 * Effective scope = caller override > stored preference > doctrine
 * default. Pure function — no side effects.
 */
export function resolveReputationPrivacy(
  policy: ReputationSyncPolicy,
  kind: ReputationUserEmitKind,
  override?: ReputationSyncScope
): ReputationSyncScope {
  if (override !== undefined) {
    if (!(REPUTATION_SYNC_SCOPES as readonly string[]).includes(override)) {
      // Unknown scope override falls through to the policy rather
      // than crashing the emit — defense-in-depth.
      return policy[kind];
    }
    return override;
  }
  return policy[kind];
}

/* -------------------------------------------------------------------------- */
/*                          input validation                                  */
/* -------------------------------------------------------------------------- */

/**
 * Normalize a possibly-corrupt persisted policy back to a frozen,
 * documented shape. Any missing or invalid field falls back to the
 * doctrine default. Throws ONLY if `input` is itself non-object.
 */
export function normaliseReputationSyncPolicy(input: unknown): ReputationSyncPolicy {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('normaliseReputationSyncPolicy: input must be an object');
  }
  const record = input as Record<string, unknown>;
  const pick = (key: ReputationUserEmitKind): ReputationSyncScope => {
    const raw = record[key];
    if (typeof raw === 'string' && (REPUTATION_SYNC_SCOPES as readonly string[]).includes(raw)) {
      return raw as ReputationSyncScope;
    }
    return DEFAULT_REPUTATION_SYNC_POLICY[key];
  };
  return Object.freeze({
    version: REPUTATION_SYNC_POLICY_VERSION,
    observation: pick('observation'),
    attestation: pick('attestation'),
    revocation: pick('revocation')
  });
}

/* -------------------------------------------------------------------------- */
/*                       localStorage persistence                             */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = 'lfp2p.pwa.reputation-sync-policy.v1';

type StorageLike = Readonly<{
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}>;

function defaultStorage(): StorageLike | undefined {
  if (typeof globalThis === 'undefined') return undefined;
  // SSR / test environments may lack localStorage; we tolerate
  // gracefully rather than throwing on import.
  const candidate = (globalThis as { localStorage?: StorageLike }).localStorage;
  if (
    candidate === undefined ||
    typeof candidate.getItem !== 'function' ||
    typeof candidate.setItem !== 'function'
  ) {
    return undefined;
  }
  return candidate;
}

/**
 * Load the stored policy. Returns the doctrine default when no
 * preference has ever been saved OR the stored blob is corrupt.
 *
 * Caller may inject `storage` for tests; otherwise
 * `globalThis.localStorage` is used. When no storage is available
 * the default is returned silently.
 */
export function loadReputationSyncPolicy(
  storage: StorageLike | undefined = defaultStorage()
): ReputationSyncPolicy {
  if (storage === undefined) return DEFAULT_REPUTATION_SYNC_POLICY;
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return DEFAULT_REPUTATION_SYNC_POLICY;
  try {
    return normaliseReputationSyncPolicy(JSON.parse(raw));
  } catch {
    // Corrupt blob — fail closed to the doctrine default rather
    // than throwing on read.
    return DEFAULT_REPUTATION_SYNC_POLICY;
  }
}

/**
 * Save the policy. Normalises before writing so a malformed input
 * cannot corrupt the stored blob. Returns the normalized record
 * that was actually written.
 */
export function saveReputationSyncPolicy(
  next: unknown,
  storage: StorageLike | undefined = defaultStorage()
): ReputationSyncPolicy {
  const normalised = normaliseReputationSyncPolicy(next);
  if (storage !== undefined) {
    storage.setItem(STORAGE_KEY, JSON.stringify(normalised));
  }
  return normalised;
}

/**
 * Reset the policy to doctrine defaults. Useful when the user
 * wants to clear their elevations.
 */
export function resetReputationSyncPolicy(
  storage: StorageLike | undefined = defaultStorage()
): ReputationSyncPolicy {
  if (storage !== undefined) storage.removeItem(STORAGE_KEY);
  return DEFAULT_REPUTATION_SYNC_POLICY;
}
