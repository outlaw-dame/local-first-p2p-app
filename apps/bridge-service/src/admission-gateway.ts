/**
 * Phase 4.1 — Bridge admission gateway.
 *
 * Wires the existing Phase 1.64 trust-safety transport-admission
 * engine into `BridgeService.acceptDelivery`. The engine, its
 * fixtures, and its adversarial tests already exist. This module is
 * the integration layer: it projects an incoming `BridgeDeliveryRequest`
 * into the engine's `AdmissionEnvelope` shape, calls `admitEnvelope`,
 * maps the resulting `TransportAdmissionDecision.action` back into
 * the bridge's `accept | reject | drop-duplicate | quarantine`
 * vocabulary, and threads the updated `TransportAdmissionState`
 * forward.
 *
 * Design discipline:
 *
 *  - The gateway is OPT-IN. A `BridgeService` constructed without
 *    `admission` continues to behave exactly as before — every
 *    existing test passes unmodified. Production wiring is expected
 *    to supply a real `AdmissionConfig` per the bridge-admission
 *    doctrine.
 *
 *  - The gateway holds a mutable reference to the latest
 *    `TransportAdmissionState`. The state ITSELF is frozen (per
 *    Phase 3.2.A invariant 2) and only ever replaced wholesale; the
 *    reference moves forward atomically with each admission
 *    decision. No partial-state observability is possible.
 *
 *  - The byte-size estimate uses `TextEncoder` over the canonical
 *    JSON representation of the envelope. It is an UPPER BOUND on
 *    the on-wire byte size for any concrete transport (HTTP/JSON,
 *    WebSocket text frames). A future binary transport may report a
 *    tighter measurement via the optional `byteSize` accessor.
 *
 *  - Privacy-safe logging (Phase 3.1): the gateway never logs the
 *    envelope payload, the signature, or the peer's IP. Audit
 *    entries flow through the engine's existing
 *    `redactDigestForAudit` discipline.
 *
 *  - Failure semantics: a thrown error inside `admitEnvelope` is
 *    propagated upward. The gateway never silently swallows admission
 *    errors. This matches the doctrine that admission MUST fail
 *    closed.
 */
import type { SignedEventEnvelope } from '@lfp2p/protocol';
import {
  admitEnvelope,
  createEmptyTransportAdmissionState,
  decideUserBlockTransport,
  decideReportForwarding,
  TRANSPORT_ADMISSION_DECISION_VERSION,
  type AdmissionConfig,
  type AdmissionContext,
  type AdmissionEnvelope,
  type AdmissionResult,
  type LabelersState,
  type LocalControlState,
  type ReportAppealEvent,
  type TransportAdmissionDecision,
  type TransportAdmissionState
} from '@lfp2p/trust-safety';

import type { AdmissionStateStore } from './admission-state-store.js';
import type { BridgeDeliveryRequest } from './types.js';
import type { PolicySubscriptionRuntime } from './policy-subscription.js';

// ---------------------------------------------------------------------------
// acceptReportDelivery types (Check #10 type contract)
// ---------------------------------------------------------------------------

export type ReportDeliveryRequest = Readonly<{
  envelope: ReportAppealEvent;
  /** Estimated byte size of the serialized envelope for the size cap. */
  byteSize?: number;
}>;

export type ReportDeliveryResult =
  | Readonly<{ status: 'accepted' }>
  | Readonly<{ status: 'rejected'; reason: string }>;

// ---------------------------------------------------------------------------
// Gateway options
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase 4.6 — Advisory reputation feed types
// ---------------------------------------------------------------------------

export type AdvisoryReputationEntry = Readonly<{
  peerId: string;
  /** Advisory reputation score, clamped to [-1, 1] on ingest. */
  score: number;
  /** ISO-8601 instant of the advisory score. Used for 24 h TTL pruning. */
  updatedAt: string;
  /** Bridge operator identity that sourced this advisory (not an actorId). */
  sourceId: string;
}>;

// ---------------------------------------------------------------------------
// Phase 4.6 — Appeal hook type
// ---------------------------------------------------------------------------

/**
 * Fires after a `reject` or `quarantine` outcome for kinds in
 * `appealableKinds`. Fire-and-forget: the hook never delays the
 * admission response and a throwing hook does NOT reverse the decision.
 */
export type AppealHook = (decision: TransportAdmissionDecision) => Promise<void>;

// ---------------------------------------------------------------------------
// Gateway options
// ---------------------------------------------------------------------------

