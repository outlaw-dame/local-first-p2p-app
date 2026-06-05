/**
 * The admission decision engine. Given an incoming envelope and the
 * operator's projection state, run a fixed-order check pipeline and
 * produce a `TransportAdmissionDecision` plus the next projection
 * state.
 *
 * The engine is pure. No IO, no clock reads, no random sources. The
 * caller passes `now` explicitly.
 *
 * Check order matters — earlier checks short-circuit later ones:
 *
 *  1. Schema shape (caller is expected to have done envelope-level
 *     validation; we re-check envelope basics here).
 *  2. Replay / idempotency.
 *  3. Privacy scope is bridge-safe for the surface.
 *  4. Event kind is allowed at this surface.
 *  5. Byte size is within limit.
 *  6. Object/content ref structural validation.
 *  7. Peer quarantine.
 *  8. Peer rate limit.
 *  9. Recipient user-block (Phase 1.62 deferral) if recipientUserId given.
 *  10. Report-forwarding structural privacy (Phase 1.63 deferral) when
 *     the envelope carries a SafetyReport.
 */

import type { SafetyAuthority } from '../authorities.js';
import type { LocalControlState } from '../local-controls/projection.js';
import type { SafetyReasonCode } from '../reason-codes.js';
import type { SafetyReport } from '../reports.js';
import type {
  TransportAction,
  TransportAdmissionDecision,
  TransportSurface
} from '../transport-admission.js';
import { decideReportForwarding } from './report-forwarding.js';
import {
  decideUserBlockTransport,
  type EnvelopeProducerContext
} from './user-block-enforcement.js';
import type { PeerReputation, ReputationConfig } from './peer-reputation.js';
import {
  DEFAULT_REPUTATION,
  applyReputationDelta,
  decayReputation,
  isQuarantined
} from './peer-reputation.js';
import type { RateLimitBucket, RateLimitConfig } from './rate-limit.js';
import { DEFAULT_RATE_LIMIT, tryConsume } from './rate-limit.js';
import { modulateRateLimitConfig } from './reputation-modulation.js';
import type { ReplayCache, ReplayCacheConfig } from './replay-cache.js';
import { DEFAULT_REPLAY_CACHE, recordSeen } from './replay-cache.js';

/**
 * Privacy scopes the protocol envelope can carry. Mirrors the
 * `Phase 1.61` `privacy` field on a signed envelope.
 */
export const ENVELOPE_PRIVACY_SCOPES = [
  'device-local',
  'self',
  'dm',
  'group',
  'public'
] as const;
export type EnvelopePrivacyScope = (typeof ENVELOPE_PRIVACY_SCOPES)[number];

/**
 * Per-surface allowlist of which envelope privacy scopes the operator
 * may admit. Mirrors the existing bridge-safe rule (`dm`, `group`,
 * `public` for bridges) — `device-local` and `self` never traverse a
 * bridge.
 */
export const BRIDGE_SAFE_PRIVACY_SCOPES: ReadonlySet<EnvelopePrivacyScope> = new Set<EnvelopePrivacyScope>([
  'dm',
  'group',
  'public'
]);
export const RELAY_SAFE_PRIVACY_SCOPES: ReadonlySet<EnvelopePrivacyScope> = new Set<EnvelopePrivacyScope>([
  'dm',
  'group',
  'public'
]);
export const SUPER_PEER_SAFE_PRIVACY_SCOPES: ReadonlySet<EnvelopePrivacyScope> = new Set<EnvelopePrivacyScope>([
  'group',
  'public'
]);
export const PUBLIC_INDEX_SAFE_PRIVACY_SCOPES: ReadonlySet<EnvelopePrivacyScope> = new Set<EnvelopePrivacyScope>([
  'public'
]);
export const MEDIA_STORE_SAFE_PRIVACY_SCOPES: ReadonlySet<EnvelopePrivacyScope> = new Set<EnvelopePrivacyScope>([
  'dm',
  'group',
  'public'
]);

const SAFE_SCOPES_BY_SURFACE: Readonly<Record<TransportSurface, ReadonlySet<EnvelopePrivacyScope>>> = {
  bridge: BRIDGE_SAFE_PRIVACY_SCOPES,
  relay: RELAY_SAFE_PRIVACY_SCOPES,
  'super-peer': SUPER_PEER_SAFE_PRIVACY_SCOPES,
  'public-index': PUBLIC_INDEX_SAFE_PRIVACY_SCOPES,
  'media-store': MEDIA_STORE_SAFE_PRIVACY_SCOPES
};

