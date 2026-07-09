import { useEffect } from 'react';
import { DeviceIdentityManager } from '@lfp2p/identity';
import { createLocalFirstStore } from '@lfp2p/local-store';
import { RootApp } from './root-app.js';
import {
  ensurePwaLocalWrapMetadataPublished,
  type PwaWrapMetadataBootstrapResult
} from './pwa-wrap-metadata-bootstrap.js';

export const PWA_BOOTSTRAP_STORE_NAME = 'lfp2p-pwa-v1';

export function BootstrapRootApp(): JSX.Element {
  useEffect(() => {
    void runPwaWrapMetadataBootstrap();
  }, []);

  return <RootApp />;
}

/**
 * Run the Phase 5.12C local wrap-publication repair from app startup without
 * blocking the visible PWA shell. The helper uses its own short-lived store
 * handle so the existing RootApp store ownership stays untouched.
 */
export async function runPwaWrapMetadataBootstrap(
  storeName = PWA_BOOTSTRAP_STORE_NAME
): Promise<PwaWrapMetadataBootstrapResult> {
  const store = createLocalFirstStore(storeName);
  try {
    const identityManager = new DeviceIdentityManager(store);
    const session = await identityManager.getOrCreatePrimaryDeviceSession();
    const projection = await store.getIdentityControlProjection(session.identity.identityId);
    return await ensurePwaLocalWrapMetadataPublished({
      store,
      session,
      projection
    });
  } catch (error: unknown) {
    return Object.freeze({
      status: 'failed',
      projection: undefined,
      message: `Local device wrap metadata bootstrap failed: ${formatBootstrapError(error)}`
    });
  } finally {
    await store.close();
  }
}

function formatBootstrapError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (typeof error === 'string' && error.trim().length > 0) return error;
  return 'Unknown error';
}
