import { type SignedEventEnvelope } from '@lfp2p/protocol';

/**
 * Phase 4.4 — Durable Streams broker.
 *
 * Pure runtime-agnostic publish-subscribe broker used by the bridge
 * to push newly-accepted inbound records to live subscribers. It is
 * deliberately small:
 *
 *   - The broker NEVER caches record bodies for backlog reads. The
 *     store is the single source of truth. The broker's only state is
 *     a per-subscription buffer that exists ONLY between
 *     `subscribe()` and `goLive()` so a record published in that
 *     race window is not lost.
 *
 *   - The broker NEVER mutates a record. Records flow through frozen.
 *
 *   - The broker NEVER blocks on a subscriber. A throwing or hostile
 *     `onRecord` callback is isolated; other subscribers continue to
 *     receive records normally.
 *
 *   - The broker NEVER lets one subscription grow unboundedly.
 *     `maxBufferedRecords` caps the pre-`goLive` buffer. When the
 *     cap is hit the subscription transitions to `overflowed` and
 *     the adapter is signaled via `onOverflow` so it can close the
 *     socket. We do NOT drop records silently — that would create a
 *     consistency gap the subscriber could not detect.
 *
 * Wire protocol context (Phase 4.4 doctrine, see `bridge-admission-doctrine.md`):
 *
 *   1. Client opens a WebSocket and sends `subscribe`.
 *   2. Adapter calls `broker.subscribe(...)` — returns `'buffering'`.
 *      Any record published from this instant onwards is captured
 *      in the per-subscription buffer.
 *   3. Adapter reads backlog from the store via the existing
 *      `BridgeService.readInboundRecords` (cursor-based, monotonic
 *      sequence as the opaque offset, per Electric's Durable Streams
 *      pattern).
 *   4. Adapter calls `handle.goLive(lastBacklogSequence)`. The
 *      broker drains the buffer, dispatching only records with
 *      `sequence > lastBacklogSequence` via `onRecord`, and then
 *      transitions to `live`. Subsequent publishes flow directly
 *      through `onRecord`.
 *   5. Adapter sends frames to the client and tracks ack cursors
 *      for backpressure.
 *
 * The race fix in step 2 is the core reason the broker exists. A
 * naive "fetch backlog then subscribe" sequence loses records
 * published in the gap; a naive "subscribe then fetch backlog" double-
 * delivers them. The `buffering → goLive(afterSequence) → live`
 * handshake closes both gaps with O(buffer) memory and zero
 * persistent cost.
 */
export type BridgeStreamRecord = Readonly<{
  cursor: string;
  sequence: number;
  event: SignedEventEnvelope;
  receivedAt: string;
}>;

export type BridgeStreamSubscriptionState =
  | 'buffering'
  | 'live'
  | 'closed'
  | 'overflowed';

export const DEFAULT_BRIDGE_STREAM_BUFFER = 1000;

export type BridgeStreamSubscriptionHandle = Readonly<{
  readonly subscriberId: string;
  readonly streamKey: string;
  /**
   * Switch from `buffering` to `live`. Synchronously drains any
   * records published while buffering, filters out records the
   * adapter has already delivered via the store backlog
   * (`sequence <= afterSequence`), and dispatches the rest in
   * sequence order via the registered `onRecord`. After this call
   * the subscription is `live` and every subsequent publish is
   * dispatched immediately.
   *
   * Calling `goLive` again is a no-op (subscription already live or
   * closed). Calling on a `closed` or `overflowed` subscription is
   * also a no-op.
   */
  goLive: (afterSequence: number) => void;
  /**
   * Remove the subscription from the broker. After this call, no
   * further records flow to `onRecord`. Idempotent.
   */
  unsubscribe: () => void;
  /** Test/observability. */
  state: () => BridgeStreamSubscriptionState;
  /** Test/observability — current buffer occupancy while buffering. */
  bufferedCount: () => number;
}>;

export type BridgeStreamSubscribeOptions = Readonly<{
  streamKey: string;
  onRecord: (record: BridgeStreamRecord) => void;
  /**
   * Called at most once, when the per-subscription buffer overflows
   * during the `buffering` phase. After this callback fires the
   * subscription state is `overflowed` and no further records are
   * delivered. The adapter is expected to close the underlying
   * socket — the consistency gap is fatal for this connection.
   */
  onOverflow?: () => void;
}>;

export type BridgeStreamBrokerOptions = Readonly<{
  /**
   * Per-subscription pre-`goLive` buffer cap. Defaults to
   * `DEFAULT_BRIDGE_STREAM_BUFFER`. Tests inject a small value to
   * exercise overflow handling.
   */
  maxBufferedRecords?: number;
  /**
   * Test-injectable random-id source. Defaults to a Web-Crypto-based
   * 16-hex token. The runtime adapter never depends on the id format.
   */
  randomId?: () => string;
}>;

type SubscriptionInternal = {
  state: BridgeStreamSubscriptionState;
  buffer: BridgeStreamRecord[];
  onRecord: (record: BridgeStreamRecord) => void;
  onOverflow: (() => void) | undefined;
  streamKey: string;
};

