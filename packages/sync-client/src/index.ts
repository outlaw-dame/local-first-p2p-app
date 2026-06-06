import {
  SyncCheckpointRejectedError,
  type DexieLocalFirstStore,
  type MutationOutboxEntry,
  type StoredIdentityControlProjection,
  type StoredSyncCheckpoint,
  type SyncCheckpointKey
} from '@lfp2p/local-store';
import { verifySignedEventEnvelope } from '@lfp2p/crypto';
import { applyIdentityControlEvent, createEmptyIdentityControlState } from '@lfp2p/identity';
import { isReputationEventKind, type SignedEventEnvelope } from '@lfp2p/protocol';
import { validateReputationEvent } from '@lfp2p/trust-safety';
import {
  isAbortError,
  isNonRetryableHttpStatus,
  isRecord,
  normalizeBridgeEndpoint,
  requireNonEmpty,
  requireNonNegativeInteger,
  requirePositiveInteger
} from './http-bridge-internals.js';
import { resolveJitterRatio } from './retry-policy.js';

export type RetryPolicyInput = Readonly<{
  attempt: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number | null;
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

export type AcceptSyncCheckpointInput = SyncCheckpointKey &
  Readonly<{
    store: DexieLocalFirstStore;
    cursor: string;
    sequence: number;
    updatedAt?: string;
    allowRewind?: boolean;
  }>;

export type InboundSyncRecord = SyncCheckpointKey &
  Readonly<{
    event: SignedEventEnvelope;
    cursor: string;
    sequence: number;
    receivedAt?: string;
  }>;

export type InboundSyncPullInput = SyncCheckpointKey &
  Readonly<{
    cursor?: string;
    limit?: number;
  }>;

export type InboundSyncTransport = Readonly<{
  pull(input: InboundSyncPullInput): Promise<readonly InboundSyncRecord[]>;
}>;

export type InboundSyncIdentityMismatchField = 'sourceId' | 'streamId' | 'scope';

export class InboundSyncIdentityMismatchError extends Error {
  readonly code = 'inbound-sync-identity-mismatch';
  readonly recordIndex: number;
  readonly mismatchFields: readonly InboundSyncIdentityMismatchField[];

  constructor(input: Readonly<{ recordIndex: number; mismatchFields: readonly InboundSyncIdentityMismatchField[] }>) {
    super(`Inbound sync record ${input.recordIndex} checkpoint identity mismatch`);
    this.name = 'InboundSyncIdentityMismatchError';
    this.recordIndex = input.recordIndex;
    this.mismatchFields = [...input.mismatchFields];
  }
}

export class InboundSyncLimitExceededError extends Error {
  readonly code = 'inbound-sync-limit-exceeded';
  readonly limit: number;
  readonly returned: number;

  constructor(input: Readonly<{ limit: number; returned: number }>) {
    super(`Inbound sync transport returned ${input.returned} records, exceeding limit ${input.limit}`);
    this.name = 'InboundSyncLimitExceededError';
    this.limit = input.limit;
    this.returned = input.returned;
  }
}

export type ProcessInboundSyncInput = Readonly<{
  store: DexieLocalFirstStore;
  records: readonly InboundSyncRecord[];
  now?: Date;
  allowRewind?: boolean;
  expectedCheckpointKey?: SyncCheckpointKey;
  includeCheckpointAfter?: boolean;
  /**
   * Phase 1.8.14 — set of labeler ids the user has subscribed to.
   * Aggregator-event envelopes whose mapped publisher id is NOT in
   * this set are dropped at the reputation projection layer (the
   * envelope is still stored + the checkpoint still advances; only
   * the reputation log refrains from accepting it). Omitting this
   * field disables automatic reputation projection entirely — useful
   * for callers that handle reputation routing themselves.
   */
  subscribedLabelers?: ReadonlySet<string>;
  /**
   * Phase 1.8.14 — map envelope.author → publisherLabelerId. The
   * default identity mapping (caller-omitted) treats `event.author`
   * directly as the publisher labeler id, matching the convention
   * used in Phase 1.66 labeler profiles. Provide a custom function
   * to apply a tenant-specific mapping (e.g., DID → labeler-id).
   */
  labelerIdForAuthor?: (authorId: string) => string | undefined;
}>;

export type InboundSyncError = Readonly<{
  index: number;
  eventId?: string;
  reason: string;
}>;

/**
 * Phase 1.8.14 — per-batch reputation dispatch summary. Surfaced
 * only when the caller supplies `subscribedLabelers` to
 * `processInboundSyncBatch`. Drop / reject counts are PRIVACY-SAFE
 * (no raw payload bytes, no actor ids), satisfying Phase 3.1
 * logging doctrine when the caller logs the summary as-is.
 */
export type InboundReputationDispatchSummary = Readonly<{
  /** Reputation events appended to the trust-safety log. */
  applied: number;
  /**
   * Dropped by opt-in policy: aggregator events from unsubscribed
   * labelers, or observation/attestation/revocation events that
   * cannot be safely cross-device replicated until Phase 5.0.
   */
  dropped: number;
  /** Validation or persistence failures. */
  rejected: number;
  errors: ReadonlyArray<
    Readonly<{
      index: number;
      eventId?: string;
      reason: string;
    }>
  >;
}>;

export type ProcessInboundSyncResult = Readonly<{
  received: number;
  applied: number;
  skipped: number;
  rejected: number;
  errors: readonly InboundSyncError[];
  checkpointAfter?: StoredSyncCheckpoint;
  /** Present only when `subscribedLabelers` was passed in. */
  reputation?: InboundReputationDispatchSummary;
}>;

export type PullAndProcessInboundSyncInput = SyncCheckpointKey &
  Readonly<{
    store: DexieLocalFirstStore;
    transport: InboundSyncTransport;
    now?: Date;
    limit?: number;
    allowRewind?: boolean;
  }>;

export type PullAndProcessInboundSyncResult = ProcessInboundSyncResult &
  Readonly<{
    pulled: number;
    checkpointBefore?: StoredSyncCheckpoint;
  }>;

type BridgeHttpResponse =
  | Readonly<{ status: 'confirmed'; sequence?: number }>
  | Readonly<{ status: 'conflicted'; reason: string; sequence?: number }>
  | Readonly<{ status: 'rejected'; reason: string }>;

type ParsedBridgeHttpResponse =
  | Readonly<{ parseStatus: 'empty' }>
  | Readonly<{ parseStatus: 'invalid'; reason: string }>
  | Readonly<{ parseStatus: 'valid'; body: BridgeHttpResponse }>;

type ParsedBridgeSequence =
  | Readonly<{ parseStatus: 'valid'; value?: number }>
  | Readonly<{ parseStatus: 'invalid'; reason: string }>;

export type ProcessOutboxInput = Readonly<{
  store: DexieLocalFirstStore;
  transport: OutboxTransport;
  now?: Date;
  batchSize?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number | null;
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
  const jitterRatio = resolveJitterRatio(input.jitterRatio);

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

export async function acceptSyncCheckpoint(input: AcceptSyncCheckpointInput): Promise<boolean> {
  try {
    await input.store.advanceSyncCheckpoint({
      sourceId: input.sourceId,
      streamId: input.streamId,
      scope: input.scope,
      cursor: input.cursor,
      sequence: input.sequence,
      ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
      ...(input.allowRewind === undefined ? {} : { allowRewind: input.allowRewind })
    });
    return true;
  } catch (error) {
    if (error instanceof SyncCheckpointRejectedError) return false;
    throw error;
  }
}

export async function processInboundSyncBatch(input: ProcessInboundSyncInput): Promise<ProcessInboundSyncResult> {
  const nowIso = (input.now ?? new Date()).toISOString();
  const result = mutableInboundProcessResult();
  const expectedCheckpointKey =
    input.expectedCheckpointKey === undefined ? undefined : normalizeSyncCheckpointKey(input.expectedCheckpointKey);
  let checkpointAfter: StoredSyncCheckpoint | undefined;

  // Phase 1.8.14 — reputation routing is optional. We materialise
  // the summary container only when the caller opts in by passing
  // `subscribedLabelers`. This preserves backwards compatibility for
  // every existing caller that doesn't care about reputation events
  // (they continue seeing the original result shape with no
  // `reputation` field).
  const reputationRouting =
    input.subscribedLabelers === undefined
      ? undefined
      : {
          subscribed: input.subscribedLabelers,
          labelerIdForAuthor: input.labelerIdForAuthor,
          summary: mutableReputationSummary()
        };

  if (expectedCheckpointKey !== undefined) {
    preflightInboundRecordsMatchCheckpointKey(input.records, expectedCheckpointKey);
  }

  for (const [index, record] of input.records.entries()) {
    result.received += 1;
    try {
      if (!verifySignedEventEnvelope(record.event)) {
        throw new Error('Inbound signed event signature verification failed');
      }
      const stored = await input.store.putSignedEventWithSyncCheckpoint({
        event: record.event,
        checkpoint: {
          sourceId: record.sourceId,
          streamId: record.streamId,
          scope: record.scope,
          cursor: record.cursor,
          sequence: record.sequence,
          updatedAt: record.receivedAt ?? nowIso,
          ...(input.allowRewind === undefined ? {} : { allowRewind: input.allowRewind })
        },
        ...(isIdentityControlEvent(record.event)
          ? {
              identityControlProjectionUpdate: (
                current: StoredIdentityControlProjection | undefined,
                event: SignedEventEnvelope,
                updatedAt: string
              ) => applyIdentityControlProjectionUpdate(current, event, updatedAt)
            }
          : {})
      });
      checkpointAfter = stored.checkpoint;
      if (stored.status === 'stored') {
        result.applied += 1;
        // Phase 1.8.14 — reputation projection runs ONLY on freshly
        // stored envelopes (idempotency: a duplicate envelope that
        // was already replayed once must not double-apply at the
        // reputation log either). We never throw from the projection
        // — failures surface in the summary, not the batch result.
        if (reputationRouting !== undefined && isReputationEventKind(record.event.kind)) {
          await dispatchInboundReputationEnvelope({
            store: input.store,
            event: record.event,
            index,
            subscribed: reputationRouting.subscribed,
            labelerIdForAuthor: reputationRouting.labelerIdForAuthor,
            summary: reputationRouting.summary
          });
        }
      } else {
        result.skipped += 1;
      }
    } catch (error) {
      if (error instanceof SyncCheckpointRejectedError && error.code === 'stale-sequence') {
        result.skipped += 1;
        continue;
      }
      result.rejected += 1;
      result.errors.push({
        index,
        ...safeInboundEventId(record),
        reason: normalizeInboundSyncErrorMessage(error)
      });
      break;
    }
  }

  const reputationField =
    reputationRouting === undefined
      ? undefined
      : freezeReputationSummary(reputationRouting.summary);

  return {
    ...result,
    ...(input.includeCheckpointAfter === true && checkpointAfter !== undefined
      ? { checkpointAfter }
      : {}),
    ...(reputationField === undefined ? {} : { reputation: reputationField })
  };
}

export async function pullAndProcessInboundSyncBatch(
  input: PullAndProcessInboundSyncInput
): Promise<PullAndProcessInboundSyncResult> {
  const checkpointKey = normalizeSyncCheckpointKey(input);
  const limit = input.limit === undefined ? undefined : requirePositiveInteger(input.limit, 'limit');
  const checkpointBefore = await input.store.getSyncCheckpoint(checkpointKey);
  const records = await input.transport.pull({
    ...checkpointKey,
    ...(checkpointBefore === undefined ? {} : { cursor: checkpointBefore.cursor }),
    ...(limit === undefined ? {} : { limit })
  });
  if (limit !== undefined && records.length > limit) {
    throw new InboundSyncLimitExceededError({ limit, returned: records.length });
  }
  const processed = await processInboundSyncBatch({
    store: input.store,
    records,
    expectedCheckpointKey: checkpointKey,
    includeCheckpointAfter: true,
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.allowRewind === undefined ? {} : { allowRewind: input.allowRewind })
  });
  const checkpointAfter = processed.checkpointAfter ?? checkpointBefore;

  return {
    ...processed,
    pulled: records.length,
    ...(checkpointBefore === undefined ? {} : { checkpointBefore }),
    ...(checkpointAfter === undefined ? {} : { checkpointAfter })
  };
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

    if (claimed.retryCount >= maxAttempts) {
      result.failed += 1;
      await input.store.markOutboxFailed(claimed.idempotencyKey, 'Outbox retry budget exhausted', nowIso);
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
        ...(input.jitterRatio !== undefined ? { jitterRatio: input.jitterRatio } : {}),
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
  const parsed = parseOptionalBridgeJson(text);
  const validBody = parsed.parseStatus === 'valid' ? parsed.body : undefined;
  if (!response.ok) {
    const bodyReason =
      validBody && (validBody.status === 'conflicted' || validBody.status === 'rejected') ? validBody.reason : undefined;
    const statusReason = response.statusText.trim();
    const reason = bodyReason ?? (statusReason.length > 0 ? statusReason : `Bridge HTTP ${response.status}`);
    if (response.status === 409) return { status: 'conflicted', reason };
    if (isNonRetryableHttpStatus(response.status)) throw new NonRetryableOutboxError(reason);
    throw new Error(reason);
  }

  if (parsed.parseStatus === 'empty') throw new Error('Bridge returned an empty response');
  if (parsed.parseStatus === 'invalid') throw new Error(parsed.reason);

  const body = parsed.body;
  if (body.status === 'confirmed') return body;
  if (body.status === 'conflicted') return body;
  throw new NonRetryableOutboxError(body.reason);
}

function parseOptionalBridgeJson(text: string): ParsedBridgeHttpResponse {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { parseStatus: 'empty' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return invalidBridgeResponse('Bridge returned malformed JSON response');
  }

  if (!isRecord(parsed)) return invalidBridgeResponse('Bridge returned invalid response body');

  const status = parsed.status;
  if (status === 'confirmed') return parseConfirmedBridgeResponse(parsed);
  if (status === 'conflicted') return parseReasonedBridgeResponse('conflicted', parsed);
  if (status === 'rejected') return parseReasonedBridgeResponse('rejected', parsed);
  if (typeof status !== 'string' || status.trim().length === 0) {
    return invalidBridgeResponse('Bridge response status is required');
  }
  return invalidBridgeResponse('Bridge returned unsupported status');
}

function parseConfirmedBridgeResponse(parsed: Record<string, unknown>): ParsedBridgeHttpResponse {
  const sequence = parseOptionalBridgeSequence(parsed.sequence);
  if (sequence.parseStatus === 'invalid') return invalidBridgeResponse(sequence.reason);
  return {
    parseStatus: 'valid',
    body: {
      status: 'confirmed',
      ...(sequence.value === undefined ? {} : { sequence: sequence.value })
    }
  };
}

function parseReasonedBridgeResponse(
  status: 'conflicted' | 'rejected',
  parsed: Record<string, unknown>
): ParsedBridgeHttpResponse {
  const reason = parsed.reason;
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return invalidBridgeResponse('Bridge response reason is required');
  }

  if (status === 'rejected') {
    return { parseStatus: 'valid', body: { status: 'rejected', reason } };
  }

  const sequence = parseOptionalBridgeSequence(parsed.sequence);
  if (sequence.parseStatus === 'invalid') return invalidBridgeResponse(sequence.reason);
  return {
    parseStatus: 'valid',
    body: {
      status: 'conflicted',
      reason,
      ...(sequence.value === undefined ? {} : { sequence: sequence.value })
    }
  };
}

function parseOptionalBridgeSequence(value: unknown): ParsedBridgeSequence {
  if (value === undefined) return { parseStatus: 'valid' };
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return { parseStatus: 'invalid', reason: 'Bridge response sequence must be a non-negative integer' };
  }
  return { parseStatus: 'valid', value };
}

