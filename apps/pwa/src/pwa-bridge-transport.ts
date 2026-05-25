import {
  createHttpBridgeTransport,
  type HttpBridgeTransportOptions,
  type OutboxTransport
} from '@lfp2p/sync-client';
import { resolvePwaBridgeConfig, type PwaBridgeConfig, type PwaBridgeConfigEnv } from './pwa-bridge-config.js';

type ConfiguredPwaBridgeConfig = Extract<PwaBridgeConfig, { status: 'configured' }>;

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
      reason: 'bridge-config-disabled' | 'bridge-config-invalid' | 'fetch-unavailable';
      config: PwaBridgeConfig;
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

  const createTransport = input.createTransport ?? createHttpBridgeTransport;
  const transport = createTransport({
    endpoint: config.endpoint,
    timeoutMs: config.timeoutMs,
    fetch: fetchImpl
  });

  return {
    status: 'prepared',
    config,
    transport,
    message: 'Bridge transport prepared but not attached to foreground sync or outbox delivery in this slice.'
  };
}