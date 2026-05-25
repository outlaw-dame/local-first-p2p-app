import {
  preparePwaBridgeTransport,
  type PreparePwaBridgeTransportInput,
  type PwaBridgeTransportPreparation
} from './pwa-bridge-transport.js';

export type PwaOutboxBridgeTransportStatus = 'disabled' | 'invalid' | 'fetch-unavailable' | 'prepared';

export type CreatePwaOutboxDeliveryPlanInput = PreparePwaBridgeTransportInput &
  Readonly<{
    pendingOutboxCount: number;
  }>;

export type PwaOutboxDeliveryPlan = Readonly<{
  status: 'delivery-disabled';
  deliveryEnabled: false;
  pendingOutboxCount: number;
  bridgeTransportStatus: PwaOutboxBridgeTransportStatus;
  message: string;
}>;

export function createPwaOutboxDeliveryPlan(input: CreatePwaOutboxDeliveryPlanInput): PwaOutboxDeliveryPlan {
  const pendingOutboxCount = normalizePendingOutboxCount(input.pendingOutboxCount);
  const bridgeTransport = preparePwaBridgeTransport(bridgeTransportInput(input));
  const bridgeTransportStatus = bridgeTransportStatusFromPreparation(bridgeTransport);

  return {
    status: 'delivery-disabled',
    deliveryEnabled: false,
    pendingOutboxCount,
    bridgeTransportStatus,
    message: `${pendingOutboxCountText(pendingOutboxCount)}; ${bridgeTransportText(
      bridgeTransportStatus
    )}; delivery remains disabled.`
  };
}

export function formatPwaOutboxDeliveryPlan(plan: PwaOutboxDeliveryPlan): string {
  return plan.message;
}

function bridgeTransportInput(input: CreatePwaOutboxDeliveryPlanInput): PreparePwaBridgeTransportInput {
  const transportInput: PreparePwaBridgeTransportInput = {};
  if (input.env !== undefined) transportInput.env = input.env;
  if (input.fetch !== undefined) transportInput.fetch = input.fetch;
  if (input.createTransport !== undefined) transportInput.createTransport = input.createTransport;
  return transportInput;
}

function bridgeTransportStatusFromPreparation(
  preparation: PwaBridgeTransportPreparation
): PwaOutboxBridgeTransportStatus {
  if (preparation.status === 'prepared') return 'prepared';
  if (preparation.reason === 'bridge-config-disabled') return 'disabled';
  if (preparation.reason === 'bridge-config-invalid') return 'invalid';
  return 'fetch-unavailable';
}

function normalizePendingOutboxCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('pendingOutboxCount must be a non-negative safe integer.');
  }
  return value;
}

function pendingOutboxCountText(count: number): string {
  return `${count} pending outbox ${count === 1 ? 'entry' : 'entries'}`;
}

function bridgeTransportText(status: PwaOutboxBridgeTransportStatus): string {
  switch (status) {
    case 'disabled':
      return 'bridge transport is disabled';
    case 'invalid':
      return 'bridge transport config is invalid';
    case 'fetch-unavailable':
      return 'bridge transport is unavailable because fetch is missing';
    case 'prepared':
      return 'bridge transport is prepared';
  }
}
