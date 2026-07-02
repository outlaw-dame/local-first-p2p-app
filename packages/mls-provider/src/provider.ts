import type { DigestRef } from '@lfp2p/content-addressing';
import { createDigest } from '@lfp2p/content-addressing';
import type {
  AuthenticationService,
  Ciphersuite,
  CiphersuiteImpl,
  CiphersuiteName,
  ClientConfig,
  ClientState,
  Credential,
  GroupState,
  KeyPackage,
  MLSMessage,
  PrivateKeyPackage,
  Proposal
} from 'ts-mls';
import {
  acceptAll,
  createApplicationMessage,
  createCommit,
  createGroup,
  decodeGroupState,
  decodeMlsMessage,
  defaultCapabilities,
  defaultLifetime,
  emptyPskIndex,
  encodeGroupState,
  encodeMlsMessage,
  generateKeyPackage,
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  joinGroup,
  processMessage,
  zeroOutUint8Array
} from 'ts-mls';
// Runtime values not re-exported from the package index; the `./*.js`
// exports map makes these stable subpath imports.
import { defaultClientConfig } from 'ts-mls/clientConfig.js';
import { MlsError, ValidationError } from 'ts-mls/mlsError.js';
import { mlsError } from './errors.js';
import type { MlsIdentityBinding } from './identity.js';
import {
  decodeIdentityBinding,
  encodeIdentityBinding,
  identityBindingsEqual,
  validateIdentityBinding
} from './identity.js';
import { decodePrivateKeyPackage, encodePrivateKeyPackage } from './private-key-package-codec.js';
import type { MlsStateStore } from './store.js';

/**
 * The only ciphersuite this provider accepts (ADR-015). Ed25519
 * credentials align with the protocol identity model; anything else is
 * rejected at construction — no silent downgrade, no runtime widening.
 */
export const PINNED_CIPHERSUITE = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519' as const;

const MAX_GROUP_ID_BYTES = 256;
const MAX_APPLICATION_PLAINTEXT_BYTES = 1024 * 1024;
const MAX_WIRE_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_ADDS_PER_COMMIT = 64;

export type MlsProviderConfig = Readonly<{
  identity: MlsIdentityBinding;
  store: MlsStateStore;
  /** Optional but must equal the pinned suite when provided. */
  ciphersuite?: CiphersuiteName;
}>;

export type GeneratedKeyPackage = Readonly<{
  /** RFC 9420 MLSMessage(mls_key_package) wire bytes — safe to publish. */
  keyPackageWire: Uint8Array;
  /** Digest of the wire bytes; also the consume-once storage key. */
  keyPackageRef: DigestRef;
}>;

export type MlsGroupActiveState = 'active' | 'suspendedPendingReinit' | 'removedFromGroup';

/** Projection-safe epoch checkpoint — no key material, ever. */
export type MlsEpochCheckpoint = Readonly<{
  groupId: Uint8Array;
  epoch: number;
  memberCount: number;
  /** Digest over the sorted member credential identities. */
  membershipDigest: DigestRef;
  active: MlsGroupActiveState;
}>;

export type MlsCommitResult = Readonly<{
  /** RFC 9420 MLSMessage wire bytes for the commit. */
  commitWire: Uint8Array;
  /** Present when the commit adds members. */
  welcomeWire?: Uint8Array;
  checkpoint: MlsEpochCheckpoint;
}>;

export type MlsProcessResult =
  | Readonly<{ kind: 'handshake'; checkpoint: MlsEpochCheckpoint }>
  | Readonly<{ kind: 'application'; plaintext: Uint8Array; epoch: number }>;

