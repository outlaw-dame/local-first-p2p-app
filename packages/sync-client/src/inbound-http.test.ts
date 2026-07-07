import { describe, expect, it } from 'vitest';
import { signingKeypairFromSeed, signEventEnvelope } from '@lfp2p/crypto';
import {
  createUnsignedEvent,
  type SignedEventEnvelope,
  placeholderPrivatePayloadEnvelope
} from '@lfp2p/protocol';
import { createHttpBridgeInboundTransport, NonRetryableInboundSyncError } from './inbound-http.js';

describe('createHttpBridgeInboundTransport', () => {
  it('pulls and maps validated bridge records into inbound sync records', async () => {
    const event = makeSignedEvent('evt_inbound_http_001');
    let request: { url: string; body: unknown; credentials?: RequestCredentials } | undefined;
    const transport = createHttpBridgeInboundTransport({
      endpoint: 'https://bridge.test/inbound',
      fetch: async (input, init) => {
        request = {
          url: String(input),
          body: JSON.parse(String(init?.body)),
          credentials: init?.credentials
        };
        return jsonResponse({
          records: [
            {
              cursor: 'cursor-1',
              sequence: 1,
              receivedAt: '2026-05-24T00:00:00.000Z',
              event
            }
          ]
        });
      }
    });

    const records = await transport.pull({
      sourceId: 'bridge:primary',
      streamId: 'durable-stream:inbox',
      scope: 'identity:alice',
      cursor: 'cursor-0',
      limit: 5
    });

    expect(request).toEqual({
      url: 'https://bridge.test/inbound',
      credentials: 'omit',
      body: {
        sourceId: 'bridge:primary',
        streamId: 'durable-stream:inbox',
        scope: 'identity:alice',
        cursor: 'cursor-0',
        limit: 5
      }
    });
    expect(records).toEqual([
      {
        sourceId: 'bridge:primary',
        streamId: 'durable-stream:inbox',
        scope: 'identity:alice',
        cursor: 'cursor-1',
        sequence: 1,
        receivedAt: '2026-05-24T00:00:00.000Z',
        event
      }
    ]);
  });

  it('rejects bridge records that try to override checkpoint identity', async () => {
    const transport = createHttpBridgeInboundTransport({
      endpoint: 'https://bridge.test/inbound',
      fetch: async () =>
        jsonResponse({
          records: [
            {
              sourceId: 'bridge:evil',
              cursor: 'cursor-1',
              sequence: 1,
              event: makeSignedEvent('evt_inbound_http_override')
            }
          ]
        })
    });

    await expect(
      transport.pull({
        sourceId: 'bridge:primary',
        streamId: 'durable-stream:inbox',
        scope: 'identity:alice'
      })
    ).rejects.toThrow(/must not override checkpoint identity/);
  });

  it('rejects malformed successful bridge responses as retryable failures', async () => {
    const transport = createHttpBridgeInboundTransport({
      endpoint: 'https://bridge.test/inbound',
      fetch: async () => new Response('{not json', { status: 200 })
    });

    await expect(
      transport.pull({
        sourceId: 'bridge:primary',
        streamId: 'durable-stream:inbox',
        scope: 'identity:alice'
      })
    ).rejects.toThrow('Bridge returned malformed JSON inbound response');
  });

  it('rejects responses that exceed the requested record limit', async () => {
    const transport = createHttpBridgeInboundTransport({
      endpoint: 'https://bridge.test/inbound',
      fetch: async () =>
        jsonResponse({
          records: [
            { cursor: 'cursor-1', sequence: 1, event: makeSignedEvent('evt_inbound_http_limit_1') },
            { cursor: 'cursor-2', sequence: 2, event: makeSignedEvent('evt_inbound_http_limit_2') }
          ]
        })
    });

    await expect(
      transport.pull({
        sourceId: 'bridge:primary',
        streamId: 'durable-stream:inbox',
        scope: 'identity:alice',
        limit: 1
      })
    ).rejects.toThrow('Bridge returned more inbound records than requested');
  });

  it('treats non-retryable HTTP statuses as terminal inbound sync errors', async () => {
    const transport = createHttpBridgeInboundTransport({
      endpoint: 'https://bridge.test/inbound',
      fetch: async () =>
        new Response(JSON.stringify({ records: 'bad-shape' }), {
          status: 422,
          statusText: 'Unprocessable Content'
        })
    });

    await expect(
      transport.pull({
        sourceId: 'bridge:primary',
        streamId: 'durable-stream:inbox',
        scope: 'identity:alice'
      })
    ).rejects.toBeInstanceOf(NonRetryableInboundSyncError);
  });

  it('times out stalled inbound bridge reads', async () => {
    const transport = createHttpBridgeInboundTransport({
      endpoint: 'https://bridge.test/inbound',
      timeoutMs: 1,
      fetch: async (_input, init) => {
        await waitForAbort(init?.signal);
        throw makeAbortError();
      }
    });

    await expect(
      transport.pull({
        sourceId: 'bridge:primary',
        streamId: 'durable-stream:inbox',
        scope: 'identity:alice'
      })
    ).rejects.toThrow('Bridge inbound request timed out after 1ms');
  });

  it('rejects endpoints with embedded credentials', () => {
    expect(() =>
      createHttpBridgeInboundTransport({ endpoint: 'https://user:pass@bridge.test/inbound' })
    ).toThrow('Bridge endpoint must not include credentials');
  });
});

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init
  });
}

async function waitForAbort(signal: AbortSignal | null | undefined): Promise<void> {
  if (!signal) throw new Error('Expected bridge request abort signal');
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

function makeAbortError(): Error {
  const error = new Error('Request aborted');
  error.name = 'AbortError';
  return error;
}

function makeSignedEvent(eventId: string): SignedEventEnvelope {
  const keypair = signingKeypairFromSeed(new Uint8Array(32).fill(13));
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
