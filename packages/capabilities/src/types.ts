export const CAPABILITY_GRANT_VERSION = 'lfp2p.capability.grant.v1' as const;
export const CAPABILITY_INVOCATION_VERSION = 'lfp2p.capability.invocation.v1' as const;
export const CAPABILITY_REVOCATION_VERSION = 'lfp2p.capability.revocation.v1' as const;

export const CAPABILITY_PARTY_KINDS = [
  'actor',
  'device',
  'controller',
  'service',
  'bridge',
  'relay',
  'super-peer',
  'labeler',
  'bot',
  'pseudonym'
] as const;

export type CapabilityPartyKind = (typeof CAPABILITY_PARTY_KINDS)[number];

export const CAPABILITY_RESOURCE_KINDS = [
  'identity',
  'device',
  'community',
  'group',
  'room',
  'object',
  'bundle',
  'bridge',
  'relay',
  'super-peer',
  'label-namespace',
  'report-queue',
  'appeal-queue',
  'search-surface',
  'media-pipeline',
  'sync-stream'
] as const;

export type CapabilityResourceKind = (typeof CAPABILITY_RESOURCE_KINDS)[number];

export const CAPABILITY_SCOPE_KINDS = [
  'self',
  'local-device',
  'identity',
  'community',
  'group',
  'room',
  'bridge',
  'relay',
  'super-peer',
  'public-index',
  'private-envelope'
] as const;

export type CapabilityScopeKind = (typeof CAPABILITY_SCOPE_KINDS)[number];

export const CAPABILITY_ACTIONS = [
  'identity.device.authorize',
  'identity.device.revoke',
  'identity.capability.grant',
  'identity.capability.revoke',
  'community.member.invite',
  'community.member.approve',
  'community.member.remove',
  'community.role.assign',
  'community.role.revoke',
  'room.create',
  'room.moderate',
  'label.issue',
  'label.revoke',
  'report.read-encrypted',
  'report.resolve',
  'appeal.resolve',
  'bridge.store-bundle',
  'bridge.forward-envelope',
  'bridge.publish-admission-decision',
  'relay.forward-envelope',
  'relay.cache-object',
  'super-peer.store-bundle',
  'search.index-public-object',
  'media.quarantine',
  'media.release',
  'sync.pull',
  'sync.push',
  'identity.contact-card.publish'
] as const;

export type CapabilityAction = (typeof CAPABILITY_ACTIONS)[number];

export const CAPABILITY_CAVEAT_KINDS = [
  'expires-before',
  'not-before',
  'audience-is',
  'device-is',
  'resource-is',
  'action-is',
  'scope-is',
  'issuer-is',
  'requires-freshness-check',
  'requires-human-review',
  'requires-private-envelope',
  'requires-encrypted-evidence',
  'max-uses',
  'max-delegation-depth',
  'network-surface-is',
  'bridge-is',
  'label-namespace-is'
] as const;

export type CapabilityCaveatKind = (typeof CAPABILITY_CAVEAT_KINDS)[number];

export const CAPABILITY_PROOF_SCHEMES = [
  'native-signed-event',
  'identity-control-log',
  'ucan',
  'zcap-ld',
  'vc',
  'bearcap',
  'manual-local-policy'
] as const;

export type CapabilityProofScheme = (typeof CAPABILITY_PROOF_SCHEMES)[number];

export const CAPABILITY_REVOCATION_REASONS = [
  'superseded',
  'compromised',
  'expired-early',
  'policy-change',
  'user-request',
  'operator-action',
  'abuse-prevention',
  'unknown'
] as const;

export type CapabilityRevocationReason = (typeof CAPABILITY_REVOCATION_REASONS)[number];

export const CAPABILITY_DECISION_STATUSES = [
  'allow',
  'warn',
  'require-confirmation',
  'quarantine',
  'deny'
] as const;

export type CapabilityDecisionStatus = (typeof CAPABILITY_DECISION_STATUSES)[number];

export const CAPABILITY_REASON_CODES = [
  'capability.valid',
  'capability.malformed',
  'capability.unsupported-version',
  'capability.expired',
  'capability.not-yet-valid',
  'capability.revoked',
  'capability.wrong-audience',
  'capability.wrong-device',
  'capability.wrong-resource',
  'capability.wrong-action',
  'capability.wrong-scope',
  'capability.unknown-caveat',
  'capability.unsatisfied-caveat',
  'capability.replayed-invocation',
  'capability.stale-revocation-state',
  'capability.untrusted-issuer',
  'capability.unverified-proof',
  'capability.vc-only-authority-denied',
  'capability.bearcap-forbidden-for-action',
  'capability.private-data-leak-risk'
] as const;

export type CapabilityReasonCode = (typeof CAPABILITY_REASON_CODES)[number];

export type CapabilityJsonScalar = string | number | boolean | null;
export type CapabilityJsonValue = CapabilityJsonScalar | readonly CapabilityJsonValue[] | { readonly [key: string]: CapabilityJsonValue };

export type CapabilityPartyRef = Readonly<{
  kind: CapabilityPartyKind;
  id: string;
  digest?: string;
  publicKeyRef?: string;
}>;

export type CapabilityResourceRef = Readonly<{
  kind: CapabilityResourceKind;
  id: string;
  digest?: string;
  scopeHint?: string;
}>;

export type CapabilityScopeRef = Readonly<{
  kind: CapabilityScopeKind;
  id: string;
}>;

export type CapabilityCaveat = Readonly<{
  kind: CapabilityCaveatKind;
  value: CapabilityJsonValue;
}>;

export type CapabilityProofRef = Readonly<{
  proofId: string;
  scheme: CapabilityProofScheme;
}>;

export type CapabilityRevocationRef = Readonly<{
  revocationId: string;
  capabilityId: string;
}>;

export type CapabilityGrantV1 = Readonly<{
  version: typeof CAPABILITY_GRANT_VERSION;
  capabilityId: string;
  issuer: CapabilityPartyRef;
  audience: CapabilityPartyRef;
  resource: CapabilityResourceRef;
  actions: readonly CapabilityAction[];
  scope: CapabilityScopeRef;
  caveats: readonly CapabilityCaveat[];
  notBefore?: string;
  expiresAt: string;
  delegationDepth: number;
  revocationRef?: CapabilityRevocationRef;
  nonce: string;
  proofRefs: readonly CapabilityProofRef[];
  createdAt: string;
}>;

export type CapabilityInvocationV1 = Readonly<{
  version: typeof CAPABILITY_INVOCATION_VERSION;
  invocationId: string;
  capabilityId: string;
  invoker: CapabilityPartyRef;
  device?: CapabilityPartyRef;
  resource: CapabilityResourceRef;
  action: CapabilityAction;
  scope: CapabilityScopeRef;
  argumentsDigest?: string;
  nonce: string;
  createdAt: string;
  expiresAt?: string;
  proofRefs: readonly CapabilityProofRef[];
}>;

export type CapabilityRevocationV1 = Readonly<{
  version: typeof CAPABILITY_REVOCATION_VERSION;
  revocationId: string;
  capabilityId: string;
  issuer: CapabilityPartyRef;
  audience?: CapabilityPartyRef;
  reasonCode: CapabilityRevocationReason;
  createdAt: string;
  proofRefs: readonly CapabilityProofRef[];
}>;

export type CapabilityDecision = Readonly<{
  status: CapabilityDecisionStatus;
  reasonCodes: readonly CapabilityReasonCode[];
  capabilityId: string;
  invocationId?: string;
  createdAt: string;
  expiresAt?: string;
}>;
