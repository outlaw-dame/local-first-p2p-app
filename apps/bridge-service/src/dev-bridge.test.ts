import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDevBridgeService } from './index.js';

describe('createDevBridgeService', () => {
  it('creates a JSON-file backed bridge service', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lfp2p-dev-bridge-'));
    try {
      const service = createDevBridgeService({
        storeFilePath: join(dir, 'bridge-store.json'),
        initialSequence: 0
      });
      await expect(service.snapshot('1970-01-01T00:00:00.000Z')).resolves.toMatchObject({
        storeKind: 'json-file',
        acceptedCount: 0
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
