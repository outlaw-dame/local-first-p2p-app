import { tsError } from '../errors.js';
import {
  withFrozenAppliedEventId as withAppliedEventId,
  withFrozenRecordSet as withRecordSet
} from '../projection-helpers.js';
import {
  type AuditLog,
  appendAuditEntry,
  createAuditLog,
  redactBlockRefForAudit,
  redactDigestForAudit
} from './audit.js';
import {
  type AdmissionConfig,
  type AdmissionContext,
  type AdmissionEnvelope,
  type AdmissionResult,
  runAdmissionChecks
} from './admission.js';
import {
  type PeerReputation,
  applyReputationDelta,
  createReputation,
  decayReputation,
  isQuarantined
} from './peer-reputation.js';
import {
  type RateLimitBucket,
  createRateLimitBucket
} from './rate-limit.js';
import {
  type ReplayCache,
  createReplayCache
} from './replay-cache.js';
import {
  type TransportEvent,
  validateTransportEvent
} from './events.js';

export type QuarantineRecord = Readonly<{
  since: string;
  expiresAt?: string;
  reasonCode: string;
}>;

/**
 * Frozen state for one operator's admission policy. Stores per-peer
 * reputation, rate-limit buckets, the replay cache, quarantine indexes
 * for peers / events / media, and the redacted audit log.
 *
 * Per-peer indexes are keyed by `peerId`. Per-event indexes are keyed
 * by the envelope's `eventId`. Per-media indexes are keyed by the
 * BlockRef's source-digest body (already a base64url-safe string) — we
 * do not key by the full digest object to keep the index serializable
 * and stable across restarts.
 */
export type TransportAdmissionState = Readonly<{
  peerReputation: Readonly<Record<string, PeerReputation>>;
  rateLimitState: Readonly<Record<string, RateLimitBucket>>;
  replayCache: ReplayCache;
  quarantinedPeers: Readonly<Record<string, QuarantineRecord>>;
  quarantinedEvents: Readonly<Record<string, QuarantineRecord>>;
  quarantinedMedia: Readonly<Record<string, QuarantineRecord>>;
  auditLog: AuditLog;
  appliedEventIds: ReadonlySet<string>;
}>;

export function createEmptyTransportAdmissionState(): TransportAdmissionState {
  return Object.freeze({
    peerReputation: Object.freeze({}),
    rateLimitState: Object.freeze({}),
    replayCache: createReplayCache(),
    quarantinedPeers: Object.freeze({}),
    quarantinedEvents: Object.freeze({}),
    quarantinedMedia: Object.freeze({}),
    auditLog: createAuditLog(),
    appliedEventIds: Object.freeze(new Set<string>())
  });
}

// Defensive Record helpers live in `../projection-helpers.js` (imported
// at top of file).

function mediaKey(digestAlgorithm: string, digestBody: string): string {
  return `${digestAlgorithm}:${digestBody}`;
}

// --- Admission entrypoint ----------------------------------------------

/**
 * The primary admission entrypoint. Given the operator's current state
 * and an incoming envelope, run the check pipeline and return:
 *
 *  - `nextState`: the new projection state (rate-limit / reputation /
 *    replay updates), regardless of accept/reject.
 *  - `result`: the produced `TransportAdmissionDecision` plus an
 *    `admitted` boolean.
 *
 * Pure. The caller persists `nextState` and emits the transport event
 * corresponding to the decision (via `applyTransportEvent`).
 */
export function admitEnvelope(
  state: TransportAdmissionState,
  envelope: AdmissionEnvelope,
  config: AdmissionConfig,
  context: AdmissionContext | undefined,
  now: number
): Readonly<{ nextState: TransportAdmissionState; result: AdmissionResult }> {
  const peerBucket =
    state.rateLimitState[envelope.peerId] ?? createRateLimitBucket(now, config.rateLimit);
  const peerRep =
    state.peerReputation[envelope.peerId] ?? createReputation(now);

  const baseInputs = {
    config,
    envelope,
    rateLimitBucket: peerBucket,
    reputation: peerRep,
    replayCache: state.replayCache,
    now
  };
  const outputs = runAdmissionChecks(
    context !== undefined ? { ...baseInputs, context } : baseInputs
  );

  // Subject ref for audit redaction — never logs full digests.
  let subjectRef: string | undefined;
  if (envelope.embeddedReport !== undefined) {
    // Reports: log the targeted authority id (already non-sensitive) only.
    subjectRef = `report:${envelope.embeddedReport.targetAuthority.authorityId}`;
  } else if (envelope.subjectRefDisplay !== undefined) {
    subjectRef = envelope.subjectRefDisplay.slice(0, 256);
  } else {
    subjectRef = `event:${envelope.eventId.slice(0, 12)}…`;
  }

  const auditLog = appendAuditEntry(
    state.auditLog,
    {
      operatorAuthorityId: config.operatorAuthority.authorityId,
      surface: config.surface,
      action: outputs.result.decision.action,
      reasonCode: outputs.result.decision.reasonCode,
      peerId: envelope.peerId,
      subjectRef
    },
    now,
    [outputs.result.decision.reasonCode]
  );

  // If the post-decision reputation crosses into quarantine, record it.
  let quarantinedPeers = state.quarantinedPeers;
  if (
    isQuarantined(outputs.reputation, now) &&
    quarantinedPeers[envelope.peerId] === undefined
  ) {
    const quarantineExpiresAt = outputs.reputation.quarantineUntil;
    const record: QuarantineRecord =
      quarantineExpiresAt !== undefined
        ? Object.freeze({
            since: new Date(now).toISOString(),
            expiresAt: new Date(quarantineExpiresAt).toISOString(),
            reasonCode: outputs.result.decision.reasonCode
          })
        : Object.freeze({
            since: new Date(now).toISOString(),
            reasonCode: outputs.result.decision.reasonCode
          });
    quarantinedPeers = withRecordSet(quarantinedPeers, envelope.peerId, record);
  }

  const nextState: TransportAdmissionState = Object.freeze({
    ...state,
    peerReputation: withRecordSet(state.peerReputation, envelope.peerId, outputs.reputation),
    rateLimitState: withRecordSet(state.rateLimitState, envelope.peerId, outputs.rateLimitBucket),
    replayCache: outputs.replayCache,
    quarantinedPeers,
    auditLog
  });

  return Object.freeze({ nextState, result: outputs.result });
}

