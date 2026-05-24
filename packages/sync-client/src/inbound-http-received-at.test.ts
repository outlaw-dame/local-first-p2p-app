import { describe, expect, it } from 'vitest';
import { createHttpBridgeInboundTransport } from './inbound-http.js';

describe('createHttpBridgeInboundTransport receivedAt validation', () => {
  it('rejects non-canonical date strings for receivedAt', async () => {
    const transport = createHttpBridgeInboundTransport({
      endpoint: 'https://bridge.test/inbound',
      fetch: async () =>
        jsonResponse({
          records: [
            {
              cursor: 'cursor-1',
              sequence: 1,
              receivedAt: '2026-05-24 00:00:00',
              event: { eventId: 'evt_non_canonical_received_at' }
            }
          ]
        })
    });

    await expect(
      transport.pull({ sourceId: 'bridge:primary', streamId: 'durable-stream:inbox', scope: 'identity:alice' })
    ).rejects.toThrow('Bridge inbound record 0 receivedAt must be a canonical ISO date string');
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}
