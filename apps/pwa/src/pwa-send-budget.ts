const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_RUNS = 3;
const DEFAULT_MAX_ENTRIES = 5;
const DEFAULT_MIN_INTERVAL_MS = 1_000;

export type PwaSendBudgetReason = 'minimum-interval' | 'window-limit';

export type PwaSendBudgetOptions = Readonly<{
  windowMs?: number;
  maxRuns?: number;
  maxEntries?: number;
  minIntervalMs?: number;
}>;

export type PwaSendBudgetDecision =
  | Readonly<{
      status: 'accepted';
      remainingRuns: number;
      remainingEntries: number;
    }>
  | Readonly<{
      status: 'deferred';
      reason: PwaSendBudgetReason;
      retryAfterMs: number;
      message: string;
    }>;

export type PwaSendBudgetSnapshot = Readonly<{
  windowStartedAtMs: number;
  lastAcceptedAtMs?: number;
  runs: number;
  entries: number;
  windowMs: number;
  maxRuns: number;
  maxEntries: number;
  minIntervalMs: number;
}>;

export type PwaSendBudgetRefundInput = Readonly<{
  runs?: number;
  entries?: number;
}>;

export class PwaSendBudget {
  readonly #options: Required<PwaSendBudgetOptions>;
  #windowStartedAtMs: number | undefined;
  #lastAcceptedAtMs: number | undefined;
  #runs = 0;
  #entries = 0;

  constructor(options: PwaSendBudgetOptions = {}) {
    this.#options = normalizeOptions(options);
  }

  reserve(input: Readonly<{ now?: Date; entries: number }>): PwaSendBudgetDecision {
    const nowMs = normalizeNowMs(input.now);
    const entries = positiveInteger(input.entries, 'entries');
    if (entries > this.#options.maxEntries) {
      throw new RangeError(
        `send budget entries must not exceed the configured maxEntries value of ${this.#options.maxEntries}.`
      );
    }
    this.#rollWindow(nowMs);

    if (this.#lastAcceptedAtMs !== undefined) {
      const elapsedMs = Math.max(0, nowMs - this.#lastAcceptedAtMs);
      if (elapsedMs < this.#options.minIntervalMs) {
        return deferred('minimum-interval', this.#options.minIntervalMs - elapsedMs);
      }
    }

    const windowStartMs = this.#windowStartedAtMs!;
    const retryAfterMs = Math.max(1, windowStartMs + this.#options.windowMs - nowMs);
    if (
      this.#runs + 1 > this.#options.maxRuns ||
      this.#entries + entries > this.#options.maxEntries
    ) {
      return deferred('window-limit', retryAfterMs);
    }

    this.#runs += 1;
    this.#entries += entries;
    this.#lastAcceptedAtMs = nowMs;

    return {
      status: 'accepted',
      remainingRuns: this.#options.maxRuns - this.#runs,
      remainingEntries: this.#options.maxEntries - this.#entries
    };
  }

  refund(input: PwaSendBudgetRefundInput): void {
    const runs = input.runs === undefined ? 0 : nonNegativeInteger(input.runs, 'refund.runs');
    const entries =
      input.entries === undefined ? 0 : nonNegativeInteger(input.entries, 'refund.entries');
    if (runs === 0 && entries === 0) return;
    if (runs > this.#runs)
      throw new RangeError('send budget refund.runs exceeds current reserved runs.');
    if (entries > this.#entries)
      throw new RangeError('send budget refund.entries exceeds current reserved entries.');

    this.#runs -= runs;
    this.#entries -= entries;
    if (this.#runs === 0 && this.#entries === 0) {
      this.#lastAcceptedAtMs = undefined;
    }
  }

  snapshot(now: Date = new Date()): PwaSendBudgetSnapshot {
    const nowMs = normalizeNowMs(now);
    this.#rollWindow(nowMs);
    return {
      windowStartedAtMs: this.#windowStartedAtMs ?? nowMs,
      ...(this.#lastAcceptedAtMs === undefined ? {} : { lastAcceptedAtMs: this.#lastAcceptedAtMs }),
      runs: this.#runs,
      entries: this.#entries,
      ...this.#options
    };
  }

  reset(now: Date = new Date()): void {
    const nowMs = normalizeNowMs(now);
    this.#resetMs(nowMs);
  }

  #resetMs(nowMs: number): void {
    this.#windowStartedAtMs = nowMs;
    this.#lastAcceptedAtMs = undefined;
    this.#runs = 0;
    this.#entries = 0;
  }

  #rollWindow(nowMs: number): void {
    if (this.#windowStartedAtMs === undefined || nowMs < this.#windowStartedAtMs) {
      this.#resetMs(nowMs);
      return;
    }
    if (nowMs - this.#windowStartedAtMs >= this.#options.windowMs) {
      this.#resetMs(nowMs);
    }
  }
}

export function createPwaSendBudget(options: PwaSendBudgetOptions = {}): PwaSendBudget {
  return new PwaSendBudget(options);
}

export function formatPwaSendBudgetDecision(decision: PwaSendBudgetDecision): string {
  if (decision.status === 'accepted') {
    return `Send budget accepted. Remaining window: ${decision.remainingRuns} runs and ${decision.remainingEntries} entries.`;
  }
  return `${decision.message} Retry after ${formatMs(decision.retryAfterMs)}.`;
}

function normalizeOptions(options: PwaSendBudgetOptions): Required<PwaSendBudgetOptions> {
  return {
    windowMs: positiveInteger(options.windowMs ?? DEFAULT_WINDOW_MS, 'windowMs'),
    maxRuns: positiveInteger(options.maxRuns ?? DEFAULT_MAX_RUNS, 'maxRuns'),
    maxEntries: positiveInteger(options.maxEntries ?? DEFAULT_MAX_ENTRIES, 'maxEntries'),
    minIntervalMs: nonNegativeInteger(
      options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS,
      'minIntervalMs'
    )
  };
}

function normalizeNowMs(now: Date | undefined): number {
  const value = (now ?? new Date()).getTime();
  if (!Number.isSafeInteger(value)) throw new TypeError('send budget now must be a valid Date.');
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new TypeError(`send budget ${label} must be a positive safe integer.`);
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`send budget ${label} must be a non-negative safe integer.`);
  return value;
}

function deferred(reason: PwaSendBudgetReason, retryAfterMs: number): PwaSendBudgetDecision {
  return {
    status: 'deferred',
    reason,
    retryAfterMs: Math.max(1, Math.ceil(retryAfterMs)),
    message:
      reason === 'minimum-interval'
        ? 'Send budget minimum interval is active.'
        : 'Send budget window limit is active.'
  };
}

function formatMs(value: number): string {
  if (value < 1_000) return `${value}ms`;
  return `${Math.ceil(value / 1_000)}s`;
}
