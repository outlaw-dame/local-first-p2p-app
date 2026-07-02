import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { signingKeypairFromSeed, signEventEnvelope } from '@lfp2p/crypto';
import { createLocalFirstStore } from '@lfp2p/local-store';
import {
  createUnsignedEvent,
  type SignedEventEnvelope,
  placeholderPrivatePayloadEnvelope
} from '@lfp2p/protocol';
import {
  InboundSyncIdentityMismatchError,
  InboundSyncLimitExceededError,
  pullAndProcessInboundSyncBatch,
  type InboundSyncPullInput,
  type InboundSyncRecord,
  type InboundSyncTransport
} from './index.js';

describe('pullAndProcessInboundSyncBatch', () => {
  it('pulls from the current checkpoint and applies one returned record', async () => {
    const store = createLocalFirstStore(`inbound-runner-empty-${globalThis.crypto.randomUUID()}`);
    const first = makeRecord('evt_inbound_runner_001', '1', 1);
    const capturedPulls: InboundSyncPullInput[] = [];
    const transport = transportFrom(async (input) => {
      capturedPulls.push(input);
      return [first];
    });

    try {
      const result = await pullAndProcessInboundSyncBatch({
        store,
        transport,
        sourceId: 'bridge:primary',
        streamId: 'stream:inbox',
        scope: 'identity:alice',
        limit: 25,
        now: new Date('2026-05-24T00:00:00.000Z')
      });

      expect(capturedPulls).toEqual([
        { sourceId: 'bridge:primary', streamId: 'stream:inbox', scope: 'identity:alice', limit: 25 }
      ]);
      expect(result).toMatchObject({
        pulled: 1,
        received: 1,
        applied: 1,
        skipped: 0,
        rejected: 0,
        errors: []
      });
      expect(result.checkpointBefore).toBeUndefined();
      expect(result.checkpointAfter).toMatchObject({ cursor: '1', sequence: 1 });
      await expect(store.getSignedEvent('evt_inbound_runner_001')).resolves.toEqual(first.event);
    } finally {
      await store.delete();
    }
  });

  it('uses the stored checkpoint cursor for incremental pulls', async () => {
    const store = createLocalFirstStore(
      `inbound-runner-checkpoint-${globalThis.crypto.randomUUID()}`
    );
    const first = makeRecord('evt_inbound_runner_checkpoint_001', '10', 10);
    const second = makeRecord('evt_inbound_runner_checkpoint_002', '11', 11);
    const capturedPulls: InboundSyncPullInput[] = [];
    const transport = transportFrom(async (input) => {
      capturedPulls.push(input);
      return [second];
    });

    try {
      await store.putSignedEventWithSyncCheckpoint({
        event: first.event,
        checkpoint: {
          sourceId: first.sourceId,
          streamId: first.streamId,
          scope: first.scope,
          cursor: first.cursor,
          sequence: first.sequence,
          updatedAt: first.receivedAt
        }
      });

      const result = await pullAndProcessInboundSyncBatch({
        store,
        transport,
        sourceId: 'bridge:primary',
        streamId: 'stream:inbox',
        scope: 'identity:alice',
        limit: 5
      });

      expect(capturedPulls).toEqual([
        {
          sourceId: 'bridge:primary',
          streamId: 'stream:inbox',
          scope: 'identity:alice',
          cursor: '10',
          limit: 5
        }
      ]);
      expect(result).toMatchObject({
        pulled: 1,
        received: 1,
        applied: 1,
        skipped: 0,
        rejected: 0,
        errors: []
      });
      expect(result.checkpointBefore).toMatchObject({ cursor: '10', sequence: 10 });
      expect(result.checkpointAfter).toMatchObject({ cursor: '11', sequence: 11 });
      await expect(store.getSignedEvent('evt_inbound_runner_checkpoint_002')).resolves.toEqual(
        second.event
      );
    } finally {
      await store.delete();
    }
  });

  it('does not mutate local state when the transport fails before records are returned', async () => {
    const store = createLocalFirstStore(
      `inbound-runner-transport-fail-${globalThis.crypto.randomUUID()}`
    );
    const current = makeRecord('evt_inbound_runner_existing', '20', 20);
    const transport = transportFrom(async () => {
      throw new Error('bridge unavailable');
    });

    try {
      await store.putSignedEventWithSyncCheckpoint({
        event: current.event,
        checkpoint: {
          sourceId: current.sourceId,
          streamId: current.streamId,
          scope: current.scope,
          cursor: current.cursor,
          sequence: current.sequence,
          updatedAt: current.receivedAt
        }
      });

      await expect(
        pullAndProcessInboundSyncBatch({
          store,
          transport,
          sourceId: 'bridge:primary',
          streamId: 'stream:inbox',
          scope: 'identity:alice'
        })
      ).rejects.toThrow('bridge unavailable');

      await expect(
        store.getSyncCheckpoint({
          sourceId: 'bridge:primary',
          streamId: 'stream:inbox',
          scope: 'identity:alice'
        })
      ).resolves.toMatchObject({ cursor: '20', sequence: 20 });
    } finally {
      await store.delete();
    }
  });

  it('rejects checkpoint identity mismatches before applying any returned records', async () => {
    const store = createLocalFirstStore(
      `inbound-runner-identity-mismatch-${globalThis.crypto.randomUUID()}`
    );
    const valid = makeRecord('evt_inbound_runner_valid_before_mismatch', '1', 1);
    const mismatched = {
      ...makeRecord('evt_inbound_runner_mismatch', '2', 2),
      scope: 'identity:mallory'
    };
    const transport = transportFrom(async () => [valid, mismatched]);

    try {
      const promise = pullAndProcessInboundSyncBatch({
        store,
        transport,
        sourceId: 'bridge:primary',
        streamId: 'stream:inbox',
        scope: 'identity:alice'
      });

      await expect(promise).rejects.toThrow(InboundSyncIdentityMismatchError);
      await expect(promise).rejects.toMatchObject({
        code: 'inbound-sync-identity-mismatch',
        recordIndex: 1,
        mismatchFields: ['scope']
      });
      await expect(promise).rejects.not.toThrow('identity:mallory');

      await expect(
        store.getSignedEvent('evt_inbound_runner_valid_before_mismatch')
      ).resolves.toBeUndefined();
      await expect(
        store.getSyncCheckpoint({
          sourceId: 'bridge:primary',
          streamId: 'stream:inbox',
          scope: 'identity:alice'
        })
      ).resolves.toBeUndefined();
    } finally {
      await store.delete();
    }
  });

  it('rejects over-limit transport responses before applying records', async () => {
    const store = createLocalFirstStore(
      `inbound-runner-limit-exceeded-${globalThis.crypto.randomUUID()}`
    );
    const first = makeRecord('evt_inbound_runner_limit_001', '1', 1);
    const second = makeRecord('evt_inbound_runner_limit_002', '2', 2);
    const transport = transportFrom(async () => [first, second]);

    try {
      const promise = pullAndProcessInboundSyncBatch({
        store,
        transport,
        sourceId: 'bridge:primary',
        streamId: 'stream:inbox',
        scope: 'identity:alice',
        limit: 1
      });

      await expect(promise).rejects.toThrow(InboundSyncLimitExceededError);
      await expect(promise).rejects.toMatchObject({
        code: 'inbound-sync-limit-exceeded',
        limit: 1,
        returned: 2
      });
      await expect(store.getSignedEvent('evt_inbound_runner_limit_001')).resolves.toBeUndefined();
      await expect(
        store.getSyncCheckpoint({
          sourceId: 'bridge:primary',
          streamId: 'stream:inbox',
          scope: 'identity:alice'
        })
      ).resolves.toBeUndefined();
    } finally {
      await store.delete();
    }
  });
});

function transportFrom(pull: InboundSyncTransport['pull']): InboundSyncTransport {
  return { pull };
}

function makeRecord(eventId: string, cursor: string, sequence: number): InboundSyncRecord {
  return {
    sourceId: 'bridge:primary',
    streamId: 'stream:inbox',
    scope: 'identity:alice',
    cursor,
    sequence,
    receivedAt: '2026-05-24T00:00:00.000Z',
    event: makeSignedEvent(eventId)
  };
}

function makeSignedEvent(eventId: string): SignedEventEnvelope {
  const keypair = signingKeypairFromSeed(new Uint8Array(32).fill(14));
  return signEventEnvelope(
    createUnsignedEvent({
      eventId,
      kind: 'outbox.test.created',
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: '2026-05-24T00:00:00.000Z',
      privacy: 'dm',
      // Phase 5.0E follow-up: `dm` privacy requires a PrivatePayloadEnvelopeV1.
      payload: placeholderPrivatePayloadEnvelope({ keyId: `placeholder-${eventId}` })
    }),
    keypair
  );
}
