import {
  type BridgeStreamBroker,
  type BridgeStreamRecord,
  type BridgeStreamSubscriptionHandle
} from './stream-broker.js';
import type { BridgeService } from './service.js';
import { type BridgeInboundReadRecord } from './types.js';

/**
 * Phase 4.4 — Durable Streams WebSocket adapter.
 *
 * Runtime-agnostic adapter that wires a Web-standard
 * `WebSocketLike` to a `BridgeService` + `BridgeStreamBroker`. The
 * runtime layer (Node `ws`, Cloudflare Workers, Deno, Bun, browser)
 * is responsible for:
 *
 *   - Authenticating the upgrade request via the Phase 4.3
 *     `authorizeRequest` against the multi-token registry.
 *   - Accepting the WebSocket and producing a `WebSocketLike`.
 *   - Calling `attachBridgeStreamSocket({ tokenId, ... })`.
 *
 * The adapter then runs the application-level Durable Streams
 * protocol (subscribe → backlog → live tail) on top of WebSocket
 * frames. The cursor model matches Electric's Durable Streams
 * pattern: opaque monotonic offsets the client persists and resumes
 * from. Each outbound frame includes the cursor of the last record
 * delivered so a reconnecting client can pick up exactly where it
 * left off.
 *
 * Hardening (matches the project's adversarial-mindset bar):
 *
 *   1. **Inbound frame size cap** — protects the JSON parser from a
 *      hostile client sending a multi-MB frame on a low-budget
 *      bridge. Default 64 KiB.
 *   2. **Inbound frame rate limit** — rolling 60s window with a
 *      configurable cap (default 120 frames/min). Prevents a client
 *      from spinning the JSON parser as a CPU DoS.
 *   3. **Outbound backpressure** — checks `socket.bufferedAmount`
 *      before every send and closes the connection with
 *      `try-again-later` (1013) when the slow consumer accumulates
 *      too much in-flight data. Default 8 MiB.
 *   4. **Broker buffer overflow** — between the SUBSCRIBE frame and
 *      the adapter's `goLive` call, new publishes are buffered in
 *      the broker. If the buffer overflows (slow backlog read +
 *      hot publish stream), the broker fires `onOverflow` and the
 *      adapter closes the socket. The client reconnects with their
 *      last cursor and the store backfill is authoritative — no
 *      records are lost.
 *   5. **Heartbeat** — server-initiated ping at
 *      `heartbeatIntervalMs`; if no inbound frame is seen for
 *      `heartbeatTimeoutMs` the socket is closed. Detects half-open
 *      TCP connections that the runtime would otherwise leave open
 *      indefinitely.
 *   6. **Privacy-safe error frames** — error frames carry a stable
 *      machine-readable `code` and a generic `message`; never the
 *      offending input. Per Phase 3.1 privacy-safe-logging doctrine.
 *   7. **Single subscription per socket** — re-subscribing closes
 *      the socket with a protocol-violation code. Subscriptions are
 *      scoped to the connection lifetime. (A different stream needs
 *      a new socket.)
 *   8. **Binary frames rejected** — the protocol is JSON-only;
 *      binary frames are a protocol violation.
 *
 * Wire frames (JSON only, framed by the underlying WebSocket):
 *
 *   Client → Server:
 *     { "type": "subscribe", "sourceId": string, "streamId": string,
 *       "scope": string, "cursor"?: string, "backlogLimit"?: number }
 *     { "type": "ack", "cursor": string }
 *     { "type": "ping" }
 *     { "type": "unsubscribe" }
 *
 *   Server → Client:
 *     { "type": "ready", "tokenId": string }          // sent on attach
 *     { "type": "backlog", "records": Record[], "cursor": string }
 *     { "type": "live", "record": Record, "cursor": string }
 *     { "type": "pong" }
 *     { "type": "ping" }                              // heartbeat
 *     { "type": "error", "code": string }             // privacy-safe
 *
 * Record shape matches `BridgeInboundReadRecord` (the same shape
 * the existing POST inbound-read endpoint returns), so a client
 * library can share a single decoder.
 */
