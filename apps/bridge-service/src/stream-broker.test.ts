import { describe, expect, it } from 'vitest';
import { generateSigningKeypair, signEventEnvelope } from '@lfp2p/crypto';
import { createUnsignedEvent, type PrivacyScope, type SignedEventEnvelope } from '@lfp2p/protocol';
import { BridgeStreamBroker, type BridgeStreamRecord } from './stream-broker.js';

describe('BridgeStreamBroker — Phase 4.4 broker', () => {
  describe('constructor validation', () => {
    it('rejects non-positive maxBufferedRecords', () => {
      expect(() => new BridgeStreamBroker({ maxBufferedRecords: 0 })).toThrow();
      expect(() => new BridgeStreamBroker({ maxBufferedRecords: -1 })).toThrow();
      expect(() => new BridgeStreamBroker({ maxBufferedRecords: 1.5 })).toThrow();
    });

    it('accepts default and explicit positive value', () => {
      expect(() => new BridgeStreamBroker()).not.toThrow();
      expect(() => new BridgeStreamBroker({ maxBufferedRecords: 10 })).not.toThrow();
    });
  });

  describe('subscribe / publish — live mode', () => {
    it('subscriber in live mode receives each published record exactly once', () => {
      const broker = new BridgeStreamBroker();
      const received: BridgeStreamRecord[] = [];
      const handle = broker.subscribe({
        streamKey: 'stream:inbox',
        onRecord: (r) => received.push(r)
      });
      handle.goLive(0);

      broker.publish('stream:inbox', makeRecord(1));
      broker.publish('stream:inbox', makeRecord(2));
      broker.publish('stream:inbox', makeRecord(3));

      expect(received.map((r) => r.sequence)).toEqual([1, 2, 3]);
      expect(handle.state()).toBe('live');
    });

    it('does not deliver to subscribers of a different stream', () => {
      const broker = new BridgeStreamBroker();
      const inbox: BridgeStreamRecord[] = [];
      const other: BridgeStreamRecord[] = [];
      const a = broker.subscribe({ streamKey: 'stream:inbox', onRecord: (r) => inbox.push(r) });
      const b = broker.subscribe({ streamKey: 'stream:other', onRecord: (r) => other.push(r) });
      a.goLive(0);
      b.goLive(0);

      broker.publish('stream:inbox', makeRecord(7));
      broker.publish('stream:other', makeRecord(8));

      expect(inbox.map((r) => r.sequence)).toEqual([7]);
      expect(other.map((r) => r.sequence)).toEqual([8]);
    });
  });

  describe('subscribe → buffering → goLive race fix', () => {
    it('records published while buffering are drained on goLive (filtering by afterSequence)', () => {
      const broker = new BridgeStreamBroker();
      const received: BridgeStreamRecord[] = [];
      const handle = broker.subscribe({
        streamKey: 'stream:inbox',
        onRecord: (r) => received.push(r)
      });
      // Publish during the buffering phase — these are records that
      // landed in the store while the adapter was still reading
      // backlog.
      broker.publish('stream:inbox', makeRecord(5));
      broker.publish('stream:inbox', makeRecord(6));
      broker.publish('stream:inbox', makeRecord(7));

      expect(handle.state()).toBe('buffering');
      expect(handle.bufferedCount()).toBe(3);
      expect(received).toHaveLength(0);

      // Simulate the adapter having delivered backlog up through
      // sequence 5 via the store; goLive should drain 6 + 7.
      handle.goLive(5);

      expect(received.map((r) => r.sequence)).toEqual([6, 7]);
      expect(handle.state()).toBe('live');
      expect(handle.bufferedCount()).toBe(0);
    });

    it('drained buffer is dispatched in sequence order even if publishes arrived out of order', () => {
      // Defensive: the broker should never assume the publisher delivers
      // in order, even though the bridge does today.
      const broker = new BridgeStreamBroker();
      const received: BridgeStreamRecord[] = [];
      const handle = broker.subscribe({
        streamKey: 'stream:inbox',
        onRecord: (r) => received.push(r)
      });
      broker.publish('stream:inbox', makeRecord(11));
      broker.publish('stream:inbox', makeRecord(9));
      broker.publish('stream:inbox', makeRecord(10));
      handle.goLive(8);

      expect(received.map((r) => r.sequence)).toEqual([9, 10, 11]);
    });

    it('goLive on a non-buffering subscription is a no-op', () => {
      const broker = new BridgeStreamBroker();
      const received: BridgeStreamRecord[] = [];
      const handle = broker.subscribe({
        streamKey: 'stream:inbox',
        onRecord: (r) => received.push(r)
      });
      handle.goLive(0);
      // Calling again is a no-op (does not double-deliver).
      handle.goLive(0);
      broker.publish('stream:inbox', makeRecord(1));
      expect(received).toHaveLength(1);
    });
  });

  describe('buffer overflow', () => {
    it('signals onOverflow once when the buffer exceeds the cap; subsequent publishes are dropped', () => {
      const broker = new BridgeStreamBroker({ maxBufferedRecords: 2 });
      let overflowCount = 0;
      const received: BridgeStreamRecord[] = [];
      const handle = broker.subscribe({
        streamKey: 'stream:inbox',
        onRecord: (r) => received.push(r),
        onOverflow: () => overflowCount++
      });
      broker.publish('stream:inbox', makeRecord(1));
      broker.publish('stream:inbox', makeRecord(2));
      // Third publish should trip the overflow.
      broker.publish('stream:inbox', makeRecord(3));
      // Further publishes must be no-ops on this subscription and
      // must NOT fire overflow again.
      broker.publish('stream:inbox', makeRecord(4));
      broker.publish('stream:inbox', makeRecord(5));

      expect(handle.state()).toBe('overflowed');
      expect(overflowCount).toBe(1);
      // After overflow, goLive must not deliver anything.
      handle.goLive(0);
      expect(received).toHaveLength(0);
    });

    it('overflow on one subscription does not affect a healthy sibling on the same stream', () => {
      const broker = new BridgeStreamBroker({ maxBufferedRecords: 1 });
      const healthy: BridgeStreamRecord[] = [];
      let badOverflowed = false;
      const bad = broker.subscribe({
        streamKey: 'stream:inbox',
        onRecord: () => {
          /* never goes live */
        },
        onOverflow: () => {
          badOverflowed = true;
        }
      });
      const good = broker.subscribe({
        streamKey: 'stream:inbox',
        onRecord: (r) => healthy.push(r)
      });
      good.goLive(0);

      broker.publish('stream:inbox', makeRecord(1));
      broker.publish('stream:inbox', makeRecord(2));

      expect(badOverflowed).toBe(true);
      expect(bad.state()).toBe('overflowed');
      expect(healthy.map((r) => r.sequence)).toEqual([1, 2]);
      expect(good.state()).toBe('live');
    });

    it('throwing onOverflow does not crash the publish loop', () => {
      const broker = new BridgeStreamBroker({ maxBufferedRecords: 1 });
      const healthy: BridgeStreamRecord[] = [];
      broker.subscribe({
        streamKey: 'stream:inbox',
        onRecord: () => undefined,
        onOverflow: () => {
          throw new Error('hostile overflow handler');
        }
      });
      const good = broker.subscribe({
        streamKey: 'stream:inbox',
        onRecord: (r) => healthy.push(r)
      });
      good.goLive(0);

      expect(() => {
        broker.publish('stream:inbox', makeRecord(1));
        broker.publish('stream:inbox', makeRecord(2));
      }).not.toThrow();
      expect(healthy.map((r) => r.sequence)).toEqual([1, 2]);
    });
  });

  describe('subscriber isolation', () => {
    it('a throwing onRecord does not affect other subscribers on the same stream', () => {
      const broker = new BridgeStreamBroker();
      const a: BridgeStreamRecord[] = [];
      const c: BridgeStreamRecord[] = [];
      const subA = broker.subscribe({ streamKey: 'stream:inbox', onRecord: (r) => a.push(r) });
      const subB = broker.subscribe({
        streamKey: 'stream:inbox',
        onRecord: () => {
          throw new Error('hostile subscriber');
        }
      });
      const subC = broker.subscribe({ streamKey: 'stream:inbox', onRecord: (r) => c.push(r) });
      subA.goLive(0);
      subB.goLive(0);
      subC.goLive(0);

      broker.publish('stream:inbox', makeRecord(1));

      expect(a.map((r) => r.sequence)).toEqual([1]);
      expect(c.map((r) => r.sequence)).toEqual([1]);
    });

    it('a subscriber that calls unsubscribe inside its own onRecord does not break iteration', () => {
      const broker = new BridgeStreamBroker();
      const c: BridgeStreamRecord[] = [];
      let aHandle: ReturnType<BridgeStreamBroker['subscribe']>;
      // eslint-disable-next-line prefer-const
      aHandle = broker.subscribe({
        streamKey: 'stream:inbox',
        onRecord: () => aHandle.unsubscribe()
      });
      const cHandle = broker.subscribe({ streamKey: 'stream:inbox', onRecord: (r) => c.push(r) });
      aHandle.goLive(0);
      cHandle.goLive(0);

      broker.publish('stream:inbox', makeRecord(1));
      expect(c.map((r) => r.sequence)).toEqual([1]);
      expect(aHandle.state()).toBe('closed');
    });
  });

  describe('unsubscribe', () => {
    it('is idempotent and removes the subscription bucket when last subscriber leaves', () => {
      const broker = new BridgeStreamBroker();
      const handle = broker.subscribe({ streamKey: 'stream:inbox', onRecord: () => undefined });
      expect(broker.subscriptionCount('stream:inbox')).toBe(1);
      handle.unsubscribe();
      handle.unsubscribe();
      expect(handle.state()).toBe('closed');
      expect(broker.subscriptionCount('stream:inbox')).toBe(0);
      expect(broker.totalSubscriptionCount()).toBe(0);
    });

    it('after unsubscribe, no further records are delivered', () => {
      const broker = new BridgeStreamBroker();
      const received: BridgeStreamRecord[] = [];
      const handle = broker.subscribe({
        streamKey: 'stream:inbox',
        onRecord: (r) => received.push(r)
      });
      handle.goLive(0);
      broker.publish('stream:inbox', makeRecord(1));
      handle.unsubscribe();
      broker.publish('stream:inbox', makeRecord(2));
      expect(received.map((r) => r.sequence)).toEqual([1]);
    });
  });

  describe('publish validation', () => {
    it('rejects empty streamKey', () => {
      const broker = new BridgeStreamBroker();
      expect(() => broker.publish('', makeRecord(1))).toThrow();
    });
    it('rejects negative or non-integer sequence', () => {
      const broker = new BridgeStreamBroker();
      broker.subscribe({ streamKey: 'stream:inbox', onRecord: () => undefined }).goLive(0);
      expect(() => broker.publish('stream:inbox', makeRecord(-1))).toThrow();
      expect(() => broker.publish('stream:inbox', makeRecord(1.5))).toThrow();
    });
  });

  describe('subscribe validation', () => {
    it('rejects empty streamKey', () => {
      const broker = new BridgeStreamBroker();
      expect(() => broker.subscribe({ streamKey: '', onRecord: () => undefined })).toThrow();
    });
    it('rejects non-function onRecord', () => {
      const broker = new BridgeStreamBroker();
      expect(() =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        broker.subscribe({ streamKey: 'x', onRecord: 'not-a-function' as any })
      ).toThrow();
    });
  });
});

function makeRecord(sequence: number): BridgeStreamRecord {
  return Object.freeze({
    cursor: String(sequence),
    sequence,
    event: makeSignedEvent({ eventId: `evt_${sequence}`, privacy: 'public' }),
    receivedAt: new Date(sequence * 1_000).toISOString()
  });
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
