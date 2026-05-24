export function normalizeBridgeEndpoint(endpoint: string | URL): string {
  const url = endpoint instanceof URL ? new URL(endpoint.href) : new URL(endpoint);
  if (url.username.length > 0 || url.password.length > 0) throw new Error('Bridge endpoint must not include credentials');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Bridge endpoint must use http or https');
  return url.toString();
}

export function isNonRetryableHttpStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 413 || status === 422;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be positive`);
  return value;
}

export function requireNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be non-negative`);
  return value;
}

export function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} is required`);
  return value;
}

export function isCanonicalIsoDateString(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
