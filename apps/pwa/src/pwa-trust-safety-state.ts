/**
 * Phase 1.70 PWA T&S settings — pure logic helpers.
 *
 * This module owns the *protocol-shaped* side of the settings UI:
 * event construction, validation, and view-model assembly. The
 * React component layer in `pwa-trust-safety-settings.tsx` consumes
 * these helpers and never touches the protocol directly.
 *
 * Discipline:
 *  - Every emitted event is run through the package validator before
 *    we return it. Defense-in-depth: the persistence layer also
 *    re-validates, so a malformed event is rejected twice.
 *  - All view models are derived from frozen projection state. We
 *    never mutate state here.
 *  - No regex against user-authored text. The two new match kinds
 *    (`phrase`, `hashtag`) live on the linear-time path inside the
 *    `@lfp2p/trust-safety` package.
 *  - No semantic match kind in the UI yet — wiring an embedding
 *    pipeline is a separate slice. We surface the deferral
 *    explicitly via `KEYWORD_MATCH_KINDS_AVAILABLE_IN_UI`.
 */
import {
  CONTENT_CATEGORIES,
  CONTENT_CATEGORY_NAMESPACE,
  type ContentCategory,
  type LabelPreferenceAction,
  type LabelerEvent,
  type LabelersState,
  type LocalControlEvent,
  type LocalControlState,
  decideContentCategoryAction,
  detectRedundantSubscription,
  findOverlappingSubscriptions,
  labelPreferenceKey,
  validateLabelerEvent,
  validateLocalControlEvent
} from '@lfp2p/trust-safety';

/**
 * Match kinds the PWA exposes in the keyword-filter form. `semantic`
 * is intentionally absent: it requires a host-supplied embedding
 * pipeline that we have not yet shipped in the PWA. The protocol
 * still accepts it; only the UI gates it.
 */
export const KEYWORD_MATCH_KINDS_AVAILABLE_IN_UI = [
  'substring',
  'word',
  'phrase',
  'hashtag'
] as const;
export type UiKeywordMatchKind = (typeof KEYWORD_MATCH_KINDS_AVAILABLE_IN_UI)[number];

/**
 * Allocate a fresh event ID with a stable per-kind prefix so logs are
 * readable on inspection. The body uses `crypto.randomUUID()` which
 * is RFC-4122 v4 — collision-resistant within a single device.
 */
