/**
 * Phase 1.63 deferral: when a bridge is asked to forward an envelope
 * whose payload is a `safety.report.created` event, the bridge MUST run
 * the structural privacy check before forwarding. Bridges MUST NOT
 * decrypt encrypted bodies or evidence — this check operates on the
 * declared shape only.
 *
 * The function is pure and never inspects the encrypted contents.
 */

import type { SafetyReport } from '../reports.js';
import { canBridgeForwardReport } from '../reports-appeals/privacy.js';

export type ReportForwardingDecision = Readonly<{
  shouldForward: boolean;
  reason: 'forwardable' | 'private-evidence-leak-risk';
}>;

/**
 * Returns `forwardable` when the report's declared structure is safe
 * for bridge forwarding; otherwise `private-evidence-leak-risk` (the
 * bridge MUST reject the envelope without forwarding).
 */
export function decideReportForwarding(report: SafetyReport): ReportForwardingDecision {
  if (canBridgeForwardReport(report)) {
    return Object.freeze({ shouldForward: true, reason: 'forwardable' });
  }
  return Object.freeze({
    shouldForward: false,
    reason: 'private-evidence-leak-risk'
  });
}
