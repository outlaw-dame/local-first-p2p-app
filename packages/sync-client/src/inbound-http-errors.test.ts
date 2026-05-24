import { describe, expect, it } from 'vitest';
import { createHttpBridgeInboundTransport, NonRetryableInboundSyncError } from './inbound-http.js';

describe('createHttpBridgeInboundTransport error responses', () => {
  it('uses reason from a failed bridge response body', async () => {
    const transport = createHttpBridgeInboundTransport({
      endpoint: 'https://bridge.test/inbound',
      fetch: async () => jsonResponse({ reason: 'Invalid cursor' }, { status: 422, statusText: 'Unprocessable Content' })
    });

    await expect(
      transport.pull({ sourceId: 'bridge:primary', streamId: 'durable-stream:inbox', scope: 'identity:alice' })
    ).rejects.toThrow('Invalid cursor');
  });

  it('falls back to HTTP status text when a failed response lacks a readable reason', async () => {
    const transport = createHttpBridgeInboundTransport({
      endpoint: 'https://bridge.test/inbound',
      fetch: async () => jsonResponse({ records: 'bad-shape' }, { status: 422, statusText: 'Unprocessable Content' })
    });

    await expect(
      transport.pull({ sourceId: 'bridge:primary', streamId: 'durable-stream:inbox', scope: 'identity:alice' })
    ).rejects.toThrow('Unprocessable Content');
  });

  it('keeps terminal failed responses classified as non-retryable', async () => {
    const transport = createHttpBridgeInboundTransport({
      endpoint: 'https://bridge.test/inbound',
      fetch: async () => jsonResponse({ reason: 'Invalid cursor' }, { status: 422, statusText: 'Unprocessable Content' })
    });

    await expect(
      transport.pull({ sourceId: 'bridge:primary', streamId: 'durable-stream:inbox', scope: 'identity:alice' })
    ).rejects.toBeInstanceOf(NonRetryableInboundSyncError);
  });
});

function jsonResponse(value: unknown, init: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    ...init
  });
}
