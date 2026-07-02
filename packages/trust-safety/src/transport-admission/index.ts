export {
  TRANSPORT_EVENT_KINDS,
  TRANSPORT_EVENT_VERSION,
  validateTransportEvent
} from './events.js';
export type { TransportEvent, TransportEventKind } from './events.js';

export {
  DEFAULT_RATE_LIMIT,
  createRateLimitBucket,
  tryConsume,
  validateRateLimitConfig
} from './rate-limit.js';
export type { RateLimitBucket, RateLimitConfig, RateLimitDecision } from './rate-limit.js';

export {
  DEFAULT_REPUTATION,
  applyReputationDelta,
  createReputation,
  decayReputation,
  isQuarantined,
  validateReputationConfig
} from './peer-reputation.js';
export type { PeerReputation, ReputationConfig } from './peer-reputation.js';

export {
  DEFAULT_REPLAY_CACHE,
  createReplayCache,
  pruneReplayCache,
  recordSeen,
  validateReplayCacheConfig
} from './replay-cache.js';
export type { ReplayCache, ReplayCacheConfig, ReplayResult } from './replay-cache.js';

export {
  AUDIT_ACTIONS,
  DEFAULT_AUDIT_LOG_CAPACITY,
  appendAuditEntry,
  createAuditLog,
  redactBlockRefForAudit,
  redactDigestForAudit
} from './audit.js';
export type { AuditAction, AuditAppendInput, AuditEntry, AuditLog } from './audit.js';

export {
  BRIDGE_SAFE_PRIVACY_SCOPES,
  DEFAULT_MAX_BYTES_BY_SURFACE,
  ENVELOPE_PRIVACY_SCOPES,
  MEDIA_STORE_SAFE_PRIVACY_SCOPES,
  PUBLIC_INDEX_SAFE_PRIVACY_SCOPES,
  RELAY_SAFE_PRIVACY_SCOPES,
  SUPER_PEER_SAFE_PRIVACY_SCOPES,
  runAdmissionChecks
} from './admission.js';
export type {
  AdmissionConfig,
  AdmissionContext,
  AdmissionEnvelope,
  AdmissionInputs,
  AdmissionOutputs,
  AdmissionResult,
  EnvelopePrivacyScope
} from './admission.js';

export {
  admitEnvelope,
  applyTransportEvent,
  createEmptyTransportAdmissionState,
  seedTransportAdmissionState
} from './projection.js';
export type { QuarantineRecord, TransportAdmissionState } from './projection.js';

export { decideReportForwarding } from './report-forwarding.js';
export type { ReportForwardingDecision } from './report-forwarding.js';

export { decideUserBlockTransport } from './user-block-enforcement.js';
export type {
  EnvelopeProducerContext,
  UserBlockTransportDecision
} from './user-block-enforcement.js';

// Phase 1.8.6 — bridge between the Phase 1.8.3 doctrine band table
// and the Phase 1.64 rate-limit config. Pure helper.
export { modulateRateLimitConfig, modulateDefaultRateLimit } from './reputation-modulation.js';
export type { ModulatedRateLimit } from './reputation-modulation.js';
