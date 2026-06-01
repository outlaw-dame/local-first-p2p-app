import type { DigestRef } from '@lfp2p/content-addressing';
import { validateDigestRef } from '@lfp2p/content-addressing';
import { tsError } from '../errors.js';
import type { EnforcementScope } from '../authorities.js';
import {
  assertExactVersion,
  assertFiniteNumberInRange,
  assertId,
  assertIso8601,
  assertNotBefore,
  assertOneOf,
  assertPlainObject,
  assertReadonlyArray,
  assertText
} from '../validation.js';

export const LOCAL_CONTROL_EVENT_VERSION = 'lfp2p.local-control-event.v1' as const;

/**
 * Local user-control event kinds.
 *
 * The first seven kinds are the Phase 1.62 baseline. The next five close
 * the Nostr-style "preferences scatter across apps" gap by giving us:
 *  - explicit visibility overrides (`safety.account.allowlisted`)
 *  - subscription to community/policy lists
 *    (`safety.policy-list.subscribed` / `.unsubscribed`)
 *  - per-notification-channel preferences (`safety.notification-preference.set`)
 *  - a canonical full-state snapshot event so a fresh app in our
 *    architecture can bootstrap from one account-local message rather
 *    than replaying the full event log (`safety.preferences.snapshot`)
 */
export const LOCAL_CONTROL_KINDS = [
  // Phase 1.62 baseline
  'safety.account.blocked',
  'safety.account.muted',
  'safety.domain.blocked',
  'safety.keyword.muted',
  'safety.thread.muted',
  'safety.post.hidden',
  'safety.label.preference.set',
  // Phase 1.62.1 expansion
  'safety.account.allowlisted',
  'safety.policy-list.subscribed',
  'safety.policy-list.unsubscribed',
  'safety.notification-preference.set',
  'safety.preferences.snapshot'
] as const;
export type LocalControlKind = (typeof LOCAL_CONTROL_KINDS)[number];

/**
 * `apply` and `revert` are the only two actions. A `revert` event removes
 * the entry that an earlier `apply` of the same target installed.
 */
export const LOCAL_CONTROL_ACTIONS = ['apply', 'revert'] as const;
export type LocalControlAction = (typeof LOCAL_CONTROL_ACTIONS)[number];

/**
 * Privacy scopes permitted for local-control events.
 *
 * `device-local` keeps the preference on a single device. `account-local`
 * is the cross-app portability scope: any of the user's other apps in
 * this architecture, signed into the same controller identity, can
 * replay the event and apply the same preference. Bridge analytics and
 * public flows remain forbidden.
 */
export const PRIVATE_LOCAL_CONTROL_SCOPES: ReadonlySet<EnforcementScope> = new Set<EnforcementScope>([
  'device-local',
  'account-local'
]);

export const ACCOUNT_MUTE_SCOPES = ['all', 'feed', 'replies', 'notifications'] as const;
export type AccountMuteScope = (typeof ACCOUNT_MUTE_SCOPES)[number];

/**
 * Keyword match kinds.
 *
 * `substring` and `word` are pure-text matchers implemented inside this
 * package. `semantic` carries a reference to a precomputed embedding and
 * a similarity threshold; the actual cosine-similarity comparison happens
 * in a host-supplied matcher. The package never compiles a regex and
 * never loads an ML model — both would be ReDoS / supply-chain risks.
 */
export const KEYWORD_MATCH_KINDS = ['substring', 'word', 'semantic'] as const;
export type KeywordMatchKind = (typeof KEYWORD_MATCH_KINDS)[number];

export const LABEL_PREFERENCE_ACTIONS = [
  'allow',
  'warn',
  'collapse',
  'blur-media',
  'hide',
  'downrank'
] as const;
export type LabelPreferenceAction = (typeof LABEL_PREFERENCE_ACTIONS)[number];

/** Trust levels for policy-list subscriptions. */
export const POLICY_LIST_TRUST_LEVELS = ['advisory', 'apply'] as const;
export type PolicyListTrustLevel = (typeof POLICY_LIST_TRUST_LEVELS)[number];

