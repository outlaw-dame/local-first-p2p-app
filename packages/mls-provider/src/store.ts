import { mlsError } from './errors.js';

/**
 * Injected persistence port for MLS state (ADR-015: the provider must
 * accept injected storage; it never persists through library-internal
 * mechanisms).
 *
 * Values are opaque serialized bytes containing SECRET key material.
 * Durable implementations (e.g. `@lfp2p/local-store`) MUST encrypt
 * them at rest under `localProtectionKeys`, exactly like
 * `StoredDeviceIdentity.encryptedPrivateKey`, and MUST scope them
 * `device-local`. Store keys are opaque identifiers derived by the
 * provider; they contain no plaintext group metadata.
 */
export interface MlsStateStore {
  loadGroupState(key: string): Promise<Uint8Array | undefined>;
  saveGroupState(key: string, bytes: Uint8Array): Promise<void>;
  deleteGroupState(key: string): Promise<boolean>;
  loadPrivateKeyPackage(key: string): Promise<Uint8Array | undefined>;
  savePrivateKeyPackage(key: string, bytes: Uint8Array): Promise<void>;
  deletePrivateKeyPackage(key: string): Promise<boolean>;
}

function zeroize(bytes: Uint8Array): void {
  bytes.fill(0);
}

/**
 * In-memory reference implementation. Defensive copies on both sides
 * so callers cannot mutate stored state; deleted entries are zeroized
 * before release since they contain key material.
 *
 * Suitable for tests and ephemeral sessions only — it provides no
 * at-rest encryption because nothing rests.
 */
export class InMemoryMlsStateStore implements MlsStateStore {
  private readonly groups = new Map<string, Uint8Array>();
  private readonly keyPackages = new Map<string, Uint8Array>();

  private static get(map: Map<string, Uint8Array>, key: string): Promise<Uint8Array | undefined> {
    const bytes = map.get(key);
    return Promise.resolve(bytes === undefined ? undefined : bytes.slice());
  }

  private static set(map: Map<string, Uint8Array>, key: string, bytes: Uint8Array): Promise<void> {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      return Promise.reject(mlsError('MLS_STORE_FAILURE', 'refusing to store empty state bytes'));
    }
    const previous = map.get(key);
    map.set(key, bytes.slice());
    if (previous !== undefined) zeroize(previous);
    return Promise.resolve();
  }

  private static remove(map: Map<string, Uint8Array>, key: string): Promise<boolean> {
    const existing = map.get(key);
    if (existing === undefined) return Promise.resolve(false);
    map.delete(key);
    zeroize(existing);
    return Promise.resolve(true);
  }

  loadGroupState(key: string): Promise<Uint8Array | undefined> {
    return InMemoryMlsStateStore.get(this.groups, key);
  }

  saveGroupState(key: string, bytes: Uint8Array): Promise<void> {
    return InMemoryMlsStateStore.set(this.groups, key, bytes);
  }

  deleteGroupState(key: string): Promise<boolean> {
    return InMemoryMlsStateStore.remove(this.groups, key);
  }

  loadPrivateKeyPackage(key: string): Promise<Uint8Array | undefined> {
    return InMemoryMlsStateStore.get(this.keyPackages, key);
  }

  savePrivateKeyPackage(key: string, bytes: Uint8Array): Promise<void> {
    return InMemoryMlsStateStore.set(this.keyPackages, key, bytes);
  }

  deletePrivateKeyPackage(key: string): Promise<boolean> {
    return InMemoryMlsStateStore.remove(this.keyPackages, key);
  }
}
