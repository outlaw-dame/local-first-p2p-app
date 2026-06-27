import type { CapabilityDecision, CapabilityProofRef, ProofRegistry } from '@lfp2p/capabilities';
import type { DexieLocalFirstStore } from '@lfp2p/local-store';
import { processOutboxBatch, type ProcessOutboxResult } from '@lfp2p/sync-client';
import { evaluateTrustSafetyCap } from '@lfp2p/trust-safety';
import { preparePwaBridgeTransport, type PreparePwaBridgeTransportInput } from './pwa-bridge-transport.js';
import { createPwaSendBudget, formatPwaSendBudgetDecision, type PwaSendBudget } from './pwa-send-budget.js';

const MANUAL_DELIVERY_ENABLED_KEY = 'VITE_LFP2P_MANUAL_OUTBOX_DELIVERY_ENABLED';
const DEFAULT_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 5;

const defaultSendBudget = createPwaSendBudget();

export type ManualOutboxDeliveryEnv = Readonly<Record<string, unknown>>;

/**
 * Step 4 of the post-#84 follow-up — first production enforcement
 * consumer of the proof registry.
 *
 * When supplied, the manual outbox gate consults the
 * trust-safety cap-adapter before each batch. The gate folds the
 * local device's identity-control-log proofs and refuses delivery
 * unless the cap-adapter returns `allow` for action `sync.push`.
 *
 * Omitting `capabilityGate` preserves the pre-enforcement behaviour
 * exactly — the proof-registry gate is opt-in so existing test
 * harnesses and prior PWA builds continue to deliver as before.
 */
export type OutboxCapabilityGate = Readonly<{
  /**
   * The id of the device running this PWA, used to look up the
   * device's identity-control-log proofs in the registry. Must
   * match `record.subject.id` on the granted proof records the
   * controller emitted for this device.
   */
  localDeviceId: string;
  /**
   * ISO timestamp for the reliance gate's `now` field. Defaulted
   * to `new Date().toISOString()` when omitted.
   */
  now?: string;
}>;

export type RunManualOutboxDeliveryInput = PreparePwaBridgeTransportInput &
  Readonly<{
    store: DexieLocalFirstStore;
    authorization?: Readonly<{ authorized: boolean; reason: string }>;
    env?: ManualOutboxDeliveryEnv;
    onlineSource?: Readonly<{ navigator?: Readonly<{ onLine?: boolean }> }>;
    now?: Date;
    batchSize?: number;
    sendBudget?: PwaSendBudget;
    /**
     * Proof-registry-backed authorization gate. Omitting this field
     * skips the gate entirely (back-compat for existing callers).
     */
    capabilityGate?: OutboxCapabilityGate;
  }>;

export type ManualOutboxDeliveryResult =
  | Readonly<{
      status: 'disabled';
      reason: 'manual-delivery-disabled' | 'not-dev-mode';
      message: string;
    }>
  | Readonly<{
      status: 'blocked';
      reason:
        | 'offline'
        | 'bridge-config-disabled'
        | 'bridge-config-invalid'
        | 'fetch-unavailable'
        | 'send-budget-paused'
        | 'identity-authorization-denied'
        | 'capability-proof-denied';
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

  if (!browserReportsOnline(input.onlineSource)) {
    return {
      status: 'blocked',
      reason: 'offline',
      message: 'Manual outbox delivery is blocked while offline.'
    };
  }

  if (input.authorization?.authorized === false) {
    return {
      status: 'blocked',
      reason: 'identity-authorization-denied',
      message: `Manual outbox delivery blocked: ${input.authorization.reason}`
    };
  }

  const batchSize = normalizeBatchSize(input.batchSize);
  const bridgeTransport = preparePwaBridgeTransport({
    env,
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
    ...(input.createTransport === undefined ? {} : { createTransport: input.createTransport })
  });
  if (bridgeTransport.status !== 'prepared') {
    return { status: 'blocked', reason: bridgeTransport.reason, message: `Manual outbox delivery blocked: ${bridgeTransport.message}` };
  }

  const budgetDecision = (input.sendBudget ?? defaultSendBudget).reserve({
    entries: batchSize,
    ...(input.now === undefined ? {} : { now: input.now })
  });
  if (budgetDecision.status !== 'accepted') {
    return { status: 'blocked', reason: 'send-budget-paused', message: formatPwaSendBudgetDecision(budgetDecision) };
  }

  if (input.capabilityGate !== undefined) {
    const gateDecision = await evaluateOutboxCapabilityGate({
      store: input.store,
      localDeviceId: input.capabilityGate.localDeviceId,
      now: input.capabilityGate.now ?? (input.now ?? new Date()).toISOString()
    });
    if (gateDecision.status === 'deny') {
      // Refund the budget reservation we already took out — the
      // batch is not going to ship, so the send-budget should not
      // count it.
      (input.sendBudget ?? defaultSendBudget).refund({ runs: 1, entries: batchSize });
      return {
        status: 'blocked',
        reason: 'capability-proof-denied',
        message: `Manual outbox delivery blocked: ${gateDecision.message}`
      };
    }
  }

  const result = await processOutboxBatch({
    store: input.store,
    transport: bridgeTransport.transport,
    batchSize,
    ...(input.now === undefined ? {} : { now: input.now })
  });

  const refundedEntries = Math.max(0, batchSize - result.attempted);
  if (result.attempted === 0) {
    (input.sendBudget ?? defaultSendBudget).refund({ runs: 1, entries: refundedEntries });
  } else if (refundedEntries > 0) {
    (input.sendBudget ?? defaultSendBudget).refund({ entries: refundedEntries });
  }

  return { status: 'delivered', batchSize, result, message: formatManualOutboxDeliveryResult(result) };
}