function invalidBridgeResponse(reason: string): ParsedBridgeHttpResponse {
  return { parseStatus: 'invalid', reason };
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

function mutableInboundProcessResult(): {
  received: number;
  applied: number;
  skipped: number;
  rejected: number;
  errors: InboundSyncError[];
} {
  return {
    received: 0,
    applied: 0,
    skipped: 0,
    rejected: 0,
    errors: []
  };
}

type MutableReputationSummary = {
  applied: number;
  dropped: number;
  rejected: number;
  errors: Array<{ index: number; eventId?: string; reason: string }>;
};

function mutableReputationSummary(): MutableReputationSummary {
  return { applied: 0, dropped: 0, rejected: 0, errors: [] };
}

function freezeReputationSummary(
  summary: MutableReputationSummary
): InboundReputationDispatchSummary {
  return Object.freeze({
    applied: summary.applied,
    dropped: summary.dropped,
    rejected: summary.rejected,
    errors: Object.freeze(summary.errors.map((e) => Object.freeze({ ...e })))
  });
}

/**
 * Phase 1.8.14 — apply the opt-in / drop-by-policy gate AFTER the
 * envelope has been stored. Failures here surface in the reputation
 * summary, NOT the outer batch result — the bridge inbound stream
 * MUST keep making forward progress on the checkpoint even if the
 * reputation projection trips on a single hostile event.
 *
 * Privacy-safe: the only error message that surfaces is the
 * exception's message (from the trust-safety validator or store
 * layer), never the raw payload. The Phase 3.1 logging doctrine is
 * preserved.
 */
async function dispatchInboundReputationEnvelope(input: {
  store: DexieLocalFirstStore;
  event: SignedEventEnvelope;
  index: number;
  subscribed: ReadonlySet<string>;
  labelerIdForAuthor: ((authorId: string) => string | undefined) | undefined;
  summary: MutableReputationSummary;
}): Promise<void> {
  const { event, index, subscribed, labelerIdForAuthor, summary } = input;
  // Aggregator events are the only network-distributable reputation
  // family in 1.8.14. Observation / attestation / revocation are
  // device-local by the protocol envelope rule (`requirePrivacyForReputationEvent`),
  // so they would have failed envelope validation upstream if they
  // arrived over the wire. As defense-in-depth, drop them here too.
  if (
    event.kind !== 'reputation.aggregator.published' &&
    event.kind !== 'reputation.aggregator.score.removed'
  ) {
    summary.dropped += 1;
    return;
  }

  // Subscription gate. Pinned to the *labeler id* per Phase 1.66.
  // The default identity mapping treats the envelope's author as the
  // labeler id when the caller doesn't pass a custom mapper.
  const publisherLabelerId =
    labelerIdForAuthor === undefined ? event.author : labelerIdForAuthor(event.author);
  if (typeof publisherLabelerId !== 'string' || publisherLabelerId.length === 0) {
    summary.dropped += 1;
    return;
  }
  if (!subscribed.has(publisherLabelerId)) {
    summary.dropped += 1;
    return;
  }

  // Re-validate via the trust-safety semantic validator. The
  // protocol's structural check at envelope construction already
  // pinned eventId / kind / createdAt / version, so the inner
  // payload IS shape-consistent — this call ensures it's also
  // RANGE-correct (score bounds, subject enums, observation counts).
  // A throw here surfaces as a rejected count + an error row.
  try {
    const reputationEvent = validateReputationEvent(event.payload);
    const persistence = await input.store.appendTrustSafetyReputationEvent(reputationEvent);
    // Idempotency-aware counting: a duplicate event (same eventId
    // already in the reputation log) reports as `dropped`, not
    // `applied` — preserves the invariant `summary.applied ===
    // newly-inserted rows`. The reputation runtime computes from the
    // stored rows so the projection's truthfulness is unaffected.
    if (persistence.status === 'stored') {
      summary.applied += 1;
    } else {
      summary.dropped += 1;
    }
  } catch (err) {
    summary.rejected += 1;
    summary.errors.push({
      index,
      eventId: event.eventId,
      reason: (err as Error).message
    });
  }
}

function safeInboundEventId(record: unknown): { eventId: string } | Record<string, never> {
  if (!isRecord(record)) return {};
  const event = record.event;
  if (!isRecord(event)) return {};
  return typeof event.eventId === 'string' ? { eventId: event.eventId } : {};
}

function preflightInboundRecordsMatchCheckpointKey(records: readonly InboundSyncRecord[], key: SyncCheckpointKey): void {
  for (const [index, record] of records.entries()) {
    const mismatchFields = checkpointKeyMismatchFields(record, key);
    if (mismatchFields.length > 0) {
      throw new InboundSyncIdentityMismatchError({ recordIndex: index, mismatchFields });
    }
  }
}

function checkpointKeyMismatchFields(record: SyncCheckpointKey, key: SyncCheckpointKey): InboundSyncIdentityMismatchField[] {
  const mismatchFields: InboundSyncIdentityMismatchField[] = [];
  if (record.sourceId !== key.sourceId) mismatchFields.push('sourceId');
  if (record.streamId !== key.streamId) mismatchFields.push('streamId');
  if (record.scope !== key.scope) mismatchFields.push('scope');
  return mismatchFields;
}

function normalizeSyncCheckpointKey(key: SyncCheckpointKey): SyncCheckpointKey {
  return {
    sourceId: requireNonEmpty(key.sourceId, 'sourceId'),
    streamId: requireNonEmpty(key.streamId, 'streamId'),
    scope: requireNonEmpty(key.scope, 'scope')
  };
}

function isNonRetryableError(error: unknown): boolean {
  return error instanceof NonRetryableOutboxError;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return 'Unknown outbox transport failure';
}

function normalizeInboundSyncErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return 'Unknown inbound sync failure';
}