export function newEventId(prefix: string): string {
  return `evt_${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Event constructors
// ---------------------------------------------------------------------------

/**
 * Construct the master adult-content gate event. Caller MUST surface
 * an explicit "I am 18+" confirmation in the UI before invoking
 * this with `enabled=true`.
 */
export function buildAdultContentGateEvent(enabled: boolean): LocalControlEvent {
  const at = nowIso();
  return validateLocalControlEvent({
    version: 'lfp2p.local-control-event.v1',
    eventId: newEventId('gate'),
    createdAt: at,
    action: 'apply',
    kind: 'safety.adult-content.gate.set',
    enabled,
    gatedAt: at
  });
}

/**
 * Construct a content-category preference event. The category's
 * standard registry entry is the canonical key + namespace.
 */
export function buildContentCategoryPreferenceEvent(
  categoryKey: string,
  preference: LabelPreferenceAction
): LocalControlEvent {
  const category = CONTENT_CATEGORIES.find((c) => c.key === categoryKey);
  if (category === undefined) {
    throw new Error(`Unknown content category: ${categoryKey}`);
  }
  return validateLocalControlEvent({
    version: 'lfp2p.local-control-event.v1',
    eventId: newEventId('catpref'),
    createdAt: nowIso(),
    action: 'apply',
    kind: 'safety.label.preference.set',
    namespace: CONTENT_CATEGORY_NAMESPACE,
    labelKey: category.key,
    preference
  });
}

export type KeywordFilterInput = Readonly<{
  keyword: string;
  matchKind: UiKeywordMatchKind;
}>;

export function buildKeywordFilterEvent(input: KeywordFilterInput): LocalControlEvent {
  return validateLocalControlEvent({
    version: 'lfp2p.local-control-event.v1',
    eventId: newEventId('kw'),
    createdAt: nowIso(),
    action: 'apply',
    kind: 'safety.keyword.muted',
    keyword: input.keyword,
    matchKind: input.matchKind
  });
}

/**
 * Build a revert event for a previously-applied keyword filter. The
 * projection identifies the entry by the normalized keyword
 * (substring/word preserve case in storage; phrase trims+collapses;
 * hashtag lowercases). Caller MUST pass the same normalized form
 * that the projection stored — typically the value already on
 * `LocalControlState.mutedKeywords`'s key.
 */
export function buildKeywordFilterRevertEvent(input: KeywordFilterInput): LocalControlEvent {
  return validateLocalControlEvent({
    version: 'lfp2p.local-control-event.v1',
    eventId: newEventId('kw_rev'),
    createdAt: nowIso(),
    action: 'revert',
    kind: 'safety.keyword.muted',
    keyword: input.keyword,
    matchKind: input.matchKind
  });
}

export type SubscribeInput = Readonly<{
  subscriptionId: string;
  subscriberActorId: string;
  labelerId: string;
  trustedNamespaces: ReadonlyArray<string>;
}>;

export function buildLabelerSubscribeEvent(input: SubscribeInput): LabelerEvent {
  const at = nowIso();
  return validateLabelerEvent({
    version: 'lfp2p.labeler-event.v1',
    eventId: newEventId('sub'),
    createdAt: at,
    kind: 'safety.labeler.subscribed',
    subscription: {
      version: 'lfp2p.safety-labeler-subscription.v1',
      subscriptionId: input.subscriptionId,
      subscriberActorId: input.subscriberActorId,
      labelerId: input.labelerId,
      trustedNamespaces: input.trustedNamespaces,
      scope: 'account-local',
      createdAt: at
    }
  });
}

export function buildLabelerUnsubscribeEvent(subscriptionId: string): LabelerEvent {
  const at = nowIso();
  return validateLabelerEvent({
    version: 'lfp2p.labeler-event.v1',
    eventId: newEventId('unsub'),
    createdAt: at,
    kind: 'safety.labeler.unsubscribed',
    subscriptionId,
    unsubscribedAt: at
  });
}

// ---------------------------------------------------------------------------
// View models
// ---------------------------------------------------------------------------

export type ContentCategoryRow = Readonly<{
  category: ContentCategory;
  currentPreference: LabelPreferenceAction | undefined;
  /** What the selector will actually apply once the gate is consulted. */
  effectiveAction: LabelPreferenceAction;
  /**
   * True when the master gate is off AND the category is adult — the
   * user's preference is overridden to `hide`. The UI should render
   * the preference picker as disabled with a "turn on adult content
   * to override" hint.
   */
  lockedByGate: boolean;
}>;

export function buildContentCategoryRows(state: LocalControlState): ContentCategoryRow[] {
  const gateEnabled = state.adultContentGate?.enabled ?? false;
  return CONTENT_CATEGORIES.map((category) => {
    const prefKey = labelPreferenceKey(CONTENT_CATEGORY_NAMESPACE, category.key);
    const prefEntry = state.labelPreferences[prefKey];
    const currentPreference = prefEntry?.preference;
    const effectiveAction = decideContentCategoryAction(
      category,
      currentPreference,
      gateEnabled
    );
    const lockedByGate = category.isAdult && !gateEnabled;
    return Object.freeze({
      category,
      currentPreference,
      effectiveAction,
      lockedByGate
    });
  });
}

export type KeywordFilterRow = Readonly<{
  /** The stored keyword (normalized per match kind). */
  keyword: string;
  matchKind: string;
  since: string;
  expiresAt: string | undefined;
}>;

export function buildKeywordFilterRows(state: LocalControlState): KeywordFilterRow[] {
  const rows: KeywordFilterRow[] = [];
  for (const key of Object.keys(state.mutedKeywords).sort()) {
    const entry = state.mutedKeywords[key];
    if (entry === undefined) continue;
    rows.push(
      Object.freeze({
        keyword: entry.keyword,
        matchKind: entry.matchKind,
        since: entry.since,
        expiresAt: entry.expiresAt
      })
    );
  }
  return rows;
}

export type LabelerSubscriptionRow = Readonly<{
  subscriptionId: string;
  labelerId: string;
  labelerDisplayName: string;
  capabilitySummary: ReadonlyArray<string>;
  supportedLabels: ReadonlyArray<string>;
}>;

export function buildLabelerSubscriptionRows(
  state: LabelersState,
  subscriberActorId: string
): LabelerSubscriptionRow[] {
  const rows: LabelerSubscriptionRow[] = [];
  for (const sub of Object.values(state.subscriptionsById)) {
    if (sub.status !== 'active') continue;
    if (sub.subscription.subscriberActorId !== subscriberActorId) continue;
    const profile = state.labelerProfilesById[sub.subscription.labelerId];
    if (profile === undefined) {
      rows.push(
        Object.freeze({
          subscriptionId: sub.subscription.subscriptionId,
          labelerId: sub.subscription.labelerId,
          labelerDisplayName: sub.subscription.labelerId,
          capabilitySummary: Object.freeze([] as string[]),
          supportedLabels: Object.freeze([] as string[])
        })
      );
      continue;
    }
    const capabilitySummary = (profile.capabilities ?? []).map(
      (c) => `${c.capabilityId}`
    );
    rows.push(
      Object.freeze({
        subscriptionId: sub.subscription.subscriptionId,
        labelerId: profile.labelerId,
        labelerDisplayName: profile.displayName,
        capabilitySummary: Object.freeze(capabilitySummary),
        supportedLabels: Object.freeze([...profile.supportedLabels])
      })
    );
  }
  rows.sort((a, b) => a.labelerDisplayName.localeCompare(b.labelerDisplayName));
  return rows;
}

export type PreSubscribeAssessment = Readonly<{
  ok: boolean;
  message: string;
  redundantWithLabelerId: string | undefined;
  overlappingCapabilityIds: ReadonlyArray<string>;
  overlappingLabelKeys: ReadonlyArray<string>;
}>;

/**
 * UI-facing wrapper around `detectRedundantSubscription`. Returns a
 * `message` suitable for a confirmation dialog. `ok=true` means the
 * subscription is safe to add silently; `ok=false` means the UI
 * SHOULD show the message and require an explicit confirmation.
 */
export function assessSubscribeIntent(
  state: LabelersState,
  subscriberActorId: string,
  candidateLabelerId: string
): PreSubscribeAssessment {
  const r = detectRedundantSubscription(state, subscriberActorId, candidateLabelerId);
  if (r.isRedundant && r.overlappingWithLabelerId !== undefined) {
    return Object.freeze({
      ok: false,
      message: `You already subscribe to "${r.overlappingWithLabelerId}", which provides ${r.overlappingCapabilityIds.join(', ')}. Subscribing to "${candidateLabelerId}" would be redundant.`,
      redundantWithLabelerId: r.overlappingWithLabelerId,
      overlappingCapabilityIds: r.overlappingCapabilityIds,
      overlappingLabelKeys: r.overlappingLabelKeys
    });
  }
  if (
    r.overlappingCapabilityIds.length > 0 ||
    r.overlappingLabelKeys.length > 0
  ) {
    return Object.freeze({
      ok: false,
      message: `"${candidateLabelerId}" partially overlaps with an existing subscription. Capabilities in common: ${r.overlappingCapabilityIds.join(', ') || '(none)'}; label keys in common: ${r.overlappingLabelKeys.join(', ') || '(none)'}.`,
      redundantWithLabelerId: r.overlappingWithLabelerId,
      overlappingCapabilityIds: r.overlappingCapabilityIds,
      overlappingLabelKeys: r.overlappingLabelKeys
    });
  }
  return Object.freeze({
    ok: true,
    message: '',
    redundantWithLabelerId: undefined,
    overlappingCapabilityIds: Object.freeze([] as string[]),
    overlappingLabelKeys: Object.freeze([] as string[])
  });
}

/**
 * Convenience re-export of the protocol overlap pairs for the UI's
 * "subscription health" indicator.
 */
export function listExistingOverlaps(
  state: LabelersState,
  subscriberActorId: string
): ReturnType<typeof findOverlappingSubscriptions> {
  return findOverlappingSubscriptions(state, subscriberActorId);
}
