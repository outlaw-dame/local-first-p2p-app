import { bsError } from './errors.js';

export type BackoffConfig = Readonly<{
  /** Base delay for the first retry. */
  baseDelayMs: number;
  /** Hard cap on any single delay. */
  maxDelayMs: number;
}>;

export const DEFAULT_BACKOFF: BackoffConfig = Object.freeze({
  baseDelayMs: 100,
  maxDelayMs: 10_000
});

export function validateBackoffConfig(config: BackoffConfig): void {
  const { baseDelayMs, maxDelayMs } = config;
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
    throw bsError('BS_INVALID_CONFIG', 'backoff.baseDelayMs must be a finite number >= 0');
  }
  if (!Number.isFinite(maxDelayMs) || maxDelayMs < baseDelayMs) {
    throw bsError('BS_INVALID_CONFIG', 'backoff.maxDelayMs must be finite and >= baseDelayMs');
  }
}

/**
 * Exponential backoff with full jitter (AWS-style): the delay for
 * retry N (0-indexed) is uniform in [0, min(maxDelayMs, base * 2^N)].
 * Full jitter avoids synchronized retry storms across many clients
 * hitting the same recovering provider.
 *
 * `random` is injectable so tests are deterministic; it must return a
 * number in [0, 1).
 */
export function computeBackoffDelayMs(
  retryIndex: number,
  config: BackoffConfig,
  random: () => number
): number {
  if (!Number.isInteger(retryIndex) || retryIndex < 0) {
    throw bsError('BS_INVALID_INPUT', 'retryIndex must be a non-negative integer');
  }
  // 2^retryIndex overflows to Infinity for large indices; Math.min
  // keeps the result finite because maxDelayMs is validated finite.
  const ceiling = Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** retryIndex);
  const r = random();
  if (!Number.isFinite(r) || r < 0 || r >= 1) {
    throw bsError('BS_INVALID_INPUT', 'random() must return a finite number in [0, 1)');
  }
  return Math.floor(r * ceiling);
}