export type WebSocketLike = {
  readonly readyState: number;
  readonly bufferedAmount?: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message', handler: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close', handler: () => void): void;
  addEventListener(type: 'error', handler: () => void): void;
  removeEventListener(type: string, handler: (event: unknown) => void): void;
};

// RFC 6455 §7.4.1 — application-meaningful close codes used here.
const WS_CLOSE_GOING_AWAY = 1001;
const WS_CLOSE_PROTOCOL_ERROR = 1002;
const WS_CLOSE_POLICY_VIOLATION = 1008;
const WS_CLOSE_MESSAGE_TOO_BIG = 1009;
const WS_CLOSE_INTERNAL_ERROR = 1011;
const WS_CLOSE_TRY_AGAIN_LATER = 1013;
const WEBSOCKET_OPEN = 1;

export const DEFAULT_STREAM_HEARTBEAT_INTERVAL_MS = 25_000;
export const DEFAULT_STREAM_HEARTBEAT_TIMEOUT_MS = 60_000;
export const DEFAULT_STREAM_MAX_FRAME_BYTES = 64 * 1024;
export const DEFAULT_STREAM_MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
export const DEFAULT_STREAM_MAX_INBOUND_FRAMES_PER_MINUTE = 120;
export const DEFAULT_STREAM_BACKLOG_LIMIT = 200;
export const MAX_STREAM_BACKLOG_LIMIT = 500;

export type BridgeStreamSocketOptions = Readonly<{
  service: BridgeService;
  broker: BridgeStreamBroker;
  socket: WebSocketLike;
  /**
   * Phase 4.3 — the bearer-token id that authenticated the WebSocket
   * upgrade. Used as a stable, secret-free key for audit and
   * (future) per-token streaming rate limit.
   */
  tokenId: string;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  maxFrameBytes?: number;
  maxBufferedBytes?: number;
  maxInboundFramesPerMinute?: number;
  /** Default page size when fetching backlog from the store. */
  defaultBacklogLimit?: number;
  now?: () => number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}>;

export type BridgeStreamSocketHandle = Readonly<{
  close: (code?: number, reason?: string) => void;
  state: () => 'opening' | 'subscribed' | 'closed';
  /** Test/observability — frames sent since attach. */
  sentFrames: () => number;
  /** Test/observability — last cursor we sent. */
  lastSentCursor: () => string | undefined;
}>;

type AttachState = 'opening' | 'subscribed' | 'closed';

type Internal = {
  state: AttachState;
  subscription: BridgeStreamSubscriptionHandle | undefined;
  lastInboundAt: number;
  lastSentCursor: string | undefined;
  inboundFrameTimes: number[];
  sentFrames: number;
  heartbeatTimer: ReturnType<typeof setInterval> | undefined;
};