/** Maximum byte size for an envelope at the bridge surface. Defaults. */
export const DEFAULT_MAX_BYTES_BY_SURFACE: Readonly<Record<TransportSurface, number>> = {
  bridge: 1 * 1024 * 1024,
  relay: 1 * 1024 * 1024,
  'super-peer': 8 * 1024 * 1024,
  'public-index': 64 * 1024,
  'media-store': 32 * 1024 * 1024
};

export type AdmissionConfig = Readonly<{
  surface: TransportSurface;
  operatorAuthority: SafetyAuthority;
  policyVersion: string;
  maxBytes?: number;
  rateLimit?: RateLimitConfig;
  reputation?: ReputationConfig;
  replayCache?: ReplayCacheConfig;
  /**
   * Set of allowed envelope kinds at this surface. If undefined, all
   * kinds are allowed (operator-level coarse policy). If a finite set
   * is supplied, anything outside is rejected.
   */
  allowedKinds?: ReadonlySet<string>;
}>;

/**
 * Envelope shape that the engine operates on. The caller projects an
 * incoming signed envelope into this minimal record before invoking
 * the engine. We deliberately operate on a *projection* rather than
 * the raw envelope so the engine has no side effects on the raw
 * payload.
 */
export type AdmissionEnvelope = Readonly<{
  /** Stable id used as the projection's eventId. */
  eventId: string;
  /** Idempotency key for replay detection. Distinct from eventId. */
  idempotencyKey: string;
  /** Envelope kind (e.g. `note.created`, `safety.report.created`). */
  kind: string;
  /** Envelope privacy scope. */
  privacy: EnvelopePrivacyScope;
  /** Producer actor id (signed signer). */
  producerActorId: string;
  /** Originating peer id (transport-level). */
  peerId: string;
  /** Raw byte size of the envelope (compressed). */
  byteSize: number;
  /** Optional decoded byte size, used for compression-bomb checks. */
  decodedByteSize?: number;
  /** Envelope subject for audit redaction. */
  subjectRefDisplay?: string;
  /**
   * If the envelope wraps a `safety.report.created`, the embedded
   * `SafetyReport` so the engine can run the Phase 1.63 forwarding
   * check without re-parsing the inner payload.
   */
  embeddedReport?: SafetyReport;
}>;

export type AdmissionContext = Readonly<{
  /**
   * If the envelope is being forwarded into a specific user's
   * account-local sync, the user's local-control state so the engine
   * can apply the Phase 1.62 user-block transport rule.
   */
  recipientUserLocalControlState?: LocalControlState;
  /** Recipient user id (matches the local-control state owner). */
  recipientUserId?: string;
  /**
   * Phase 1.8.6 — per-peer reputation score lookup. When supplied,
   * the rate-limit step modulates the per-peer bucket params via
   * the Phase 1.8.3 doctrine band table:
   *
   *   high       ⇒ 2.0× capacity, 2.0× refill, 0.5× base-backoff
   *   mid        ⇒ 1.0× × all (no-op)
   *   low        ⇒ 0.5× capacity, 0.5× refill, 1.5× base-backoff
   *   untrusted  ⇒ 0.25× capacity, 0.25× refill, 2.0× base-backoff
   *
   * Engine math (token bucket, exponential backoff, self-healing) is
   * UNCHANGED — only the per-peer parameters are dialed. The
   * resulting `band` is recorded in the audit log entry under
   * `reputationBand` for privacy-safe Phase 3.1 audit (band is a
   * stable string; raw score is never logged).
   *
   * Returns `undefined` when the peer is unknown to the user's
   * reputation state — the band table collapses to `'untrusted'`
   * in that case (fail-closed default).
   *
   * Default behavior (`undefined` lookup) is byte-identical to
   * pre-1.8.6 admission so existing callers see no change.
   */
  reputationScoreLookup?: (peerId: string) => number | undefined;
}>;

export type AdmissionResult = Readonly<{
  decision: TransportAdmissionDecision;
  /** True iff the decision permits forwarding. */
  admitted: boolean;
}>;

function buildDecision(
  config: AdmissionConfig,
  envelope: AdmissionEnvelope,
  action: TransportAction,
  reasonCode: SafetyReasonCode,
  now: number
): TransportAdmissionDecision {
  return Object.freeze({
    version: 'lfp2p.transport-admission-decision.v1' as const,
    decisionId: `dec_${envelope.eventId}_${now}`,
    operatorAuthority: config.operatorAuthority,
    subject: Object.freeze({
      type: 'event' as const,
      eventId: envelope.eventId
    }),
    surface: config.surface,
    action,
    reasonCode,
    policyVersion: config.policyVersion,
    createdAt: new Date(now).toISOString()
  });
}