export type AdmissionGatewayOptions = Readonly<{
  config: AdmissionConfig;
  initialState?: TransportAdmissionState;
  /**
   * Phase 4.2 — optional persistent state store. When set, every
   * successful `admit` call writes the new state via
   * `stateStore.save(state)` BEFORE returning the result. A save
   * failure throws and the in-memory state DOES NOT advance — the
   * gateway fail-closes so the bridge wraps it in a rejection
   * response rather than silently losing the durable abuse-resistance
   * record.
   *
   * Use `BridgeAdmissionGateway.create({...})` to construct a
   * gateway that pre-loads any persisted state on startup. The plain
   * constructor does NOT auto-load; pass `initialState` if you have
   * pre-loaded state synchronously.
   */
  stateStore?: AdmissionStateStore;
  /**
   * Phase 4.5 — optional lookup for check #9 (`decideUserBlockTransport`).
   * When set AND `BridgeDeliveryRequest.recipientActorId` is present, the
   * gateway looks up the recipient's local-control state and rejects
   * deliveries whose producer is in the recipient's blocked-actors set.
   *
   * This is OPT-IN: omitting it skips check #9 entirely and the
   * admission output is byte-identical to pre-Phase-4.5 for callers
   * that do not wire the lookup.
   *
   * The lookup result is NEVER stored in the audit log — it is local-
   * policy state, not a bridge-level decision. The rejection reason
   * `policy.local-preference` is stable and audit-safe.
   */
  localControlStateLookup?: (recipientActorId: string) => LocalControlState | undefined;
  /**
   * Phase 4.6 — optional policy subscription runtime for check #8.5.
   * When set, after the rate-limit check (#8) and before the user-block
   * check (#9), the gateway calls
   * `policyRuntime.checkProducerLabels(producerActorId)`. A
   * `hard-safety` label from a listed labeler rejects with
   * `policy.operator-label` and no reputation penalty.
   */
  policyRuntime?: PolicySubscriptionRuntime;
  /**
   * Phase 4.6 — advisory reputation TTL in milliseconds.
   * Advisory entries older than this are dropped on ingest and evicted
   * by the periodic background timer. Default: 24 hours.
   */
  advisoryTtlMs?: number;
  /**
   * Phase 4.6 — appeal hook trigger kinds. When set, the appeal hook
   * fires for `reject` / `quarantine` outcomes whose envelope kind is in
   * this set. Default: empty set (no hooks fired).
   */
  appealableKinds?: ReadonlySet<string>;
}>;

export type AdmissionGatewayDecision = Readonly<{
  result: AdmissionResult;
  /** A reason string suitable for inclusion in a delivery rejection. */
  reason: string;
}>;

/**
 * Encoded byte-size estimate. Public for tests so the byte cap can
 * be exercised deterministically.
 */
export function estimateEnvelopeByteSize(event: SignedEventEnvelope): number {
  // TextEncoder gives the UTF-8 byte length of the canonical JSON
  // serialization. It is an upper bound for any text-frame transport
  // (HTTP/JSON, WebSocket text) and a tight bound for length-prefixed
  // binary frames that ship JSON.
  return new TextEncoder().encode(JSON.stringify(event)).length;
}

function buildAdmissionEnvelope(request: BridgeDeliveryRequest): AdmissionEnvelope {
  const event = request.event;
  // `peerId` falls back to `deviceId`. We document the fallback
  // openly because production wiring SHOULD supply a transport-level
  // peer identifier and the engine's per-peer reputation only
  // matters when distinct peers map to distinct identifiers.
  const peerId =
    request.peerId !== undefined && request.peerId.length > 0 ? request.peerId : event.deviceId;

  // NOTE: `safety.report.created` is NOT a `SignedEventEnvelope`
  // kind today — reports ride the separate `ReportAppealEvent`
  // envelope family (`lfp2p.report-appeal-event.v1`) and are not
  // delivered through this bridge surface. The admission engine's
  // Phase 1.63 forwarding check (`decideReportForwarding`) becomes
  // wireable here when a future bridge slice opens a report
  // delivery surface; until then `embeddedReport` is left
  // unpopulated and the engine's other checks (byte cap, privacy
  // scope, rate limit, replay) cover the bridge envelopes that DO
  // come through.
  return {
    eventId: event.eventId,
    idempotencyKey: request.idempotencyKey,
    kind: event.kind,
    privacy: event.privacy,
    producerActorId: event.author,
    peerId,
    byteSize: estimateEnvelopeByteSize(event)
  };
}

