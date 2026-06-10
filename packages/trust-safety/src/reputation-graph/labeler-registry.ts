/**
 * Phase 1.8.15 — default labeler registry (LOCAL-ONLY default).
 *
 * The doctrine non-negotiable this module enforces:
 *
 *   **No external party is ever privileged out of the box.**
 *
 * The shipped `DEFAULT_LABELER_REGISTRY` contains ZERO external
 * entries. A brand-new device consults ONLY its own local
 * personalized-EigenTrust computer (Phase 1.8.2), which always wins
 * priority 0 structurally inside `computeAggregatedReputation`. There
 * is no global trust authority, no mandatory aggregator, no default
 * seed-set curated by us or anyone else.
 *
 * What this module DOES provide is the *mechanism* for a distributor
 * or a user to add external labelers EXPLICITLY:
 *
 *   - `DefaultLabelerRegistry` is a data-driven structure a
 *     distributor can populate (e.g., a fork that ships a curated,
 *     opt-out-able bundle). Our shipped default is empty.
 *   - `resolveActiveLabelerSet` merges a registry's defaults with the
 *     user's own subscriptions and the user's mute list, producing
 *     the effective `AggregatorSubscription[]` to feed the Phase 1.8.4
 *     `computeAggregatedReputation` runtime.
 *
 * Structural guarantees in the resolver:
 *
 *   1. **Local is never a subscription.** The local source is
 *      `localState` inside `computeAggregatedReputation`, not a
 *      registry entry. Any entry claiming the `__local__` sentinel is
 *      rejected — local owns priority 0 unconditionally and cannot be
 *      impersonated, muted, or re-prioritised.
 *   2. **Priority 0 is reserved.** Any entry claiming priority ≤ 0 is
 *      rejected (local owns it). External labelers compete from
 *      priority 1 down.
 *   3. **Opt-out wins.** A `mutedLabelerIds` member is excluded from
 *      the active set even if the registry default lists it. The user
 *      can always turn off any external labeler.
 *   4. **User intent overrides distributor default.** When the same
 *      `labelerId` appears in both the registry and the user's
 *      subscriptions, the user's entry wins (their chosen priority +
 *      algorithm). The user is sovereign over their own stack.
 *   5. **Deterministic + frozen output** per Phase 3.2 replay
 *      discipline — sorted ascending by priority, ties broken by
 *      ascending labelerId, deep-frozen.
 *   6. **Audit-friendly origin map** per Phase 3.1 — every active
 *      labeler is tagged `'distributor'` or `'user'` so a settings UI
 *      can show provenance without leaking scoring math.
 */
import { tsError } from '../errors.js';
import {
  REPUTATION_ALGORITHMS,
  type ReputationAlgorithm
} from './constants.js';
import {
  LOCAL_REPUTATION_SOURCE,
  type AggregatorSubscription
} from './aggregator-runtime.js';

export const LABELER_REGISTRY_VERSION = 'lfp2p.labeler-registry.v1' as const;
export type LabelerRegistryVersion = typeof LABELER_REGISTRY_VERSION;

/**
 * Where an active labeler entry came from. `'distributor'` means a
 * shipped registry default (a fork's curated bundle); `'user'` means
 * the device owner subscribed to it explicitly. Used for audit /
 * settings provenance display only — never a trust input.
 */
export type LabelerOrigin = 'distributor' | 'user';

/**
 * One default labeler a distributor chose to ship pre-subscribed.
 * Opt-out-able by the user via `mutedLabelerIds`. Carries the same
 * `{ labelerId, priority }` shape the runtime consumes, plus the
 * `algorithm` tag (for settings display) and an explicit
 * description-free stable id (privacy: no free-form trust text).
 */
export type DefaultLabelerEntry = Readonly<{
  labelerId: string;
  /** ≥ 1. Priority 0 is reserved for the local source. */
  priority: number;
  algorithm: ReputationAlgorithm;
}>;

export type DefaultLabelerRegistry = Readonly<{
  version: LabelerRegistryVersion;
  entries: ReadonlyArray<DefaultLabelerEntry>;
}>;

/**
 * THE doctrinal constant. Shipped default is LOCAL-ONLY: zero
 * external entries. A test pins `entries.length === 0` so a future
 * edit that smuggles a mandatory external labeler into the default
 * fails CI. If a distributor fork wants to ship defaults, it
 * constructs its OWN `DefaultLabelerRegistry` and passes it to
 * `resolveActiveLabelerSet` — it does not mutate this constant.
 */
export const DEFAULT_LABELER_REGISTRY: DefaultLabelerRegistry = Object.freeze({
  version: LABELER_REGISTRY_VERSION,
  entries: Object.freeze([] as ReadonlyArray<DefaultLabelerEntry>)
});

/**
 * A subscription the user added explicitly. Same shape as the
 * registry entry — the only difference is provenance.
 */
export type UserLabelerSubscription = DefaultLabelerEntry;

export type ResolveActiveLabelerSetInput = Readonly<{
  /** Defaults to the local-only `DEFAULT_LABELER_REGISTRY`. */
  registry?: DefaultLabelerRegistry;
  /** The device owner's explicit subscriptions. */
  userSubscriptions?: ReadonlyArray<UserLabelerSubscription>;
  /**
   * Labeler ids the user has muted. A muted id is excluded from the
   * active set even if a registry default lists it. MUST be a Set so
   * membership checks are O(1).
   */
  mutedLabelerIds?: ReadonlySet<string>;
}>;

export type ActiveLabelerEntry = Readonly<{
  labelerId: string;
  priority: number;
  algorithm: ReputationAlgorithm;
  origin: LabelerOrigin;
}>;