export function manualOutboxDeliveryActionEnabled(env: ManualOutboxDeliveryEnv = importMetaEnv()): boolean {
  return isDevMode(env) && manualDeliveryEnabled(env);
}

export function formatManualOutboxDeliveryResult(result: ProcessOutboxResult): string {
  return `Manual outbox delivery attempted ${result.attempted}, confirmed ${result.confirmed}, conflicted ${result.conflicted}, retried ${result.retried}, failed ${result.failed}, skipped ${result.skipped}.`;
}

export function resetDefaultManualOutboxDeliveryBudgetForTest(now: Date = new Date()): void {
  defaultSendBudget.reset(now);
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

function browserReportsOnline(source: Readonly<{ navigator?: Readonly<{ onLine?: boolean }> }> = globalThis): boolean {
  return source.navigator?.onLine !== false;
}

/**
 * Fold the local device's identity-control-log proofs through the
 * trust-safety cap-adapter and return an allow/deny decision for
 * `sync.push`.
 *
 * Honest v1 scope:
 *
 *  - Only identity-control-log proofs whose `subject.kind === 'device'`
 *    and `subject.id === localDeviceId` are consulted. Proofs from
 *    other schemes (UCAN, VC, …) ARE in the registry but are not
 *    addressed by this gate's lookup pattern — they're a future
 *    expansion.
 *  - We synthesize a baseline `allow` capability decision; the gate
 *    flips it to `deny` based on the proofs-state fold. This
 *    matches the cap-adapter's contract: a relying caller asserts
 *    "my local policy allows this action" and the gate denies on
 *    the proof state.
 *  - When the device has NO matching proofs, the gate denies with
 *    a clear "no capability proof registered for this device"
 *    message. Fail-closed by construction — a device the
 *    controller has not granted authority to cannot send.
 *
 * `evaluateTrustSafetyCap` itself never throws on well-formed
 * inputs; the only error path is a registry-load failure which we
 * surface as a deny with a privacy-safe message.
 */
async function evaluateOutboxCapabilityGate(input: {
  store: DexieLocalFirstStore;
  localDeviceId: string;
  now: string;
}): Promise<{ status: 'allow' } | { status: 'deny'; message: string }> {
  let registry: ProofRegistry;
  try {
    registry = await input.store.loadProofRegistry();
  } catch (err) {
    return {
      status: 'deny',
      message: `proof registry load failed (${err instanceof Error ? err.message : 'unknown'})`
    };
  }
  // Defense-in-depth: loadProofRegistry's type signature promises a
  // well-formed ProofRegistry, but a future schema-migration bug or
  // a downstream mock could violate that. A runtime shape check
  // here fails CLOSED to a deny rather than propagating a
  // TypeError out to the caller as an unhandled rejection. Gemini
  // review on PR #101.
  if (
    registry === null ||
    typeof registry !== 'object' ||
    !(registry.proofs instanceof Map)
  ) {
    return {
      status: 'deny',
      message: 'proof registry load returned an invalid shape — fail closed'
    };
  }

  const refs: CapabilityProofRef[] = [];
  for (const record of registry.proofs.values()) {
    if (record.scheme !== 'identity-control-log') continue;
    if (record.subject.kind !== 'device') continue;
    if (record.subject.id !== input.localDeviceId) continue;
    refs.push({ proofId: record.proofId, scheme: 'identity-control-log' });
  }

  if (refs.length === 0) {
    return {
      status: 'deny',
      message:
        'no identity-control-log proof registered for this device — the controller must grant sync authority before this device can deliver outbox events'
    };
  }

  // Synthesize a baseline allow decision. The cap-adapter's
  // proofsState fold is what denies (or passes) the action; the
  // baseline says "absent the proof gate, local policy allows
  // sync.push from this device." This mirrors how the canonical
  // recipe in capability-authority-model.md frames the wiring.
  const allow: CapabilityDecision = Object.freeze({
    status: 'allow',
    reasonCodes: Object.freeze(['capability.valid'] as const),
    capabilityId: `sync.push:${input.localDeviceId}`,
    invocationId: `outbox-batch:${input.now}`,
    createdAt: input.now
  });

  const verdict = evaluateTrustSafetyCap({
    capabilityDecision: allow,
    capabilityAction: 'sync.push',
    now: input.now,
    proofRegistry: registry,
    capabilityProofs: refs
  });
  if (verdict.status === 'allow') return { status: 'allow' };
  return {
    status: 'deny',
    message: `proof gate denied (${verdict.reasonCodes.join(', ')})`
  };
}