export class BridgeStreamBroker {
  readonly #subscriptionsByStream = new Map<string, Map<string, SubscriptionInternal>>();
  readonly #maxBufferedRecords: number;
  readonly #randomId: () => string;

  constructor(options: BridgeStreamBrokerOptions = {}) {
    const max = options.maxBufferedRecords ?? DEFAULT_BRIDGE_STREAM_BUFFER;
    if (!Number.isSafeInteger(max) || max <= 0) {
      throw new Error('maxBufferedRecords must be a positive safe integer');
    }
    this.#maxBufferedRecords = max;
    this.#randomId = options.randomId ?? defaultRandomId;
  }

  subscribe(options: BridgeStreamSubscribeOptions): BridgeStreamSubscriptionHandle {
    if (typeof options.streamKey !== 'string' || options.streamKey.length === 0) {
      throw new Error('streamKey must be a non-empty string');
    }
    if (typeof options.onRecord !== 'function') {
      throw new Error('onRecord must be a function');
    }
    const subscriberId = this.#randomId();
    const internal: SubscriptionInternal = {
      state: 'buffering',
      buffer: [],
      onRecord: options.onRecord,
      onOverflow: options.onOverflow,
      streamKey: options.streamKey
    };
    let bucket = this.#subscriptionsByStream.get(options.streamKey);
    if (bucket === undefined) {
      bucket = new Map();
      this.#subscriptionsByStream.set(options.streamKey, bucket);
    }
    bucket.set(subscriberId, internal);

    const handle: BridgeStreamSubscriptionHandle = Object.freeze({
      subscriberId,
      streamKey: options.streamKey,
      goLive: (afterSequence: number) => {
        if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
          throw new Error('afterSequence must be a non-negative safe integer');
        }
        if (internal.state !== 'buffering') return;
        // Drain the buffer atomically: filter, sort by sequence, then
        // dispatch. The state flip to `live` happens BEFORE dispatch
        // so any callback that re-enters the broker via publish lands
        // through the live path rather than the buffering path —
        // preserves ordering.
        const drained = internal.buffer
          .filter((r) => r.sequence > afterSequence)
          .sort((a, b) => a.sequence - b.sequence);
        internal.buffer = [];
        internal.state = 'live';
        for (const record of drained) this.#deliverSafely(internal, record);
      },
      unsubscribe: () => {
        if (internal.state === 'closed') return;
        internal.state = 'closed';
        internal.buffer = [];
        const b = this.#subscriptionsByStream.get(options.streamKey);
        if (b !== undefined) {
          b.delete(subscriberId);
          if (b.size === 0) this.#subscriptionsByStream.delete(options.streamKey);
        }
      },
      state: () => internal.state,
      bufferedCount: () => internal.buffer.length
    });
    return handle;
  }

  publish(streamKey: string, record: BridgeStreamRecord): void {
    if (typeof streamKey !== 'string' || streamKey.length === 0) {
      throw new Error('streamKey must be a non-empty string');
    }
    if (!Number.isSafeInteger(record.sequence) || record.sequence < 0) {
      throw new Error('record.sequence must be a non-negative safe integer');
    }
    const bucket = this.#subscriptionsByStream.get(streamKey);
    if (bucket === undefined) return;
    // Snapshot the iteration target so that subscribers calling
    // `unsubscribe` from inside `onRecord` (or `onOverflow`) don't
    // corrupt the live iterator and don't get skipped.
    for (const internal of [...bucket.values()]) {
      if (internal.state === 'closed' || internal.state === 'overflowed') continue;
      if (internal.state === 'buffering') {
        if (internal.buffer.length >= this.#maxBufferedRecords) {
          internal.state = 'overflowed';
          internal.buffer = [];
          if (internal.onOverflow !== undefined) {
            try {
              internal.onOverflow();
            } catch {
              // Isolate — the adapter's own overflow handler must
              // not affect other subscribers or the publish loop.
            }
          }
          continue;
        }
        internal.buffer.push(record);
        continue;
      }
      // 'live' — dispatch immediately. Safety wrapping below.
      this.#deliverSafely(internal, record);
    }
  }

  /**
   * Number of active subscriptions for a stream. Test/observability.
   */
  subscriptionCount(streamKey: string): number {
    return this.#subscriptionsByStream.get(streamKey)?.size ?? 0;
  }

  /**
   * Total active subscriptions across all streams.
   */
  totalSubscriptionCount(): number {
    let n = 0;
    for (const b of this.#subscriptionsByStream.values()) n += b.size;
    return n;
  }

  #deliverSafely(internal: SubscriptionInternal, record: BridgeStreamRecord): void {
    try {
      internal.onRecord(record);
    } catch {
      // Subscriber isolation: one bad subscriber must NEVER prevent
      // a different subscriber from getting its records. The
      // adapter is responsible for closing its own socket on send
      // failure.
    }
  }
}

function defaultRandomId(): string {
  const buf = new Uint8Array(8);
  globalThis.crypto.getRandomValues(buf);
  let out = 'sub-';
  for (const b of buf) out += b.toString(16).padStart(2, '0');
  return out;
}