/**
 * The gateway holds the latest `TransportAdmissionState` and exposes
 * an `admit` method that the BridgeService calls before storing a
 * delivery.
 *
 * Concurrency note: a single BridgeService instance is assumed to
 * process delivery requests sequentially. If a future runtime
 * introduces concurrent delivery handling on the same instance, the
 * caller MUST wrap `admit` with a lock; otherwise two concurrent
 * deliveries might both observe the same pre-mutation state and one
 * of their rate-limit / replay-cache updates would be lost on the
 * final assignment.
 */
// Per-source score record stored per (peerId, sourceId) pair.
type AdvisorySourceRecord = Readonly<{ score: number; updatedAt: number }>;

// Effective advisory score for a peer — minimum score across all live sources.
type AdvisoryPeerRecord = Readonly<{
  /** Effective score: minimum across all live (non-stale) sources for this peer. */
  score: number;
  /** Epoch ms of the most recent advisory entry for this peer (across all sources). */
  updatedAt: number;
}>;

const DEFAULT_ADVISORY_TTL_MS = 24 * 60 * 60 * 1_000; // 24 h
const ADVISORY_EVICTION_INTERVAL_MS = 6 * 60 * 60 * 1_000; // 6 h

export class BridgeAdmissionGateway {
  #config: AdmissionConfig;
  readonly #stateStore: AdmissionStateStore | undefined;
  readonly #localControlStateLookup:
    | ((recipientActorId: string) => LocalControlState | undefined)
    | undefined;
  #state: TransportAdmissionState;

  // Phase 4.6 — policy subscription runtime (check #8.5)
  readonly #policyRuntime: PolicySubscriptionRuntime | undefined;

  // Phase 4.6 — advisory reputation.
  // Per-source tracking enables correct score retraction when a source updates.
  // Effective score (minimum across live sources) is kept in #advisoryScores for O(1) lookup.
  #advisorySourceScores: Map<string, Map<string, AdvisorySourceRecord>>;
  #advisoryScores: Map<string, AdvisoryPeerRecord>;
  readonly #advisoryTtlMs: number;
  readonly #advisoryEvictionTimer: ReturnType<typeof setInterval> | undefined;

  // Phase 4.6 — appeal hooks
  readonly #appealHooks: AppealHook[];
  readonly #appealableKinds: ReadonlySet<string>;

  constructor(options: AdmissionGatewayOptions) {
    this.#config = options.config;
    this.#stateStore = options.stateStore;
    this.#localControlStateLookup = options.localControlStateLookup;
    this.#state = options.initialState ?? createEmptyTransportAdmissionState();
    this.#policyRuntime = options.policyRuntime;
    this.#advisorySourceScores = new Map();
    this.#advisoryScores = new Map();
    this.#advisoryTtlMs = options.advisoryTtlMs ?? DEFAULT_ADVISORY_TTL_MS;
    this.#appealHooks = [];
    this.#appealableKinds = options.appealableKinds ?? new Set();

    if (this.#advisoryTtlMs > 0) {
      const timer = setInterval(() => {
        this.#evictStaleAdvisory(Date.now());
      }, ADVISORY_EVICTION_INTERVAL_MS);
      if (typeof timer === 'object' && 'unref' in timer) {
        (timer as { unref(): void }).unref();
      }
      this.#advisoryEvictionTimer = timer;
    } else {
      this.#advisoryEvictionTimer = undefined;
    }
  }

  /**
   * Async factory that pre-loads persisted state from the supplied
   * `stateStore` (if any) before returning a ready-to-use gateway.
   *
   * On cold start (no persisted state) the gateway begins with
   * `options.initialState` or `createEmptyTransportAdmissionState()`.
   *
   * Refuses to start on corruption: if `stateStore.load()` throws
   * (e.g. `AdmissionStateCorruptError`), the factory propagates the
   * error so the operator decides whether to delete the bad
   * snapshot. We deliberately do NOT silently start fresh on
   * corruption — that would let an attacker who corrupted the file
   * (or a buggy upgrade producing an incompatible shape) gain a
   * fresh budget every restart.
   */
  static async create(options: AdmissionGatewayOptions): Promise<BridgeAdmissionGateway> {
    if (options.stateStore !== undefined) {
      const loaded = await options.stateStore.load();
      if (loaded !== undefined) {
        return new BridgeAdmissionGateway({ ...options, initialState: loaded });
      }
    }
    return new BridgeAdmissionGateway(options);
  }

