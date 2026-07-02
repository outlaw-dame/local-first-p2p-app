import { bsError } from './errors.js';

export type BreakerConfig = Readonly<{
  /** Consecutive transient failures before the breaker opens. */
  failureThreshold: number;
  /** Cooldown after the first trip. */
  cooldownMs: number;
  /** Hard cap on escalated cooldowns. */
  maxCooldownMs: number;
}>;

export const DEFAULT_BREAKER: BreakerConfig = Object.freeze({
  failureThreshold: 5,
  cooldownMs: 5_000,
  maxCooldownMs: 300_000
});

export function validateBreakerConfig(config: BreakerConfig): void {
  if (!Number.isInteger(config.failureThreshold) || config.failureThreshold < 1) {
    throw bsError('BS_INVALID_CONFIG', 'breaker.failureThreshold must be an integer >= 1');
  }
  if (!Number.isFinite(config.cooldownMs) || config.cooldownMs < 0) {
    throw bsError('BS_INVALID_CONFIG', 'breaker.cooldownMs must be a finite number >= 0');
  }
  if (!Number.isFinite(config.maxCooldownMs) || config.maxCooldownMs < config.cooldownMs) {
    throw bsError('BS_INVALID_CONFIG', 'breaker.maxCooldownMs must be finite and >= cooldownMs');
  }
}

type BreakerState = {
  consecutiveFailures: number;
  /** How many times the breaker has tripped since the last success. */
  trips: number;
  /** Epoch-ms until which attempts are refused; 0 when closed. */
  openUntil: number;
  /** True while a single half-open probe is outstanding. */
  probing: boolean;
};

/**
 * Per-fetcher circuit breaker with escalating cooldown and half-open
 * probing. Self-healing: once a cooldown elapses, exactly one probe
 * attempt is allowed; a success fully resets the fetcher, a failure
 * re-opens with a doubled (capped) cooldown. A success at any point
 * resets everything, so a recovered provider is immediately trusted
 * again.
 *
 * Time is injected (`now`) so tests are deterministic and callers can
 * share a clock with the rest of the store.
 */
export class FetcherHealthTracker {
  private readonly config: BreakerConfig;
  private readonly states = new Map<string, BreakerState>();

  constructor(config: BreakerConfig = DEFAULT_BREAKER) {
    validateBreakerConfig(config);
    this.config = config;
  }

  private stateFor(id: string): BreakerState {
    let state = this.states.get(id);
    if (state === undefined) {
      state = { consecutiveFailures: 0, trips: 0, openUntil: 0, probing: false };
      this.states.set(id, state);
    }
    return state;
  }

  /**
   * Whether the fetcher may be attempted right now. When a cooldown has
   * elapsed this transitions to a half-open probe: the first caller
   * gets `true`, concurrent callers get `false` until the probe
   * resolves via recordSuccess/recordFailure.
   */
  canAttempt(id: string, nowMs: number): boolean {
    const state = this.stateFor(id);
    if (state.openUntil === 0) return true;
    if (nowMs < state.openUntil) return false;
    if (state.probing) return false;
    state.probing = true;
    return true;
  }

  recordSuccess(id: string): void {
    this.states.set(id, { consecutiveFailures: 0, trips: 0, openUntil: 0, probing: false });
  }

  recordFailure(id: string, nowMs: number): void {
    const state = this.stateFor(id);
    state.consecutiveFailures += 1;
    const wasProbe = state.probing;
    state.probing = false;
    if (wasProbe || state.consecutiveFailures >= this.config.failureThreshold) {
      state.trips += 1;
      const escalated = this.config.cooldownMs * 2 ** (state.trips - 1);
      const cooldown = Math.min(this.config.maxCooldownMs, escalated);
      state.openUntil = nowMs + cooldown;
      state.consecutiveFailures = 0;
    }
  }

  /** Diagnostic view; safe to expose (contains no request data). */
  snapshot(id: string): Readonly<{ open: boolean; trips: number }> {
    const state = this.states.get(id);
    if (state === undefined) return Object.freeze({ open: false, trips: 0 });
    return Object.freeze({ open: state.openUntil !== 0, trips: state.trips });
  }
}
