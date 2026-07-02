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
const MAX_AGGREGATOR_SOURCES = 256;

/**
 * Self-declared labeler kind. The kind is advisory metadata — local
 * trust policy decides how to weight different kinds. The protocol
 * does not infer authority from the kind; that belongs to the
 * trust-policy engine (ADR-006).
 *
 * Kinds (chosen to emulate ATProto-style composable moderation while
 * preserving our protocol's stronger privacy and trust controls):
 *
 *  - `human-curated`: individual or small team manually applying labels.
 *  - `automated-classifier`: ML or heuristic, high-volume, low-latency.
 *  - `hybrid`: automated triage with human review.
 *  - `attestation`: cryptographic attestations (domain verification,
 *    badge issuers, court orders, identity verification services).
 *  - `community-aggregator`: re-publishes labels from other labelers'
 *    streams with its own signature; carries `aggregatorOf` listing
 *    the source labelerIds.
 *  - `media-scanner`: specifically for media safety (CSAM/NSFW/etc.).
 *  - `unknown`: default when the field is not provided on older
 *    `lfp2p.safety-labeler-profile.v1` events.
 */
export const LABELER_KINDS = [
  'human-curated',
  'automated-classifier',
  'hybrid',
  'attestation',
  'community-aggregator',
  'media-scanner',
  // Phase 1.8.4 — labelers that publish `reputation.aggregator.published`
  // events. Slots into the Phase 1.66 labeler stack; the user-side
  // computer (the local-personalized EigenTrust output) is ALWAYS
  // labeler-priority #0 and external aggregators stack below per
  // the user's chosen priority. See
  // `docs/protocol/reputation-graph-doctrine.md` and the
  // `reputation-graph/aggregator-runtime.ts` module.
  'reputation-aggregator',
  'unknown'
] as const;
export type LabelerKind = (typeof LABELER_KINDS)[number];

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
  /**
   * Self-declared labeler kind. Advisory only. When absent on a v1
   * profile event, the runtime treats the kind as `unknown` rather
   * than rejecting the event — preserving backward compatibility
   * with profiles emitted before this field existed.
   */
  kind?: LabelerKind;
  /**
   * For `community-aggregator` kind, the set of source labelerIds
   * whose streams this labeler re-publishes. Subscribing to an
   * aggregator transitively trusts the aggregator's curation of
   * which sources to include — NOT the source labelers themselves
   * for purposes of their other (non-aggregated) work.
   *
   * Required when `kind === 'community-aggregator'`; rejected when
   * `kind` is anything else.
   */
  aggregatorOf?: ReadonlyArray<string>;
  /**
   * Self-declared capabilities — *what the labeler does*, in
   * machine-readable form. Distinct from `kind` (which describes
   * *how* the labeler operates).
   *
   * A capability declares a functional purpose (`detect.twitter-screenshot`,
   * `classify.spam`, `attest.domain-ownership`, etc.) and the label
   * keys it produces in service of that purpose. UIs can compare two
   * labelers' `capabilities` to spot redundant subscriptions; trust
   * policy can refuse to surface labels whose producing capability
   * is unknown.
   *
   * Optional and additive on `lfp2p.safety-labeler-profile.v1`.
   * When absent, downstream consumers treat the labeler as having
   * no declared capabilities (subscription overlap detection falls
   * back to `supportedLabels` overlap).
   */
  capabilities?: ReadonlyArray<LabelerCapability>;
}>;

/**
 * A single declared capability on a `SafetyLabelerProfile`.
 *
 *  - `capabilityId`: a structured token from the standard registry
 *    (`detect.*`, `classify.*`, `scan.*`, `attest.*`, `aggregate.*`)
 *    or a community-defined `x.*` token.
 *  - `description`: a short human-readable description.
 *  - `producesLabels`: the `labelKey` values this capability emits.
 *    Must be a subset of the profile's `supportedLabels` — declaring
 *    a capability whose output labels are not in the profile's
 *    supported list is rejected.
 *  - `mediaTypes`: optional restriction. When present, the capability
 *    only operates on content with these media types (e.g., a screenshot
 *    detector that only consumes `image/png`).
 */
export type LabelerCapability = Readonly<{
  capabilityId: string;
  description: string;
  producesLabels: ReadonlyArray<string>;
  mediaTypes?: ReadonlyArray<string>;
}>;

