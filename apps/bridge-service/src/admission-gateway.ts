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
  type AdmissionConfig,
  type AdmissionContext,
  type AdmissionEnvelope,
  type AdmissionResult,
  type TransportAdmissionState
} from '@lfp2p/trust-safety';

import type { BridgeDeliveryRequest } from './types.js';

export type AdmissionGatewayOptions = Readonly<{
  config: AdmissionConfig;
  initialState?: TransportAdmissionState;
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
  readonly #config: AdmissionConfig;
  #state: TransportAdmissionState;

  constructor(options: AdmissionGatewayOptions) {
    this.#config = options.config;
    this.#state = options.initialState ?? createEmptyTransportAdmissionState();
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
    return Object.freeze({
      result,
      reason: this.#formatReason(result)
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
