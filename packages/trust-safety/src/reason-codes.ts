/**
 * Initial set of stable reason codes for reports and policy decisions.
 *
 * The list intentionally errs toward structured, neutral codes rather
 * than free-form text — both for analytics privacy (no inadvertent PII
 * in reason text) and for cross-jurisdiction interoperability. Free-form
 * reasoning, when needed, belongs in encrypted body fields, not reason
 * code strings.
 */
export const SAFETY_REASON_CODES = [
  'abuse.harassment',
  'abuse.threats',
  'abuse.hate-speech',
  'abuse.doxxing',
  'security.malware',
  'security.phishing',
  'security.account-compromise',
  'security.spam',
  'security.scam',
  'media-safety.csam',
  'media-safety.violent-imagery',
  'media-safety.self-harm',
  'media-safety.adult-explicit',
  'media-safety.gore',
  'legal-risk.copyright',
  'legal-risk.trademark',
  'legal-risk.illegal-content',
  'legal-risk.terrorism',
  'quality.duplicate',
  'quality.off-topic',
  'quality.low-effort',
  'context.unverified-claim',
  'context.misleading-edit',
  'context.misattribution',
  'system.replay',
  'system.rate-limit',
  'system.invalid-signature',
  'system.disallowed-scope',
  'system.unsupported-version',
  'system.malformed-object',
  'policy.community-rule',
  'policy.local-preference',
  'other'
] as const;
export type SafetyReasonCode = (typeof SAFETY_REASON_CODES)[number];