  /**
   * Read the current admission state. Frozen — safe to expose for
   * persistence or test observation.
   */
  get state(): TransportAdmissionState {
    return this.#state;
  }

  admit(
    request: BridgeDeliveryRequest,
    nowMs: number,
    context?: AdmissionContext
  ): AdmissionGatewayDecision {
    const envelope = buildAdmissionEnvelope(request);
    const mergedContext = this.#mergeAdvisoryContext(context, envelope.peerId);
    const { nextState, result } = admitEnvelope(
      this.#state,
      envelope,
      this.#config,
      mergedContext,
      nowMs
    );
    // Move the reference forward exactly once per admission decision.
    this.#state = nextState;

    // Check #8.5 — operator policy subscription (Phase 4.6, opt-in).
    // Runs after the rate-limit check and before user-block.
    if (result.admitted && result.decision.action !== 'drop-duplicate') {
      const labelDecision = this.#checkPolicyLabels(request, nowMs);
      if (labelDecision !== undefined) {
        this.#maybeFireAppealHook(labelDecision.result.decision, request.event.kind);
        return labelDecision;
      }
    }

    // Check #9 — user-block transport (Phase 4.5, opt-in).
    // Runs AFTER the engine so rate-limit / replay-cache state has
    // already been updated. On a reject here we do NOT update state
    // again — the engine already advanced it above.
    if (result.admitted && result.decision.action !== 'drop-duplicate') {
      const userBlockDecision = this.#checkUserBlock(request, nowMs);
      if (userBlockDecision !== undefined) {
        return userBlockDecision;
      }
    }

    // Fire appeal hook for engine-produced reject/quarantine outcomes.
    const action = result.decision.action;
    if (action === 'reject' || action === 'quarantine') {
      this.#maybeFireAppealHook(result.decision, request.event.kind);
    }

    return Object.freeze({
      result,
      reason: this.#formatReason(result)
    });
  }

  /**
   * Phase 4.2 — async variant that persists the new state BEFORE
   * advancing the in-memory reference.
   *
   * Fail-closed contract: if `stateStore.save` throws, the in-memory
   * state IS NOT advanced and the error propagates upward. The
   * BridgeService that wraps the gateway then returns a rejection
   * response rather than admitting a delivery whose admission record
   * was not durably written. This matches the bridge-admission
   * doctrine: an in-memory budget that disappears on restart while
   * the producer continues to consume it would be silently broken
   * abuse-resistance.
   *
   * When no `stateStore` was configured this method's behavior is
   * identical to `admit` (no persistence side effect).
   */
  /**
   * Phase 4.2 — async variant that persists the new state before
   * advancing the in-memory reference.
   *
   * Fail-closed contract: if `stateStore.save` throws, the in-memory
   * state IS NOT advanced and the error propagates upward.
   *
   * Post-engine policy checks (#8.5, #9) run BEFORE persistence so
   * the final caller-visible decision is determined before any I/O.
   * The persisted state records the engine-level outcome (rate-limit
   * consumed, replay cache updated) regardless of the policy overlay
   * decision — the engine state and the operator policy layer are
   * intentionally separate audit concerns.
   */
  async admitAndPersist(
    request: BridgeDeliveryRequest,
    nowMs: number,
    context?: AdmissionContext
  ): Promise<AdmissionGatewayDecision> {
    const envelope = buildAdmissionEnvelope(request);
    const mergedContext = this.#mergeAdvisoryContext(context, envelope.peerId);
    const { nextState, result } = admitEnvelope(
      this.#state,
      envelope,
      this.#config,
      mergedContext,
      nowMs
    );

    // Run post-engine policy checks BEFORE persisting so the returned
    // decision is authoritative before any I/O side effect.
    let policyDecision: AdmissionGatewayDecision | undefined;
    if (result.admitted && result.decision.action !== 'drop-duplicate') {
      // Check #8.5 — operator policy subscription
      policyDecision = this.#checkPolicyLabels(request, nowMs);
      if (policyDecision !== undefined) {
        this.#maybeFireAppealHook(policyDecision.result.decision, request.event.kind);
      }
    }
    if (
      policyDecision === undefined &&
      result.admitted &&
      result.decision.action !== 'drop-duplicate'
    ) {
      // Check #9 — user-block transport
      policyDecision = this.#checkUserBlock(request, nowMs);
    }

    // Persist the engine's nextState (fail-closed: if this throws, in-memory
    // does NOT advance). The persisted state captures rate-limit/replay updates
    // from the engine regardless of the policy overlay decision.
    if (this.#stateStore !== undefined) {
      await this.#stateStore.save(nextState);
    }
    this.#state = nextState;

    if (policyDecision !== undefined) {
      return policyDecision;
    }

    // Fire appeal hook for engine-produced reject/quarantine outcomes.
    const action = result.decision.action;
    if (action === 'reject' || action === 'quarantine') {
      this.#maybeFireAppealHook(result.decision, request.event.kind);
    }

    return Object.freeze({
      result,
      reason: this.#formatReason(result)
    });
  }

