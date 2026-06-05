/**
 * Phase 1.8.7 — view-model logic for the PWA reputation settings.
 *
 * Pure helpers. No React. No persistence. The React component
 * (`pwa-reputation-settings.tsx`) consumes these helpers and the
 * emit helpers (`pwa-reputation-emit.ts`) to drive the actual flows.
 *
 * Three responsibilities:
 *
 *   1. Validate + clamp user inputs for the spam-gate threshold
 *      sliders so a bad input never reaches the Phase 1.8.3
 *      `resolveSpamGateConfig` validator (we use the validator as a
 *      backstop but the UI clamps proactively so the user always
 *      sees a snappy form).
 *
 *   2. Build the form-state for observation / attestation emit
 *      forms with explicit "this publishes outside your device"
 *      warnings keyed to the doctrine privacy ladder. Observations
 *      and attestations are device-local by default — the UI MUST
 *      surface that contract to the user, and any future cross-
 *      device publish MUST be a separate explicit opt-in.
 *
 *   3. Compose the aggregator subscription list with priority
 *      management, including the doctrine non-negotiable "local is
 *      always priority 0" enforced at the form layer so a user
 *      cannot even attempt to claim priority 0 for an external
 *      labeler.
 */
import {
  AGGREGATOR_REMOVAL_REASONS,
  ATTESTATION_CONTEXT_TAGS,
  ATTESTATION_VALENCES,
  DEFAULT_SPAM_GATE_CONFIG,
  LOCAL_REPUTATION_SOURCE,
  OBSERVATION_KINDS,
  REPUTATION_ALGORITHMS,
  REPUTATION_LIMITS,
  resolveSpamGateConfig,
  type AggregatorRemovalReason,
  type AttestationContextTag,
  type AttestationValence,
  type ObservationKind,
  type ReputationAlgorithm,
  type SpamGateConfig
} from '@lfp2p/trust-safety';

/* -------------------------------------------------------------------------- */
/*                          spam-gate thresholds                              */
/* -------------------------------------------------------------------------- */

export type SpamGateSliderInput = Readonly<{
  spamScoreThreshold: number;
  spamSeedDistanceMax: number;
}>;

export type SpamGateSliderResult = Readonly<{
  config: SpamGateConfig;
  warnings: ReadonlyArray<string>;
}>;

/**
 * Clamp user input into the doctrine-valid spam-gate config range
 * and surface warnings when the user picks a permissive
 * configuration. Returns the resolved frozen config the caller can
 * persist + the human-readable warning list.
 *
 * The clamping is conservative — too-permissive thresholds get
 * walked back to a safer value rather than silently rejected.
 * That's UI-friendliness; the validator (`resolveSpamGateConfig`)
 * is the final defense-in-depth backstop.
 */
export function clampSpamGateInput(input: SpamGateSliderInput): SpamGateSliderResult {
  const warnings: string[] = [];
  // Threshold clamp: [0, 1]. A value > 1 doesn't make sense; > 0.5
  // is permissive enough that we warn but allow.
  let threshold = input.spamScoreThreshold;
  if (!Number.isFinite(threshold) || threshold < 0) {
    threshold = DEFAULT_SPAM_GATE_CONFIG.spamScoreThreshold;
    warnings.push('Invalid threshold — reset to default.');
  } else if (threshold > 1) {
    threshold = 1;
    warnings.push('Threshold above 1 has no effect — clamped to 1.');
  }
  if (threshold > 0.5) {
    warnings.push('Threshold above 0.5 may flag legitimate accounts as spam.');
  }
  // Seed distance: non-negative integer, default 3.
  let distance = input.spamSeedDistanceMax;
  if (!Number.isFinite(distance) || distance < 0 || !Number.isInteger(distance)) {
    distance = DEFAULT_SPAM_GATE_CONFIG.spamSeedDistanceMax;
    warnings.push('Invalid distance — reset to default.');
  } else if (distance > 10) {
    distance = 10;
    warnings.push('Distance above 10 covers most of the graph; clamped to 10.');
  }
  // Final defense-in-depth — feed through the validator. If the
  // validator throws (which it should not, since we clamped to its
  // documented range), the caller surfaces the error.
  const config = resolveSpamGateConfig({
    spamScoreThreshold: threshold,
    spamSeedDistanceMax: distance
  });
  return Object.freeze({ config, warnings: Object.freeze(warnings) });
}

/* -------------------------------------------------------------------------- */
/*                      observation / attestation forms                       */
/* -------------------------------------------------------------------------- */

export type ObservationFormDefaults = Readonly<{
  kinds: ReadonlyArray<ObservationKind>;
  maxCount: number;
}>;

export const OBSERVATION_FORM_DEFAULTS: ObservationFormDefaults = Object.freeze({
  kinds: OBSERVATION_KINDS,
  maxCount: REPUTATION_LIMITS.maxObservationCount
});