/** Kinds of items a policy-list subscription is permitted to install. */
export const POLICY_LIST_KINDS = [
  'block',
  'mute',
  'allowlist',
  'label-preference',
  'keyword-mute'
] as const;
export type PolicyListKind = (typeof POLICY_LIST_KINDS)[number];

/** Notification channels. */
export const NOTIFICATION_CHANNELS = [
  'mentions',
  'replies',
  'reactions',
  'dm-from-non-contacts',
  'group-invites',
  'follows'
] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** What a user wants to happen on a notification channel. */
export const NOTIFICATION_PREFERENCES = ['allow', 'mute', 'collapse'] as const;
export type NotificationPreference = (typeof NOTIFICATION_PREFERENCES)[number];

const MAX_KEYWORD_LENGTH = 256;
const MAX_REASON_CODE_LENGTH = 256;
const MAX_EMBEDDING_MODEL_LENGTH = 256;
const MAX_POLICY_LIST_KINDS = POLICY_LIST_KINDS.length;

type CommonFields = Readonly<{
  version: typeof LOCAL_CONTROL_EVENT_VERSION;
  eventId: string;
  createdAt: string;
  action: LocalControlAction;
}>;

/**
 * Optional `expiresAt` is supported on every entry-installing event (block,
 * mute, hide, allowlist, label preference, notification preference). When
 * set, the selector treats the entry as inactive once `now > expiresAt`.
 * Selector consults the entry without mutating state, so expiration is
 * pure: rebuild produces the same state, expiration only changes what the
 * selector exposes.
 */
type WithOptionalExpiry = Readonly<{ expiresAt?: string }>;

export type LocalControlEvent =
  | Readonly<CommonFields & WithOptionalExpiry & {
      kind: 'safety.account.blocked';
      targetActorId: string;
      reasonCode?: string;
    }>
  | Readonly<CommonFields & WithOptionalExpiry & {
      kind: 'safety.account.muted';
      targetActorId: string;
      muteScope: AccountMuteScope;
    }>
  | Readonly<CommonFields & WithOptionalExpiry & {
      kind: 'safety.account.allowlisted';
      targetActorId: string;
      reasonCode?: string;
    }>
  | Readonly<CommonFields & WithOptionalExpiry & {
      kind: 'safety.domain.blocked';
      domain: string;
      reasonCode?: string;
    }>
  | Readonly<CommonFields & WithOptionalExpiry & {
      kind: 'safety.keyword.muted';
      keyword: string;
      matchKind: KeywordMatchKind;
      embeddingRef?: DigestRef;
      embeddingModel?: string;
      similarityThreshold?: number;
    }>
  | Readonly<CommonFields & WithOptionalExpiry & {
      kind: 'safety.thread.muted';
      threadId: string;
    }>
  | Readonly<CommonFields & WithOptionalExpiry & {
      kind: 'safety.post.hidden';
      postEventId: string;
    }>
  | Readonly<CommonFields & WithOptionalExpiry & {
      kind: 'safety.label.preference.set';
      labelKey: string;
      namespace: string;
      preference: LabelPreferenceAction;
    }>
  | Readonly<CommonFields & WithOptionalExpiry & {
      kind: 'safety.policy-list.subscribed';
      policyListId: string;
      issuerActorId: string;
      allowedKinds: ReadonlyArray<PolicyListKind>;
      trustLevel: PolicyListTrustLevel;
    }>
  | Readonly<CommonFields & {
      kind: 'safety.policy-list.unsubscribed';
      policyListId: string;
    }>
  | Readonly<CommonFields & WithOptionalExpiry & {
      kind: 'safety.notification-preference.set';
      channel: NotificationChannel;
      preference: NotificationPreference;
    }>
  | Readonly<CommonFields & {
      kind: 'safety.preferences.snapshot';
      snapshotId: string;
      capturedAt: string;
      includesUpThroughEventId?: string;
      /** Canonical serialized state. Schema lives in `./snapshot.ts`. */
      snapshot: Readonly<Record<string, unknown>>;
    }>;