export function attachBridgeStreamSocket(
  options: BridgeStreamSocketOptions
): BridgeStreamSocketHandle {
  if (typeof options.tokenId !== 'string' || options.tokenId.length === 0) {
    throw new Error('tokenId must be a non-empty string');
  }
  const heartbeatIntervalMs = positiveOr(
    options.heartbeatIntervalMs,
    DEFAULT_STREAM_HEARTBEAT_INTERVAL_MS,
    'heartbeatIntervalMs'
  );
  const heartbeatTimeoutMs = positiveOr(
    options.heartbeatTimeoutMs,
    DEFAULT_STREAM_HEARTBEAT_TIMEOUT_MS,
    'heartbeatTimeoutMs'
  );
  if (heartbeatTimeoutMs <= heartbeatIntervalMs) {
    throw new Error('heartbeatTimeoutMs must exceed heartbeatIntervalMs');
  }
  const maxFrameBytes = positiveOr(
    options.maxFrameBytes,
    DEFAULT_STREAM_MAX_FRAME_BYTES,
    'maxFrameBytes'
  );
  const maxBufferedBytes = positiveOr(
    options.maxBufferedBytes,
    DEFAULT_STREAM_MAX_BUFFERED_BYTES,
    'maxBufferedBytes'
  );
  const maxInboundFramesPerMinute = positiveOr(
    options.maxInboundFramesPerMinute,
    DEFAULT_STREAM_MAX_INBOUND_FRAMES_PER_MINUTE,
    'maxInboundFramesPerMinute'
  );
  const defaultBacklogLimit = positiveOr(
    options.defaultBacklogLimit,
    DEFAULT_STREAM_BACKLOG_LIMIT,
    'defaultBacklogLimit'
  );
  if (defaultBacklogLimit > MAX_STREAM_BACKLOG_LIMIT) {
    throw new Error(`defaultBacklogLimit must be at most ${MAX_STREAM_BACKLOG_LIMIT}`);
  }
  const nowFn = options.now ?? (() => Date.now());
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;

  const state: Internal = {
    state: 'opening',
    subscription: undefined,
    lastInboundAt: nowFn(),
    lastSentCursor: undefined,
    inboundFrameTimes: [],
    sentFrames: 0,
    heartbeatTimer: undefined
  };

  // -- helpers ---------------------------------------------------------

  const close = (code: number, reason: string): void => {
    if (state.state === 'closed') return;
    state.state = 'closed';
    if (state.heartbeatTimer !== undefined) {
      clearIntervalFn(state.heartbeatTimer);
      state.heartbeatTimer = undefined;
    }
    if (state.subscription !== undefined) {
      try {
        state.subscription.unsubscribe();
      } catch {
        // isolate
      }
      state.subscription = undefined;
    }
    try {
      options.socket.close(code, reason);
    } catch {
      // socket may already be closed by the runtime — fine.
    }
  };

  const send = (payload: Record<string, unknown>): boolean => {
    if (state.state === 'closed') return false;
    if (options.socket.readyState !== WEBSOCKET_OPEN) {
      close(WS_CLOSE_GOING_AWAY, 'socket-not-open');
      return false;
    }
    const buffered = options.socket.bufferedAmount ?? 0;
    if (buffered > maxBufferedBytes) {
      close(WS_CLOSE_TRY_AGAIN_LATER, 'backpressure-overflow');
      return false;
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(payload);
    } catch {
      // A non-serializable payload is a bug in the adapter itself,
      // not a hostile input. Close with internal-error.
      close(WS_CLOSE_INTERNAL_ERROR, 'serialization-failed');
      return false;
    }
    try {
      options.socket.send(serialized);
    } catch {
      close(WS_CLOSE_GOING_AWAY, 'send-failed');
      return false;
    }
    state.sentFrames += 1;
    return true;
  };

  const sendError = (code: string): void => {
    // Privacy-safe: no echo of the offending input. `code` is a fixed
    // string from a small enum below.
    send({ type: 'error', code });
  };

  const sendRecord = (record: BridgeStreamRecord): void => {
    const ok = send({
      type: 'live',
      record: toWireRecord(record),
      cursor: record.cursor
    });
    if (ok) state.lastSentCursor = record.cursor;
  };

  // -- inbound rate limit ---------------------------------------------

  const recordInboundFrame = (nowMs: number): boolean => {
    state.inboundFrameTimes.push(nowMs);
    // Drop entries older than 60s.
    const cutoff = nowMs - 60_000;
    while (state.inboundFrameTimes.length > 0 && state.inboundFrameTimes[0]! < cutoff) {
      state.inboundFrameTimes.shift();
    }
    return state.inboundFrameTimes.length <= maxInboundFramesPerMinute;
  };

  // -- subscribe / backlog / goLive sequence --------------------------

  const handleSubscribe = async (payload: SubscribeFrame, nowIso: string): Promise<void> => {
    if (state.subscription !== undefined) {
      close(WS_CLOSE_PROTOCOL_ERROR, 'already-subscribed');
      return;
    }
    const cursor = payload.cursor ?? '0';
    const afterSequence = parseCursorOrZero(cursor);
    if (afterSequence === undefined) {
      close(WS_CLOSE_PROTOCOL_ERROR, 'invalid-cursor');
      return;
    }
    const backlogLimit = payload.backlogLimit ?? defaultBacklogLimit;
    if (
      !Number.isSafeInteger(backlogLimit) ||
      backlogLimit <= 0 ||
      backlogLimit > MAX_STREAM_BACKLOG_LIMIT
    ) {
      close(WS_CLOSE_PROTOCOL_ERROR, 'invalid-backlog-limit');
      return;
    }

    // 1. Subscribe FIRST so the broker buffers any publish that
    //    races with our backlog read. The buffer is bounded; if it
    //    overflows we close.
    const handle = options.broker.subscribe({
      streamKey: payload.streamId,
      onRecord: (record) => sendRecord(record),
      onOverflow: () => close(WS_CLOSE_TRY_AGAIN_LATER, 'broker-overflow')
    });
    state.subscription = handle;

    // 2. Read backlog from the store. The store is the durable
    //    source of truth; the broker is a notification channel.
    let backlog;
    try {
      backlog = await options.service.readInboundRecords(
        {
          sourceId: payload.sourceId,
          streamId: payload.streamId,
          scope: payload.scope,
          ...(afterSequence === 0 ? {} : { cursor: String(afterSequence) }),
          limit: backlogLimit
        },
        nowIso
      );
    } catch {
      close(WS_CLOSE_INTERNAL_ERROR, 'backlog-read-failed');
      return;
    }

    if (state.state === 'closed') return;
    // 3. Send the backlog as one frame. Clients can choose to
    //    process records individually; the wire shape preserves
    //    sequence order.
    if (backlog.records.length > 0) {
      const tail = backlog.records[backlog.records.length - 1]!;
      const ok = send({
        type: 'backlog',
        records: backlog.records.map(toWireRecord),
        cursor: tail.cursor
      });
      if (!ok) return;
      state.lastSentCursor = tail.cursor;
    } else {
      const ok = send({ type: 'backlog', records: [], cursor: String(afterSequence) });
      if (!ok) return;
    }

    // 4. Drain the broker buffer (filtering out records the backlog
    //    already covered), then transition to live.
    const lastDeliveredSequence =
      backlog.records.length > 0
        ? backlog.records[backlog.records.length - 1]!.sequence
        : afterSequence;
    handle.goLive(lastDeliveredSequence);
    state.state = 'subscribed';
  };

  const handleFrame = (raw: unknown): void => {
    const nowMs = nowFn();
    state.lastInboundAt = nowMs;
    if (typeof raw !== 'string') {
      close(WS_CLOSE_POLICY_VIOLATION, 'binary-not-allowed');
      return;
    }
    if (raw.length > maxFrameBytes) {
      close(WS_CLOSE_MESSAGE_TOO_BIG, 'inbound-frame-too-big');
      return;
    }
    if (!recordInboundFrame(nowMs)) {
      close(WS_CLOSE_POLICY_VIOLATION, 'inbound-rate-limit-exceeded');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      close(WS_CLOSE_PROTOCOL_ERROR, 'invalid-json');
      return;
    }
    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
      close(WS_CLOSE_PROTOCOL_ERROR, 'invalid-frame');
      return;
    }
    switch (parsed.type) {
      case 'subscribe': {
        const sub = parseSubscribeFrame(parsed);
        if (sub === undefined) {
          close(WS_CLOSE_PROTOCOL_ERROR, 'invalid-subscribe');
          return;
        }
        // Fire-and-forget — we MUST NOT block the inbound message
        // loop, but we DO need to record any failure. The promise's
        // rejection branch only exists for catastrophic bugs since
        // every awaited op has its own try/catch and closes the
        // socket on failure.
        void handleSubscribe(sub, new Date(nowMs).toISOString()).catch(() => {
          close(WS_CLOSE_INTERNAL_ERROR, 'subscribe-failed');
        });
        return;
      }
      case 'ack': {
        // Phase 4.4 v1 — ack is informational. v2 may use it to
        // gate broker buffer trimming; for now we accept and ignore.
        if (typeof parsed.cursor !== 'string' || parsed.cursor.length === 0) {
          sendError('invalid-ack');
          return;
        }
        return;
      }
      case 'ping':
        send({ type: 'pong' });
        return;
      case 'unsubscribe':
        close(1000, 'client-unsubscribed');
        return;
      default:
        close(WS_CLOSE_PROTOCOL_ERROR, 'unknown-frame-type');
        return;
    }
  };

  // -- heartbeat ------------------------------------------------------

  const tick = (): void => {
    if (state.state === 'closed') return;
    const nowMs = nowFn();
    if (nowMs - state.lastInboundAt > heartbeatTimeoutMs) {
      close(WS_CLOSE_GOING_AWAY, 'heartbeat-timeout');
      return;
    }
    send({ type: 'ping' });
  };
  state.heartbeatTimer = setIntervalFn(tick, heartbeatIntervalMs);

  // -- wire up socket listeners --------------------------------------

  const onMessage = (event: { data: unknown }): void => {
    try {
      handleFrame(event.data);
    } catch {
      close(WS_CLOSE_INTERNAL_ERROR, 'handler-threw');
    }
  };
  const onClose = (): void => close(WS_CLOSE_GOING_AWAY, 'socket-closed');
  const onError = (): void => close(WS_CLOSE_INTERNAL_ERROR, 'socket-error');

  options.socket.addEventListener('message', onMessage);
  options.socket.addEventListener('close', onClose);
  options.socket.addEventListener('error', onError);

  // Initial ready frame so the client knows the server is up and
  // which token id was accepted (useful for clients holding multiple
  // tokens at rotation time).
  send({ type: 'ready', tokenId: options.tokenId });

  return Object.freeze({
    close: (code = 1000, reason = 'closed-by-host') => close(code, reason),
    state: () => state.state,
    sentFrames: () => state.sentFrames,
    lastSentCursor: () => state.lastSentCursor
  });
}

