import { describe, expect, it } from 'vitest';
import { formatPwaBridgeConfigStatus, resolvePwaBridgeConfig } from './pwa-bridge-config.js';

const ENABLED_ENV = { VITE_LFP2P_BRIDGE_SYNC_ENABLED: 'true' } as const;
const CONFIGURED_ENV = {
  ...ENABLED_ENV,
  VITE_LFP2P_BRIDGE_ENDPOINT: 'https://bridge.example.test/events'
} as const;
const SAMPLE_AUTH_VALUE = 'opaque-dev-value-123';

describe('PWA bridge config boundary', () => {
  it('is disabled unless explicitly enabled', () => {
    expect(resolvePwaBridgeConfig({})).toMatchObject({ status: 'disabled', reason: 'not-enabled' });
    expect(resolvePwaBridgeConfig({ VITE_LFP2P_BRIDGE_SYNC_ENABLED: 'false' })).toMatchObject({
      status: 'disabled',
      reason: 'not-enabled'
    });
  });

  it('requires an endpoint when enabled', () => {
    expect(resolvePwaBridgeConfig(ENABLED_ENV)).toMatchObject({
      status: 'invalid',
      reason: 'missing-endpoint'
    });
  });

  it('accepts https endpoints without wiring transport', () => {
    const config = resolvePwaBridgeConfig({
      ...ENABLED_ENV,
      VITE_LFP2P_BRIDGE_ENDPOINT: 'https://bridge.example.test/events',
      VITE_LFP2P_BRIDGE_TARGET: 'bridge:primary',
      VITE_LFP2P_BRIDGE_TIMEOUT_MS: '15000'
    });

    expect(config).toEqual({
      status: 'configured',
      endpoint: 'https://bridge.example.test/events',
      target: 'bridge:primary',
      timeoutMs: 15_000,
      transportWired: false,
      message: 'Bridge endpoint is configured, but PWA bridge transport is not wired in this slice.'
    });
    expect(formatPwaBridgeConfigStatus(config)).toBe(
      'Bridge config ready for future transport: bridge.example.test (bridge:primary; no auth token configured).'
    );
  });

  it('accepts dev-only bridge auth without exposing the value in status text', () => {
    const config = resolvePwaBridgeConfig({
      ...CONFIGURED_ENV,
      DEV: true,
      VITE_LFP2P_BRIDGE_AUTH_BEARER_TOKEN: SAMPLE_AUTH_VALUE
    });

    expect(config).toMatchObject({
      status: 'configured',
      auth: { scheme: 'bearer', token: SAMPLE_AUTH_VALUE }
    });
    expect(formatPwaBridgeConfigStatus(config)).toBe(
      'Bridge config ready for future transport: bridge.example.test (bridge:development; dev bearer auth token configured).'
    );
    expect(formatPwaBridgeConfigStatus(config)).not.toContain(SAMPLE_AUTH_VALUE);
  });

  it('rejects bridge auth outside Vite dev runtime', () => {
    expect(
      resolvePwaBridgeConfig({
        ...CONFIGURED_ENV,
        VITE_LFP2P_BRIDGE_AUTH_BEARER_TOKEN: SAMPLE_AUTH_VALUE
      })
    ).toMatchObject({ status: 'invalid', reason: 'auth-token-requires-dev-mode' });
    expect(
      resolvePwaBridgeConfig({
        ...CONFIGURED_ENV,
        DEV: false,
        VITE_LFP2P_BRIDGE_AUTH_BEARER_TOKEN: SAMPLE_AUTH_VALUE
      })
    ).toMatchObject({ status: 'invalid', reason: 'auth-token-requires-dev-mode' });
  });

  it('rejects unsafe bridge auth material', () => {
    expect(
      resolvePwaBridgeConfig({
        ...CONFIGURED_ENV,
        DEV: true,
        VITE_LFP2P_BRIDGE_AUTH_BEARER_TOKEN: 'value with spaces'
      })
    ).toMatchObject({ status: 'invalid', reason: 'invalid-auth-token' });
    expect(
      resolvePwaBridgeConfig({
        ...CONFIGURED_ENV,
        DEV: true,
        VITE_LFP2P_BRIDGE_AUTH_BEARER_TOKEN: 'value\nnewline'
      })
    ).toMatchObject({ status: 'invalid', reason: 'invalid-auth-token' });
  });

  it('allows local http endpoints for development only', () => {
    expect(
      resolvePwaBridgeConfig({
        ...ENABLED_ENV,
        VITE_LFP2P_BRIDGE_ENDPOINT: 'http://localhost:8787/events'
      })
    ).toMatchObject({ status: 'configured', endpoint: 'http://localhost:8787/events' });
    expect(
      resolvePwaBridgeConfig({
        ...ENABLED_ENV,
        VITE_LFP2P_BRIDGE_ENDPOINT: 'http://127.0.0.1:8787/events'
      })
    ).toMatchObject({ status: 'configured', endpoint: 'http://127.0.0.1:8787/events' });
  });

  it('rejects insecure remote endpoints', () => {
    expect(
      resolvePwaBridgeConfig({
        ...ENABLED_ENV,
        VITE_LFP2P_BRIDGE_ENDPOINT: 'http://bridge.example.test/events'
      })
    ).toMatchObject({
      status: 'invalid',
      reason: 'insecure-remote-endpoint'
    });
  });

  it('rejects endpoints with credentials, query strings, fragments, or unsupported protocols', () => {
    expect(
      resolvePwaBridgeConfig({
        ...ENABLED_ENV,
        VITE_LFP2P_BRIDGE_ENDPOINT: 'https://user:pass@bridge.test/events'
      })
    ).toMatchObject({
      status: 'invalid',
      reason: 'embedded-credentials'
    });
    expect(
      resolvePwaBridgeConfig({
        ...ENABLED_ENV,
        VITE_LFP2P_BRIDGE_ENDPOINT: 'https://bridge.test/events?token=secret'
      })
    ).toMatchObject({
      status: 'invalid',
      reason: 'query-or-fragment'
    });
    expect(
      resolvePwaBridgeConfig({
        ...ENABLED_ENV,
        VITE_LFP2P_BRIDGE_ENDPOINT: 'https://bridge.test/events#secret'
      })
    ).toMatchObject({
      status: 'invalid',
      reason: 'query-or-fragment'
    });
    expect(
      resolvePwaBridgeConfig({
        ...ENABLED_ENV,
        VITE_LFP2P_BRIDGE_ENDPOINT: 'wss://bridge.test/events'
      })
    ).toMatchObject({
      status: 'invalid',
      reason: 'unsupported-protocol'
    });
  });

  it('validates timeout and target configuration', () => {
    expect(
      resolvePwaBridgeConfig({
        ...ENABLED_ENV,
        VITE_LFP2P_BRIDGE_ENDPOINT: 'https://bridge.test/events',
        VITE_LFP2P_BRIDGE_TIMEOUT_MS: '0'
      })
    ).toMatchObject({ status: 'invalid', reason: 'invalid-timeout' });
    expect(
      resolvePwaBridgeConfig({
        ...ENABLED_ENV,
        VITE_LFP2P_BRIDGE_ENDPOINT: 'https://bridge.test/events',
        VITE_LFP2P_BRIDGE_TIMEOUT_MS: '90000'
      })
    ).toMatchObject({ status: 'invalid', reason: 'invalid-timeout' });
    expect(
      resolvePwaBridgeConfig({
        ...ENABLED_ENV,
        VITE_LFP2P_BRIDGE_ENDPOINT: 'https://bridge.test/events',
        VITE_LFP2P_BRIDGE_TARGET: 'bridge primary'
      })
    ).toMatchObject({ status: 'invalid', reason: 'invalid-target' });
  });
});