function commonFields(record: Record<string, unknown>, label: string): CommonFields {
  assertExactVersion(record.version, LOCAL_CONTROL_EVENT_VERSION, `${label}.version`);
  const eventId = assertId(record.eventId, `${label}.eventId`);
  const createdAt = assertIso8601(record.createdAt, `${label}.createdAt`);
  const action = assertOneOf(record.action, LOCAL_CONTROL_ACTIONS, `${label}.action`);
  return Object.freeze({
    version: LOCAL_CONTROL_EVENT_VERSION,
    eventId,
    createdAt,
    action
  });
}

function maybeExpiry(
  record: Record<string, unknown>,
  label: string,
  createdAt: string
): string | undefined {
  if (record.expiresAt === undefined) return undefined;
  const expiresAt = assertIso8601(record.expiresAt, `${label}.expiresAt`);
  assertNotBefore(createdAt, expiresAt, `${label}.createdAt`, `${label}.expiresAt`);
  return expiresAt;
}

const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const NAMESPACE_PATTERN = /^[a-z][a-z0-9._-]{0,254}$/;
const LABEL_KEY_PATTERN = /^[a-z][a-z0-9._-]{0,126}$/;

export function validateLocalControlEvent(
  value: unknown,
  label = 'LocalControlEvent'
): LocalControlEvent {
  const record = assertPlainObject(value, label);
  const kind = record.kind;
  if (
    typeof kind !== 'string' ||
    !(LOCAL_CONTROL_KINDS as readonly string[]).includes(kind)
  ) {
    throw tsError(
      'TS_INVALID_ENUM',
      `${label}.kind must be one of ${LOCAL_CONTROL_KINDS.join(', ')} (got: ${String(kind)})`
    );
  }
  const k = kind as LocalControlKind;
  const common = commonFields(record, label);

  switch (k) {
    case 'safety.account.blocked': {
      const targetActorId = assertId(record.targetActorId, `${label}.targetActorId`);
      const expiresAt = maybeExpiry(record, label, common.createdAt);
      const out: Record<string, unknown> = {
        ...common,
        kind: 'safety.account.blocked',
        targetActorId
      };
      if (record.reasonCode !== undefined) {
        out.reasonCode = assertId(record.reasonCode, `${label}.reasonCode`, MAX_REASON_CODE_LENGTH);
      }
      if (expiresAt !== undefined) out.expiresAt = expiresAt;
      return Object.freeze(out) as LocalControlEvent;
    }
    case 'safety.account.muted': {
      const expiresAt = maybeExpiry(record, label, common.createdAt);
      const out: Record<string, unknown> = {
        ...common,
        kind: 'safety.account.muted',
        targetActorId: assertId(record.targetActorId, `${label}.targetActorId`),
        muteScope: assertOneOf(record.muteScope, ACCOUNT_MUTE_SCOPES, `${label}.muteScope`)
      };
      if (expiresAt !== undefined) out.expiresAt = expiresAt;
      return Object.freeze(out) as LocalControlEvent;
    }
    case 'safety.account.allowlisted': {
      const targetActorId = assertId(record.targetActorId, `${label}.targetActorId`);
      const expiresAt = maybeExpiry(record, label, common.createdAt);
      const out: Record<string, unknown> = {
        ...common,
        kind: 'safety.account.allowlisted',
        targetActorId
      };
      if (record.reasonCode !== undefined) {
        out.reasonCode = assertId(record.reasonCode, `${label}.reasonCode`, MAX_REASON_CODE_LENGTH);
      }
      if (expiresAt !== undefined) out.expiresAt = expiresAt;
      return Object.freeze(out) as LocalControlEvent;
    }
    case 'safety.domain.blocked': {
      const domain = assertId(record.domain, `${label}.domain`, 253);
      if (!DOMAIN_PATTERN.test(domain)) {
        throw tsError('TS_INVALID_INPUT', `${label}.domain must be a bare domain`);
      }
      const expiresAt = maybeExpiry(record, label, common.createdAt);
      const out: Record<string, unknown> = {
        ...common,
        kind: 'safety.domain.blocked',
        domain: domain.toLowerCase()
      };
      if (record.reasonCode !== undefined) {
        out.reasonCode = assertId(record.reasonCode, `${label}.reasonCode`, MAX_REASON_CODE_LENGTH);
      }
      if (expiresAt !== undefined) out.expiresAt = expiresAt;
      return Object.freeze(out) as LocalControlEvent;
    }
    case 'safety.keyword.muted': {
      const keyword = assertText(record.keyword, `${label}.keyword`, MAX_KEYWORD_LENGTH);
      const matchKind = assertOneOf(
        record.matchKind,
        KEYWORD_MATCH_KINDS,
        `${label}.matchKind`
      );
      const expiresAt = maybeExpiry(record, label, common.createdAt);
      const out: Record<string, unknown> = {
        ...common,
        kind: 'safety.keyword.muted',
        keyword,
        matchKind
      };
      // For semantic match kind, the embeddingRef is mandatory and the
      // model identifier must be present so the host can refuse to apply
      // an embedding generated by an unknown model. The threshold is
      // optional but bounded.
      if (matchKind === 'semantic') {
        if (record.embeddingRef === undefined) {
          throw tsError(
            'TS_INVALID_INPUT',
            `${label}: matchKind="semantic" requires an embeddingRef`
          );
        }
        out.embeddingRef = validateDigestRef(record.embeddingRef);
        if (record.embeddingModel === undefined) {
          throw tsError(
            'TS_INVALID_INPUT',
            `${label}: matchKind="semantic" requires an embeddingModel identifier`
          );
        }
        out.embeddingModel = assertId(
          record.embeddingModel,
          `${label}.embeddingModel`,
          MAX_EMBEDDING_MODEL_LENGTH
        );
        if (record.similarityThreshold !== undefined) {
          out.similarityThreshold = assertFiniteNumberInRange(
            record.similarityThreshold,
            `${label}.similarityThreshold`,
            0,
            1
          );
        }
      } else {
        // Non-semantic matches must not carry semantic-only fields.
        if (
          record.embeddingRef !== undefined ||
          record.embeddingModel !== undefined ||
          record.similarityThreshold !== undefined
        ) {
          throw tsError(
            'TS_INVALID_INPUT',
            `${label}: embedding fields are only valid when matchKind="semantic"`
          );
        }
      }
      if (expiresAt !== undefined) out.expiresAt = expiresAt;
      return Object.freeze(out) as LocalControlEvent;
    }
    case 'safety.thread.muted': {
      const expiresAt = maybeExpiry(record, label, common.createdAt);
      const out: Record<string, unknown> = {
        ...common,
        kind: 'safety.thread.muted',
        threadId: assertId(record.threadId, `${label}.threadId`)
      };
      if (expiresAt !== undefined) out.expiresAt = expiresAt;
      return Object.freeze(out) as LocalControlEvent;
    }
    case 'safety.post.hidden': {
      const expiresAt = maybeExpiry(record, label, common.createdAt);
      const out: Record<string, unknown> = {
        ...common,
        kind: 'safety.post.hidden',
        postEventId: assertId(record.postEventId, `${label}.postEventId`)
      };
      if (expiresAt !== undefined) out.expiresAt = expiresAt;
      return Object.freeze(out) as LocalControlEvent;
    }
    case 'safety.label.preference.set': {
      const namespace = assertId(record.namespace, `${label}.namespace`, 256);
      if (!NAMESPACE_PATTERN.test(namespace)) {
        throw tsError('TS_INVALID_LABEL', `${label}.namespace must match the label namespace pattern`);
      }
      const labelKey = assertId(record.labelKey, `${label}.labelKey`, 128);
      if (!LABEL_KEY_PATTERN.test(labelKey)) {
        throw tsError('TS_INVALID_LABEL', `${label}.labelKey must match the label-key pattern`);
      }
      const expiresAt = maybeExpiry(record, label, common.createdAt);
      const out: Record<string, unknown> = {
        ...common,
        kind: 'safety.label.preference.set',
        namespace,
        labelKey,
        preference: assertOneOf(
          record.preference,
          LABEL_PREFERENCE_ACTIONS,
          `${label}.preference`
        )
      };
      if (expiresAt !== undefined) out.expiresAt = expiresAt;
      return Object.freeze(out) as LocalControlEvent;
    }
    case 'safety.policy-list.subscribed': {
      const policyListId = assertId(record.policyListId, `${label}.policyListId`);
      const issuerActorId = assertId(record.issuerActorId, `${label}.issuerActorId`);
      const trustLevel = assertOneOf(
        record.trustLevel,
        POLICY_LIST_TRUST_LEVELS,
        `${label}.trustLevel`
      );
      const allowedKinds = assertReadonlyArray(
        record.allowedKinds,
        `${label}.allowedKinds`,
        MAX_POLICY_LIST_KINDS,
        (item, i) => assertOneOf(item, POLICY_LIST_KINDS, `${label}.allowedKinds[${i}]`)
      );
      if (allowedKinds.length === 0) {
        throw tsError(
          'TS_INVALID_INPUT',
          `${label}.allowedKinds must contain at least one kind`
        );
      }
      const expiresAt = maybeExpiry(record, label, common.createdAt);
      const out: Record<string, unknown> = {
        ...common,
        kind: 'safety.policy-list.subscribed',
        policyListId,
        issuerActorId,
        allowedKinds,
        trustLevel
      };
      if (expiresAt !== undefined) out.expiresAt = expiresAt;
      return Object.freeze(out) as LocalControlEvent;
    }
    case 'safety.policy-list.unsubscribed': {
      return Object.freeze({
        ...common,
        kind: 'safety.policy-list.unsubscribed',
        policyListId: assertId(record.policyListId, `${label}.policyListId`)
      }) as LocalControlEvent;
    }
    case 'safety.notification-preference.set': {
      const channel = assertOneOf(record.channel, NOTIFICATION_CHANNELS, `${label}.channel`);
      const preference = assertOneOf(
        record.preference,
        NOTIFICATION_PREFERENCES,
        `${label}.preference`
      );
      const expiresAt = maybeExpiry(record, label, common.createdAt);
      const out: Record<string, unknown> = {
        ...common,
        kind: 'safety.notification-preference.set',
        channel,
        preference
      };
      if (expiresAt !== undefined) out.expiresAt = expiresAt;
      return Object.freeze(out) as LocalControlEvent;
    }
    case 'safety.preferences.snapshot': {
      const snapshotId = assertId(record.snapshotId, `${label}.snapshotId`);
      const capturedAt = assertIso8601(record.capturedAt, `${label}.capturedAt`);
      const snapshot = assertPlainObject(record.snapshot, `${label}.snapshot`);
      const out: Record<string, unknown> = {
        ...common,
        kind: 'safety.preferences.snapshot',
        snapshotId,
        capturedAt,
        snapshot
      };
      if (record.includesUpThroughEventId !== undefined) {
        out.includesUpThroughEventId = assertId(
          record.includesUpThroughEventId,
          `${label}.includesUpThroughEventId`
        );
      }
      return Object.freeze(out) as LocalControlEvent;
    }
  }
}

/**
 * Cross-check the envelope's privacy scope against the local-control event's
 * private-by-default policy. Throws TS_PRIVATE_LEAK if the scope is not
 * device-local or account-local.
 *
 * `account-local` is the cross-app portability scope: a user's other
 * apps in this architecture can subscribe to their own account-local
 * sync and replay these events. Bridges and public flows still cannot
 * read them.
 */
export function assertLocalControlEnvelopeScope(
  envelopeScope: unknown,
  label = 'LocalControlEvent.envelopeScope'
): EnforcementScope {
  if (typeof envelopeScope !== 'string') {
    throw tsError('TS_INVALID_INPUT', `${label} must be a string`);
  }
  if (!PRIVATE_LOCAL_CONTROL_SCOPES.has(envelopeScope as EnforcementScope)) {
    throw tsError(
      'TS_PRIVATE_LEAK',
      `${label}: local-control events must use device-local or account-local scope (got "${envelopeScope}")`
    );
  }
  return envelopeScope as EnforcementScope;
}
