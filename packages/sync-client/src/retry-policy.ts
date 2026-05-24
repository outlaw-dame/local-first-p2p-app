export const DEFAULT_JITTER_RATIO = 0.35;

export function requireJitterRatio(value: number, name = 'jitterRatio'): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1`);
  return value;
}

export function requireOptionalJitterRatio(value: number | undefined, name = 'jitterRatio'): number | undefined {
  if (value === undefined) return undefined;
  return requireJitterRatio(value, name);
}

export function resolveJitterRatio(value: number | undefined, name = 'jitterRatio'): number {
  return requireJitterRatio(value ?? DEFAULT_JITTER_RATIO, name);
}