/**
 * Standard capability namespaces. The registry is curated; communities
 * may extend it with `x.<namespace>.<name>` tokens for experimental
 * capabilities (which downstream consumers may treat with reduced
 * trust by default).
 *
 * Initial standard entries:
 *
 *   detect.*    — functional detection (typically high-volume, automated)
 *     detect.twitter-screenshot   — screenshot of an X/Twitter post
 *     detect.bluesky-screenshot   — screenshot of a Bluesky post
 *     detect.crossplatform-screenshot — any non-local social screenshot
 *     detect.profanity-en         — English profanity
 *     detect.profanity-multilang  — multi-language profanity
 *     detect.malicious-link       — phishing / malware link
 *     detect.machine-generated    — AI-generated content detection
 *     detect.duplicate            — near-duplicate of prior content
 *
 *   classify.*  — broader classifiers, often with severity / confidence
 *     classify.spam               — spam likelihood classifier
 *     classify.toxicity           — toxicity scoring
 *     classify.topic              — topic / category labeling
 *     classify.sentiment          — sentiment scoring
 *     classify.adult-content      — adult content classifier (umbrella)
 *
 *   scan.*      — media safety scanners
 *     scan.media-csam             — CSAM scanner (hard-safety)
 *     scan.media-violence         — graphic violence scanner
 *     scan.media-nudity           — nudity scanner
 *
 *   attest.*    — attestation issuers (claims about identity / property)
 *     attest.domain-ownership     — domain verification
 *     attest.organization-affiliation — org affiliation
 *     attest.account-age          — account-age attestation
 *
 *   aggregate.* — re-publishing / synthesis
 *     aggregate.community-list    — re-publishes community list curation
 *     aggregate.multi-labeler     — synthesizes from multiple sources
 *
 * Custom capabilities are valid if they match `x.<namespace>.<name>`.
 */
export const STANDARD_LABELER_CAPABILITIES: ReadonlyArray<string> = Object.freeze([
  // detect.*
  'detect.twitter-screenshot',
  'detect.bluesky-screenshot',
  'detect.crossplatform-screenshot',
  'detect.profanity-en',
  'detect.profanity-multilang',
  'detect.malicious-link',
  'detect.machine-generated',
  'detect.duplicate',
  // classify.*
  'classify.spam',
  'classify.toxicity',
  'classify.topic',
  'classify.sentiment',
  'classify.adult-content',
  // scan.*
  'scan.media-csam',
  'scan.media-violence',
  'scan.media-nudity',
  // attest.*
  'attest.domain-ownership',
  'attest.organization-affiliation',
  'attest.account-age',
  // aggregate.*
  'aggregate.community-list',
  'aggregate.multi-labeler',
  // Phase 1.8.4 — reputation-scoring capability. A labeler that
  // declares this capability publishes `reputation.aggregator.published`
  // events whose subjects + scores feed the Phase 1.66 labeler
  // stack alongside the local-personalized EigenTrust output.
  // OpenRank-derived adapters declare this capability under their
  // own labeler profile.
  'aggregate.reputation-scoring'
]);