/**
 * The decision engine itself. Returns the admission decision, the
 * updated rate-limit bucket for the peer, the updated reputation, and
 * the updated replay cache.
 *
 * The signature is intentionally verbose: every piece of mutable
 * projection state appears in both the input and the output so the
 * caller has no implicit globals.
 */
export type AdmissionInputs = Readonly<{
  config: AdmissionConfig;
  envelope: AdmissionEnvelope;
  context?: AdmissionContext;
  rateLimitBucket: RateLimitBucket;
  reputation: PeerReputation;
  replayCache: ReplayCache;
  now: number;
}>;

export type AdmissionOutputs = Readonly<{
  result: AdmissionResult;
  rateLimitBucket: RateLimitBucket;
  reputation: PeerReputation;
  replayCache: ReplayCache;
  /**
   * Phase 1.8.6 — privacy-safe stable string identifying which
   * reputation band this peer fell into for the rate-limit check.
   * `undefined` when no `context.reputationScoreLookup` was wired —
   * matches pre-1.8.6 behavior. Per Phase 3.1: the raw score is
   * NEVER logged; this stable string is sufficient for audit.
   */
  reputationBand?: 'high' | 'mid' | 'low' | 'untrusted';
}>;

export function runAdmissionChecks(inputs: AdmissionInputs): AdmissionOutputs {
  const { config, envelope, context } = inputs;
  const rateConfig = config.rateLimit ?? DEFAULT_RATE_LIMIT;

  // Phase 1.8.6 — compute the per-peer modulated rate-limit config
  // ONCE so every return path (early reject / rate-limit / admit)
  // reports the same band. When no lookup is wired, `reputationBand`
  // is undefined and the engine sees byte-identical behavior.
  let effectiveRateConfig = rateConfig;
  let reputationBand: AdmissionOutputs['reputationBand'];
  if (context?.reputationScoreLookup !== undefined) {
    const score = context.reputationScoreLookup(envelope.peerId);
    const modulated = modulateRateLimitConfig(rateConfig, score);
    effectiveRateConfig = modulated.config;
    reputationBand = modulated.band;
  }

  const raw = runAdmissionChecksInner(inputs, effectiveRateConfig);
  // Defense-in-depth: only attach the band when set so existing
  // callers see byte-identical structures otherwise.
  if (reputationBand === undefined) return raw;
  return Object.freeze({ ...raw, reputationBand });
}

