export type PwaBridgeConfigEnv = Readonly<Record<string, unknown>>;

export type PwaBridgeConfig =
  | Readonly<{
      status: 'disabled';
      reason: 'not-enabled';
      message: string;
    }>
  | Readonly<{
      status: 'invalid';
      reason:
        | 'missing-endpoint'
        | 'invalid-endpoint'
        | 'unsupported-protocol'
        | 'embedded-credentials'
        | 'query-or-fragment'
        | 'insecure-remote-endpoint'
        | 'invalid-timeout'
        | 'invalid-target';
      message: string;
    }>
  | Readonly<{
      status: 'configured';
      endpoint: string;
      target: string;
      timeoutMs: number;
      transportWired: false;
      message: string;
    }>;

const ENABLED_KEY = 'VITE_LFP2P_BRIDGE_SYNC_ENABLED';
const ENDPOINT_KEY = 'VITE_LFP2P_BRIDGE_ENDPOINT';
const TARGET_KEY = 'VITE_LFP2P_BRIDGE_TARGET';
const TIMEOUT_KEY = 'VITE_LFP2P_BRIDGE_TIMEOUT_MS';
const DEFAULT_TARGET = 'bridge:development';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_TARGET_LENGTH = 120;
const TARGET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/u;

export function resolvePwaBridgeConfig(env: PwaBridgeConfigEnv = importMetaEnv()): PwaBridgeConfig {
  if (!isExplicitlyEnabled(env[ENABLED_KEY])) {
    return {
      status: 'disabled',
      reason: 'not-enabled',
      message: `Bridge sync is disabled. Set ${ENABLED_KEY}=true and ${ENDPOINT_KEY} to configure the boundary.`
    };
  }

  const endpointValue = stringEnv(env[ENDPOINT_KEY]);
  if (endpointValue === undefined) {
    return invalid('missing-endpoint', `${ENDPOINT_KEY} is required when bridge sync is explicitly enabled.`);
  }

  const endpoint = parseBridgeEndpoint(endpointValue);
  if (endpoint.status === 'invalid') return endpoint;

  const target = parseBridgeTarget(env[TARGET_KEY]);
  if (target.status === 'invalid') return target;

  const timeoutMs = parseBridgeTimeoutMs(env[TIMEOUT_KEY]);
  if (timeoutMs.status === 'invalid') return timeoutMs;

  return {
    status: 'configured',
    endpoint: endpoint.endpoint,
    target: target.target,
    timeoutMs: timeoutMs.timeoutMs,
    transportWired: false,
    message: 'Bridge endpoint is configured, but PWA bridge transport is not wired in this slice.'
  };
}

export function formatPwaBridgeConfigStatus(config: PwaBridgeConfig): string {
  if (config.status === 'configured') {
    const host = new URL(config.endpoint).host;
    return `Bridge config ready for future transport: ${host} (${config.target}).`;
  }
  if (config.status === 'disabled') return config.message;
  return `Bridge config invalid: ${config.message}`;
}

function parseBridgeEndpoint(value: string): PwaBridgeConfig | Readonly<{ status: 'valid'; endpoint: string }> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid('invalid-endpoint', `${ENDPOINT_KEY} must be an absolute http(s) URL.`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return invalid('unsupported-protocol', `${ENDPOINT_KEY} must use http or https.`);
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return invalid('embedded-credentials', `${ENDPOINT_KEY} must not include embedded credentials.`);
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    return invalid('query-or-fragment', `${ENDPOINT_KEY} must not include query strings or fragments.`);
  }
  if (url.protocol === 'http:' && !isLocalBridgeHost(url.hostname)) {
    return invalid('insecure-remote-endpoint', `${ENDPOINT_KEY} must use https unless targeting localhost.`);
  }

  return { status: 'valid', endpoint: url.href };
}

function parseBridgeTarget(value: unknown): PwaBridgeConfig | Readonly<{ status: 'valid'; target: string }> {
  const target = stringEnv(value) ?? DEFAULT_TARGET;
  if (target.length > MAX_TARGET_LENGTH || !TARGET_PATTERN.test(target)) {
    return invalid('invalid-target', `${TARGET_KEY} must be ${MAX_TARGET_LENGTH} characters or fewer and contain only letters, numbers, colon, dot, underscore, or dash.`);
  }
  return { status: 'valid', target };
}

function parseBridgeTimeoutMs(value: unknown): PwaBridgeConfig | Readonly<{ status: 'valid'; timeoutMs: number }> {
  const raw = stringEnv(value);
  if (raw === undefined) return { status: 'valid', timeoutMs: DEFAULT_TIMEOUT_MS };
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_TIMEOUT_MS) {
    return invalid('invalid-timeout', `${TIMEOUT_KEY} must be a positive integer no greater than ${MAX_TIMEOUT_MS}.`);
  }
  return { status: 'valid', timeoutMs: parsed };
}

function stringEnv(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function isExplicitlyEnabled(value: unknown): boolean {
  const normalized = stringEnv(value)?.toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function isLocalBridgeHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]' || normalized === '::1';
}

function invalid(reason: Extract<PwaBridgeConfig, { status: 'invalid' }>['reason'], message: string): PwaBridgeConfig {
  return { status: 'invalid', reason, message };
}

function importMetaEnv(): PwaBridgeConfigEnv {
  return (import.meta as unknown as { env?: PwaBridgeConfigEnv }).env ?? {};
}
