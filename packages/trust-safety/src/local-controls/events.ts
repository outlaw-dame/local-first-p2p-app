import { tsError } from '../errors.js';
import type { EnforcementScope } from '../authorities.js';
import {
  assertExactVersion,
  assertId,
  assertIso8601,
  assertOneOf,
  assertPlainObject,
  assertText
} from '../validation.js';

export const LOCAL_CONTROL_EVENT_VERSION = 'lfp2p.local-control-event.v1' as const;

/**
 * Local user-control event kinds. These are the seven kinds called out by
 * the Phase 1.62 plan. Each kind has its own payload shape; the discriminator
 * is `kind`.
 */
export const LOCAL_CONTROL_KINDS = [
  'safety.account.blocked',
  'safety.account.muted',
  'safety.domain.blocked',
  'safety.keyword.muted',
  'safety.thread.muted',
  'safety.post.hidden',
  'safety.label.preference.set'
] as const;
export type LocalControlKind = (typeof LOCAL_CONTROL_KINDS)[number];

/**
 * `apply` and `revert` are the only two actions. A `revert` event removes
 * the entry that an earlier `apply` of the same target installed.
 */
export const LOCAL_CONTROL_ACTIONS = ['apply', 'revert'] as const;
export type LocalControlAction = (typeof LOCAL_CONTROL_ACTIONS)[number];

/**
 * Privacy scopes permitted for local-control events. The plan: "Local user
 * controls are private by default. Mutes, hides, keyword filters, feed
 * preferences, label preferences, and trust settings are not bridge
 * analytics." Allowed scopes are therefore strictly local to the device or
 * the account's own private sync.
 */
export const PRIVATE_LOCAL_CONTROL_SCOPES: ReadonlySet<EnforcementScope> = new Set<EnforcementScope>([
  'device-local',
  'account-local'
]);

/** Mute scope for `safety.account.muted`. */
export const ACCOUNT_MUTE_SCOPES = ['all', 'feed', 'replies', 'notifications'] as const;
export type AccountMuteScope = (typeof ACCOUNT_MUTE_SCOPES)[number];

/**
 * Keyword match kinds. `regex` is deliberately excluded — user-controlled
 * regexes are a ReDoS footgun and our threat model rejects them. Substring
 * is case-insensitive byte/char match; `word` requires whitespace or
 * punctuation boundaries on both sides.
 */
export const KEYWORD_MATCH_KINDS = ['substring', 'word'] as const;
export type KeywordMatchKind = (typeof KEYWORD_MATCH_KINDS)[number];

/**
 * Label preferences a user may set. This is a subset of the global SafetyAction
 * enum: only actions that make sense as a *user override* on a label appear here.
 * `reject-transport`, `escalate-review`, `quarantine`, `remove-local`,
 * `rate-limit` are infrastructure or admin behaviors and not user preferences.
 */
export const LABEL_PREFERENCE_ACTIONS = [
  'allow',
  'warn',
  'collapse',
  'blur-media',
  'hide',
  'downrank'
] as const;
export type LabelPreferenceAction = (typeof LABEL_PREFERENCE_ACTIONS)[number];

const MAX_KEYWORD_LENGTH = 256;
const MAX_REASON_CODE_LENGTH = 256;

type CommonFields = Readonly<{
  version: typeof LOCAL_CONTROL_EVENT_VERSION;
  eventId: string;
  createdAt: string;
  action: LocalControlAction;
}>;