// -- frame validation --------------------------------------------------

type SubscribeFrame = Readonly<{
  sourceId: string;
  streamId: string;
  scope: string;
  cursor?: string;
  backlogLimit?: number;
}>;

function parseSubscribeFrame(value: Record<string, unknown>): SubscribeFrame | undefined {
  if (typeof value.sourceId !== 'string' || value.sourceId.length === 0) return undefined;
  if (typeof value.streamId !== 'string' || value.streamId.length === 0) return undefined;
  if (typeof value.scope !== 'string' || value.scope.length === 0) return undefined;
  if (value.cursor !== undefined && (typeof value.cursor !== 'string' || value.cursor.length === 0)) {
    return undefined;
  }
  if (
    value.backlogLimit !== undefined &&
    (typeof value.backlogLimit !== 'number' || !Number.isSafeInteger(value.backlogLimit))
  ) {
    return undefined;
  }
  return Object.freeze({
    sourceId: value.sourceId,
    streamId: value.streamId,
    scope: value.scope,
    ...(typeof value.cursor === 'string' ? { cursor: value.cursor } : {}),
    ...(typeof value.backlogLimit === 'number' ? { backlogLimit: value.backlogLimit } : {})
  });
}

function parseCursorOrZero(cursor: string): number | undefined {
  if (cursor === '0' || cursor === '') return 0;
  if (!/^\d+$/.test(cursor)) return undefined;
  const n = Number(cursor);
  if (!Number.isSafeInteger(n) || n < 0) return undefined;
  return n;
}

function toWireRecord(
  record: BridgeStreamRecord | BridgeInboundReadRecord
): BridgeInboundReadRecord {
  return Object.freeze({
    cursor: record.cursor,
    sequence: record.sequence,
    event: record.event,
    receivedAt: record.receivedAt
  });
}

function positiveOr(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