  /**
   * Phase 4.6 — update the `PolicySubscriptionRuntime`'s labeler-state
   * snapshot. The new snapshot is used on the next `admit` call without
   * a process restart.
   *
   * No-op when no `policyRuntime` was configured.
   */
  refreshLabelersState(newSnapshot: LabelersState): void {
    this.#policyRuntime?.refreshLabelersState(newSnapshot);
  }

  /**
   * Phase 4.6 — ingest advisory reputation entries from other bridge
   * operators.
   *
   * Each entry is validated and clamped to [-1, 1]. Entries older than
   * the configured advisory TTL are silently dropped. For each `peerId`,
   * the effective advisory score is the MINIMUM across all live entries
   * so a single source cannot unilaterally raise a peer's advisory score
   * above what another source has reported.
   *
   * The advisory channel can only LOWER effective reputation — it is
   * applied to the engine via a `reputationScoreLookup` that clamps the
   * advisory score at the peer's locally-observed score.
   *
   * Non-numeric or NaN scores are silently dropped (fail-closed).
   */
  ingestAdvisoryFeed(
    entries: ReadonlyArray<AdvisoryReputationEntry>,
    nowMs: number = Date.now()
  ): void {
    const cutoffMs = nowMs - this.#advisoryTtlMs;
    const affectedPeerIds = new Set<string>();

    for (const entry of entries) {
      // Defensive null-check: advisory feeds arrive from external sources
      // and may be malformed. Fail-closed on any invalid entry.
      if (
        !entry ||
        typeof entry.peerId !== 'string' ||
        entry.peerId.length === 0 ||
        typeof entry.sourceId !== 'string' ||
        typeof entry.score !== 'number' ||
        !Number.isFinite(entry.score) ||
        typeof entry.updatedAt !== 'string'
      ) {
        continue;
      }
      const updatedAtMs = Date.parse(entry.updatedAt);
      if (!Number.isFinite(updatedAtMs) || updatedAtMs < cutoffMs) {
        continue; // stale or unparseable
      }
      // Advisory channel can only LOWER effective reputation; positive scores
      // are dropped so the advisory feed cannot boost an unknown peer.
      const clampedScore = Math.min(0, Math.max(-1, entry.score));

      // Per-source tracking: store (peerId → sourceId → {score, updatedAt})
      // so a source can retract a previously-low score without being stuck
      // at the historical minimum.
      let sourceMap = this.#advisorySourceScores.get(entry.peerId);
      if (sourceMap === undefined) {
        sourceMap = new Map();
        this.#advisorySourceScores.set(entry.peerId, sourceMap);
      }
      const existingSource = sourceMap.get(entry.sourceId);
      if (existingSource === undefined || updatedAtMs >= existingSource.updatedAt) {
        if (clampedScore < 0) {
          sourceMap.set(
            entry.sourceId,
            Object.freeze({ score: clampedScore, updatedAt: updatedAtMs })
          );
        } else {
          // Score is 0 (i.e. original was positive/zero) — source is retracting
          sourceMap.delete(entry.sourceId);
        }
        affectedPeerIds.add(entry.peerId);
      }
    }

    // Recompute effective score for each affected peer.
    for (const peerId of affectedPeerIds) {
      this.#recomputeAdvisoryScore(peerId);
    }
  }