export type AttestationFormDefaults = Readonly<{
  valences: ReadonlyArray<AttestationValence>;
  contextTags: ReadonlyArray<AttestationContextTag>;
}>;

export const ATTESTATION_FORM_DEFAULTS: AttestationFormDefaults = Object.freeze({
  valences: ATTESTATION_VALENCES,
  contextTags: ATTESTATION_CONTEXT_TAGS
});

export type RemovalFormDefaults = Readonly<{
  reasons: ReadonlyArray<AggregatorRemovalReason>;
}>;

export const REMOVAL_FORM_DEFAULTS: RemovalFormDefaults = Object.freeze({
  reasons: AGGREGATOR_REMOVAL_REASONS
});

/**
 * Privacy-ladder warning the form MUST show whenever the user
 * about to emit an observation or attestation. Today everything
 * stays device-local; the wording prepares the user for a future
 * opt-in cross-device publish.
 */
export const DEVICE_LOCAL_PRIVACY_NOTICE = Object.freeze({
  title: 'Stays on this device',
  body:
    'This observation is recorded locally and used to compute your ' +
    'personal reputation view. It is NOT shared with other devices, ' +
    'bridges, or aggregators unless you explicitly opt in via a ' +
    'future setting.'
});

/* -------------------------------------------------------------------------- */
/*                       aggregator subscription list                         */
/* -------------------------------------------------------------------------- */

export type AggregatorSubscriptionInput = Readonly<{
  labelerId: string;
  /** UI priority — caller's intent. Will be clamped to ≥1 (local owns 0). */
  priority: number;
  algorithm: ReputationAlgorithm;
}>;

export type AggregatorSubscriptionRecord = Readonly<{
  labelerId: string;
  priority: number;
  algorithm: ReputationAlgorithm;
}>;

export type AggregatorSubscriptionListResult = Readonly<{
  list: ReadonlyArray<AggregatorSubscriptionRecord>;
  warnings: ReadonlyArray<string>;
}>;

/**
 * Build the subscription list from user inputs. Enforces the
 * doctrine non-negotiable "local is always priority 0":
 *
 *  - any subscription claiming priority 0 is bumped to priority 1
 *    with a warning,
 *  - any subscription claiming `LOCAL_REPUTATION_SOURCE` as its
 *    labelerId is rejected outright (returns warnings, drops the
 *    entry).
 *
 * Duplicate labelerIds are collapsed to the highest priority
 * (lowest number) the user supplied; the others are dropped with
 * a warning so the user understands the deduplication.
 *
 * Output is sorted ascending by priority for deterministic
 * presentation.
 */
export function buildAggregatorSubscriptionList(
  inputs: ReadonlyArray<AggregatorSubscriptionInput>
): AggregatorSubscriptionListResult {
  const warnings: string[] = [];
  const seen = new Map<string, AggregatorSubscriptionRecord>();

  for (const raw of inputs) {
    if (typeof raw.labelerId !== 'string' || raw.labelerId.length === 0) {
      warnings.push('Skipped subscription with empty labeler id.');
      continue;
    }
    if (raw.labelerId === LOCAL_REPUTATION_SOURCE) {
      warnings.push(
        'Reserved labeler id "__local__" cannot be a subscription — local source is always priority 0.'
      );
      continue;
    }
    if (
      typeof raw.algorithm !== 'string' ||
      !(REPUTATION_ALGORITHMS as readonly string[]).includes(raw.algorithm)
    ) {
      warnings.push(
        `Skipped subscription with unknown algorithm "${String(raw.algorithm)}".`
      );
      continue;
    }
    let priority = raw.priority;
    if (!Number.isFinite(priority) || !Number.isInteger(priority) || priority < 0) {
      warnings.push(`Reset invalid priority for "${raw.labelerId}" to 1.`);
      priority = 1;
    } else if (priority === 0) {
      warnings.push(
        `Priority 0 is reserved for the local source — bumped "${raw.labelerId}" to 1.`
      );
      priority = 1;
    }
    const existing = seen.get(raw.labelerId);
    if (existing === undefined || priority < existing.priority) {
      seen.set(
        raw.labelerId,
        Object.freeze({
          labelerId: raw.labelerId,
          priority,
          algorithm: raw.algorithm
        })
      );
      if (existing !== undefined) {
        warnings.push(
          `Replaced existing subscription for "${raw.labelerId}" with higher-priority entry.`
        );
      }
    } else {
      warnings.push(
        `Dropped duplicate subscription for "${raw.labelerId}" (kept higher-priority entry).`
      );
    }
  }

  const list = [...seen.values()].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.labelerId < b.labelerId ? -1 : a.labelerId > b.labelerId ? 1 : 0;
  });
  return Object.freeze({
    list: Object.freeze(list),
    warnings: Object.freeze(warnings)
  });
}
