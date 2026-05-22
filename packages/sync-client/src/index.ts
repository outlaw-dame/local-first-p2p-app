export type RetryPolicyInput = Readonly<{
  attempt: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  random?: () => number;
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