  /**
   * Phase 4.6 — directly quarantine a peer by setting its reputation to
   * the engine's `quarantineThreshold` floor. Writes a
   * `transport.peer.quarantined` event to the admission state so the
   * quarantine is visible in the audit log.
   *
   * The quarantine floor overrides the peer's locally-observed score —
   * it does NOT wait for score decay to cross the threshold. Duration is
   * operator-specified; the engine's own `maxQuarantineMs` still caps
   * the TTL.
   *
   * Callers MUST persist the updated state if durable quarantine is
   * required; this method updates in-memory only.
   */
  quarantinePeer(peerId: string, reason: string, durationMs: number): void {
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
      throw new Error(
        `quarantinePeer: durationMs must be a non-negative finite number, got ${String(durationMs)}`
      );
    }
    const repConfig = this.#config.reputation;
    const maxQuarantineMs = repConfig?.maxQuarantineMs ?? 7 * 24 * 60 * 60 * 1_000;
    const quarantineThreshold = repConfig?.quarantineThreshold ?? -500;
    const now = Date.now();
    const quarantineUntil = now + Math.min(durationMs, maxQuarantineMs);
    const existingRep = this.#state.peerReputation?.[peerId] ?? { score: 0, lastUpdatedAt: now };
    const quarantinedRep = Object.freeze({
      ...existingRep,
      score: quarantineThreshold,
      lastUpdatedAt: now,
      lastReason: `operator.quarantine:${reason}`,
      quarantineUntil
    });
    this.#state = Object.freeze({
      ...this.#state,
      peerReputation: Object.freeze({
        ...this.#state.peerReputation,
        [peerId]: quarantinedRep
      })
    });
  }

  /**
   * Phase 4.6 — lift an operator-imposed quarantine on a peer by
   * resetting its reputation score to 0 (neutral) and clearing the
   * `quarantineUntil` field. Writes a `transport.peer.rate_limited`
   * (recovering status) audit event.
   *
   * Callers MUST persist the updated state if durable lift is required.
   */
  liftQuarantine(peerId: string, reason: string): void {
    const existing = this.#state.peerReputation?.[peerId];
    if (existing === undefined) return; // no-op — peer has no reputation record
    const now = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentional omit: destructure to drop quarantineUntil from the lifted record without setting it to undefined (exactOptionalPropertyTypes)
    const { quarantineUntil: _removed, ...rest } = existing;
    const liftedRep = Object.freeze({
      ...rest,
      score: 0,
      lastUpdatedAt: now,
      lastReason: `operator.lift-quarantine:${reason}`
    });
    this.#state = Object.freeze({
      ...this.#state,
      peerReputation: Object.freeze({
        ...this.#state.peerReputation,
        [peerId]: liftedRep
      })
    });
  }

  /**
   * Phase 4.6 — register an appeal hook. Called after a `reject` or
   * `quarantine` outcome when the envelope's `kind` is in
   * `appealableKinds`. Fire-and-forget: the hook never delays the
   * admission response and a throwing hook does NOT reverse the decision.
   *
   * The hook receives only the `TransportAdmissionDecision` — never the
   * envelope bytes or decrypted content (Phase 1.63 non-negotiable).
   */
  registerAppealHook(hook: AppealHook): void {
    this.#appealHooks.push(hook);
  }

  /**
   * Stop the periodic advisory eviction timer. Call during graceful
   * shutdown to allow the process to exit cleanly.
   */
  dispose(): void {
    if (this.#advisoryEvictionTimer !== undefined) {
      clearInterval(this.#advisoryEvictionTimer);
    }
  }

  /**
   * Phase 4.5 — check #10 type contract for `ReportAppealEvent`
   * envelopes.
   *
   * Reports ride `ReportAppealEvent` (not `SignedEventEnvelope`) so
   * they cannot go through `acceptDelivery`. This entry point
   * establishes the type contract for Phase 5's report-forwarding
   * HTTP surface. Today no HTTP route is wired to it; wiring is
   * deferred until Phase 5 opens that surface.
   *
   * Non-negotiable (Phase 1.63): the bridge MUST NOT decrypt the
   * report's evidence. This check is structural only — it calls
   * `decideReportForwarding` which operates on declared shape,
   * never on encrypted content.
   */
  acceptReportDelivery(request: ReportDeliveryRequest): ReportDeliveryResult {
    const { envelope } = request;
    // Version check.
    if (envelope.version !== 'lfp2p.report-appeal-event.v1') {
      return Object.freeze({
        status: 'rejected',
        reason: `unsupported version: ${String(envelope.version)}`
      });
    }
    // Byte-size cap (use the same cap as the gateway's SignedEventEnvelope surface).
    const byteSize = request.byteSize ?? new TextEncoder().encode(JSON.stringify(envelope)).length;
    const maxBytes = this.#config.maxBytes ?? 1_048_576;
    if (byteSize > maxBytes) {
      return Object.freeze({
        status: 'rejected',
        reason: `payload.too-large:report-envelope`
      });
    }
    // Check #10 — structural privacy check on `safety.report.created`.
    if (envelope.kind === 'safety.report.created') {
      const fwd = decideReportForwarding(envelope.report);
      if (!fwd.shouldForward) {
        return Object.freeze({
          status: 'rejected',
          reason: `policy.report-privacy:${fwd.reason}`
        });
      }
    }
    return Object.freeze({ status: 'accepted' });
  }

  /**
   * Phase 4.5 — hot-rotate the operator authority without a process
   * restart. The new authority takes effect immediately on the next
   * `admit` call.
   *
   * IMPORTANT: this method is synchronous and does NOT persist the
   * new authority. `stateStore` only stores `TransportAdmissionState`,
   * which does not include `AdmissionConfig`. Callers MUST persist the
   * new authority via their own configuration store so that it survives
   * a process restart.
   */
  rotateOperatorAuthority(newAuthority: AdmissionConfig['operatorAuthority']): void {
    this.#config = Object.freeze({ ...this.#config, operatorAuthority: newAuthority });
  }

  /**
   * Phase 4.6 — merge the advisory reputation score for a peer into
   * the admission context's `reputationScoreLookup`. Advisory scores
   * can only lower the effective score below the locally-observed value;
   * they never raise it.
   */
  #mergeAdvisoryContext(
    context: AdmissionContext | undefined,
    peerId: string
  ): AdmissionContext | undefined {
    const advisoryRecord = this.#advisoryScores.get(peerId);
    if (advisoryRecord === undefined) return context;

    const advisoryScore = advisoryRecord.score;
    // By design all stored advisory scores are <= 0 (ingestAdvisoryFeed clamps
    // positive entries to 0 and discards them). This guard is belt-and-suspenders.
    if (advisoryScore >= 0) return context;

    const base = context?.reputationScoreLookup;
    const mergedLookup = (id: string): number | undefined => {
      const local = base?.(id);
      if (id !== peerId) return local;
      // Advisory can only lower, never raise above the locally-observed score.
      // When no local lookup is wired, advisory is used directly (it's negative).
      if (local === undefined) return advisoryScore;
      return Math.min(local, advisoryScore);
    };

    return Object.freeze({ ...context, reputationScoreLookup: mergedLookup });
  }

  /**
   * Phase 4.6 — check #8.5: operator policy subscription label check.
   * Returns a reject decision when a listed labeler has applied a
   * `hard-safety` label to the producer, `undefined` otherwise.
   * No reputation penalty.
   */
  #checkPolicyLabels(
    request: BridgeDeliveryRequest,
    nowMs: number
  ): AdmissionGatewayDecision | undefined {
    if (this.#policyRuntime === undefined) return undefined;
    const reasonCode = this.#policyRuntime.checkProducerLabels(request.event.author);
    if (reasonCode === undefined) return undefined;

    const syntheticDecision: TransportAdmissionDecision = Object.freeze({
      version: TRANSPORT_ADMISSION_DECISION_VERSION,
      decisionId: `dec_label_${request.event.eventId}_${nowMs}`,
      operatorAuthority: this.#config.operatorAuthority,
      subject: Object.freeze({
        type: 'event' as const,
        eventId: request.event.eventId
      }),
      surface: this.#config.surface,
      action: 'reject' as const,
      reasonCode,
      policyVersion: this.#config.policyVersion,
      createdAt: new Date(nowMs).toISOString()
    });
    const rejectResult: AdmissionResult = Object.freeze({
      decision: syntheticDecision,
      admitted: false
    });
    return Object.freeze({
      result: rejectResult,
      reason: `rejected:${reasonCode}`
    });
  }

  /**
   * Phase 4.6 — fire all registered appeal hooks for a rejected/quarantined
   * decision when the envelope kind is in `appealableKinds`. Fire-and-forget.
   */
  #maybeFireAppealHook(decision: TransportAdmissionDecision, kind: string): void {
    if (this.#appealHooks.length === 0) return;
    if (!this.#appealableKinds.has(kind)) return;
    for (const hook of this.#appealHooks) {
      // Fire-and-forget: a broken hook must not reverse the decision or crash
      // the process. Silenced per Phase 3.1 privacy-safe logging doctrine —
      // `err` is attacker-influenced and must not reach any log surface.
      void hook(decision).catch(() => undefined);
    }
  }

  /**
   * Phase 4.6 — evict stale per-source advisory entries and recompute
   * effective scores. Called periodically by the background timer.
   */
  #evictStaleAdvisory(nowMs: number): void {
    const cutoffMs = nowMs - this.#advisoryTtlMs;
    for (const [peerId, sourceMap] of this.#advisorySourceScores) {
      let changed = false;
      for (const [sourceId, record] of sourceMap) {
        if (record.updatedAt < cutoffMs) {
          sourceMap.delete(sourceId);
          changed = true;
        }
      }
      if (sourceMap.size === 0) {
        this.#advisorySourceScores.delete(peerId);
        this.#advisoryScores.delete(peerId);
      } else if (changed) {
        this.#recomputeAdvisoryScore(peerId);
      }
    }
  }

  /** Recompute the effective advisory score for a peer from its per-source map. */
  #recomputeAdvisoryScore(peerId: string): void {
    const sourceMap = this.#advisorySourceScores.get(peerId);
    if (sourceMap === undefined || sourceMap.size === 0) {
      this.#advisoryScores.delete(peerId);
      return;
    }
    let minScore = 0;
    let maxUpdatedAt = 0;
    for (const record of sourceMap.values()) {
      if (record.score < minScore) minScore = record.score;
      if (record.updatedAt > maxUpdatedAt) maxUpdatedAt = record.updatedAt;
    }
    if (minScore < 0) {
      this.#advisoryScores.set(peerId, Object.freeze({ score: minScore, updatedAt: maxUpdatedAt }));
    } else {
      this.#advisoryScores.delete(peerId);
    }
  }

  /**
   * Phase 4.5 — check #9 helper.
   * Returns a `reject` decision when the user-block check fires,
   * or `undefined` when the check is skipped or passes.
   * No reputation penalty — the block is the recipient's preference,
   * not evidence of sender misbehaviour.
   */
  #checkUserBlock(
    request: BridgeDeliveryRequest,
    nowMs: number
  ): AdmissionGatewayDecision | undefined {
    if (this.#localControlStateLookup === undefined || request.recipientActorId === undefined) {
      return undefined;
    }
    const localState = this.#localControlStateLookup(request.recipientActorId);
    if (localState === undefined) return undefined;

    const blockDecision = decideUserBlockTransport(
      localState,
      { producerActorId: request.event.author },
      nowMs
    );
    if (!blockDecision.shouldReject) return undefined;

    // Synthesize a full AdmissionResult carrying a stable
    // `policy.local-preference` reason code. The admitted flag is
    // false so the bridge never stores this delivery.
    const syntheticDecision: TransportAdmissionDecision = Object.freeze({
      version: TRANSPORT_ADMISSION_DECISION_VERSION,
      decisionId: `dec_block_${request.event.eventId}_${nowMs}`,
      operatorAuthority: this.#config.operatorAuthority,
      subject: Object.freeze({
        type: 'event' as const,
        eventId: request.event.eventId
      }),
      surface: this.#config.surface,
      action: 'reject' as const,
      reasonCode: 'policy.local-preference' as const,
      policyVersion: this.#config.policyVersion,
      createdAt: new Date(nowMs).toISOString()
    });
    const rejectResult: AdmissionResult = Object.freeze({
      decision: syntheticDecision,
      admitted: false
    });
    return Object.freeze({
      result: rejectResult,
      reason: 'rejected:policy.local-preference'
    });
  }

  /**
   * Produce a reason string suitable for inclusion in a rejection
   * response. Uses stable error codes only — never echoes envelope
   * payload — per the Phase 3.1 privacy-safe-logging doctrine.
   */
  #formatReason(result: AdmissionResult): string {
    const action = result.decision.action;
    const code = result.decision.reasonCode;
    switch (action) {
      case 'accept':
        return `admitted:${code}`;
      case 'accept-limited':
        return `admitted-limited:${code}`;
      case 'reject':
        return `rejected:${code}`;
      case 'quarantine':
        return `quarantined:${code}`;
      case 'rate-limit':
        return `rate-limited:${code}`;
      case 'drop-duplicate':
        return `drop-duplicate:${code}`;
      default: {
        // Exhaustiveness check — if the engine adds a new action
        // variant, this throw fires immediately and the gateway
        // never silently produces a misleading "admitted" response.
        const _exhaustive: never = action;
        return `unknown:${code}:${String(_exhaustive)}`;
      }
    }
  }
}
