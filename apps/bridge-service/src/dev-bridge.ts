import { join } from 'node:path';
import { BridgeService } from './service.js';
import { JsonFileBridgeStore } from './stores.js';
import { type BridgeServiceRole } from './types.js';

export type DevBridgeOptions = Readonly<{
  role?: BridgeServiceRole;
  storeFilePath?: string;
  maxRecords?: number;
  ttlMs?: number;
  initialSequence?: number;
}>;

const DEFAULT_STORE_FILE = join('.lfp2p', 'bridge-store.json');

export function createDevBridgeService(options: DevBridgeOptions = {}): BridgeService {
  return new BridgeService({
    ...(options.role === undefined ? {} : { role: options.role }),
    store: new JsonFileBridgeStore({
      filePath: options.storeFilePath ?? DEFAULT_STORE_FILE,
      ...(options.maxRecords === undefined ? {} : { maxRecords: options.maxRecords }),
      ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
      ...(options.initialSequence === undefined ? {} : { initialSequence: options.initialSequence })
    })
  });
}