function groupKey(groupId: Uint8Array): string {
  let hex = '';
  for (const byte of groupId) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function keyPackageStoreKey(ref: DigestRef): string {
  return `${ref.algorithm}:${ref.digest}`;
}

function validateGroupId(groupId: Uint8Array): Uint8Array {
  if (!(groupId instanceof Uint8Array) || groupId.byteLength === 0) {
    throw mlsError('MLS_INVALID_INPUT', 'groupId must be a non-empty Uint8Array');
  }
  if (groupId.byteLength > MAX_GROUP_ID_BYTES) {
    throw mlsError('MLS_INVALID_INPUT', `groupId exceeds ${MAX_GROUP_ID_BYTES} bytes`);
  }
  return groupId;
}

function zeroizeAll(consumed: ReadonlyArray<Uint8Array>): void {
  for (const bytes of consumed) zeroOutUint8Array(bytes);
}

/** Wipe every private-key buffer in an MLS private key package. */
function zeroizePrivateKeyPackage(pkg: PrivateKeyPackage): void {
  zeroOutUint8Array(pkg.initPrivateKey);
  zeroOutUint8Array(pkg.hpkePrivateKey);
  zeroOutUint8Array(pkg.signaturePrivateKey);
}

/**
 * Map a ts-mls failure to a stable, privacy-safe provider error. The
 * upstream message is intentionally discarded (it may describe secret
 * internal state); only the operation token and error class survive.
 */
function wrapLibraryError(operation: string, error: unknown): never {
  if (error instanceof ValidationError) {
    throw mlsError('MLS_INVALID_INPUT', `${operation}: message rejected by MLS validation`);
  }
  const kind = error instanceof MlsError ? error.constructor.name : 'unexpected-error';
  throw mlsError('MLS_PROVIDER_FAILURE', `${operation}: MLS runtime failure (${kind})`);
}

/**
 * `MlsProvider` reference implementation over ts-mls (ADR-015,
 * P6-M2). This is the cryptographic boundary defined by
 * `docs/protocol/mls-group-keying.md`:
 *
 * - only RFC 9420 wire objects (KeyPackage, Welcome, MLSMessage) and
 *   projection-safe checkpoints cross this boundary — library state
 *   never leaks as protocol objects;
 * - the ciphersuite is pinned; construction fails closed on anything
 *   else;
 * - credentials are minimal lfp2p identity bindings, validated by an
 *   injected MLS AuthenticationService so malformed or foreign
 *   credentials are rejected inside the MLS layer itself;
 * - state persists exclusively through the injected `MlsStateStore`
 *   (encryption at rest is the durable store's contract);
 * - all per-group operations are serialized through an async mutex so
 *   concurrent calls cannot interleave read-modify-write cycles and
 *   corrupt or fork local group state;
 * - private KeyPackages are consume-once: a successful join deletes
 *   the stored private half and zeroizes buffers;
 * - this layer decides NOTHING about protocol authority: membership
 *   policy, fork recovery, and moderation live in the projection and
 *   policy layers above.
 */
export class TsMlsProvider {
  private readonly identity: MlsIdentityBinding;
  private readonly store: MlsStateStore;
  private readonly clientConfig: ClientConfig;
  private csPromise: Promise<CiphersuiteImpl> | undefined;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(config: MlsProviderConfig) {
    if (typeof config !== 'object' || config === null) {
      throw mlsError('MLS_INVALID_CONFIG', 'config must be an object');
    }
    if (config.ciphersuite !== undefined && config.ciphersuite !== PINNED_CIPHERSUITE) {
      throw mlsError(
        'MLS_UNSUPPORTED_CIPHERSUITE',
        `only ${PINNED_CIPHERSUITE} is supported by this provider version`
      );
    }
    this.identity = validateIdentityBinding(config.identity);
    if (typeof config.store !== 'object' || config.store === null) {
      throw mlsError('MLS_INVALID_CONFIG', 'a state store is required');
    }
    this.store = config.store;

    // Enforce lfp2p credential shape inside the MLS layer: leaves with
    // credentials this protocol cannot resolve are rejected during
    // ts-mls validation, not just at the projection layer.
    const authService: AuthenticationService = {
      validateCredential: (credential: Credential): Promise<boolean> => {
        if (credential.credentialType !== 'basic') return Promise.resolve(false);
        try {
          decodeIdentityBinding(credential.identity);
          return Promise.resolve(true);
        } catch {
          return Promise.resolve(false);
        }
      }
    };
    this.clientConfig = { ...defaultClientConfig, authService };
  }

  private ciphersuiteImpl(): Promise<CiphersuiteImpl> {
    if (this.csPromise === undefined) {
      const suite: Ciphersuite = getCiphersuiteFromName(PINNED_CIPHERSUITE);
      this.csPromise = getCiphersuiteImpl(suite);
    }
    return this.csPromise;
  }

  /**
   * Serialize operations that share a lock key (a group, or a
   * consume-once KeyPackage claim). Stored chains never reject
   * (failures propagate to the caller, not to the queue), so a failed
   * operation cannot deadlock the key.
   */
  private withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const tail = this.locks.get(key) ?? Promise.resolve();
    const run = tail.then(operation);
    const settled = run.then(
      () => undefined,
      () => undefined
    );
    this.locks.set(key, settled);
    void settled.then(() => {
      if (this.locks.get(key) === settled) this.locks.delete(key);
    });
    return run;
  }

  private credential(): Credential {
    return { credentialType: 'basic', identity: encodeIdentityBinding(this.identity) };
  }

  private async loadState(key: string): Promise<ClientState> {
    const bytes = await this.store.loadGroupState(key);
    if (bytes === undefined) {
      throw mlsError('MLS_UNKNOWN_GROUP', 'no local state for the requested group');
    }
    const decoded = decodeGroupState(bytes, 0);
    if (decoded === undefined || decoded[1] !== bytes.byteLength) {
      throw mlsError('MLS_STATE_CODEC', 'stored group state failed to decode');
    }
    const groupState: GroupState = decoded[0];
    return { ...groupState, clientConfig: this.clientConfig };
  }

  private async saveState(key: string, state: ClientState): Promise<void> {
    await this.store.saveGroupState(key, encodeGroupState(state));
  }

  private async checkpointOf(state: ClientState): Promise<MlsEpochCheckpoint> {
    const epochBig = state.groupContext.epoch;
    if (epochBig < 0n || epochBig > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw mlsError('MLS_STATE_CODEC', 'epoch is outside the safe integer range');
    }
    const identities: string[] = [];
    for (const binding of this.membersOf(state)) {
      identities.push(groupKey(encodeIdentityBinding(binding)));
    }
    identities.sort();
    const membershipDigest = await createDigest(identities.join('\n'), 'sha-256');
    return Object.freeze({
      groupId: state.groupContext.groupId.slice(),
      epoch: Number(epochBig),
      memberCount: identities.length,
      membershipDigest,
      active: state.groupActiveState.kind
    });
  }

  /**
   * Iterate the group's occupied leaves, yielding each member's leaf
   * index and resolved identity binding. Single source of truth for
   * membership traversal (used by projection and removal), with
   * defensive guards so a malformed ratchet tree fails soft (skips the
   * leaf) rather than throwing a raw TypeError. Leaves live at even
   * node indices of the RFC 9420 array representation; blanks are
   * `undefined`.
   */
  private *resolvedLeaves(
    state: ClientState
  ): Generator<{ leafIndex: number; binding: MlsIdentityBinding }> {
    for (let nodeIndex = 0; nodeIndex < state.ratchetTree.length; nodeIndex += 2) {
      const node = state.ratchetTree[nodeIndex];
      if (node === undefined || node.nodeType !== 'leaf') continue;
      const credential = node.leaf?.credential;
      if (credential === undefined || credential.credentialType !== 'basic') continue;
      let binding: MlsIdentityBinding;
      try {
        binding = decodeIdentityBinding(credential.identity);
      } catch {
        // Unresolvable credentials are excluded; the authService
        // prevents such leaves from being added by us in the first place.
        continue;
      }
      yield { leafIndex: nodeIndex / 2, binding };
    }
  }

  private membersOf(state: ClientState): MlsIdentityBinding[] {
    const members: MlsIdentityBinding[] = [];
    for (const { binding } of this.resolvedLeaves(state)) members.push(binding);
    return members;
  }

  private decodeWire(wire: Uint8Array, label: string): MLSMessage {
    if (!(wire instanceof Uint8Array) || wire.byteLength === 0) {
      throw mlsError('MLS_INVALID_INPUT', `${label} must be non-empty bytes`);
    }
    if (wire.byteLength > MAX_WIRE_MESSAGE_BYTES) {
      throw mlsError('MLS_INVALID_INPUT', `${label} exceeds ${MAX_WIRE_MESSAGE_BYTES} bytes`);
    }
    const decoded = decodeMlsMessage(wire, 0);
    if (decoded === undefined) {
      throw mlsError('MLS_INVALID_INPUT', `${label} is not a valid MLS message`);
    }
    if (decoded[1] !== wire.byteLength) {
      throw mlsError('MLS_INVALID_INPUT', `${label} has trailing bytes`);
    }
    return decoded[0];
  }

  private decodeKeyPackageWire(wire: Uint8Array): KeyPackage {
    const message = this.decodeWire(wire, 'key package');
    if (message.wireformat !== 'mls_key_package') {
      throw mlsError('MLS_INVALID_INPUT', 'expected an MLS key package message');
    }
    const keyPackage = message.keyPackage;
    if (keyPackage.cipherSuite !== PINNED_CIPHERSUITE) {
      throw mlsError('MLS_UNSUPPORTED_CIPHERSUITE', 'key package uses an unsupported ciphersuite');
    }
    const credential = keyPackage.leafNode?.credential;
    if (credential === undefined || credential.credentialType !== 'basic') {
      throw mlsError('MLS_CREDENTIAL_INVALID', 'key package credential type is unsupported');
    }
    // Throws MLS_CREDENTIAL_INVALID when the binding is malformed.
    decodeIdentityBinding(credential.identity);
    return keyPackage;
  }

  /**
   * Generate a fresh consume-once KeyPackage. The public half is
   * returned as publishable wire bytes; the private half is persisted
   * under the wire digest and destroyed on join.
   */
  async generateKeyPackage(): Promise<GeneratedKeyPackage> {
    const cs = await this.ciphersuiteImpl();
    let privatePackage: PrivateKeyPackage | undefined;
    try {
      const generated = await generateKeyPackage(
        this.credential(),
        defaultCapabilities(),
        defaultLifetime,
        [],
        cs
      );
      privatePackage = generated.privatePackage;
      const keyPackageWire = encodeMlsMessage({
        version: 'mls10',
        wireformat: 'mls_key_package',
        keyPackage: generated.publicPackage
      });
      const keyPackageRef = await createDigest(keyPackageWire, 'sha-256');
      const encoded = encodePrivateKeyPackage(privatePackage);
      await this.store.savePrivateKeyPackage(keyPackageStoreKey(keyPackageRef), encoded);
      zeroOutUint8Array(encoded);
      return Object.freeze({ keyPackageWire, keyPackageRef });
    } catch (error) {
      if (error instanceof Error && error.name === 'MlsProviderError') throw error;
      // `return` (wrapLibraryError is `never`) so control-flow analysis
      // sees the catch always exits even with the finally present.
      return wrapLibraryError('generateKeyPackage', error);
    } finally {
      // The raw private keys were serialized to `encoded` (persisted
      // and zeroized) and are of no further use in this buffer; wipe
      // the library's copy so key material does not linger in memory.
      if (privatePackage !== undefined) zeroizePrivateKeyPackage(privatePackage);
    }
  }

  async createGroup(groupId: Uint8Array): Promise<MlsEpochCheckpoint> {
    const validated = validateGroupId(groupId);
    const key = groupKey(validated);
    return this.withLock(key, async () => {
      const existing = await this.store.loadGroupState(key);
      if (existing !== undefined) {
        throw mlsError('MLS_GROUP_EXISTS', 'local state already exists for this group');
      }
      const cs = await this.ciphersuiteImpl();
      let privatePackage: PrivateKeyPackage | undefined;
      try {
        // The creator's KeyPackage is generated inline and never
        // published — it exists only to seed the leaf.
        const generated = await generateKeyPackage(
          this.credential(),
          defaultCapabilities(),
          defaultLifetime,
          [],
          cs
        );
        privatePackage = generated.privatePackage;
        const state = await createGroup(
          validated,
          generated.publicPackage,
          privatePackage,
          [],
          cs,
          this.clientConfig
        );
        await this.saveState(key, state);
        return await this.checkpointOf(state);
      } catch (error) {
        if (error instanceof Error && error.name === 'MlsProviderError') throw error;
        wrapLibraryError('createGroup', error);
      } finally {
        // Group state has been serialized to storage; the seed private
        // package is redundant. Wipe it (the transient `state` object is
        // discarded, so wiping shared buffers post-save is harmless).
        if (privatePackage !== undefined) zeroizePrivateKeyPackage(privatePackage);
      }
    });
  }

  async hasGroup(groupId: Uint8Array): Promise<boolean> {
    const key = groupKey(validateGroupId(groupId));
    return (await this.store.loadGroupState(key)) !== undefined;
  }

  async addMembers(
    groupId: Uint8Array,
    keyPackageWires: ReadonlyArray<Uint8Array>
  ): Promise<MlsCommitResult> {
    const validated = validateGroupId(groupId);
    if (!Array.isArray(keyPackageWires) || keyPackageWires.length === 0) {
      throw mlsError('MLS_INVALID_INPUT', 'at least one key package is required');
    }
    if (keyPackageWires.length > MAX_ADDS_PER_COMMIT) {
      throw mlsError('MLS_INVALID_INPUT', `at most ${MAX_ADDS_PER_COMMIT} adds per commit`);
    }
    const proposals: Proposal[] = keyPackageWires.map((wire) => ({
      proposalType: 'add',
      add: { keyPackage: this.decodeKeyPackageWire(wire) }
    }));
    return this.commit(validated, proposals);
  }

  async removeMember(groupId: Uint8Array, member: unknown): Promise<MlsCommitResult> {
    const validated = validateGroupId(groupId);
    const target = validateIdentityBinding(member);
    if (identityBindingsEqual(target, this.identity)) {
      throw mlsError('MLS_INVALID_INPUT', 'cannot remove the local member with removeMember');
    }
    const key = groupKey(validated);
    return this.withLock(key, async () => {
      const state = await this.loadState(key);
      let leafIndex: number | undefined;
      for (const leaf of this.resolvedLeaves(state)) {
        if (identityBindingsEqual(leaf.binding, target)) {
          leafIndex = leaf.leafIndex;
          break;
        }
      }
      if (leafIndex === undefined) {
        throw mlsError('MLS_MEMBER_NOT_FOUND', 'no group member matches the given identity');
      }
      return this.commitLocked(key, state, [
        { proposalType: 'remove', remove: { removed: leafIndex } }
      ]);
    });
  }

  /**
   * Self-update commit: rotates the local leaf key material to regain
   * post-compromise security without membership changes.
   */
  async rotateOwnLeaf(groupId: Uint8Array): Promise<MlsCommitResult> {
    return this.commit(validateGroupId(groupId), []);
  }

  private commit(groupId: Uint8Array, proposals: Proposal[]): Promise<MlsCommitResult> {
    const key = groupKey(groupId);
    return this.withLock(key, async () => {
      const state = await this.loadState(key);
      return this.commitLocked(key, state, proposals);
    });
  }

  /** Must only be called while holding the group lock. */
  private async commitLocked(
    key: string,
    state: ClientState,
    proposals: Proposal[]
  ): Promise<MlsCommitResult> {
    this.assertActive(state);
    const cs = await this.ciphersuiteImpl();
    try {
      const result = await createCommit(
        { state, cipherSuite: cs },
        { extraProposals: proposals, ratchetTreeExtension: true }
      );
      await this.saveState(key, result.newState);
      zeroizeAll(result.consumed);
      const checkpoint = await this.checkpointOf(result.newState);
      const commitWire = encodeMlsMessage(result.commit);
      if (result.welcome !== undefined) {
        const welcomeWire = encodeMlsMessage({
          version: 'mls10',
          wireformat: 'mls_welcome',
          welcome: result.welcome
        });
        return Object.freeze({ commitWire, welcomeWire, checkpoint });
      }
      return Object.freeze({ commitWire, checkpoint });
    } catch (error) {
      if (error instanceof Error && error.name === 'MlsProviderError') throw error;
      wrapLibraryError('commit', error);
    }
  }

  /**
   * Join a group from a Welcome addressed to a KeyPackage this
   * provider generated. Consume-once: the stored private half is
   * deleted (and buffers zeroized) after a successful join.
   */
  async joinFromWelcome(
    welcomeWire: Uint8Array,
    keyPackageWire: Uint8Array
  ): Promise<MlsEpochCheckpoint> {
    const welcomeMessage = this.decodeWire(welcomeWire, 'welcome');
    if (welcomeMessage.wireformat !== 'mls_welcome') {
      throw mlsError('MLS_INVALID_INPUT', 'expected an MLS welcome message');
    }
    const keyPackage = this.decodeKeyPackageWire(keyPackageWire);
    const keyPackageRef = await createDigest(keyPackageWire, 'sha-256');
    const storeKey = keyPackageStoreKey(keyPackageRef);

    // Serialize the consume-once claim by KeyPackage: two concurrent
    // joins for a replayed Welcome must not both load the private half
    // before either deletes it. Under this lock the first join loads,
    // joins, and deletes; the second sees the deleted package and fails
    // MLS_UNKNOWN_KEY_PACKAGE. A group hash and a KeyPackage store key
    // never collide (distinct formats), but the `kp:` prefix keeps the
    // lock namespaces explicitly separate.
    return this.withLock(`kp:${storeKey}`, async () => {
      const privateBytes = await this.store.loadPrivateKeyPackage(storeKey);
      if (privateBytes === undefined) {
        throw mlsError(
          'MLS_UNKNOWN_KEY_PACKAGE',
          'no private key package for this welcome (already consumed, or foreign key package)'
        );
      }
      const privatePackage = decodePrivateKeyPackage(privateBytes);
      zeroOutUint8Array(privateBytes);
      const cs = await this.ciphersuiteImpl();
      try {
        const state = await joinGroup(
          welcomeMessage.welcome,
          keyPackage,
          privatePackage,
          emptyPskIndex,
          cs,
          undefined,
          undefined,
          this.clientConfig
        );
        const key = groupKey(state.groupContext.groupId);
        const existing = await this.store.loadGroupState(key);
        if (existing !== undefined) {
          throw mlsError('MLS_GROUP_EXISTS', 'local state already exists for the welcomed group');
        }
        await this.saveState(key, state);
        await this.store.deletePrivateKeyPackage(storeKey);
        return await this.checkpointOf(state);
      } catch (error) {
        if (error instanceof Error && error.name === 'MlsProviderError') throw error;
        wrapLibraryError('joinFromWelcome', error);
      } finally {
        zeroizePrivateKeyPackage(privatePackage);
      }
    });
  }

  /**
   * Process an incoming handshake or application message for a group.
   * Handshake messages advance local state (epoch, membership);
   * application messages decrypt and ratchet receiver keys forward.
   * Both persist the new state before anything is returned.
   */
  async processMessage(groupId: Uint8Array, messageWire: Uint8Array): Promise<MlsProcessResult> {
    const validated = validateGroupId(groupId);
    const key = groupKey(validated);
    const message = this.decodeWire(messageWire, 'message');
    if (
      message.wireformat !== 'mls_private_message' &&
      message.wireformat !== 'mls_public_message'
    ) {
      throw mlsError('MLS_INVALID_INPUT', 'expected an MLS private or public message');
    }
    // Guard defensively against structurally-incomplete decoded
    // messages: a missing groupId must fail closed, never throw a raw
    // TypeError out of groupKey().
    const wireGroupId =
      message.wireformat === 'mls_private_message'
        ? message.privateMessage?.groupId
        : message.publicMessage?.content?.groupId;
    if (wireGroupId === undefined || groupKey(wireGroupId) !== key) {
      throw mlsError('MLS_WRONG_GROUP', 'message is addressed to a different group');
    }
    return this.withLock(key, async () => {
      const state = await this.loadState(key);
      // Fail closed once removed: the removal commit itself is the last
      // message this device processes for the group (it is what puts us
      // in `removedFromGroup`). Any later ciphertext is refused so the
      // provider never decrypts for a group we no longer belong to,
      // regardless of what the raw key schedule could technically do.
      this.assertActive(state);
      const cs = await this.ciphersuiteImpl();
      try {
        const result = await processMessage(message, state, emptyPskIndex, acceptAll, cs);
        await this.saveState(key, result.newState);
        zeroizeAll(result.consumed);
        if (result.kind === 'applicationMessage') {
          const epoch = (await this.checkpointOf(result.newState)).epoch;
          return Object.freeze({
            kind: 'application' as const,
            plaintext: result.message,
            epoch
          });
        }
        return Object.freeze({
          kind: 'handshake' as const,
          checkpoint: await this.checkpointOf(result.newState)
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'MlsProviderError') throw error;
        wrapLibraryError('processMessage', error);
      }
    });
  }

  async encryptApplicationMessage(
    groupId: Uint8Array,
    plaintext: Uint8Array,
    authenticatedData?: Uint8Array
  ): Promise<Readonly<{ messageWire: Uint8Array; epoch: number }>> {
    const validated = validateGroupId(groupId);
    if (!(plaintext instanceof Uint8Array) || plaintext.byteLength === 0) {
      throw mlsError('MLS_INVALID_INPUT', 'plaintext must be non-empty bytes');
    }
    if (plaintext.byteLength > MAX_APPLICATION_PLAINTEXT_BYTES) {
      throw mlsError(
        'MLS_INVALID_INPUT',
        `plaintext exceeds ${MAX_APPLICATION_PLAINTEXT_BYTES} bytes; use content-addressed blocks for large payloads`
      );
    }
    const key = groupKey(validated);
    return this.withLock(key, async () => {
      const state = await this.loadState(key);
      this.assertActive(state);
      const cs = await this.ciphersuiteImpl();
      try {
        const result = await createApplicationMessage(state, plaintext, cs, authenticatedData);
        await this.saveState(key, result.newState);
        zeroizeAll(result.consumed);
        const epoch = (await this.checkpointOf(result.newState)).epoch;
        const messageWire = encodeMlsMessage({
          version: 'mls10',
          wireformat: 'mls_private_message',
          privateMessage: result.privateMessage
        });
        return Object.freeze({ messageWire, epoch });
      } catch (error) {
        if (error instanceof Error && error.name === 'MlsProviderError') throw error;
        wrapLibraryError('encryptApplicationMessage', error);
      }
    });
  }

  async exportCheckpoint(groupId: Uint8Array): Promise<MlsEpochCheckpoint> {
    const key = groupKey(validateGroupId(groupId));
    return this.withLock(key, async () => this.checkpointOf(await this.loadState(key)));
  }

  async listMembers(groupId: Uint8Array): Promise<ReadonlyArray<MlsIdentityBinding>> {
    const key = groupKey(validateGroupId(groupId));
    return this.withLock(key, async () => Object.freeze(this.membersOf(await this.loadState(key))));
  }

  /** Remove all local state for a group (e.g. after leaving). */
  async deleteGroup(groupId: Uint8Array): Promise<boolean> {
    const key = groupKey(validateGroupId(groupId));
    return this.withLock(key, () => this.store.deleteGroupState(key));
  }

  private assertActive(state: ClientState): void {
    if (state.groupActiveState.kind === 'removedFromGroup') {
      throw mlsError('MLS_REMOVED_FROM_GROUP', 'the local device was removed from this group');
    }
  }
}
