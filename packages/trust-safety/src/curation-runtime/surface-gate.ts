/**
 * Curation surface gates and signal hygiene.
 *
 * Doctrine (from `docs/protocol/trust-safety-event-policy.md` and the
 * Phase 1.65 plan):
 *
 *  - Downranking is NOT hiding.
 *  - Search exclusion is NOT global deletion.
 *  - Recommendation exclusion is NOT account suspension.
 *  - Feed grouping is NOT moderation.
 *  - Topic labels are NOT safety labels unless policy maps them.
 *  - Public surfaces (public-feed, search, recommendation) MUST NOT
 *    ingest private-scoped objects or private-only reports as signals.
 *
 * This module exposes the structural gates that enforce the privacy
 * boundary. The Phase 1.63 deferral ("Phase 1.65 curation runtime
 * must not ingest `private-only` reports") is resolved here.
 */

import type { CurationSurface } from '../curation.js';
import { CURATION_SURFACES } from '../curation.js';
import { tsError } from '../errors.js';
import {
  type EnvelopePrivacyScope,
  ENVELOPE_PRIVACY_SCOPES
} from '../transport-admission/admission.js';
import { classifyReportPrivacy } from '../reports-appeals/privacy.js';
import type { SafetyReport } from '../reports.js';
import type { SafetySubjectRef } from '../subjects.js';
import { PRIVATE_BY_NATURE_SUBJECTS } from '../subjects.js';
import { assertOneOf } from '../validation.js';

/** Surfaces whose audience is the broader network. */
export const PUBLIC_CURATION_SURFACES: ReadonlySet<CurationSurface> = new Set<CurationSurface>([
  'public-feed',
  'search',
  'recommendation'
]);

/** Surfaces whose audience is scoped to the user or community. */
export const LOCAL_CURATION_SURFACES: ReadonlySet<CurationSurface> = new Set<CurationSurface>([
  'local-feed',
  'community-feed',
  'notification'
]);

/** Envelope privacy scopes that may flow onto a public curation surface. */
export const PUBLIC_SAFE_ENVELOPE_SCOPES: ReadonlySet<EnvelopePrivacyScope> = new Set<EnvelopePrivacyScope>([
  'public'
]);

/** Reasons a curation surface may refuse to ingest a candidate item. */
export const SURFACE_GATE_REASONS = [
  'allowed',
  'private-envelope-scope',
  'private-by-nature-subject',
  'private-only-report-signal',
  'unknown-surface'
] as const;
export type SurfaceGateReason = (typeof SURFACE_GATE_REASONS)[number];

export type SurfaceGateDecision = Readonly<{
  allowed: boolean;
  reason: SurfaceGateReason;
  surface: CurationSurface;
}>;

function assertSurface(surface: unknown): CurationSurface {
  return assertOneOf(surface, CURATION_SURFACES, 'CurationSurface');
}

/**
 * Decide whether a candidate item with the given subject and envelope
 * privacy scope may be ingested onto `surface`. Pure; no side effects.
 *
 * Public surfaces (`public-feed`, `search`, `recommendation`) require:
 *  - The envelope's privacy scope to be `public`.
 *  - The subject not to be private-by-nature (blob / media / thread)
 *    unless the subject's underlying ObjectRef is already public.
 *
 * Local surfaces (`local-feed`, `community-feed`, `notification`)
 * accept any envelope scope, because the audience is scoped.
 */
export function decideCurationSurfaceIngest(
  surface: CurationSurface,
  envelopeScope: EnvelopePrivacyScope,
  subject: SafetySubjectRef
): SurfaceGateDecision {
  if (!CURATION_SURFACES.includes(surface)) {
    return Object.freeze({ allowed: false, reason: 'unknown-surface', surface });
  }
  if (!ENVELOPE_PRIVACY_SCOPES.includes(envelopeScope)) {
    return Object.freeze({ allowed: false, reason: 'private-envelope-scope', surface });
  }
  if (PUBLIC_CURATION_SURFACES.has(surface)) {
    if (!PUBLIC_SAFE_ENVELOPE_SCOPES.has(envelopeScope)) {
      return Object.freeze({
        allowed: false,
        reason: 'private-envelope-scope',
        surface
      });
    }
    if (PRIVATE_BY_NATURE_SUBJECTS.has(subject.type)) {
      // Per Phase 1.61 doctrine the subject's underlying block/media may
      // still be public — but our `SafetySubjectRef` doesn't carry the
      // ObjectRef privacy here, so we conservatively refuse the
      // private-by-nature *type* on public surfaces. Callers that have
      // a verified-public ObjectRef should use a different surface
      // (e.g. `community-feed`) or upgrade the subject to a non-private
      // type before re-attempting ingest.
      return Object.freeze({
        allowed: false,
        reason: 'private-by-nature-subject',
        surface
      });
    }
  }
  return Object.freeze({ allowed: true, reason: 'allowed', surface });
}

/**
 * Strict variant: throws `TS_PRIVATE_LEAK` if the ingest is refused.
 * Use this at the boundary where a refusal should be a hard error.
 */
export function assertCurationSurfaceIngest(
  surface: unknown,
  envelopeScope: unknown,
  subject: SafetySubjectRef,
  label = 'CurationSurfaceIngest'
): void {
  const s = assertSurface(surface);
  const e = assertOneOf(envelopeScope, ENVELOPE_PRIVACY_SCOPES, `${label}.envelopeScope`);
  const decision = decideCurationSurfaceIngest(s, e, subject);
  if (!decision.allowed) {
    throw tsError(
      'TS_PRIVATE_LEAK',
      `${label}: surface "${s}" cannot ingest subject (reason: ${decision.reason})`
    );
  }
}

/**
 * Phase 1.63 deferral resolution: refuse to use a report as a curation
 * signal on a public surface when the report is `private-only`. The
 * report's `classifyReportPrivacy` classification is the structural
 * gate — bridges and curation engines never have to decrypt anything
 * to make this decision.
 *
 * Returns `'allowed'` when the report may inform curation on `surface`,
 * `'refuse-private-only'` when the report is private-only and the
 * surface is public.
 */
export type ReportSignalDecision = Readonly<{
  allowed: boolean;
  reason: 'allowed' | 'private-only-report-signal';
}>;

export function decideReportAsCurationSignal(
  report: SafetyReport,
  surface: CurationSurface
): ReportSignalDecision {
  if (
    PUBLIC_CURATION_SURFACES.has(surface) &&
    classifyReportPrivacy(report) === 'private-only'
  ) {
    return Object.freeze({ allowed: false, reason: 'private-only-report-signal' });
  }
  return Object.freeze({ allowed: true, reason: 'allowed' });
}

export function assertReportAsCurationSignal(
  report: SafetyReport,
  surface: CurationSurface,
  label = 'ReportAsCurationSignal'
): void {
  const decision = decideReportAsCurationSignal(report, surface);
  if (!decision.allowed) {
    throw tsError(
      'TS_PRIVATE_LEAK',
      `${label}: surface "${surface}" cannot use private-only report as a curation signal`
    );
  }
}
