import { describe, expect, it } from 'vitest';
import { generateSigningKeypair, signEventEnvelope } from '@lfp2p/crypto';
import { createUnsignedEvent, type PrivacyScope, type SignedEventEnvelope } from '@lfp2p/protocol';
import { InMemoryBridgeService } from './service.js';
import {
  BridgeStreamBroker,
  type BridgeStreamRecord
} from './stream-broker.js';
import {
  attachBridgeStreamSocket,
  type WebSocketLike
} from './stream-socket.js';

/**
 * MockWebSocket — minimal Web-standard-shaped WebSocket the adapter
 * can drive against. The tests directly invoke the message/close
 * handlers and inspect `sent` to assert wire frames.
 */
type Frame = Record<string, unknown>;

class MockWebSocket implements WebSocketLike {
  readyState = 1; // OPEN
  bufferedAmount = 0;
  sent: string[] = [];
  closed: Readonly<{ code?: number; reason?: string }> | undefined;
  #handlers: Record<string, Array<(arg: unknown) => void>> = {
    message: [],
    close: [],
    error: []
  };
  /**
   * If non-null, every send raises (simulates a runtime where the
   * underlying socket faults mid-write).
   */
  sendError: Error | null = null;

  addEventListener(type: string, handler: (arg: unknown) => void): void {
    this.#handlers[type]!.push(handler);
  }
  removeEventListener(type: string, handler: (arg: unknown) => void): void {
    this.#handlers[type] = (this.#handlers[type] ?? []).filter((h) => h !== handler);
  }
  send(data: string): void {
    if (this.sendError !== null) throw this.sendError;
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    if (this.closed !== undefined) return;
    this.closed = Object.freeze({ code, reason });
    this.readyState = 3; // CLOSED
  }
  fireMessage(data: unknown): void {
    for (const h of this.#handlers.message ?? []) h({ data });
  }
  fireClose(): void {
    for (const h of this.#handlers.close ?? []) h(undefined);
  }
  fireError(): void {
    for (const h of this.#handlers.error ?? []) h(undefined);
  }
  parsedFrames(): Frame[] {
    return this.sent.map((s) => JSON.parse(s) as Frame);
  }
}

/**
 * Fake setInterval / clearInterval pair the adapter uses for
 * heartbeats. Tests call `runTick()` to advance time.
 */
function makeFakeTimers(): {
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  fire: () => void;
} {
  let activeCallback: (() => void) | undefined;
  const setIntervalFn: typeof setInterval = ((cb: () => void) => {
    activeCallback = cb;
    return 1 as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;
  const clearIntervalFn: typeof clearInterval = (() => {
    activeCallback = undefined;
  }) as typeof clearInterval;
  return {
    setInterval: setIntervalFn,
    clearInterval: clearIntervalFn,
    fire: () => activeCallback?.()
  };
}

describe('attachBridgeStreamSocket — Phase 4.4 WebSocket adapter', () => {
  describe('attach: ready frame', () => {
    it('sends a ready frame on attach including the tokenId', async () => {
      const { handle, socket } = await attach({});
      const frames = socket.parsedFrames();
      expect(frames[0]).toEqual({ type: 'ready', tokenId: 'token-A' });
      expect(handle.sentFrames()).toBeGreaterThanOrEqual(1);
    });
  });

  describe('subscribe → backlog → live', () => {
    it('streams backlog before any live frames; cursor monotonic', async () => {
      const { bridge, socket, broker, nowMs } = await attach({});
      // Seed backlog directly via acceptDelivery before the client
      // subscribes; the broker is wired so future deliveries push
      // live frames too. Use timestamps near the adapter's clock so
      // the store's TTL filter doesn't discard them.
      const t = (offsetMs: number) => new Date(nowMs - 60_000 + offsetMs).toISOString();
      await bridge.acceptDelivery(makeDelivery('idem-1', 'stream:inbox', 'evt_1'), t(0));
      await bridge.acceptDelivery(makeDelivery('idem-2', 'stream:inbox', 'evt_2'), t(1_000));

      socket.fireMessage(json({ type: 'subscribe', sourceId: 'src', streamId: 'stream:inbox', scope: 'identity:alice' }));
      await flushMicrotasks();

      const frames = socket.parsedFrames();
      const backlogFrame = frames.find((f) => f.type === 'backlog')!;
      expect(backlogFrame).toBeDefined();
      const records = backlogFrame.records as Array<{ sequence: number }>;
      expect(records).toHaveLength(2);
      const [first, second] = records;
      expect(first!.sequence).toBeLessThan(second!.sequence);
      expect(backlogFrame.cursor).toBe(String(second!.sequence));

      // Now a fresh delivery should arrive as a live frame.
      await bridge.acceptDelivery(makeDelivery('idem-3', 'stream:inbox', 'evt_3'), t(2_000));
      const liveFrames = socket.parsedFrames().filter((f) => f.type === 'live');
      expect(liveFrames).toHaveLength(1);
      const liveRec = liveFrames[0]!.record as { sequence: number };
      expect(liveRec.sequence).toBeGreaterThan(second!.sequence);
      expect(liveFrames[0]!.cursor).toBe(String(liveRec.sequence));

      // Sanity: broker has one active subscription.
      expect(broker.totalSubscriptionCount()).toBe(1);
    });

    it('resumes from a client-supplied cursor — backlog excludes already-seen records', async () => {
      const { bridge, socket, nowMs } = await attach({});
      const t = (offsetMs: number) => new Date(nowMs - 60_000 + offsetMs).toISOString();
      await bridge.acceptDelivery(makeDelivery('idem-1', 'stream:inbox', 'evt_1'), t(0));
      await bridge.acceptDelivery(makeDelivery('idem-2', 'stream:inbox', 'evt_2'), t(1_000));
      const seqTwo = await getLatestSequence(bridge);
      await bridge.acceptDelivery(makeDelivery('idem-3', 'stream:inbox', 'evt_3'), t(2_000));

      socket.fireMessage(
        json({ type: 'subscribe', sourceId: 'src', streamId: 'stream:inbox', scope: 'identity:alice', cursor: String(seqTwo) })
      );
      await flushMicrotasks();

      const backlog = socket.parsedFrames().find((f) => f.type === 'backlog');
      const records = backlog!.records as Array<{ sequence: number }>;
      expect(records).toHaveLength(1);
      expect(records[0]!.sequence).toBeGreaterThan(seqTwo);
    });

    it('race fix: records published during backlog read are NOT lost and NOT double-delivered', async () => {
      const broker = new BridgeStreamBroker();
      const bridge = new InMemoryBridgeService({ initialSequence: 0, streamBroker: broker });
      const fixedNowMs = 1_700_000_000_000;
      const t = (offsetMs: number) => new Date(fixedNowMs - 60_000 + offsetMs).toISOString();
      await bridge.acceptDelivery(makeDelivery('idem-1', 'stream:inbox', 'evt_1'), t(0));
      await bridge.acceptDelivery(makeDelivery('idem-2', 'stream:inbox', 'evt_2'), t(1_000));

      // Patch readInboundRecords to publish a 3rd record DURING the
      // call — simulating a race where a delivery arrives after the
      // backlog query begins but before goLive.
      const origRead = bridge.readInboundRecords.bind(bridge);
      let raceFired = false;
      (bridge as unknown as { readInboundRecords: typeof origRead }).readInboundRecords = async (
        ...args
      ) => {
        const result = await origRead(...args);
        if (!raceFired) {
          raceFired = true;
          await bridge.acceptDelivery(makeDelivery('idem-3', 'stream:inbox', 'evt_3'), t(2_000));
        }
        return result;
      };

      const socket = new MockWebSocket();
      const timers = makeFakeTimers();
      attachBridgeStreamSocket({
        service: bridge,
        broker,
        socket,
        tokenId: 'token-A',
        now: () => fixedNowMs,
        setIntervalFn: timers.setInterval,
        clearIntervalFn: timers.clearInterval
      });

      socket.fireMessage(json({ type: 'subscribe', sourceId: 'src', streamId: 'stream:inbox', scope: 'identity:alice' }));
      await flushMicrotasks();

      const frames = socket.parsedFrames();
      const backlog = frames.find((f) => f.type === 'backlog');
      const live = frames.filter((f) => f.type === 'live');
      const backlogSequences = (backlog!.records as Array<{ sequence: number }>).map((r) => r.sequence);
      const liveSequences = live.map((f) => (f.record as { sequence: number }).sequence);

      // Backlog covers the first 2; the race record (3rd) is
      // delivered exactly once — via the broker's buffer drain on
      // goLive — not twice.
      expect(backlogSequences).toHaveLength(2);
      expect(liveSequences).toHaveLength(1);
      // The live record must have a strictly greater sequence than
      // the tail of the backlog (no duplicates, no reordering).
      expect(liveSequences[0]).toBeGreaterThan(backlogSequences[backlogSequences.length - 1]!);
    });

    it('subscribe with no records sends an empty backlog frame and stays live', async () => {
      const { socket } = await attach({});
      socket.fireMessage(json({ type: 'subscribe', sourceId: 'src', streamId: 'stream:empty', scope: 'identity:alice' }));
      await flushMicrotasks();
      const backlog = socket.parsedFrames().find((f) => f.type === 'backlog')!;
      expect(backlog.records).toEqual([]);
      expect(backlog.cursor).toBe('0');
    });
  });

  describe('subscribe validation — privacy-safe close + protocol-error frames', () => {
    it('rejects re-subscribe on the same socket with protocol-error close', async () => {
      const { socket } = await attach({});
      socket.fireMessage(json({ type: 'subscribe', sourceId: 'src', streamId: 'stream:inbox', scope: 'identity:alice' }));
      await flushMicrotasks();
      socket.fireMessage(json({ type: 'subscribe', sourceId: 'src', streamId: 'stream:other', scope: 'identity:alice' }));
      await flushMicrotasks();
      expect(socket.closed?.code).toBe(1002);
      expect(socket.closed?.reason).toBe('already-subscribed');
    });

    it('rejects invalid subscribe frame (missing fields)', async () => {
      const { socket } = await attach({});
      socket.fireMessage(json({ type: 'subscribe', sourceId: 'src' }));
      expect(socket.closed?.code).toBe(1002);
      expect(socket.closed?.reason).toBe('invalid-subscribe');
    });

    it('rejects invalid cursor (non-numeric)', async () => {
      const { socket } = await attach({});
      socket.fireMessage(
        json({ type: 'subscribe', sourceId: 'src', streamId: 'x', scope: 's', cursor: 'not-a-number' })
      );
      expect(socket.closed?.code).toBe(1002);
      expect(socket.closed?.reason).toBe('invalid-cursor');
    });

    it('rejects invalid backlogLimit (too large)', async () => {
      const { socket } = await attach({});
      socket.fireMessage(
        json({ type: 'subscribe', sourceId: 'src', streamId: 'x', scope: 's', backlogLimit: 10_000 })
      );
      expect(socket.closed?.code).toBe(1002);
      expect(socket.closed?.reason).toBe('invalid-backlog-limit');
    });
  });

  describe('hostile inbound frames', () => {
    it('rejects oversized inbound frame with message-too-big', async () => {
      const { socket } = await attach({ maxFrameBytes: 64 });
      socket.fireMessage('x'.repeat(65)); // > cap by 1
      expect(socket.closed?.code).toBe(1009);
      expect(socket.closed?.reason).toBe('inbound-frame-too-big');
    });

    it('rejects binary frame with policy-violation', async () => {
      const { socket } = await attach({});
      socket.fireMessage(new Uint8Array([1, 2, 3]));
      expect(socket.closed?.code).toBe(1008);
      expect(socket.closed?.reason).toBe('binary-not-allowed');
    });

    it('rejects malformed JSON with protocol-error', async () => {
      const { socket } = await attach({});
      socket.fireMessage('not-json');
      expect(socket.closed?.code).toBe(1002);
      expect(socket.closed?.reason).toBe('invalid-json');
    });

    it('rejects non-record JSON', async () => {
      const { socket } = await attach({});
      socket.fireMessage(JSON.stringify([]));
      expect(socket.closed?.code).toBe(1002);
      expect(socket.closed?.reason).toBe('invalid-frame');
    });

    it('rejects unknown type', async () => {
      const { socket } = await attach({});
      socket.fireMessage(json({ type: 'attack' }));
      expect(socket.closed?.code).toBe(1002);
      expect(socket.closed?.reason).toBe('unknown-frame-type');
    });

    it('inbound rate limit: closes after exceeding maxInboundFramesPerMinute', async () => {
      const { socket } = await attach({ maxInboundFramesPerMinute: 3 });
      // Send 4 frames; 4th should trip the limit. Use ping (cheap and valid).
      socket.fireMessage(json({ type: 'ping' }));
      socket.fireMessage(json({ type: 'ping' }));
      socket.fireMessage(json({ type: 'ping' }));
      socket.fireMessage(json({ type: 'ping' }));
      expect(socket.closed?.code).toBe(1008);
      expect(socket.closed?.reason).toBe('inbound-rate-limit-exceeded');
    });
  });

  describe('ping / pong', () => {
    it('responds to client ping with pong', async () => {
      const { socket } = await attach({});
      socket.fireMessage(json({ type: 'ping' }));
      const frames = socket.parsedFrames();
      expect(frames.some((f) => f.type === 'pong')).toBe(true);
    });
  });

  describe('heartbeat', () => {
    it('server sends periodic ping; closes after no inbound within timeout', async () => {
      let nowMs = 1_700_000_000_000;
      const { socket, fire } = await attach({
        heartbeatIntervalMs: 1_000,
        heartbeatTimeoutMs: 5_000,
        nowOverride: () => nowMs
      });
      // Fire heartbeat at t=1s — within timeout, sends ping.
      nowMs += 1_000;
      fire();
      expect(socket.parsedFrames().some((f) => f.type === 'ping')).toBe(true);
      // Advance well past the timeout without any inbound activity.
      nowMs += 60_000;
      fire();
      expect(socket.closed?.code).toBe(1001);
      expect(socket.closed?.reason).toBe('heartbeat-timeout');
    });
  });

  describe('backpressure', () => {
    it('closes with try-again-later when bufferedAmount exceeds cap', async () => {
      const { socket, bridge, nowMs } = await attach({ maxBufferedBytes: 100 });
      socket.fireMessage(json({ type: 'subscribe', sourceId: 'src', streamId: 'stream:inbox', scope: 'identity:alice' }));
      await flushMicrotasks();
      // Simulate the runtime reporting a big buffered amount BEFORE
      // the next send happens.
      socket.bufferedAmount = 10_000;
      await bridge.acceptDelivery(
        makeDelivery('idem-1', 'stream:inbox', 'evt_1'),
        new Date(nowMs).toISOString()
      );
      // bridge.acceptDelivery calls broker.publish synchronously on
      // a successful insert; the close fires on that publish path.
      expect(socket.closed?.code).toBe(1013);
      expect(socket.closed?.reason).toBe('backpressure-overflow');
    });
  });

  describe('socket failures', () => {
    it('closes the socket cleanly when the runtime fires close', async () => {
      const { socket, handle } = await attach({});
      socket.fireClose();
      expect(handle.state()).toBe('closed');
    });

    it('closes when the runtime fires error', async () => {
      const { socket, handle } = await attach({});
      socket.fireError();
      expect(handle.state()).toBe('closed');
    });

    it('throwing socket.send closes the connection', async () => {
      const { socket } = await attach({});
      socket.sendError = new Error('runtime down');
      socket.fireMessage(json({ type: 'ping' }));
      expect(socket.closed?.code).toBe(1001);
      expect(socket.closed?.reason).toBe('send-failed');
    });
  });

  describe('privacy-safe outbound frames', () => {
    it('error close reasons never echo the offending input', async () => {
      const { socket } = await attach({});
      // Hostile cursor with embedded "payload" — must not appear in
      // the close reason.
      socket.fireMessage(
        json({ type: 'subscribe', sourceId: 'src', streamId: 'x', scope: 's', cursor: 'evil-payload-xyz' })
      );
      expect(socket.closed?.reason).toBe('invalid-cursor');
      const closeReason = JSON.stringify(socket.closed);
      expect(closeReason).not.toContain('evil-payload');
    });
  });

  describe('client unsubscribe', () => {
    it('closes the socket cleanly with code 1000', async () => {
      const { socket } = await attach({});
      socket.fireMessage(json({ type: 'unsubscribe' }));
      expect(socket.closed?.code).toBe(1000);
    });
  });

  describe('ack frames', () => {
    it('valid ack is accepted (no-op v1)', async () => {
      const { socket } = await attach({});
      const before = socket.sent.length;
      socket.fireMessage(json({ type: 'ack', cursor: '5' }));
      // No outbound frame should be sent in response and no close.
      expect(socket.sent.length).toBe(before);
      expect(socket.closed).toBeUndefined();
    });

    it('invalid ack returns an error frame (not a close — ack is recoverable)', async () => {
      const { socket } = await attach({});
      socket.fireMessage(json({ type: 'ack' }));
      const errFrame = socket.parsedFrames().find((f) => f.type === 'error');
      expect(errFrame?.code).toBe('invalid-ack');
      expect(socket.closed).toBeUndefined();
    });
  });

  describe('explicit close from handle', () => {
    it('close() is idempotent and unsubscribes from the broker', async () => {
      const { handle, broker, socket } = await attach({});
      socket.fireMessage(json({ type: 'subscribe', sourceId: 'src', streamId: 'stream:inbox', scope: 'identity:alice' }));
      await flushMicrotasks();
      expect(broker.totalSubscriptionCount()).toBe(1);
      handle.close(1000, 'test');
      handle.close(1000, 'test'); // idempotent
      expect(broker.totalSubscriptionCount()).toBe(0);
      expect(handle.state()).toBe('closed');
    });
  });

  describe('attach validation', () => {
    it('rejects empty tokenId', () => {
      const broker = new BridgeStreamBroker();
      const bridge = new InMemoryBridgeService({ streamBroker: broker });
      expect(() =>
        attachBridgeStreamSocket({ service: bridge, broker, socket: new MockWebSocket(), tokenId: '' })
      ).toThrow();
    });

    it('rejects heartbeatTimeoutMs <= heartbeatIntervalMs', () => {
      const broker = new BridgeStreamBroker();
      const bridge = new InMemoryBridgeService({ streamBroker: broker });
      expect(() =>
        attachBridgeStreamSocket({
          service: bridge,
          broker,
          socket: new MockWebSocket(),
          tokenId: 'a',
          heartbeatIntervalMs: 1_000,
          heartbeatTimeoutMs: 1_000
        })
      ).toThrow();
    });
  });
});

// -- test helpers ------------------------------------------------------

/**
 * Test fixture clock. All deliveries should use ISO timestamps near
 * this value so the bridge store's TTL filter doesn't discard the
 * records seeded by tests. The adapter's `now` defaults to this
 * clock too unless `nowOverride` is supplied.
 */
const FIXED_NOW_MS = 1_700_000_000_000;

async function attach(opts: {
  maxFrameBytes?: number;
  maxBufferedBytes?: number;
  maxInboundFramesPerMinute?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  nowOverride?: () => number;
}): Promise<{
  bridge: InMemoryBridgeService;
  broker: BridgeStreamBroker;
  socket: MockWebSocket;
  handle: ReturnType<typeof attachBridgeStreamSocket>;
  fire: () => void;
  nowMs: number;
}> {
  const broker = new BridgeStreamBroker();
  const bridge = new InMemoryBridgeService({ initialSequence: 0, streamBroker: broker });
  const socket = new MockWebSocket();
  const timers = makeFakeTimers();
  const handle = attachBridgeStreamSocket({
    service: bridge,
    broker,
    socket,
    tokenId: 'token-A',
    now: opts.nowOverride ?? (() => FIXED_NOW_MS),
    setIntervalFn: timers.setInterval,
    clearIntervalFn: timers.clearInterval,
    ...(opts.maxFrameBytes === undefined ? {} : { maxFrameBytes: opts.maxFrameBytes }),
    ...(opts.maxBufferedBytes === undefined ? {} : { maxBufferedBytes: opts.maxBufferedBytes }),
    ...(opts.maxInboundFramesPerMinute === undefined ? {} : { maxInboundFramesPerMinute: opts.maxInboundFramesPerMinute }),
    ...(opts.heartbeatIntervalMs === undefined ? {} : { heartbeatIntervalMs: opts.heartbeatIntervalMs }),
    ...(opts.heartbeatTimeoutMs === undefined ? {} : { heartbeatTimeoutMs: opts.heartbeatTimeoutMs })
  });
  return { bridge, broker, socket, handle, fire: timers.fire, nowMs: FIXED_NOW_MS };
}

async function getLatestSequence(bridge: InMemoryBridgeService): Promise<number> {
  const snap = await bridge.snapshot(new Date(FIXED_NOW_MS).toISOString());
  return snap.latestSequence;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeDelivery(
  idempotencyKey: string,
  target: string,
  eventId: string
): {
  idempotencyKey: string;
  target: string;
  event: SignedEventEnvelope;
} {
  return { idempotencyKey, target, event: makeSignedEvent({ eventId, privacy: 'public' }) };
}

function makeSignedEvent(input: { eventId: string; privacy: PrivacyScope }): SignedEventEnvelope {
  const keypair = generateSigningKeypair();
  return signEventEnvelope(
    createUnsignedEvent({
      eventId: input.eventId,
      kind: 'outbox.test.created',
      author: `identity:${keypair.publicKey}`,
      deviceId: `device:${keypair.publicKey.slice(0, 16)}`,
      createdAt: '2026-05-24T00:00:00.000Z',
      privacy: input.privacy,
      payload: { body: input.eventId }
    }),
    keypair
  );
}

// Silence "unused" lint on BridgeStreamRecord import for shape parity.
void ({} as BridgeStreamRecord);
