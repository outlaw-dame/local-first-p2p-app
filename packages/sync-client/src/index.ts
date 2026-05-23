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

export type HttpBridgeTransportOptions = Readonly<{
  endpoint: string | URL;
  fetch?: typeof fetch;
  timeoutMs?: number;
}>;

type BridgeHttpResponse =
  | Readonly<{ status: 'confirmed'; sequence?: number }>
  | Readonly<{ status: 'conflicted'; reason: string; sequence?: number }>
  | Readonly<{ status: 'rejected'; reason: string }>;

export type ProcessOutboxInput = Readonly<{
  store: DexieLocalFirstStore;
  transport: OutboxTransport;
  now?: Date;
  batchSize?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  claimTimeoutMs?: number;
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

export function createHttpBridgeTransport(options: HttpBridgeTransportOptions): OutboxTransport {
  const endpoint = normalizeBridgeEndpoint(options.endpoint);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  const timeoutMs = requirePositiveInteger(options.timeoutMs ?? 10_000, 'timeoutMs');

  return {
    async send(input) {
      const controller = new AbortController();
      const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-lfp2p-idempotency-key': input.entry.idempotencyKey
          },
          body: JSON.stringify({
            idempotencyKey: input.entry.idempotencyKey,
            target: input.entry.target,
            event: input.event
          }),
          credentials: 'omit',
          signal: controller.signal
        });
        return await mapBridgeHttpResponse(response);
      } catch (error) {
        if (isAbortError(error)) {
          throw new Error(`Bridge request timed out after ${timeoutMs}ms`, { cause: error });
        }
        throw error;
      } finally {
        globalThis.clearTimeout(timeout);
      }
    }
  };
}

export async function processOutboxBatch(input: ProcessOutboxInput): Promise<ProcessOutboxResult> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const batchSize = requirePositiveInteger(input.batchSize ?? 10, 'batchSize');
  const maxAttempts = requirePositiveInteger(input.maxAttempts ?? 5, 'maxAttempts');
  const claimTimeoutMs = requireNonNegativeInteger(input.claimTimeoutMs ?? 30_000, 'claimTimeoutMs');
  const result = mutableProcessResult();
  await input.store.recoverStaleOutboxClaims({
    staleBefore: new Date(now.getTime() - claimTimeoutMs).toISOString(),
    nextRetryAt: nowIso,
    updatedAt: nowIso,
    limit: batchSize
  });
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

    let transportResult: OutboxTransportResult;
    try {
      transportResult = await input.transport.send({ entry: claimed, event });
    } catch (error) {
      const retryCount = claimed.retryCount + 1;
      const message = normalizeErrorMessage(error);
      if (retryCount >= maxAttempts || isNonRetryableError(error)) {
        result.failed += 1;
        await input.store.markOutboxFailed(claimed.idempotencyKey, message, nowIso);
        continue;
      }

      const delayMs = computeBackoffDelayMs({
        attempt: retryCount,
        ...(input.baseDelayMs !== undefined ? { baseDelayMs: input.baseDelayMs } : {}),
        ...(input.maxDelayMs !== undefined ? { maxDelayMs: input.maxDelayMs } : {}),
        ...(input.random !== undefined ? { random: input.random } : {})
      });
      const nextRetryAt = new Date(now.getTime() + delayMs).toISOString();
      result.retried += 1;
      await input.store.scheduleOutboxRetry({
        idempotencyKey: claimed.idempotencyKey,
        retryCount,
        nextRetryAt,
        lastError: message,
        updatedAt: nowIso
      });
      continue;
    }

    if (transportResult.status === 'confirmed') {
      await input.store.markOutboxConfirmed(claimed.idempotencyKey, nowIso);
      result.confirmed += 1;
    } else {
      await input.store.markOutboxConflicted(claimed.idempotencyKey, transportResult.reason, nowIso);
      result.conflicted += 1;
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

async function mapBridgeHttpResponse(response: Response): Promise<OutboxTransportResult> {
  const text = await response.text();
  const body = parseOptionalBridgeJson(text);
  if (!response.ok) {
    const bodyReason = body?.status === 'conflicted' || body?.status === 'rejected' ? body.reason : undefined;
    const statusReason = response.statusText.trim();
    const reason = bodyReason ?? (statusReason.length > 0 ? statusReason : `Bridge HTTP ${response.status}`);
    if (response.status === 409) return { status: 'conflicted', reason };
    if (isNonRetryableHttpStatus(response.status)) throw new NonRetryableOutboxError(reason);
    throw new Error(reason);
  }

  if (!body) throw new Error('Bridge returned an empty response');
  if (body.status === 'confirmed') {
    return {
      status: 'confirmed',
      ...(body.sequence === undefined ? {} : { sequence: requireNonNegativeInteger(body.sequence, 'sequence') })
    };
  }
  if (body.status === 'conflicted') return { status: 'conflicted', reason: requireNonEmpty(body.reason, 'reason') };
  if (body.status === 'rejected') throw new NonRetryableOutboxError(requireNonEmpty(body.reason, 'reason'));
  throw new Error('Bridge returned an unsupported status');
}

function parseOptionalBridgeJson(text: string): BridgeHttpResponse | null {
  if (text.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const status = parsed.status;
  if (status === 'confirmed') {
    const sequence = parsed.sequence;
    return {
      status,
      ...(sequence === undefined ? {} : { sequence: requireNonNegativeInteger(Number(sequence), 'sequence') })
    };
  }
  if (status === 'conflicted') return { status, reason: requireNonEmpty(String(parsed.reason ?? ''), 'reason') };
  if (status === 'rejected') return { status, reason: requireNonEmpty(String(parsed.reason ?? ''), 'reason') };
  return null;
}

function normalizeBridgeEndpoint(endpoint: string | URL): string {
  const url = endpoint instanceof URL ? new URL(endpoint.href) : new URL(endpoint);
  if (url.username.length > 0 || url.password.length > 0) throw new Error('Bridge endpoint must not include credentials');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Bridge endpoint must use http or https');
  return url.toString();
}

function isNonRetryableHttpStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 413 || status === 422;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
