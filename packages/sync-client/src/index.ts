import { type DexieLocalFirstStore, type MutationOutboxEntry } from '@lfp2p/local-store';
import { type SignedEventEnvelope } from '@lfp2p/protocol';

export type RetryPolicyInput = Readonly<{
  attempt: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  random?: () => number;
}>;

export type OutboxTransportResult =
  | Readonly<{ status: 'confirmed'; sequence?: number }>
  | Readonly<{ status: 'conflicted'; reason: string; sequence?: number }>;

export type OutboxTransport = Readonly<{
  send(input: Readonly<{ entry: MutationOutboxEntry; event: SignedEventEnvelope }>): Promise<OutboxTransportResult>;
}>;

export type ProcessOutboxInput = Readonly<{
  store: DexieLocalFirstStore;
  transport: OutboxTransport;
  now?: Date;
  batchSize?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
}>;

export type ProcessOutboxResult = Readonly<{
  attempted: number;
  confirmed: number;
  conflicted: number;
  retried: number;
  failed: number;
  skipped: number;
}>;

export function computeBackoffDelayMs(input: RetryPolicyInput): number {
  const attempt = requireNonNegativeInteger(input.attempt, 'attempt');
  const baseDelayMs = requirePositiveInteger(input.baseDelayMs ?? 500, 'baseDelayMs');
  const maxDelayMs = requirePositiveInteger(input.maxDelayMs ?? 30_000, 'maxDelayMs');
  const jitterRatio = input.jitterRatio ?? 0.35;
  if (jitterRatio < 0 || jitterRatio > 1) throw new Error('jitterRatio must be between 0 and 1');

  const exponent = Math.min(attempt, 12);
  const rawDelay = Math.min(baseDelayMs * 2 ** exponent, maxDelayMs);
  const jitterWindow = rawDelay * jitterRatio;
  const rand = input.random ?? Math.random;
  const normalized = Math.min(Math.max(rand(), 0), 1);
  const delay = rawDelay - jitterWindow + normalized * jitterWindow * 2;
  return Math.min(Math.max(0, Math.round(delay)), maxDelayMs);
}

export function createIdempotencyKey(prefix = 'idem'): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('crypto.randomUUID is required to create idempotency keys');
  }
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

export async function processOutboxBatch(input: ProcessOutboxInput): Promise<ProcessOutboxResult> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const batchSize = requirePositiveInteger(input.batchSize ?? 10, 'batchSize');
  const maxAttempts = requirePositiveInteger(input.maxAttempts ?? 5, 'maxAttempts');
  const result = mutableProcessResult();
  const due = await input.store.listDueOutbox(nowIso, batchSize);

  for (const candidate of due) {
    const claimed = await input.store.claimOutboxEntry(candidate.idempotencyKey, nowIso);
    if (!claimed) {
      result.skipped += 1;
      continue;
    }

    const event = await input.store.getSignedEvent(claimed.eventId);
    if (!event) {
      result.attempted += 1;
      result.failed += 1;
      await input.store.markOutboxFailed(
        claimed.idempotencyKey,
        `Missing signed event for outbox entry ${claimed.eventId}`,
        nowIso
      );
      continue;
    }

    result.attempted += 1;

    try {
      const transportResult = await input.transport.send({ entry: claimed, event });
      if (transportResult.status === 'confirmed') {
        result.confirmed += 1;
        await input.store.markOutboxConfirmed(claimed.idempotencyKey, nowIso);
      } else {
        result.conflicted += 1;
        await input.store.markOutboxConflicted(claimed.idempotencyKey, transportResult.reason, nowIso);
      }
    } catch (error) {
      const retryCount = claimed.retryCount + 1;
      const message = normalizeErrorMessage(error);
      if (retryCount >= maxAttempts || isNonRetryableError(error)) {
        result.failed += 1;
        await input.store.markOutboxFailed(claimed.idempotencyKey, message, nowIso);
        continue;
      }

      const backoffInput: RetryPolicyInput = { attempt: retryCount };
      if (input.baseDelayMs !== undefined) backoffInput.baseDelayMs = input.baseDelayMs;
      if (input.maxDelayMs !== undefined) backoffInput.maxDelayMs = input.maxDelayMs;
      if (input.random !== undefined) backoffInput.random = input.random;
      const delayMs = computeBackoffDelayMs(backoffInput);
      const nextRetryAt = new Date(now.getTime() + delayMs).toISOString();
      result.retried += 1;
      await input.store.scheduleOutboxRetry({
        idempotencyKey: claimed.idempotencyKey,
        retryCount,
        nextRetryAt,
        lastError: message,
        updatedAt: nowIso
      });
    }
  }

  return result;
}

export class NonRetryableOutboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableOutboxError';
  }
}

export class StaleResponseGuard {
  readonly #latestSequence = new Map<string, number>();

  accept(scope: string, sequence: number): boolean {
    requireNonEmpty(scope, 'scope');
    requireNonNegativeInteger(sequence, 'sequence');
    const latest = this.#latestSequence.get(scope) ?? -1;
    if (sequence < latest) return false;
    this.#latestSequence.set(scope, sequence);
    return true;
  }

  latest(scope: string): number | undefined {
    return this.#latestSequence.get(scope);
  }
}

function mutableProcessResult(): {
  attempted: number;
  confirmed: number;
  conflicted: number;
  retried: number;
  failed: number;
  skipped: number;
} {
  return {
    attempted: 0,
    confirmed: 0,
    conflicted: 0,
    retried: 0,
    failed: 0,
    skipped: 0
  };
}

function isNonRetryableError(error: unknown): boolean {
  return error instanceof NonRetryableOutboxError;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return 'Unknown outbox transport failure';
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be positive`);
  return value;
}

function requireNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be non-negative`);
  return value;
}

function requireNonEmpty(value: string, label: string): string {
  if (value.trim().length === 0) throw new Error(`${label} is required`);
  return value;
}
