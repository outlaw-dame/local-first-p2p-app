import {
  createHttpBridgeTransport,
  type HttpBridgeTransportOptions,
  type OutboxTransport
} from '@lfp2p/sync-client';
import {
  resolvePwaBridgeConfig,
  type PwaBridgeAuthConfig,
  type PwaBridgeConfig,
  type PwaBridgeConfigEnv
} from './pwa-bridge-config.js';

type ConfiguredPwaBridgeConfig = Extract<PwaBridgeConfig, { status: 'configured' }>;
type DisabledPwaBridgeConfig = Extract<PwaBridgeConfig, { status: 'disabled' }>;
type InvalidPwaBridgeConfig = Extract<PwaBridgeConfig, { status: 'invalid' }>;

type PwaBridgeTransportFactory = (options: HttpBridgeTransportOptions) => OutboxTransport;

export type PreparePwaBridgeTransportInput = Readonly<{
  env?: PwaBridgeConfigEnv;
  fetch?: typeof fetch | null;
  createTransport?: PwaBridgeTransportFactory;
}>;

export type PwaBridgeTransportPreparation =
  | Readonly<{
      status: 'prepared';
      config: ConfiguredPwaBridgeConfig;
      transport: OutboxTransport;
      message: string;
    }>
  | Readonly<{
      status: 'unavailable';
      reason: 'bridge-config-disabled';
      config: DisabledPwaBridgeConfig;
      message: string;
    }>
  | Readonly<{
      status: 'unavailable';
      reason: 'bridge-config-invalid';
      config: InvalidPwaBridgeConfig;
      message: string;
    }>
  | Readonly<{
      status: 'unavailable';
      reason: 'fetch-unavailable';
      config: ConfiguredPwaBridgeConfig;
      message: string;
    }>;

export function preparePwaBridgeTransport(input: PreparePwaBridgeTransportInput = {}): PwaBridgeTransportPreparation {
  const config = resolvePwaBridgeConfig(input.env);
  if (config.status === 'disabled') {
    return {
      status: 'unavailable',
      reason: 'bridge-config-disabled',
      config,
      message: config.message
    };
  }
  if (config.status === 'invalid') {
    return {
      status: 'unavailable',
      reason: 'bridge-config-invalid',
      config,
      message: config.message
    };
  }

  const fetchImpl = input.fetch === undefined ? globalThis.fetch : input.fetch;
  if (typeof fetchImpl !== 'function') {
    return {
      status: 'unavailable',
      reason: 'fetch-unavailable',
      config,
      message: 'Bridge transport cannot be prepared because fetch is unavailable in this runtime.'
    };
  }

  const transportFetch = config.auth === undefined ? fetchImpl : createAuthenticatedFetch(fetchImpl, config.auth);
  const createTransport = input.createTransport ?? createHttpBridgeTransport;
  const transport = createTransport({
    endpoint: config.endpoint,
    timeoutMs: config.timeoutMs,
    fetch: transportFetch
  });

  return {
    status: 'prepared',
    config,
    transport,
    message: 'Bridge transport prepared but not attached to foreground sync or outbox delivery in this slice.'
  };
}

function createAuthenticatedFetch(fetchImpl: typeof fetch, auth: PwaBridgeAuthConfig): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('authorization', ['Bearer', auth.token].join(' '));
    return fetchImpl(input, { ...init, headers });
  };
}