const CAPABILITY_ID_PATTERN =
  /^(detect|classify|scan|attest|aggregate|x)\.[a-z0-9][a-z0-9-]{0,63}(?:\.[a-z0-9][a-z0-9-]{0,63})*$/;

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
      throw tsError('TS_PRIVATE_LEAK', `${label}.serviceEndpoint must not embed userinfo`);
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

  // --- Phase 1.66 additive fields (still lfp2p.safety-labeler-profile.v1) ---
  let kind: LabelerKind | undefined;
  if (record.kind !== undefined) {
    kind = assertOneOf(record.kind, LABELER_KINDS, `${label}.kind`);
    out.kind = kind;
  }

  if (record.aggregatorOf !== undefined) {
    const sources = assertReadonlyArray(
      record.aggregatorOf,
      `${label}.aggregatorOf`,
      MAX_AGGREGATOR_SOURCES,
      (item, i) => assertId(item, `${label}.aggregatorOf[${i}]`)
    );
    // Cross-check: aggregatorOf is only valid when kind === 'community-aggregator'.
    if (kind !== 'community-aggregator') {
      throw tsError(
        'TS_INVALID_LABELER',
        `${label}.aggregatorOf may only be present when kind === "community-aggregator" (got kind="${String(kind)}")`
      );
    }
    if (sources.length === 0) {
      throw tsError(
        'TS_INVALID_LABELER',
        `${label}.aggregatorOf must contain at least one source labelerId`
      );
    }
    // An aggregator cannot list itself as a source — that would be a
    // trust loop.
    for (const src of sources) {
      if (src === labelerId) {
        throw tsError(
          'TS_INVALID_LABELER',
          `${label}.aggregatorOf must not include the labeler's own id (would create a trust loop)`
        );
      }
    }
    out.aggregatorOf = sources;
  } else if (kind === 'community-aggregator') {
    // Symmetric guard: a community-aggregator profile MUST declare its sources.
    throw tsError(
      'TS_INVALID_LABELER',
      `${label}: kind="community-aggregator" requires aggregatorOf to list at least one source labelerId`
    );
  }

  if (record.capabilities !== undefined) {
    const supportedLabelSet = new Set(supportedLabels);
    const capabilities = assertReadonlyArray(
      record.capabilities,
      `${label}.capabilities`,
      256,
      (item, i) => validateLabelerCapability(item, `${label}.capabilities[${i}]`, supportedLabelSet)
    );
    if (capabilities.length === 0) {
      throw tsError(
        'TS_INVALID_LABELER',
        `${label}.capabilities, when present, must contain at least one entry`
      );
    }
    out.capabilities = capabilities;
  }

  return Object.freeze(out);
}

const MAX_CAPABILITY_DESCRIPTION_LENGTH = 1024;
const MAX_CAPABILITY_PRODUCES_LABELS = 1024;
const MAX_CAPABILITY_MEDIA_TYPES = 64;
const MEDIA_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

function validateLabelerCapability(
  value: unknown,
  label: string,
  supportedLabels: ReadonlySet<string>
): LabelerCapability {
  const record = assertPlainObject(value, label);
  const capabilityId = assertId(record.capabilityId, `${label}.capabilityId`);
  if (!CAPABILITY_ID_PATTERN.test(capabilityId)) {
    throw tsError(
      'TS_INVALID_LABELER',
      `${label}.capabilityId "${capabilityId}" must match (detect|classify|scan|attest|aggregate|x).<segment>(.<segment>)*`
    );
  }
  const description = assertText(
    record.description,
    `${label}.description`,
    MAX_CAPABILITY_DESCRIPTION_LENGTH
  );
  const producesLabels = assertReadonlyArray(
    record.producesLabels,
    `${label}.producesLabels`,
    MAX_CAPABILITY_PRODUCES_LABELS,
    (item, i) => assertId(item, `${label}.producesLabels[${i}]`)
  );
  if (producesLabels.length === 0) {
    throw tsError(
      'TS_INVALID_LABELER',
      `${label}.producesLabels must contain at least one labelKey`
    );
  }
  for (const lk of producesLabels) {
    if (!supportedLabels.has(lk)) {
      throw tsError(
        'TS_INVALID_LABELER',
        `${label}.producesLabels: "${lk}" is not in the profile's supportedLabels`
      );
    }
  }
  const out: { -readonly [K in keyof LabelerCapability]: LabelerCapability[K] } = {
    capabilityId,
    description,
    producesLabels
  };
  if (record.mediaTypes !== undefined) {
    const mediaTypes = assertReadonlyArray(
      record.mediaTypes,
      `${label}.mediaTypes`,
      MAX_CAPABILITY_MEDIA_TYPES,
      (item, i) => {
        const mt = assertId(item, `${label}.mediaTypes[${i}]`, 255);
        if (!MEDIA_TYPE_PATTERN.test(mt)) {
          throw tsError(
            'TS_INVALID_LABELER',
            `${label}.mediaTypes[${i}] "${mt}" is not a valid RFC 6838 media type`
          );
        }
        return mt;
      }
    );
    if (mediaTypes.length === 0) {
      throw tsError(
        'TS_INVALID_LABELER',
        `${label}.mediaTypes, when present, must contain at least one type`
      );
    }
    out.mediaTypes = mediaTypes;
  }
  return Object.freeze(out);
}

/** Returns true when `capabilityId` is in the standard registry. */
export function isStandardCapability(capabilityId: string): boolean {
  return STANDARD_LABELER_CAPABILITIES.includes(capabilityId);
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