function runAdmissionChecksInner(
  inputs: AdmissionInputs,
  effectiveRateConfig: RateLimitConfig
): AdmissionOutputs {
  const { config, envelope, context, now } = inputs;
  const repConfig = config.reputation ?? DEFAULT_REPUTATION;
  const replayConfig = config.replayCache ?? DEFAULT_REPLAY_CACHE;
  const maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES_BY_SURFACE[config.surface];

  // 1. Schema shape — envelope fields are typed; we sanity-check basics.
  if (envelope.byteSize < 0 || !Number.isFinite(envelope.byteSize)) {
    return outputsFor(inputs, 'reject', 'system.malformed-object');
  }

  // 2. Replay detection.
  const replayResult = recordSeen(inputs.replayCache, envelope.idempotencyKey, now, replayConfig);
  if (replayResult.outcome === 'duplicate') {
    return outputsFor(
      { ...inputs, replayCache: replayResult.cache },
      'drop-duplicate',
      'system.replay'
    );
  }
  const replayCache = replayResult.cache;

  // 3. Privacy scope at this surface.
  const safeScopes = SAFE_SCOPES_BY_SURFACE[config.surface];
  if (!safeScopes.has(envelope.privacy)) {
    const out = applyReputationDelta(
      inputs.reputation,
      -10,
      now,
      `disallowed-scope:${envelope.privacy}`,
      repConfig
    );
    return makeOutputs(
      buildDecision(config, envelope, 'reject', 'system.disallowed-scope', now),
      false,
      inputs.rateLimitBucket,
      out,
      replayCache
    );
  }

  // 4. Event kind allowlist.
  if (config.allowedKinds !== undefined && !config.allowedKinds.has(envelope.kind)) {
    const out = applyReputationDelta(
      inputs.reputation,
      -5,
      now,
      `disallowed-kind:${envelope.kind}`,
      repConfig
    );
    return makeOutputs(
      buildDecision(config, envelope, 'reject', 'system.malformed-object', now),
      false,
      inputs.rateLimitBucket,
      out,
      replayCache
    );
  }

  // 5. Byte limits.
  if (envelope.byteSize > maxBytes) {
    const out = applyReputationDelta(
      inputs.reputation,
      -25,
      now,
      `oversized:${envelope.byteSize}`,
      repConfig
    );
    return makeOutputs(
      buildDecision(config, envelope, 'reject', 'system.malformed-object', now),
      false,
      inputs.rateLimitBucket,
      out,
      replayCache
    );
  }

  // 6. Decoded-size guard (compression bomb) — opportunistic; caller
  //    provides the decoded size if known.
  if (
    envelope.decodedByteSize !== undefined &&
    envelope.decodedByteSize > maxBytes * 1024
  ) {
    const out = applyReputationDelta(
      inputs.reputation,
      -100,
      now,
      'compression-bomb',
      repConfig
    );
    return makeOutputs(
      buildDecision(config, envelope, 'reject', 'system.malformed-object', now),
      false,
      inputs.rateLimitBucket,
      out,
      replayCache
    );
  }

  // 7. Peer quarantine — refuses traffic from quarantined peers.
  const decayed = decayReputation(inputs.reputation, now, repConfig);
  if (isQuarantined(decayed, now)) {
    return makeOutputs(
      buildDecision(config, envelope, 'reject', 'system.disallowed-scope', now),
      false,
      inputs.rateLimitBucket,
      decayed,
      replayCache
    );
  }

  // 8. Rate limit. The `effectiveRateConfig` already accounts for
  // any per-peer modulation computed at function entry (Phase
  // 1.8.6).
  const rl = tryConsume(inputs.rateLimitBucket, now, effectiveRateConfig);
  if (!rl.allowed) {
    const out = applyReputationDelta(decayed, -10, now, 'rate-limit', repConfig);
    return makeOutputs(
      buildDecision(config, envelope, 'rate-limit', 'system.rate-limit', now),
      false,
      rl.bucket,
      out,
      replayCache
    );
  }

  // 9. User-block transport rule (Phase 1.62 deferral).
  if (
    context !== undefined &&
    context.recipientUserLocalControlState !== undefined &&
    context.recipientUserId !== undefined
  ) {
    const producerCtx: EnvelopeProducerContext = {
      producerActorId: envelope.producerActorId,
      recipientUserId: context.recipientUserId
    };
    const userBlock = decideUserBlockTransport(
      context.recipientUserLocalControlState,
      producerCtx,
      now
    );
    if (userBlock.shouldReject) {
      // No reputation penalty — the producer isn't necessarily abusive;
      // they're just blocked by this recipient.
      return makeOutputs(
        buildDecision(config, envelope, 'reject', 'policy.local-preference', now),
        false,
        rl.bucket,
        decayed,
        replayCache
      );
    }
  }

  // 10. Report-forwarding privacy structural check (Phase 1.63 deferral).
  if (envelope.embeddedReport !== undefined) {
    const fwd = decideReportForwarding(envelope.embeddedReport);
    if (!fwd.shouldForward) {
      return makeOutputs(
        buildDecision(config, envelope, 'reject', 'system.malformed-object', now),
        false,
        rl.bucket,
        decayed,
        replayCache
      );
    }
  }

  // Successful admission. Small reputation credit for the peer.
  const reputation = applyReputationDelta(decayed, 1, now, 'admitted', repConfig);
  return makeOutputs(
    buildDecision(config, envelope, 'accept', 'policy.local-preference', now),
    true,
    rl.bucket,
    reputation,
    replayCache
  );
}

function makeOutputs(
  decision: TransportAdmissionDecision,
  admitted: boolean,
  rateLimitBucket: AdmissionInputs['rateLimitBucket'],
  reputation: AdmissionInputs['reputation'],
  replayCache: AdmissionInputs['replayCache'],
  reputationBand?: AdmissionOutputs['reputationBand']
): AdmissionOutputs {
  return Object.freeze({
    result: Object.freeze({ decision, admitted }),
    rateLimitBucket,
    reputation,
    replayCache,
    ...(reputationBand === undefined ? {} : { reputationBand })
  });
}

function outputsFor(
  inputs: AdmissionInputs,
  action: TransportAction,
  reasonCode: SafetyReasonCode,
  reputationBand?: AdmissionOutputs['reputationBand']
): AdmissionOutputs {
  return makeOutputs(
    buildDecision(inputs.config, inputs.envelope, action, reasonCode, inputs.now),
    action === 'accept' || action === 'accept-limited',
    inputs.rateLimitBucket,
    inputs.reputation,
    inputs.replayCache,
    reputationBand
  );
}
