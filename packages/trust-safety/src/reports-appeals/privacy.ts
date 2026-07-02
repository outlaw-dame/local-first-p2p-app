import type { BlockRef, ObjectRef } from '@lfp2p/content-addressing';
import { tsError } from '../errors.js';
import type { SafetyReport } from '../reports.js';
import { PRIVATE_BY_NATURE_SUBJECTS } from '../subjects.js';

/**
 * Privacy classification for a report's downstream routing.
 *
 *  - `public-routable`: the report's subject is not private-by-nature
 *    (e.g. a public event id, an actor id, a domain). The report may
 *    be routed to any authority whose scope accepts it; public labelers
 *    may consume it within the scope rules in the T&S event policy.
 *  - `private-only`: the report's subject is private-by-nature
 *    (`blob`, `media`, `thread`). The report must stay scoped to the
 *    target authority and must not enter public label/search/curation
 *    flows.
 */
export type ReportRoutingPrivacy = 'public-routable' | 'private-only';

export function classifyReportPrivacy(report: SafetyReport): ReportRoutingPrivacy {
  return PRIVATE_BY_NATURE_SUBJECTS.has(report.subject.type) ? 'private-only' : 'public-routable';
}

/**
 * Walk all evidence object refs on a report and assert that any
 * content-bearing evidence (media or bundle ObjectRefs) targets
 * encrypted private content when the subject is private-by-nature.
 *
 * Rules:
 *  - When `classifyReportPrivacy(report) === 'private-only'`:
 *    - every `evidenceRefs[i]` of kind `media` must reference a
 *      `BlockRef` with `privacy === 'private'` and a defined
 *      `encryption` descriptor.
 *    - every `evidenceRefs[i]` of kind `bundle` must have its
 *      BundleRef `encrypted === true`.
 *    - the optional `encryptedBodyRef` may be absent (no body) but if
 *      present it must be of a content-bearing kind, not an identity
 *      kind (actor / community / infrastructure / url / domain).
 *  - When `classifyReportPrivacy(report) === 'public-routable'`:
 *    - no extra constraint here. The subject's privacy doctrine in the
 *      Phase 1.61 validator (`TS_PRIVATE_LEAK` on private subject +
 *      public scope) already governs this.
 *
 * Throws `TS_PRIVATE_LEAK` on violation; the projection rejects the
 * underlying `safety.report.created` event before mutating state.
 */
export function assertPrivateEvidenceOnPrivateSubject(
  report: SafetyReport,
  label = 'SafetyReport'
): void {
  if (classifyReportPrivacy(report) !== 'private-only') return;

  if (report.encryptedBodyRef !== undefined) {
    assertContentBearingEvidenceRef(report.encryptedBodyRef, `${label}.encryptedBodyRef`);
  }

  if (report.evidenceRefs === undefined) return;
  for (let i = 0; i < report.evidenceRefs.length; i += 1) {
    const ref = report.evidenceRefs[i];
    if (ref === undefined) continue;
    assertEvidenceRefEncryption(ref, `${label}.evidenceRefs[${i}]`);
  }
}

function assertContentBearingEvidenceRef(ref: ObjectRef, label: string): void {
  if (ref.kind === 'actor' || ref.kind === 'community' || ref.kind === 'infrastructure') {
    throw tsError(
      'TS_PRIVATE_LEAK',
      `${label}: identity-kind ObjectRef (${ref.kind}) cannot carry a private report body`
    );
  }
}

function assertEvidenceRefEncryption(ref: ObjectRef, label: string): void {
  if (ref.kind === 'media') {
    assertBlockRefEncrypted(ref.block, `${label}.block`);
    return;
  }
  if (ref.kind === 'bundle') {
    if (ref.bundle.encrypted !== true) {
      throw tsError(
        'TS_PRIVATE_LEAK',
        `${label}: bundle evidence on a private-subject report must have bundle.encrypted=true`
      );
    }
    return;
  }
  // event / record / safety-label / report / policy-decision refs reference a
  // digest only; encryption belongs to the underlying envelope (ADR-002)
  // and is not visible at this layer. Identity / url / domain refs are
  // not content-bearing and pass through.
}

function assertBlockRefEncrypted(block: BlockRef, label: string): void {
  if (block.privacy !== 'private') {
    throw tsError(
      'TS_PRIVATE_LEAK',
      `${label}: media evidence on a private-subject report must have privacy="private"`
    );
  }
  if (block.encryption === undefined) {
    throw tsError(
      'TS_PRIVATE_LEAK',
      `${label}: media evidence on a private-subject report must declare an encryption descriptor`
    );
  }
}

/**
 * Structural pre-check used by Phase 1.64 bridge admission code. A
 * bridge may forward a report iff:
 *
 *  - The report passes shape validation (already done by
 *    `validateSafetyReport`).
 *  - If the report's subject is private-by-nature, the bridge MUST NOT
 *    inspect any evidence body and MAY only forward the package
 *    unchanged. This function does not decrypt anything; it merely
 *    confirms the *structure* permits opaque forwarding.
 *
 * Returns `true` when the structure is safe for bridge forwarding.
 * Returns `false` when the report's evidence would require the bridge
 * to either decrypt content or expose private structure publicly
 * (e.g. a private-subject report whose evidence is a public bundle).
 */
export function canBridgeForwardReport(report: SafetyReport): boolean {
  try {
    assertPrivateEvidenceOnPrivateSubject(report);
    return true;
  } catch {
    return false;
  }
}
