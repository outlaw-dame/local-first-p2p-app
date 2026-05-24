import { computeBackoffDelayMs } from './index.js';

export type ForegroundSyncTrigger = 'startup' | 'manual' | 'online' | 'visible' | 'timer';
export type ForegroundSyncStatus = 'idle' | 'running' | 'backing-off';
export type ForegroundSyncSkipReason = 'offline' | 'already-running' | 'backoff';

export type ForegroundSyncRunInput = Readonly<{
  trigger: ForegroundSyncTrigger;
  startedAt: string;
}>;

export type ForegroundSyncRunResult = Readonly<Record<string, unknown>> | void;
export type ForegroundSyncRun = (input: ForegroundSyncRunInput) => Promise<ForegroundSyncRunResult>;

export type ForegroundSyncControllerOptions = Readonly<{
  run: ForegroundSyncRun;
  isOnline?: () => boolean;
  now?: () => Date;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  random?: () => number;
}>;

export type ForegroundSyncRequestOptions = Readonly<{
  bypassBackoff?: boolean;
}>;

export type ForegroundSyncState = Readonly<{
  status: ForegroundSyncStatus;
  consecutiveFailures: number;
  lastStartedAt?: string;
  lastCompletedAt?: string;
  lastFailedAt?: string;
  lastError?: string;
  nextRetryAt?: string;
}>;

export type ForegroundSyncResult =
  | Readonly<{
      status: 'completed';
      trigger: ForegroundSyncTrigger;
      startedAt: string;
      finishedAt: string;
      consecutiveFailures: 0;
      result?: ForegroundSyncRunResult;
    }>
  | Readonly<{
      status: 'failed';
      trigger: ForegroundSyncTrigger;
      startedAt: string;
      finishedAt: string;
      consecutiveFailures: number;
      error: string;
      errorName?: string;
      nextRetryAt: string;
    }>
  | Readonly<{
      status: 'skipped';
      trigger: ForegroundSyncTrigger;
      skippedAt: string;
      reason: ForegroundSyncSkipReason;
      nextRetryAt?: string;
    }>;

const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 60_000;

export class ForegroundSyncController {
  readonly #run: ForegroundSyncRun;
  readonly #isOnline: () => boolean;
  readonly #now: () => Date;
  readonly #baseDelayMs: number;
  readonly #maxDelayMs: number;
  readonly #jitterRatio: number | undefined;
  readonly #random: (() => number) | undefined;
  #running = false;
  #state: ForegroundSyncState = { status: 'idle', consecutiveFailures: 0 };

  constructor(options: ForegroundSyncControllerOptions) {
    this.#run = options.run;
    this.#isOnline = options.isOnline ?? (() => true);
    this.#now = options.now ?? (() => new Date());
    this.#baseDelayMs = requirePositiveInteger(options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS, 'baseDelayMs');
    this.#maxDelayMs = requirePositiveInteger(options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS, 'maxDelayMs');
    this.#jitterRatio = options.jitterRatio;
    this.#random = options.random;
  }

  getState(): ForegroundSyncState {
    return { ...this.#state };
  }

  async requestSync(trigger: ForegroundSyncTrigger, options: ForegroundSyncRequestOptions = {}): Promise<ForegroundSyncResult> {
    const requestedAt = this.#now();
    const requestedAtIso = requestedAt.toISOString();

    if (this.#running) {
      return skipped(trigger, requestedAtIso, 'already-running', this.#state.nextRetryAt);
    }

    if (!this.#isOnline()) {
      return skipped(trigger, requestedAtIso, 'offline', this.#state.nextRetryAt);
    }

    if (options.bypassBackoff !== true && isBackoffActive(this.#state.nextRetryAt, requestedAt)) {
      return skipped(trigger, requestedAtIso, 'backoff', this.#state.nextRetryAt);
    }

    this.#running = true;
    this.#state = { ...this.#state, status: 'running', lastStartedAt: requestedAtIso };

    try {
      const result = await this.#run({ trigger, startedAt: requestedAtIso });
      const finishedAt = this.#now().toISOString();
      this.#state = {
        status: 'idle',
        consecutiveFailures: 0,
        lastStartedAt: requestedAtIso,
        lastCompletedAt: finishedAt
      };
      return {
        status: 'completed',
        trigger,
        startedAt: requestedAtIso,
        finishedAt,
        consecutiveFailures: 0,
        ...(result === undefined ? {} : { result })
      };
    } catch (error) {
      const finishedAtDate = this.#now();
      const finishedAt = finishedAtDate.toISOString();
      const consecutiveFailures = this.#state.consecutiveFailures + 1;
      const nextRetryAt = new Date(finishedAtDate.getTime() + this.#nextDelayMs(consecutiveFailures)).toISOString();
      const message = normalizeSyncError(error);
      const name = error instanceof Error && error.name.trim().length > 0 ? error.name : undefined;
      this.#state = {
        status: 'backing-off',
        consecutiveFailures,
        lastStartedAt: requestedAtIso,
        lastFailedAt: finishedAt,
        lastError: message,
        nextRetryAt
      };
      return {
        status: 'failed',
        trigger,
        startedAt: requestedAtIso,
        finishedAt,
        consecutiveFailures,
        error: message,
        ...(name === undefined ? {} : { errorName: name }),
        nextRetryAt
      };
    } finally {
      this.#running = false;
    }
  }

  #nextDelayMs(attempt: number): number {
    return computeBackoffDelayMs({
      attempt,
      baseDelayMs: this.#baseDelayMs,
      maxDelayMs: this.#maxDelayMs,
      ...(this.#jitterRatio === undefined ? {} : { jitterRatio: this.#jitterRatio }),
      ...(this.#random === undefined ? {} : { random: this.#random })
    });
  }
}

function skipped(
  trigger: ForegroundSyncTrigger,
  skippedAt: string,
  reason: ForegroundSyncSkipReason,
  nextRetryAt: string | undefined
): ForegroundSyncResult {
  return {
    status: 'skipped',
    trigger,
    skippedAt,
    reason,
    ...(nextRetryAt === undefined ? {} : { nextRetryAt })
  };
}

function isBackoffActive(nextRetryAt: string | undefined, now: Date): boolean {
  if (nextRetryAt === undefined) return false;
  const retryTime = Date.parse(nextRetryAt);
  if (!Number.isFinite(retryTime)) return false;
  return retryTime > now.getTime();
}

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function normalizeSyncError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return 'Unknown foreground sync failure';
}
