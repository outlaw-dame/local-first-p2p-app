import type { CredentialRef } from './refs.js';
import { validateCredentialRef } from './refs.js';
import { tsError } from './errors.js';
import {
  assertExactVersion,
  assertId,
  assertIso8601,
  assertNotBefore,
  assertOneOf,
  assertPlainObject,
  assertReadonlyArray,
  assertText
} from './validation.js';

export const SAFETY_LABELER_PROFILE_VERSION = 'lfp2p.safety-labeler-profile.v1' as const;
export const SAFETY_LABELER_SUBSCRIPTION_VERSION = 'lfp2p.safety-labeler-subscription.v1' as const;

/** Subscription scopes are strictly local (not `network-advisory`). */
export const LABELER_SUBSCRIPTION_SCOPES = [
  'device-local',
  'account-local',
  'community-local',
  'bridge-local',
  'relay-local',
  'super-peer-local',
  'index-local'
] as const;
export type LabelerSubscriptionScope = (typeof LABELER_SUBSCRIPTION_SCOPES)[number];

const MAX_NAMESPACES = 256;
const MAX_LABELS = 1024;
const MAX_OVERRIDES = 1024;
const MAX_SERVICE_ENDPOINT_LENGTH = 2048;

export type SafetyLabelerProfile = Readonly<{
  version: typeof SAFETY_LABELER_PROFILE_VERSION;
  labelerId: string;
  actorId: string;
  displayName: string;
  description?: string;
  supportedNamespaces: ReadonlyArray<string>;
  supportedLabels: ReadonlyArray<string>;
  serviceEndpoint?: string;
  policyRef?: string;
  credentialRefs?: ReadonlyArray<CredentialRef>;
  createdAt: string;
  updatedAt: string;
}>;

export function validateSafetyLabelerProfile(
  value: unknown,
  label = 'SafetyLabelerProfile'
): SafetyLabelerProfile {
  const record = assertPlainObject(value, label);
  assertExactVersion(record.version, SAFETY_LABELER_PROFILE_VERSION, `${label}.version`);
  const labelerId = assertId(record.labelerId, `${label}.labelerId`);
  const actorId = assertId(record.actorId, `${label}.actorId`);
  const displayName = assertText(record.displayName, `${label}.displayName`);
  const supportedNamespaces = assertReadonlyArray(
    record.supportedNamespaces,
    `${label}.supportedNamespaces`,
    MAX_NAMESPACES,
    (item, i) => assertId(item, `${label}.supportedNamespaces[${i}]`)
  );
  const supportedLabels = assertReadonlyArray(
    record.supportedLabels,
    `${label}.supportedLabels`,
    MAX_LABELS,
    (item, i) => assertId(item, `${label}.supportedLabels[${i}]`)
  );
  const createdAt = assertIso8601(record.createdAt, `${label}.createdAt`);
  const updatedAt = assertIso8601(record.updatedAt, `${label}.updatedAt`);
  assertNotBefore(createdAt, updatedAt, `${label}.createdAt`, `${label}.updatedAt`);

  const out: { -readonly [K in keyof SafetyLabelerProfile]: SafetyLabelerProfile[K] } = {
    version: SAFETY_LABELER_PROFILE_VERSION,
    labelerId,
    actorId,
    displayName,
    supportedNamespaces,
    supportedLabels,
    createdAt,
    updatedAt
  };
  if (record.description !== undefined) {
    out.description = assertText(record.description, `${label}.description`);
  }
  if (record.serviceEndpoint !== undefined) {
    const ep = assertId(
      record.serviceEndpoint,
      `${label}.serviceEndpoint`,
      MAX_SERVICE_ENDPOINT_LENGTH
    );
    // Service endpoint, when present, must be a parseable https URL with no userinfo.
    let url: URL;
    try {
      url = new URL(ep);
    } catch {
      throw tsError('TS_INVALID_LABELER', `${label}.serviceEndpoint must be a valid URL`);
    }
    if (url.protocol !== 'https:') {
      throw tsError('TS_INVALID_LABELER', `${label}.serviceEndpoint must use https:`);
    }
    if (url.username !== '' || url.password !== '') {
      throw tsError(
        'TS_PRIVATE_LEAK',
        `${label}.serviceEndpoint must not embed userinfo`
      );
    }
    out.serviceEndpoint = ep;
  }
  if (record.policyRef !== undefined) {
    out.policyRef = assertId(record.policyRef, `${label}.policyRef`);
  }
  if (record.credentialRefs !== undefined) {
    out.credentialRefs = assertReadonlyArray(
      record.credentialRefs,
      `${label}.credentialRefs`,
      256,
      (item, i) => validateCredentialRef(item, `${label}.credentialRefs[${i}]`)
    );
  }
  return Object.freeze(out);
}

