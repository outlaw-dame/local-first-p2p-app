import type { LocalDeviceSession } from '@lfp2p/identity';
import type { StoredIdentityControlProjection, createLocalFirstStore } from '@lfp2p/local-store';
import { ensureLocalDeviceWrapMetadataPublished } from './pwa-identity-emit.js';

type Store = ReturnType<typeof createLocalFirstStore>;

export type PwaWrapMetadataBootstrapStatus =
  | 'not-ready'
  | 'already-published'
  | 'published'
  | 'failed';

export type PwaWrapMetadataBootstrapResult = Readonly<{
  status: PwaWrapMetadataBootstrapStatus;
  projection: StoredIdentityControlProjection | undefined;
  message: string;
}>;

export type EnsurePwaLocalWrapMetadataPublishedInput = Readonly<{
  store: Store;
  session: LocalDeviceSession;
  projection: StoredIdentityControlProjection | undefined;
}>;

/**
 * Best-effort PWA/bootstrap wrapper around Phase 5.12C local wrap publication.
 *
 * The lower-level helper intentionally fails closed when the identity-control
 * projection is missing or does not match the local session. The app bootstrap
 * still needs to tolerate first-run or not-yet-synced states, so this adapter
 * only attempts publication once a controller-known projection exists. Failures
 * are surfaced as status text while preserving the previous projection snapshot.
 */
export async function ensurePwaLocalWrapMetadataPublished(
  input: EnsurePwaLocalWrapMetadataPublishedInput
): Promise<PwaWrapMetadataBootstrapResult> {
  const projection = input.projection;
  if (projection === undefined || projection.controllerPublicKey === undefined) {
    return Object.freeze({
      status: 'not-ready',
      projection,
      message: 'Identity projection is not controller-known yet; wrap metadata publication deferred.'
    });
  }

  try {
    const result = await ensureLocalDeviceWrapMetadataPublished({
      store: input.store,
      session: input.session
    });
    return Object.freeze({
      status: result.status,
      projection: result.projection,
      message:
        result.status === 'published'
          ? 'Local device wrap metadata published to the identity projection.'
          : 'Local device wrap metadata is already published.'
    });
  } catch (error: unknown) {
    return Object.freeze({
      status: 'failed',
      projection,
      message: `Local device wrap metadata publication failed: ${formatBootstrapError(error)}`
    });
  }
}

function formatBootstrapError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (typeof error === 'string' && error.trim().length > 0) return error;
  return 'Unknown error';
}
