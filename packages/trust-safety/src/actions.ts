import type { EnforcementScope } from './authorities.js';
import { tsError } from './errors.js';

/**
 * Safety actions, split into three semantic groups:
 *
 *  - Moderation actions: warn, blur-media, collapse, hide, quarantine,
 *    remove-local, reject-transport, rate-limit, escalate-review
 *  - Curation/reach actions: downrank, exclude-from-feed,
 *    exclude-from-search, exclude-from-recommendations
 *  - `allow` is a no-op affirmation that fits both groups
 *
 * The split is enforced at validation time so a curation rule cannot
 * masquerade as a moderation decision and vice versa.
 */
export const SAFETY_ACTIONS = [
  'allow',
  'warn',
  'blur-media',
  'collapse',
  'hide',
  'quarantine',
  'remove-local',
  'reject-transport',
  'rate-limit',
  'escalate-review',
  'downrank',
  'exclude-from-feed',
  'exclude-from-search',
  'exclude-from-recommendations'
] as const;
export type SafetyAction = (typeof SAFETY_ACTIONS)[number];

export const MODERATION_ACTIONS: ReadonlySet<SafetyAction> = new Set([
  'warn',
  'blur-media',
  'collapse',
  'hide',
  'quarantine',
  'remove-local',
  'reject-transport',
  'rate-limit',
  'escalate-review'
]);

export const CURATION_ACTIONS: ReadonlySet<SafetyAction> = new Set([
  'downrank',
  'exclude-from-feed',
  'exclude-from-search',
  'exclude-from-recommendations'
]);

/** Scopes under which `reject-transport` is valid. */
export const TRANSPORT_SCOPES: ReadonlySet<EnforcementScope> = new Set([
  'bridge-local',
  'relay-local',
  'super-peer-local',
  'app-surface-local'
]);

/**
 * Cross-validate an action against the scope. `reject-transport` is only
 * valid at transport scopes. Curation actions are only valid at
 * index/app/account/device local scopes by default — a global "downrank
 * everywhere" decision is not expressible by a single policy decision.
 */
export function assertActionScopeCompatible(
  action: SafetyAction,
  scope: EnforcementScope,
  label: string
): void {
  if (action === 'reject-transport' && !TRANSPORT_SCOPES.has(scope)) {
    throw tsError(
      'TS_ACTION_SCOPE_MISMATCH',
      `${label}: action "reject-transport" requires a transport scope (bridge/relay/super-peer/app-surface-local), got "${scope}"`
    );
  }
  if (CURATION_ACTIONS.has(action)) {
    if (
      scope === 'bridge-local' ||
      scope === 'relay-local' ||
      scope === 'super-peer-local' ||
      scope === 'network-advisory'
    ) {
      throw tsError(
        'TS_ACTION_SCOPE_MISMATCH',
        `${label}: curation action "${action}" cannot be issued at transport or network-advisory scope`
      );
    }
  }
}

/** Severity levels used by label definitions and labels. */
export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

/** Categories used by label definitions. */
export const LABEL_CATEGORIES = [
  'abuse',
  'security',
  'media-safety',
  'legal-risk',
  'age-sensitivity',
  'quality',
  'topic',
  'curation',
  'context',
  'system'
] as const;
export type LabelCategory = (typeof LABEL_CATEGORIES)[number];
