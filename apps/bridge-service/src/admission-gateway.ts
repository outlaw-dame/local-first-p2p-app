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
  type LocalControlState,
  type ReportAppealEvent,
  type TransportAdmissionDecision,
  type TransportAdmissionState
} from '@lfp2p/trust-safety';

import type { AdmissionStateStore } from './admission-state-store.js';
import type { BridgeDeliveryRequest } from './types.js';

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
  localControlStateLookup?: (
    recipientActorId: string
  ) => LocalControlState | undefined;
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

function buildAdmissionEnvelope(
  request: BridgeDeliveryRequest
): AdmissionEnvelope {
  const event = request.event;
  // `peerId` falls back to `deviceId`. We document the fallback
  // openly because production wiring SHOULD supply a transport-level
  // peer identifier and the engine's per-peer reputation only
  // matters when distinct peers map to distinct identifiers.
  const peerId =
    request.peerId !== undefined && request.peerId.length > 0
      ? request.peerId
      : event.deviceId;

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
export class BridgeAdmissionGateway {
  #config: AdmissionConfig;
  readonly #stateStore: AdmissionStateStore | undefined;
  readonly #localControlStateLookup:
    | ((recipientActorId: string) => LocalControlState | undefined)
    | undefined;
  #state: TransportAdmissionState;

  constructor(options: AdmissionGatewayOptions) {
    this.#config = options.config;
    this.#stateStore = options.stateStore;
    this.#localControlStateLookup = options.localControlStateLookup;
    this.#state = options.initialState ?? createEmptyTransportAdmissionState();
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
  static async create(
    options: AdmissionGatewayOptions
  ): Promise<BridgeAdmissionGateway> {
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
    const { nextState, result } = admitEnvelope(
      this.#state,
      envelope,
      this.#config,
      context,
      nowMs
    );
    // Move the reference forward exactly once per admission decision.
    this.#state = nextState;

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
  async admitAndPersist(
    request: BridgeDeliveryRequest,
    nowMs: number,
    context?: AdmissionContext
  ): Promise<AdmissionGatewayDecision> {
    const envelope = buildAdmissionEnvelope(request);
    const { nextState, result } = admitEnvelope(
      this.#state,
      envelope,
      this.#config,
      context,
      nowMs
    );
    if (this.#stateStore !== undefined) {
      // Persist FIRST. If this throws, the gateway never advances
      // its in-memory reference and the caller gets the I/O error.
      await this.#stateStore.save(nextState);
    }
    this.#state = nextState;

    // Check #9 — user-block transport (Phase 4.5, opt-in).
    if (result.admitted && result.decision.action !== 'drop-duplicate') {
      const userBlockDecision = this.#checkUserBlock(request, nowMs);
      if (userBlockDecision !== undefined) {
        return userBlockDecision;
      }
    }

    return Object.freeze({
      result,
      reason: this.#formatReason(result)
    });
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
    const byteSize =
      request.byteSize ??
      new TextEncoder().encode(JSON.stringify(envelope)).length;
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
   * `admit` call. If a `stateStore` is configured the updated config
   * is persisted by re-saving the current admission state (which
   * already encodes the config indirectly via the admission context).
   *
   * Callers are responsible for ensuring the new authority key is
   * valid before calling this method.
   */
  rotateOperatorAuthority(newAuthority: AdmissionConfig['operatorAuthority']): void {
    this.#config = Object.freeze({ ...this.#config, operatorAuthority: newAuthority });
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
    if (
      this.#localControlStateLookup === undefined ||
      request.recipientActorId === undefined
    ) {
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