export type ActiveLabelerSet = Readonly<{
  version: LabelerRegistryVersion;
  /**
   * The effective set, sorted ascending by priority (ties by
   * ascending labelerId). Audit-friendly: carries `origin`.
   */
  active: ReadonlyArray<ActiveLabelerEntry>;
  /**
   * The subset of `active` projected to the runtime's
   * `AggregatorSubscription` shape — feed this straight into
   * `computeAggregatedReputation({ subscriptions })`. Local is NOT
   * here (it is `localState`, structurally priority 0).
   */
  subscriptions: ReadonlyArray<AggregatorSubscription>;
  /** Privacy-safe, stable, human-readable notes for a settings UI. */
  warnings: ReadonlyArray<string>;
}>;

function isValidEntry(value: unknown): value is DefaultLabelerEntry {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.labelerId === 'string' &&
    typeof record.priority === 'number' &&
    typeof record.algorithm === 'string'
  );
}

/**
 * Compose registry defaults + user subscriptions + mute list into the
 * effective active labeler set. Pure on its inputs. Throws ONLY on
 * structurally-invalid input shape (non-array collections, non-object
 * registry); per-entry problems surface as dropped entries + a
 * warning, never an exception, so a single malformed registry row
 * cannot brick the whole reputation surface.
 */
export function resolveActiveLabelerSet(
  input: ResolveActiveLabelerSetInput = {}
): ActiveLabelerSet {
  if (input === null || typeof input !== 'object') {
    throw tsError('TS_INVALID_INPUT', 'ResolveActiveLabelerSetInput must be a plain object');
  }
  const registry = input.registry === undefined ? DEFAULT_LABELER_REGISTRY : input.registry;
  if (registry === null || typeof registry !== 'object' || !Array.isArray(registry.entries)) {
    throw tsError('TS_INVALID_INPUT', 'input.registry must carry an entries array');
  }
  const userSubscriptions = input.userSubscriptions === undefined ? [] : input.userSubscriptions;
  if (!Array.isArray(userSubscriptions)) {
    throw tsError('TS_INVALID_INPUT', 'input.userSubscriptions must be an array');
  }
  const mutedLabelerIds = input.mutedLabelerIds === undefined ? new Set<string>() : input.mutedLabelerIds;
  if (!(mutedLabelerIds instanceof Set)) {
    throw tsError('TS_INVALID_INPUT', 'input.mutedLabelerIds must be a Set when supplied');
  }

  const warnings: string[] = [];
  // labelerId → active entry. User entries override distributor
  // entries for the same id (inserted second, with explicit replace).
  const active = new Map<string, ActiveLabelerEntry>();

  const ingest = (raw: unknown, origin: LabelerOrigin): void => {
    if (!isValidEntry(raw)) {
      warnings.push(`Dropped a malformed ${origin} labeler entry.`);
      return;
    }
    if (raw.labelerId.length === 0) {
      warnings.push(`Dropped a ${origin} labeler entry with an empty id.`);
      return;
    }
    // Local sentinel can never be a subscription — it is structural.
    if (raw.labelerId === LOCAL_REPUTATION_SOURCE) {
      warnings.push(
        `Rejected ${origin} entry claiming reserved id "${LOCAL_REPUTATION_SOURCE}" — the local source is always priority 0 and cannot be a subscription.`
      );
      return;
    }
    if (
      typeof raw.algorithm !== 'string' ||
      !(REPUTATION_ALGORITHMS as readonly string[]).includes(raw.algorithm)
    ) {
      warnings.push(
        `Dropped ${origin} entry "${raw.labelerId}" with unknown algorithm "${String(raw.algorithm)}".`
      );
      return;
    }
    if (
      !Number.isFinite(raw.priority) ||
      !Number.isInteger(raw.priority) ||
      raw.priority <= 0
    ) {
      // Priority 0 (and below) is reserved for the local source. We
      // reject rather than silently bump so a distributor cannot
      // smuggle an entry into the local slot by claiming priority 0.
      warnings.push(
        `Rejected ${origin} entry "${raw.labelerId}" — priority must be an integer ≥ 1 (0 is reserved for the local source).`
      );
      return;
    }
    if (mutedLabelerIds.has(raw.labelerId)) {
      // Opt-out wins. The user muted this labeler; exclude it.
      warnings.push(`Excluded muted labeler "${raw.labelerId}".`);
      return;
    }
    const existing = active.get(raw.labelerId);
    if (existing !== undefined && existing.origin === 'user' && origin === 'distributor') {
      // Should not happen given ingest order (distributor first), but
      // keep the guard so a re-ordering never silently demotes the
      // user's intent.
      return;
    }
    if (existing !== undefined) {
      warnings.push(
        `Labeler "${raw.labelerId}" appears more than once — kept the ${origin} entry (priority ${raw.priority}).`
      );
    }
    active.set(
      raw.labelerId,
      Object.freeze({
        labelerId: raw.labelerId,
        priority: raw.priority,
        algorithm: raw.algorithm,
        origin
      })
    );
  };

  // Distributor defaults first, then user subscriptions — so a user
  // entry for the same id legitimately overrides the default.
  for (const entry of registry.entries) ingest(entry, 'distributor');
  for (const entry of userSubscriptions) ingest(entry, 'user');

  const sorted = [...active.values()].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.labelerId < b.labelerId ? -1 : a.labelerId > b.labelerId ? 1 : 0;
  });

  const subscriptions = sorted.map((entry) =>
    Object.freeze({ labelerId: entry.labelerId, priority: entry.priority })
  );

  return Object.freeze({
    version: LABELER_REGISTRY_VERSION,
    active: Object.freeze(sorted),
    subscriptions: Object.freeze(subscriptions),
    warnings: Object.freeze(warnings)
  });
}
