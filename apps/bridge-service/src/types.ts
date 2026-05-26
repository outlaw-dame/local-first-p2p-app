import { type PrivacyScope, type SignedEventEnvelope } from '@lfp2p/protocol';

export type BridgeServiceRole = 'stateful-edge-actor' | 'persistent-availability-peer';
export type BridgeDeliveryStatus = 'confirmed' | 'conflicted' | 'rejected';
export type BridgeStoreKind = 'memory' | 'json-file' | 'pglite';

export type BridgeHttpAuthConfig = Readonly<{
  scheme: 'bearer';
  token: string;
}>;

export type BridgeHttpHandlerOptions = Readonly<{
  auth?: BridgeHttpAuthConfig;
}>;

export type BridgeDeliveryRequest = Readonly<{
  idempotencyKey: string;
  target: string;
  event: SignedEventEnvelope;
}>;

export type BridgeDeliveryResponse =
  | Readonly<{
      status: 'confirmed';
      eventId: string;
      idempotencyKey: string;
      sequence: number;
      acceptedAt: string;
      duplicate: boolean;
    }>
  | Readonly<{
      status: 'conflicted';
      idempotencyKey: string;
      reason: string;
      existingEventId?: string;
    }>
  | Readonly<{
      status: 'rejected';
      idempotencyKey: string;
      reason: string;
    }>;

export type BridgeInboundReadRequest = Readonly<{
  sourceId: string;
  streamId: string;
  scope: string;
  cursor?: string;
  limit?: number;
}>;

export type BridgeInboundReadRecord = Readonly<{
  cursor: string;
  sequence: number;
  event: SignedEventEnvelope;
  receivedAt: string;
}>;

export type BridgeInboundReadResponse = Readonly<{
  records: readonly BridgeInboundReadRecord[];
}>;

export type BridgeRecord = Readonly<{
  idempotencyKey: string;
  target: string;
  eventId: string;
  author: string;
  privacy: PrivacyScope;
  sequence: number;
  acceptedAt: string;
}>;

export type BridgeRecordDraft = Omit<BridgeRecord, 'sequence'>;
export type StoredBridgeRecord = BridgeRecord & Readonly<{ expiresAt: string; event?: SignedEventEnvelope }>;
export type StoredBridgeRecordDraft = BridgeRecordDraft & Readonly<{ expiresAt: string; event: SignedEventEnvelope }>;

export type BridgeStoreListInput = Readonly<{
  target: string;
  afterSequence: number;
  limit: number;
}>;

export type BridgeStoreSnapshot = Readonly<{
  storeKind: BridgeStoreKind;
  acceptedCount: number;
  maxRecords: number;
  ttlMs: number;
  latestSequence: number;
}>;

export type BridgeServiceSnapshot = BridgeStoreSnapshot &
  Readonly<{
    role: BridgeServiceRole;
    authoritativeForPrivateState: false;
  }>;

export type BridgeStorePutResult =
  | Readonly<{ status: 'inserted'; record: StoredBridgeRecord }>
  | Readonly<{ status: 'existing'; record: StoredBridgeRecord }>;

export type BridgeStore = Readonly<{
  readonly kind: BridgeStoreKind;
  readonly maxRecords: number;
  readonly ttlMs: number;
  get(idempotencyKey: string, nowMs: number): Promise<StoredBridgeRecord | undefined>;
  putIfAbsent(record: StoredBridgeRecordDraft, nowMs: number): Promise<BridgeStorePutResult>;
  listAfter(input: BridgeStoreListInput, nowMs: number): Promise<readonly StoredBridgeRecord[]>;
  pruneExpired(nowMs: number): Promise<void>;
  snapshot(nowMs: number): Promise<BridgeStoreSnapshot>;
}>;

export type BridgeServiceOptions = Readonly<{
  role?: BridgeServiceRole;
  store: BridgeStore;
}>;

export type InMemoryBridgeStoreOptions = Readonly<{
  maxRecords?: number;
  ttlMs?: number;
  initialSequence?: number;
}>;

export type InMemoryBridgeServiceOptions = InMemoryBridgeStoreOptions &
  Readonly<{
    role?: BridgeServiceRole;
  }>;

export type JsonFileBridgeStoreOptions = Readonly<{
  filePath: string;
  maxRecords?: number;
  ttlMs?: number;
  initialSequence?: number;
  tempFileSuffix?: string;
}>;

export type PgliteBridgeStoreOptions = Readonly<{
  dataDir?: string;
  maxRecords?: number;
  ttlMs?: number;
  initialSequence?: number;
}>;

export type JsonBridgeStoreState = Readonly<{
  recordType: 'lfp2p.bridge.store.v1';
  latestSequence: number;
  records: StoredBridgeRecord[];
}>;

export type MutableJsonBridgeStoreState = {
  recordType: 'lfp2p.bridge.store.v1';
  latestSequence: number;
  records: StoredBridgeRecord[];
};