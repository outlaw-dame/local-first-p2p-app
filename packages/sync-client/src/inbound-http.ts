import { type SignedEventEnvelope } from '@lfp2p/protocol';
import {
  isAbortError,
  isCanonicalIsoDateString,
  isNonRetryableHttpStatus,
  isRecord,
  normalizeBridgeEndpoint,
  requireNonEmpty,
  requirePositiveInteger
} from './http-bridge-internals.js';
import {
  type InboundSyncPullInput,
  type InboundSyncRecord,
  type InboundSyncTransport
} from './index.js';

type BridgeInboundHttpRecord = Readonly<{
  cursor: string;
  sequence: number;
  event: SignedEventEnvelope;
  receivedAt?: string;
}>;

export type HttpBridgeInboundTransportOptions = Readonly<{
  endpoint: string | URL;
  fetch?: typeof fetch;
  timeoutMs?: number;
}>;

type ParsedBridgeInboundResponse =
  | Readonly<{ parseStatus: 'empty' }>
  | Readonly<{ parseStatus: 'invalid'; reason: string }>
  | Readonly<{ parseStatus: 'valid'; records: readonly BridgeInboundHttpRecord[] }>;

export class NonRetryableInboundSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableInboundSyncError';
  }
}

export function createHttpBridgeInboundTransport(
  options: HttpBridgeInboundTransportOptions
): InboundSyncTransport {
  const endpoint = normalizeBridgeEndpoint(options.endpoint);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  const timeoutMs = requirePositiveInteger(options.timeoutMs ?? 10_000, 'timeoutMs');

  return {
    async pull(input) {
      const requestBody = normalizeInboundPullInput(input);
      const controller = new AbortController();
      const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(requestBody),
          credentials: 'omit',
          signal: controller.signal
        });
        return await mapBridgeInboundHttpResponse(response, requestBody);
      } catch (error) {
        if (isAbortError(error)) {
          throw new Error(`Bridge inbound request timed out after ${timeoutMs}ms`, {
            cause: error
          });
        }
        throw error;
      } finally {
        globalThis.clearTimeout(timeout);
      }
    }
  };
}

async function mapBridgeInboundHttpResponse(
  response: Response,
  request: NormalizedInboundPullInput
): Promise<readonly InboundSyncRecord[]> {
  const text = await response.text();

  if (!response.ok) {
    const reason = extractBridgeErrorReason(text) ?? fallbackHttpReason(response);
    if (isNonRetryableHttpStatus(response.status)) throw new NonRetryableInboundSyncError(reason);
    throw new Error(reason);
  }

  const parsed = parseBridgeInboundResponse(text, request.limit);
  if (parsed.parseStatus === 'empty') throw new Error('Bridge returned an empty inbound response');
  if (parsed.parseStatus === 'invalid') throw new Error(parsed.reason);

  return parsed.records.map((record) => ({
    sourceId: request.sourceId,
    streamId: request.streamId,
    scope: request.scope,
    cursor: record.cursor,
    sequence: record.sequence,
    event: record.event,
    ...(record.receivedAt === undefined ? {} : { receivedAt: record.receivedAt })
  }));
}

type NormalizedInboundPullInput = InboundSyncPullInput;

function normalizeInboundPullInput(input: InboundSyncPullInput): NormalizedInboundPullInput {
  return {
    sourceId: requireNonEmpty(input.sourceId, 'sourceId'),
    streamId: requireNonEmpty(input.streamId, 'streamId'),
    scope: requireNonEmpty(input.scope, 'scope'),
    ...(input.cursor === undefined ? {} : { cursor: requireNonEmpty(input.cursor, 'cursor') }),
    ...(input.limit === undefined ? {} : { limit: requirePositiveInteger(input.limit, 'limit') })
  };
}

function parseBridgeInboundResponse(
  text: string,
  requestedLimit: number | undefined
): ParsedBridgeInboundResponse {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { parseStatus: 'empty' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return invalidBridgeInboundResponse('Bridge returned malformed JSON inbound response');
  }

  if (!isRecord(parsed))
    return invalidBridgeInboundResponse('Bridge returned invalid inbound response body');
  const records = parsed.records;
  if (!Array.isArray(records))
    return invalidBridgeInboundResponse('Bridge inbound response records must be an array');
  if (requestedLimit !== undefined && records.length > requestedLimit) {
    return invalidBridgeInboundResponse('Bridge returned more inbound records than requested');
  }

  const normalized: BridgeInboundHttpRecord[] = [];
  for (const [index, record] of records.entries()) {
    const valid = parseBridgeInboundRecord(record, index);
    if (valid.parseStatus === 'invalid') return invalidBridgeInboundResponse(valid.reason);
    normalized.push(valid.record);
  }
  return { parseStatus: 'valid', records: normalized };
}

function parseBridgeInboundRecord(
  value: unknown,
  index: number
):
  | Readonly<{ parseStatus: 'valid'; record: BridgeInboundHttpRecord }>
  | Readonly<{ parseStatus: 'invalid'; reason: string }> {
  if (!isRecord(value))
    return {
      parseStatus: 'invalid',
      reason: `Bridge inbound record ${index} must be a JSON object`
    };
  if ('sourceId' in value || 'streamId' in value || 'scope' in value) {
    return {
      parseStatus: 'invalid',
      reason: `Bridge inbound record ${index} must not override checkpoint identity`
    };
  }

  const cursor = value.cursor;
  if (typeof cursor !== 'string' || cursor.trim().length === 0) {
    return { parseStatus: 'invalid', reason: `Bridge inbound record ${index} cursor is required` };
  }

  const sequence = value.sequence;
  if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0) {
    return {
      parseStatus: 'invalid',
      reason: `Bridge inbound record ${index} sequence must be a non-negative integer`
    };
  }

  if (!isRecord(value.event)) {
    return {
      parseStatus: 'invalid',
      reason: `Bridge inbound record ${index} event must be a JSON object`
    };
  }

  const receivedAt = value.receivedAt;
  if (receivedAt !== undefined) {
    if (typeof receivedAt !== 'string' || !isCanonicalIsoDateString(receivedAt)) {
      return {
        parseStatus: 'invalid',
        reason: `Bridge inbound record ${index} receivedAt must be a canonical ISO date string`
      };
    }
  }

  return {
    parseStatus: 'valid',
    record: {
      cursor,
      sequence,
      event: value.event as SignedEventEnvelope,
      ...(receivedAt === undefined ? {} : { receivedAt })
    }
  };
}

function extractBridgeErrorReason(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed)) return undefined;
  for (const value of [parsed.reason, parsed.message, parsed.error]) {
    if (typeof value !== 'string') continue;
    const reason = value.trim();
    if (reason.length > 0) return reason;
  }
  return undefined;
}

function fallbackHttpReason(response: Response): string {
  const statusReason = response.statusText.trim();
  return statusReason.length > 0 ? statusReason : `Bridge HTTP ${response.status}`;
}

function invalidBridgeInboundResponse(reason: string): ParsedBridgeInboundResponse {
  return { parseStatus: 'invalid', reason };
}