function isIdentityControlEvent(event: unknown): event is SignedEventEnvelope {
  if (!isRecord(event) || typeof event.kind !== 'string') return false;
  switch (event.kind) {
    case 'identity.controller.created':
    case 'identity.device.authorized':
    case 'identity.device.revoked':
    case 'identity.device.rotated':
    case 'identity.capability.granted':
    case 'identity.capability.revoked':
    case 'identity.contact-card.published':
      return true;
    default:
      return false;
  }
}

function applyIdentityControlProjectionUpdate(
  current: StoredIdentityControlProjection | undefined,
  event: SignedEventEnvelope,
  updatedAt: string
): StoredIdentityControlProjection {
  const state = current === undefined ? createEmptyIdentityControlState() : toIdentityControlState(current);
  const nextState = applyIdentityControlEvent(state, event);
  return {
    identityId: event.author,
    epoch: nextState.epoch,
    devices: nextState.devices,
    capabilities: nextState.capabilities,
    ...(nextState.controllerPublicKey === undefined ? {} : { controllerPublicKey: nextState.controllerPublicKey }),
    ...(nextState.contactCardPublication === undefined
      ? {}
      : { contactCardPublication: nextState.contactCardPublication }),
    ...(nextState.lastEventId === undefined ? {} : { lastEventId: nextState.lastEventId }),
    updatedAt
  };
}

function toIdentityControlState(current: StoredIdentityControlProjection) {
  return {
    epoch: current.epoch,
    devices: current.devices,
    capabilities: current.capabilities,
    ...(current.controllerPublicKey === undefined ? {} : { controllerPublicKey: current.controllerPublicKey }),
    ...(current.contactCardPublication === undefined
      ? {}
      : { contactCardPublication: current.contactCardPublication }),
    ...(current.lastEventId === undefined ? {} : { lastEventId: current.lastEventId })
  };
}

// Phase 1.8.12 — re-export the reputation inbound pipeline so
// callers receive the full sync-client surface from a single import.
export {
  REPUTATION_DROP_REASONS,
  processInboundReputationBatch
} from './inbound-reputation.js';
export type {
  InboundReputationRecord,
  ProcessInboundReputationInput,
  ProcessInboundReputationResult,
  ReputationDropReason
} from './inbound-reputation.js';
