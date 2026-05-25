import type { DexieLocalFirstStore } from '@lfp2p/local-store';
import { processOutboxBatch, type ProcessOutboxResult } from '@lfp2p/sync-client';
import { preparePwaBridgeTransport, type PreparePwaBridgeTransportInput } from './pwa-bridge-transport.js';

const MANUAL_DELIVERY_ENABLED_KEY = 'VITE_LFP2P_MANUAL_OUTBOX_DELIVERY_ENABLED';
const DEFAULT_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 5;

export type ManualOutboxDeliveryEnv = Readonly<Record<string, unknown>>;

export type RunManualOutboxDeliveryInput = PreparePwaBridgeTransportInput &
  Readonly<{
    store: DexieLocalFirstStore;
    env?: ManualOutboxDeliveryEnv;
    now?: Date;
    batchSize?: number;
  }>;

export type ManualOutboxDeliveryResult =
  | Readonly<{
      status: 'disabled';
      reason: 'manual-delivery-disabled' | 'not-dev-mode';
      message: string;
    }>
  | Readonly<{
      status: 'blocked';
      reason: 'bridge-config-disabled' | 'bridge-config-invalid' | 'fetch-unavailable';
      message: string;
    }>
  | Readonly<{
      status: 'delivered';
      batchSize: number;
      result: ProcessOutboxResult;
      message: string;
    }>;

export async function runManualOutboxDelivery(input: RunManualOutboxDeliveryInput): Promise<ManualOutboxDeliveryResult> {
  const env = input.env ?? importMetaEnv();
  if (!isDevMode(env)) {
    return { status: 'disabled', reason: 'not-dev-mode', message: 'Manual outbox delivery is unavailable outside dev mode.' };
  }
  if (!manualDeliveryEnabled(env)) {
    return {
      status: 'disabled',
      reason: 'manual-delivery-disabled',
      message: `Manual outbox delivery is disabled. Set ${MANUAL_DELIVERY_ENABLED_KEY}=true in dev mode to enable the explicit action.`
    };
  }

  const batchSize = normalizeBatchSize(input.batchSize);
  const bridgeTransport = preparePwaBridgeTransport({ ...input, env });
  if (bridgeTransport.status !== 'prepared') {
    return { status: 'blocked', reason: bridgeTransport.reason, message: `Manual outbox delivery blocked: ${bridgeTransport.message}` };
  }

  const result = await processOutboxBatch({
    store: input.store,
    transport: bridgeTransport.transport,
    batchSize,
    ...(input.now === undefined ? {} : { now: input.now })
  });

  return { status: 'delivered', batchSize, result, message: formatManualOutboxDeliveryResult(result) };
}

export function manualOutboxDeliveryActionEnabled(env: ManualOutboxDeliveryEnv = importMetaEnv()): boolean {
  return isDevMode(env) && manualDeliveryEnabled(env);
}

export function formatManualOutboxDeliveryResult(result: ProcessOutboxResult): string {
  return `Manual outbox delivery attempted ${result.attempted}, confirmed ${result.confirmed}, conflicted ${result.conflicted}, retried ${result.retried}, failed ${result.failed}, skipped ${result.skipped}.`;
}

function isDevMode(env: ManualOutboxDeliveryEnv): boolean {
  return env.DEV === true;
}

function manualDeliveryEnabled(env: ManualOutboxDeliveryEnv): boolean {
  const normalized = stringEnv(env[MANUAL_DELIVERY_ENABLED_KEY])?.toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function normalizeBatchSize(value: number | undefined): number {
  const batchSize = value ?? DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0 || batchSize > MAX_BATCH_SIZE) {
    throw new TypeError(`manual outbox delivery batchSize must be a positive safe integer no greater than ${MAX_BATCH_SIZE}.`);
  }
  return batchSize;
}

function stringEnv(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function importMetaEnv(): ManualOutboxDeliveryEnv {
  if (typeof import.meta === 'undefined') return {};
  return (import.meta as ImportMeta & { env?: ManualOutboxDeliveryEnv }).env ?? {};
}
