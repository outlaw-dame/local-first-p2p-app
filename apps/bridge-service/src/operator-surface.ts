/**
 * Phase 4.6 — Operator surface configuration.
 *
 * Extends the bridge admission engine's static surface model with a
 * runtime-configurable `OperatorSurfaceConfig` that:
 *
 *  - Narrows (but NEVER widens) the default privacy-scope allowlist
 *    for the chosen surface.
 *  - Optionally narrows the event-kind allowlist.
 *  - Supplies a surface-specific byte cap to override the
 *    `DEFAULT_MAX_BYTES_BY_SURFACE` default.
 *
 * Non-negotiable: scope widening (e.g. adding `dm` to a `super-peer`
 * surface whose default excludes `dm`) is rejected at construction.
 * The engine's per-surface hardcoded allowlists are the physical
 * security boundary; operator config is an administrative narrowing
 * tool only.
 */
import {
  BRIDGE_SAFE_PRIVACY_SCOPES,
  RELAY_SAFE_PRIVACY_SCOPES,
  SUPER_PEER_SAFE_PRIVACY_SCOPES,
  PUBLIC_INDEX_SAFE_PRIVACY_SCOPES,
  type EnvelopePrivacyScope
} from '@lfp2p/trust-safety';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OperatorSurface = 'bridge' | 'relay' | 'super-peer' | 'public-index';

export type OperatorSurfaceConfig = Readonly<{
  surface: OperatorSurface;
  /**
   * Which envelope privacy scopes are admitted at this surface.
   * Must be a subset of the surface's default scope set — widening is
   * rejected at construction (see `validateOperatorSurfaceConfig`).
   */
  allowedPrivacyScopes: ReadonlyArray<EnvelopePrivacyScope>;
  /** Optional event-kind allowlist (narrows only). */
  allowedKinds?: ReadonlyArray<string>;
  /** Override for the surface's `DEFAULT_MAX_BYTES_BY_SURFACE` default. */
  maxBytesPerEnvelope?: number;
  /** Human-readable operator label for dashboards. Not used in policy checks. */
  description?: string;
}>;

// ---------------------------------------------------------------------------
// Surface defaults
// ---------------------------------------------------------------------------

export class OperatorSurfaceWidenError extends Error {
  constructor(
    surface: OperatorSurface,
    scope: EnvelopePrivacyScope,
    defaults: ReadonlySet<EnvelopePrivacyScope>
  ) {
    super(
      `OperatorSurfaceConfig: scope "${scope}" widens beyond the "${surface}" surface default ` +
        `(allowed: ${[...defaults].join(', ')})`
    );
    this.name = 'OperatorSurfaceWidenError';
  }
}

const SURFACE_DEFAULT_SCOPES: Readonly<Record<OperatorSurface, ReadonlySet<EnvelopePrivacyScope>>> =
  {
    bridge: BRIDGE_SAFE_PRIVACY_SCOPES,
    relay: RELAY_SAFE_PRIVACY_SCOPES,
    'super-peer': SUPER_PEER_SAFE_PRIVACY_SCOPES,
    'public-index': PUBLIC_INDEX_SAFE_PRIVACY_SCOPES
  };

/**
 * Validate that the config only narrows (never widens) the surface's
 * default scope set. Throws `OperatorSurfaceWidenError` if any scope
 * in `allowedPrivacyScopes` is not in the surface's default set.
 *
 * Guards against null/undefined config and unknown surface values so
 * the function is safe to call with runtime-loaded JSON configuration.
 */
export function validateOperatorSurfaceConfig(
  config: OperatorSurfaceConfig
): OperatorSurfaceConfig {
  if (config == null) {
    throw new Error('validateOperatorSurfaceConfig: config is required');
  }
  const defaults = SURFACE_DEFAULT_SCOPES[config.surface];
  if (defaults === undefined) {
    throw new Error(
      `validateOperatorSurfaceConfig: unknown surface "${String(config.surface)}" — ` +
        `must be one of: ${Object.keys(SURFACE_DEFAULT_SCOPES).join(', ')}`
    );
  }
  for (const scope of config.allowedPrivacyScopes) {
    if (!defaults.has(scope)) {
      throw new OperatorSurfaceWidenError(config.surface, scope, defaults);
    }
  }
  return config;
}

/**
 * Return the default `OperatorSurfaceConfig` for a given surface:
 * the surface's full default scope set and no additional restrictions.
 */
export function defaultOperatorSurfaceConfig(surface: OperatorSurface): OperatorSurfaceConfig {
  const defaults = SURFACE_DEFAULT_SCOPES[surface];
  return Object.freeze({
    surface,
    allowedPrivacyScopes: Object.freeze([...defaults]) as ReadonlyArray<EnvelopePrivacyScope>
  });
}

/** Exported for tests that need the defaults table. */
export { SURFACE_DEFAULT_SCOPES };