// --- Transport-event apply ---------------------------------------------

/**
 * Apply a `TransportEvent` to the projection. Used for downstream
 * persistence of decisions that the bridge has already made, and for
 * rebuilds from an event log.
 */
export function applyTransportEvent(
  state: TransportAdmissionState,
  event: TransportEvent | unknown,
  now: number,
  label = 'applyTransportEvent'
): TransportAdmissionState {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    throw tsError('TS_INVALID_INPUT', `${label}: event must be a plain object`);
  }
  const e = validateTransportEvent(event, label);
  if (state.appliedEventIds.has(e.eventId)) return state;
  const appliedEventIds = withAppliedEventId(state.appliedEventIds, e.eventId);

  switch (e.kind) {
    case 'transport.event.accepted': {
      return Object.freeze({ ...state, appliedEventIds });
    }
    case 'transport.event.rejected': {
      return Object.freeze({ ...state, appliedEventIds });
    }
    case 'transport.event.quarantined': {
      // Record an event-level quarantine keyed by the decision's subject eventId.
      const subject = e.decision.subject;
      if (subject.type !== 'event') {
        return Object.freeze({ ...state, appliedEventIds });
      }
      const record: QuarantineRecord = e.quarantineExpiresAt !== undefined
        ? Object.freeze({
            since: e.createdAt,
            expiresAt: e.quarantineExpiresAt,
            reasonCode: e.decision.reasonCode
          })
        : Object.freeze({
            since: e.createdAt,
            reasonCode: e.decision.reasonCode
          });
      return Object.freeze({
        ...state,
        quarantinedEvents: withRecordSet(state.quarantinedEvents, subject.eventId, record),
        appliedEventIds
      });
    }
    case 'transport.peer.rate_limited': {
      const rep =
        state.peerReputation[e.peerId] ?? createReputation(Date.parse(e.createdAt) || now);
      const next = applyReputationDelta(
        rep,
        -10,
        Date.parse(e.createdAt) || now,
        'rate-limit-event',
        undefined
      );
      return Object.freeze({
        ...state,
        peerReputation: withRecordSet(state.peerReputation, e.peerId, next),
        appliedEventIds
      });
    }
    case 'transport.peer.quarantined': {
      const record: QuarantineRecord = e.quarantineExpiresAt !== undefined
        ? Object.freeze({
            since: e.createdAt,
            expiresAt: e.quarantineExpiresAt,
            reasonCode: e.reasonCode
          })
        : Object.freeze({
            since: e.createdAt,
            reasonCode: e.reasonCode
          });
      // Also push score below the quarantine threshold so the engine
      // continues to refuse traffic until reputation recovers.
      const rep =
        state.peerReputation[e.peerId] ?? createReputation(Date.parse(e.createdAt) || now);
      const decayed = decayReputation(rep, Date.parse(e.createdAt) || now, undefined);
      const next = applyReputationDelta(
        decayed,
        -500 - decayed.score,
        Date.parse(e.createdAt) || now,
        'quarantine-event',
        undefined
      );
      return Object.freeze({
        ...state,
        quarantinedPeers: withRecordSet(state.quarantinedPeers, e.peerId, record),
        peerReputation: withRecordSet(state.peerReputation, e.peerId, next),
        appliedEventIds
      });
    }
    case 'transport.media.rejected': {
      // Index by the media's source digest if available.
      let key: string | undefined;
      if (e.blockRef.source.kind === 'digest') {
        key = mediaKey(e.blockRef.source.digest.algorithm, e.blockRef.source.digest.digest);
      } else {
        key = `cid:${e.blockRef.source.link.codec}:${e.blockRef.source.link.cid}`;
      }
      const record: QuarantineRecord = Object.freeze({
        since: e.createdAt,
        reasonCode: e.reasonCode
      });
      return Object.freeze({
        ...state,
        quarantinedMedia: withRecordSet(state.quarantinedMedia, key, record),
        appliedEventIds
      });
    }
  }
}

/**
 * Replay a sequence of transport events from empty state. Equivalent to
 * a left fold of `applyTransportEvent`. Provides the canonical
 * store-reopen rebuild path.
 */
export function seedTransportAdmissionState(
  events: Iterable<TransportEvent | unknown>,
  now: number,
  label = 'seedTransportAdmissionState'
): TransportAdmissionState {
  let state = createEmptyTransportAdmissionState();
  let i = 0;
  for (const event of events) {
    state = applyTransportEvent(state, event, now, `${label}[${i}]`);
    i += 1;
  }
  return state;
}

// Re-exports for backwards-compatible imports.
export { redactBlockRefForAudit, redactDigestForAudit };