export type LocalControlEvent =
  | Readonly<CommonFields & {
      kind: 'safety.account.blocked';
      targetActorId: string;
      reasonCode?: string;
    }>
  | Readonly<CommonFields & {
      kind: 'safety.account.muted';
      targetActorId: string;
      muteScope: AccountMuteScope;
    }>
  | Readonly<CommonFields & {
      kind: 'safety.domain.blocked';
      domain: string;
      reasonCode?: string;
    }>
  | Readonly<CommonFields & {
      kind: 'safety.keyword.muted';
      keyword: string;
      matchKind: KeywordMatchKind;
    }>
  | Readonly<CommonFields & {
      kind: 'safety.thread.muted';
      threadId: string;
    }>
  | Readonly<CommonFields & {
      kind: 'safety.post.hidden';
      postEventId: string;
    }>
  | Readonly<CommonFields & {
      kind: 'safety.label.preference.set';
      labelKey: string;
      namespace: string;
      preference: LabelPreferenceAction;
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
      const out: { -readonly [K in keyof Extract<LocalControlEvent, { kind: 'safety.account.blocked' }>]: Extract<LocalControlEvent, { kind: 'safety.account.blocked' }>[K] } = {
        ...common,
        kind: 'safety.account.blocked',
        targetActorId
      };
      if (record.reasonCode !== undefined) {
        out.reasonCode = assertId(record.reasonCode, `${label}.reasonCode`, MAX_REASON_CODE_LENGTH);
      }
      return Object.freeze(out);
    }
    case 'safety.account.muted': {
      return Object.freeze({
        ...common,
        kind: 'safety.account.muted',
        targetActorId: assertId(record.targetActorId, `${label}.targetActorId`),
        muteScope: assertOneOf(record.muteScope, ACCOUNT_MUTE_SCOPES, `${label}.muteScope`)
      });
    }
    case 'safety.domain.blocked': {
      const domain = assertId(record.domain, `${label}.domain`, 253);
      if (!DOMAIN_PATTERN.test(domain)) {
        throw tsError('TS_INVALID_INPUT', `${label}.domain must be a bare domain`);
      }
      const out: { -readonly [K in keyof Extract<LocalControlEvent, { kind: 'safety.domain.blocked' }>]: Extract<LocalControlEvent, { kind: 'safety.domain.blocked' }>[K] } = {
        ...common,
        kind: 'safety.domain.blocked',
        domain: domain.toLowerCase()
      };
      if (record.reasonCode !== undefined) {
        out.reasonCode = assertId(record.reasonCode, `${label}.reasonCode`, MAX_REASON_CODE_LENGTH);
      }
      return Object.freeze(out);
    }
    case 'safety.keyword.muted': {
      const keyword = assertText(record.keyword, `${label}.keyword`, MAX_KEYWORD_LENGTH);
      const matchKind = assertOneOf(
        record.matchKind,
        KEYWORD_MATCH_KINDS,
        `${label}.matchKind`
      );
      // Defense-in-depth: reject anything that looks like a user-supplied regex —
      // matchKind='regex' is not in our enum, and a keyword that happens to be a
      // regex string is still treated as a literal substring/word match. We do
      // not compile user-supplied regexes anywhere in this package.
      return Object.freeze({
        ...common,
        kind: 'safety.keyword.muted',
        keyword,
        matchKind
      });
    }
    case 'safety.thread.muted': {
      return Object.freeze({
        ...common,
        kind: 'safety.thread.muted',
        threadId: assertId(record.threadId, `${label}.threadId`)
      });
    }
    case 'safety.post.hidden': {
      return Object.freeze({
        ...common,
        kind: 'safety.post.hidden',
        postEventId: assertId(record.postEventId, `${label}.postEventId`)
      });
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
      return Object.freeze({
        ...common,
        kind: 'safety.label.preference.set',
        namespace,
        labelKey,
        preference: assertOneOf(
          record.preference,
          LABEL_PREFERENCE_ACTIONS,
          `${label}.preference`
        )
      });
    }
  }
}

/**
 * Cross-check the envelope's privacy scope against the local-control event's
 * private-by-default policy. Throws TS_PRIVATE_LEAK if the scope is not
 * device-local or account-local.
 *
 * This guard is the structural enforcement of the doctrine line:
 *
 *   "Local user controls are private by default … not bridge analytics."
 *
 * It is intentionally fail-closed: unknown scopes also fail. Bridge or
 * relay code that attempts to emit a `safety.account.blocked` event at
 * `community-local` or any networked scope will be rejected here.
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
