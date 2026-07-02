import type { CompressionDescriptor } from '@lfp2p/content-addressing';
import { bsError } from './errors.js';

/**
 * An injected decoder for algorithms this runtime cannot decode
 * natively (`zstd`, `br`). The decoder MUST stop producing output and
 * throw once `maxDecodedBytes` is exceeded; the store still re-checks
 * the output length afterwards and never trusts the adapter.
 */
export type BoundedDecoder = (bytes: Uint8Array, maxDecodedBytes: number) => Promise<Uint8Array>;

export type DecoderMap = Readonly<{
  zstd?: BoundedDecoder;
  br?: BoundedDecoder;
}>;

/**
 * Decode block bytes according to a validated CompressionDescriptor,
 * enforcing the declared decoded size exactly.
 *
 * Fail-closed discipline:
 * - output exceeding `descriptor.decodedSize` aborts mid-stream
 *   (`BS_DECODED_SIZE_EXCEEDED`) — a compression bomb whose descriptor
 *   lies is stopped at the declared bound, not at the much larger
 *   protocol maximum;
 * - output shorter or longer than declared fails (`BS_DECODE_FAILED`)
 *   — the descriptor is part of the signed ref and must be exact;
 * - algorithms without a native or injected decoder fail
 *   (`BS_DECODE_UNSUPPORTED`) rather than passing encoded bytes
 *   through as if decoded;
 * - shared-dictionary refs are not supported by this runtime and fail
 *   closed.
 */
export async function decodeBlockBytes(
  bytes: Uint8Array,
  descriptor: CompressionDescriptor | undefined,
  decoders: DecoderMap
): Promise<Uint8Array> {
  if (descriptor === undefined || descriptor.algorithm === 'identity') {
    return bytes;
  }
  if (descriptor.dictionaryRef !== undefined) {
    throw bsError(
      'BS_DECODE_UNSUPPORTED',
      'shared-dictionary decompression is not supported by this runtime'
    );
  }

  const declared = descriptor.decodedSize;
  let decoded: Uint8Array;
  if (descriptor.algorithm === 'gzip') {
    decoded = await gunzipBounded(bytes, declared);
  } else {
    const decoder = decoders[descriptor.algorithm];
    if (decoder === undefined) {
      throw bsError(
        'BS_DECODE_UNSUPPORTED',
        `no decoder available for compression algorithm "${descriptor.algorithm}"`
      );
    }
    try {
      decoded = await decoder(bytes, declared);
    } catch (error) {
      if (error instanceof Error && error.name === 'BlockStoreError') throw error;
      // Discard upstream error text; it is not under our control.
      throw bsError('BS_DECODE_FAILED', `injected ${descriptor.algorithm} decoder failed`);
    }
  }

  if (decoded.byteLength > declared) {
    throw bsError(
      'BS_DECODED_SIZE_EXCEEDED',
      `decoded output ${decoded.byteLength} exceeds declared decodedSize ${declared}`
    );
  }
  if (decoded.byteLength !== declared) {
    throw bsError(
      'BS_DECODE_FAILED',
      `decoded output ${decoded.byteLength} does not match declared decodedSize ${declared}`
    );
  }
  return decoded;
}

/**
 * Streaming gzip decode via the standard DecompressionStream
 * (available in Node >= 18 and all modern browsers), aborting as soon
 * as output exceeds `maxDecodedBytes` so a bomb never materializes in
 * memory.
 */
async function gunzipBounded(bytes: Uint8Array, maxDecodedBytes: number): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') {
    throw bsError('BS_DECODE_UNSUPPORTED', 'DecompressionStream is unavailable in this runtime');
  }
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  } catch {
    throw bsError('BS_DECODE_FAILED', 'gzip stream initialization failed');
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxDecodedBytes) {
        await reader.cancel();
        throw bsError(
          'BS_DECODED_SIZE_EXCEEDED',
          `gzip output exceeded declared decodedSize ${maxDecodedBytes} mid-stream`
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'BlockStoreError') throw error;
    throw bsError('BS_DECODE_FAILED', 'gzip decode failed (corrupt or truncated input)');
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
