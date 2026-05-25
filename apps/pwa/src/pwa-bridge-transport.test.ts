import { describe, expect, it, vi } from 'vitest';
import { preparePwaBridgeTransport } from './pwa-bridge-transport.js';

const ENABLED_CONFIG_ENV = {
  VITE_LFP2P_BRIDGE_SYNC_ENABLED: 'true',
  VITE_LFP2P_BRIDGE_ENDPOINT: 'https://bridge.example.test/events'
} as const;

describe('preparePwaBridgeTransport', () => {
  it('does not create a transport when bridge config is disabled or invalid', () => {
    let createTransportCalls = 0;
    const createTransport = () => {
      createTransportCalls += 1;
      return {
        async send() {
          return { status: 'confirmed' } as const;
        }
      };
    };

    const disabled = preparePwaBridgeTransport({ env: {}, createTransport });
    const invalid = preparePwaBridgeTransport({
      env: { VITE_LFP2P_BRIDGE_SYNC_ENABLED: 'true' },
      createTransport
    });

    expect(disabled).toMatchObject({ status: 'unavailable', reason: 'bridge-config-disabled' });
    expect(invalid).toMatchObject({ status: 'unavailable', reason: 'bridge-config-invalid' });
    expect(createTransportCalls).toBe(0);
  });

  it('returns unavailable when fetch is missing instead of throwing', () => {
    const result = preparePwaBridgeTransport({
      env: ENABLED_CONFIG_ENV,
      fetch: null
    });

    expect(result).toMatchObject({ status: 'unavailable', reason: 'fetch-unavailable' });
  });

  it('prepares transport without network calls until send is invoked', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ status: 'confirmed' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );

    const result = preparePwaBridgeTransport({ env: ENABLED_CONFIG_ENV, fetch: fetchSpy });

    expect(result.status).toBe('prepared');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.message).toBe(
      'Bridge transport prepared but not attached to foreground sync or outbox delivery in this slice.'
    );

    if (result.status !== 'prepared') throw new Error('Expected prepared bridge transport');
    await result.transport.send({
      entry: {
        idempotencyKey: 'idem_transport_prepare_test',
        target: result.config.target
      } as never,
      event: {
        event: {
          eventId: 'evt_transport_prepare_test'
        }
      } as never
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});