export type SafetyLabelActionOverride = Readonly<{
  labelKey: string;
  namespace: string;
  action:
    | 'allow'
    | 'warn'
    | 'blur-media'
    | 'collapse'
    | 'hide'
    | 'quarantine'
    | 'downrank'
    | 'exclude-from-feed'
    | 'exclude-from-search'
    | 'exclude-from-recommendations';
}>;

const OVERRIDE_ACTIONS = [
  'allow',
  'warn',
  'blur-media',
  'collapse',
  'hide',
  'quarantine',
  'downrank',
  'exclude-from-feed',
  'exclude-from-search',
  'exclude-from-recommendations'
] as const;

function validateOverride(value: unknown, label: string): SafetyLabelActionOverride {
  const record = assertPlainObject(value, label);
  return Object.freeze({
    labelKey: assertId(record.labelKey, `${label}.labelKey`),
    namespace: assertId(record.namespace, `${label}.namespace`),
    action: assertOneOf(record.action, OVERRIDE_ACTIONS, `${label}.action`)
  });
}

export type SafetyLabelerSubscription = Readonly<{
  version: typeof SAFETY_LABELER_SUBSCRIPTION_VERSION;
  subscriptionId: string;
  subscriberActorId: string;
  labelerId: string;
  trustedNamespaces: ReadonlyArray<string>;
  trustedLabels?: ReadonlyArray<string>;
  scope: LabelerSubscriptionScope;
  actionOverrides?: ReadonlyArray<SafetyLabelActionOverride>;
  createdAt: string;
  disabledAt?: string;
}>;

export function validateSafetyLabelerSubscription(
  value: unknown,
  label = 'SafetyLabelerSubscription'
): SafetyLabelerSubscription {
  const record = assertPlainObject(value, label);
  assertExactVersion(record.version, SAFETY_LABELER_SUBSCRIPTION_VERSION, `${label}.version`);
  const subscriptionId = assertId(record.subscriptionId, `${label}.subscriptionId`);
  const subscriberActorId = assertId(record.subscriberActorId, `${label}.subscriberActorId`);
  const labelerId = assertId(record.labelerId, `${label}.labelerId`);
  const scope = assertOneOf(record.scope, LABELER_SUBSCRIPTION_SCOPES, `${label}.scope`);
  const trustedNamespaces = assertReadonlyArray(
    record.trustedNamespaces,
    `${label}.trustedNamespaces`,
    MAX_NAMESPACES,
    (item, i) => assertId(item, `${label}.trustedNamespaces[${i}]`)
  );
  const createdAt = assertIso8601(record.createdAt, `${label}.createdAt`);

  const out: {
    -readonly [K in keyof SafetyLabelerSubscription]: SafetyLabelerSubscription[K];
  } = {
    version: SAFETY_LABELER_SUBSCRIPTION_VERSION,
    subscriptionId,
    subscriberActorId,
    labelerId,
    trustedNamespaces,
    scope,
    createdAt
  };
  if (record.trustedLabels !== undefined) {
    out.trustedLabels = assertReadonlyArray(
      record.trustedLabels,
      `${label}.trustedLabels`,
      MAX_LABELS,
      (item, i) => assertId(item, `${label}.trustedLabels[${i}]`)
    );
  }
  if (record.actionOverrides !== undefined) {
    out.actionOverrides = assertReadonlyArray(
      record.actionOverrides,
      `${label}.actionOverrides`,
      MAX_OVERRIDES,
      (item, i) => validateOverride(item, `${label}.actionOverrides[${i}]`)
    );
  }
  if (record.disabledAt !== undefined) {
    out.disabledAt = assertIso8601(record.disabledAt, `${label}.disabledAt`);
    assertNotBefore(createdAt, out.disabledAt, `${label}.createdAt`, `${label}.disabledAt`);
  }
  return Object.freeze(out);
}
