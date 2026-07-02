import { describe, expect, it } from 'vitest';
import type { LabelerEvent } from '../index.js';
import {
  applyLabelerEvent,
  createEmptyLabelersState,
  effectiveLabelsForSubject,
  mostRestrictiveAction,
  seedLabelersState,
  subjectKey
} from '../index.js';

const SUBSCRIBER = 'actor_subscriber_42';

function labelerAuthority(labelerId: string, actorId: string) {
  return {
    version: 'lfp2p.safety-authority.v1' as const,
    authorityId: labelerId,
    actorId,
    role: 'labeler' as const,
    scope: 'account-local' as const,
    createdAt: '2026-01-01T00:00:00Z'
  };
}

function profilePublished(
  labelerId: string,
  actorId: string,
  kind: string,
  evId: string,
  ts = '2026-05-01T00:00:00Z'
): LabelerEvent {
  return {
    version: 'lfp2p.labeler-event.v1',
    eventId: evId,
    createdAt: ts,
    kind: 'safety.labeler.profile.published',
    profile: {
      version: 'lfp2p.safety-labeler-profile.v1',
      labelerId,
      actorId,
      displayName: `Labeler ${labelerId}`,
      supportedNamespaces: ['lfp2p.safety'],
      supportedLabels: ['security.spam', 'quality.low-effort'],
      createdAt: ts,
      updatedAt: ts,
      kind
    }
  } as unknown as LabelerEvent;
}

function subscribed(
  subscriptionId: string,
  labelerId: string,
  evId: string,
  overrides?: ReadonlyArray<{ labelKey: string; namespace: string; action: string }>
): LabelerEvent {
  const sub: Record<string, unknown> = {
    version: 'lfp2p.safety-labeler-subscription.v1',
    subscriptionId,
    subscriberActorId: SUBSCRIBER,
    labelerId,
    trustedNamespaces: ['lfp2p.safety'],
    scope: 'account-local',
    createdAt: '2026-05-10T00:00:00Z'
  };
  if (overrides !== undefined) sub.actionOverrides = overrides;
  return {
    version: 'lfp2p.labeler-event.v1',
    eventId: evId,
    createdAt: '2026-05-10T00:00:00Z',
    kind: 'safety.labeler.subscribed',
    subscription: sub
  } as unknown as LabelerEvent;
}

function applied(
  labelId: string,
  labelerId: string,
  actorId: string,
  subjectEventId: string,
  labelKey: string,
  evId: string,
  ts = '2026-05-31T00:00:00Z',
  severity?: string
): LabelerEvent {
  const labelPayload: Record<string, unknown> = {
    version: 'lfp2p.safety-label.v1',
    labelId,
    issuer: labelerAuthority(labelerId, actorId),
    subject: { type: 'event', eventId: subjectEventId },
    labelKey,
    namespace: 'lfp2p.safety',
    scope: 'account-local',
    createdAt: ts
  };
  if (severity !== undefined) labelPayload.severity = severity;
  return {
    version: 'lfp2p.labeler-event.v1',
    eventId: evId,
    createdAt: ts,
    kind: 'safety.label.applied',
    label: labelPayload
  } as unknown as LabelerEvent;
}

function revoked(
  labelId: string,
  revokerLabelerId: string,
  revokerActorId: string,
  evId: string
): LabelerEvent {
  return {
    version: 'lfp2p.labeler-event.v1',
    eventId: evId,
    createdAt: '2026-06-01T00:00:00Z',
    kind: 'safety.label.revoked',
    labelId,
    revokedBy: labelerAuthority(revokerLabelerId, revokerActorId),
    revokedAt: '2026-06-01T00:00:00Z',
    reasonCode: 'policy.community-rule'
  } as unknown as LabelerEvent;
}

const SUBJ = { type: 'event' as const, eventId: 'evt_target' };
const SUBJ_KEY = subjectKey(SUBJ);

describe('labeler runtime — composable stacking (ATProto + improvements)', () => {
  it('stacks labels from two different labelers on the same subject', () => {
    let s = createEmptyLabelersState();
    s = applyLabelerEvent(
      s,
      profilePublished('labeler_A', 'actor_A', 'automated-classifier', 'e_pA')
    );
    s = applyLabelerEvent(s, profilePublished('labeler_B', 'actor_B', 'human-curated', 'e_pB'));
    s = applyLabelerEvent(s, subscribed('sub_A', 'labeler_A', 'e_sA'));
    s = applyLabelerEvent(s, subscribed('sub_B', 'labeler_B', 'e_sB'));
    s = applyLabelerEvent(
      s,
      applied(
        'lbl_A_spam',
        'labeler_A',
        'actor_A',
        'evt_target',
        'security.spam',
        'e_lA',
        '2026-05-31T00:00:00Z',
        'medium'
      )
    );
    s = applyLabelerEvent(
      s,
      applied(
        'lbl_B_spam',
        'labeler_B',
        'actor_B',
        'evt_target',
        'security.spam',
        'e_lB',
        '2026-05-31T00:01:00Z',
        'high'
      )
    );

    const stack = effectiveLabelsForSubject(s, SUBJ_KEY, SUBSCRIBER);
    expect(stack.length).toBe(2);
    expect(stack[0]?.issuerLabelerId).toBe('labeler_A');
    expect(stack[1]?.issuerLabelerId).toBe('labeler_B');
    // Both labelers' kinds are exposed for transparency.
    expect(stack[0]?.labelerKind).toBe('automated-classifier');
    expect(stack[1]?.labelerKind).toBe('human-curated');
  });

  it('subscriber-specific action override stacks correctly per labeler', () => {
    let s = createEmptyLabelersState();
    s = applyLabelerEvent(
      s,
      profilePublished('labeler_A', 'actor_A', 'automated-classifier', 'e_pA')
    );
    s = applyLabelerEvent(s, profilePublished('labeler_B', 'actor_B', 'human-curated', 'e_pB'));
    // Subscriber wants labeler A's "spam" labels to merely warn, but
    // labeler B's "spam" labels to hide.
    s = applyLabelerEvent(
      s,
      subscribed('sub_A', 'labeler_A', 'e_sA', [
        { labelKey: 'security.spam', namespace: 'lfp2p.safety', action: 'warn' }
      ])
    );
    s = applyLabelerEvent(
      s,
      subscribed('sub_B', 'labeler_B', 'e_sB', [
        { labelKey: 'security.spam', namespace: 'lfp2p.safety', action: 'hide' }
      ])
    );
    s = applyLabelerEvent(
      s,
      applied('lbl_A_spam', 'labeler_A', 'actor_A', 'evt_target', 'security.spam', 'e_lA')
    );
    s = applyLabelerEvent(
      s,
      applied('lbl_B_spam', 'labeler_B', 'actor_B', 'evt_target', 'security.spam', 'e_lB')
    );

    const stack = effectiveLabelsForSubject(s, SUBJ_KEY, SUBSCRIBER);
    const byLabeler = new Map(stack.map((r) => [r.issuerLabelerId, r.effectiveAction]));
    expect(byLabeler.get('labeler_A')).toBe('warn');
    expect(byLabeler.get('labeler_B')).toBe('hide');
    expect(mostRestrictiveAction(stack)).toBe('hide');
  });

  it('cross-labeler revoke is rejected (labelers can only revoke their own labels)', () => {
    let s = createEmptyLabelersState();
    s = applyLabelerEvent(
      s,
      profilePublished('labeler_A', 'actor_A', 'automated-classifier', 'e_pA')
    );
    s = applyLabelerEvent(
      s,
      applied('lbl_A_spam', 'labeler_A', 'actor_A', 'evt_target', 'security.spam', 'e_lA')
    );
    expect(() =>
      applyLabelerEvent(s, revoked('lbl_A_spam', 'labeler_B', 'actor_B', 'e_revoke'))
    ).toThrow(/cross-labeler|labelers can only revoke their own/);
  });

  it('same-labeler revoke succeeds and removes the label from the stack', () => {
    let s = createEmptyLabelersState();
    s = applyLabelerEvent(s, profilePublished('labeler_A', 'actor_A', 'human-curated', 'e_pA'));
    s = applyLabelerEvent(s, subscribed('sub_A', 'labeler_A', 'e_sA'));
    s = applyLabelerEvent(
      s,
      applied('lbl_A_spam', 'labeler_A', 'actor_A', 'evt_target', 'security.spam', 'e_lA')
    );
    expect(effectiveLabelsForSubject(s, SUBJ_KEY, SUBSCRIBER).length).toBe(1);
    s = applyLabelerEvent(s, revoked('lbl_A_spam', 'labeler_A', 'actor_A', 'e_revoke'));
    expect(effectiveLabelsForSubject(s, SUBJ_KEY, SUBSCRIBER).length).toBe(0);
  });

  it('a subscription unsubscribed mid-stack filters out that labeler', () => {
    let s = createEmptyLabelersState();
    s = applyLabelerEvent(
      s,
      profilePublished('labeler_A', 'actor_A', 'automated-classifier', 'e_pA')
    );
    s = applyLabelerEvent(s, profilePublished('labeler_B', 'actor_B', 'human-curated', 'e_pB'));
    s = applyLabelerEvent(s, subscribed('sub_A', 'labeler_A', 'e_sA'));
    s = applyLabelerEvent(s, subscribed('sub_B', 'labeler_B', 'e_sB'));
    s = applyLabelerEvent(
      s,
      applied('lbl_A', 'labeler_A', 'actor_A', 'evt_target', 'security.spam', 'e_lA')
    );
    s = applyLabelerEvent(
      s,
      applied('lbl_B', 'labeler_B', 'actor_B', 'evt_target', 'security.spam', 'e_lB')
    );
    expect(effectiveLabelsForSubject(s, SUBJ_KEY, SUBSCRIBER).length).toBe(2);
    s = applyLabelerEvent(s, {
      version: 'lfp2p.labeler-event.v1',
      eventId: 'e_unsub_A',
      createdAt: '2026-06-15T00:00:00Z',
      kind: 'safety.labeler.unsubscribed',
      subscriptionId: 'sub_A',
      unsubscribedAt: '2026-06-15T00:00:00Z'
    } as unknown as LabelerEvent);
    const stack = effectiveLabelsForSubject(s, SUBJ_KEY, SUBSCRIBER);
    expect(stack.length).toBe(1);
    expect(stack[0]?.issuerLabelerId).toBe('labeler_B');
  });

  it('per-namespace trust filters labels from labelers the subscriber does not trust for that namespace', () => {
    let s = createEmptyLabelersState();
    s = applyLabelerEvent(
      s,
      profilePublished('labeler_A', 'actor_A', 'automated-classifier', 'e_pA')
    );
    s = applyLabelerEvent(s, {
      version: 'lfp2p.labeler-event.v1',
      eventId: 'e_subA',
      createdAt: '2026-05-10T00:00:00Z',
      kind: 'safety.labeler.subscribed',
      subscription: {
        version: 'lfp2p.safety-labeler-subscription.v1',
        subscriptionId: 'sub_A',
        subscriberActorId: SUBSCRIBER,
        labelerId: 'labeler_A',
        trustedNamespaces: ['lfp2p.safety'],
        trustedLabels: ['quality.low-effort'],
        scope: 'account-local',
        createdAt: '2026-05-10T00:00:00Z'
      }
    } as unknown as LabelerEvent);
    // labeler A applies a label outside the subscriber's trustedLabels filter.
    s = applyLabelerEvent(
      s,
      applied('lbl_A_spam', 'labeler_A', 'actor_A', 'evt_target', 'security.spam', 'e_lA')
    );
    s = applyLabelerEvent(
      s,
      applied('lbl_A_lowq', 'labeler_A', 'actor_A', 'evt_target', 'quality.low-effort', 'e_lA2')
    );
    const stack = effectiveLabelsForSubject(s, SUBJ_KEY, SUBSCRIBER);
    expect(stack.map((r) => r.labelKey)).toEqual(['quality.low-effort']);
  });

  it('profile re-publish supersedes prior profile under same labelerId', () => {
    let s = createEmptyLabelersState();
    s = applyLabelerEvent(
      s,
      profilePublished(
        'labeler_A',
        'actor_A',
        'automated-classifier',
        'e_p1',
        '2026-05-01T00:00:00Z'
      )
    );
    s = applyLabelerEvent(
      s,
      profilePublished('labeler_A', 'actor_A', 'hybrid', 'e_p2', '2026-06-01T00:00:00Z')
    );
    expect(s.labelerProfilesById['labeler_A']?.kind).toBe('hybrid');
  });

  it('seedLabelersState replay equivalence', () => {
    const events: LabelerEvent[] = [
      profilePublished('labeler_A', 'actor_A', 'automated-classifier', 'e_pA'),
      subscribed('sub_A', 'labeler_A', 'e_sA'),
      applied('lbl_A', 'labeler_A', 'actor_A', 'evt_target', 'security.spam', 'e_lA'),
      applied('lbl_A2', 'labeler_A', 'actor_A', 'evt_other', 'quality.low-effort', 'e_lA2')
    ];
    const seeded = seedLabelersState(events);
    let stepped = createEmptyLabelersState();
    for (const e of events) stepped = applyLabelerEvent(stepped, e);
    expect(seeded).toEqual(stepped);
  });

  it('mostRestrictiveAction picks the highest-rank action across the stack', () => {
    const stack = [
      {
        labelId: '1',
        labelKey: 'a',
        namespace: 'n',
        issuerActorId: 'i1',
        effectiveAction: 'warn' as const,
        appliedAt: 't1'
      },
      {
        labelId: '2',
        labelKey: 'b',
        namespace: 'n',
        issuerActorId: 'i2',
        effectiveAction: 'hide' as const,
        appliedAt: 't2'
      },
      {
        labelId: '3',
        labelKey: 'c',
        namespace: 'n',
        issuerActorId: 'i3',
        effectiveAction: 'collapse' as const,
        appliedAt: 't3'
      }
    ];
    expect(mostRestrictiveAction(stack)).toBe('hide');
  });

  it('empty stack -> mostRestrictiveAction returns allow', () => {
    expect(mostRestrictiveAction([])).toBe('allow');
  });
});

describe('labeler kind taxonomy', () => {
  it('rejects aggregatorOf when kind is not community-aggregator', () => {
    const ev = profilePublished('labeler_A', 'actor_A', 'human-curated', 'e_pA');
    const broken: Record<string, unknown> = JSON.parse(JSON.stringify(ev));
    (broken.profile as Record<string, unknown>).aggregatorOf = ['labeler_B'];
    expect(() => applyLabelerEvent(createEmptyLabelersState(), broken)).toThrow(
      /aggregatorOf may only be present when kind/
    );
  });

  it('rejects community-aggregator without aggregatorOf', () => {
    const ev = profilePublished('labeler_A', 'actor_A', 'community-aggregator', 'e_pA');
    expect(() => applyLabelerEvent(createEmptyLabelersState(), ev)).toThrow(
      /requires aggregatorOf/
    );
  });

  it('accepts a community-aggregator with sources, rejecting self-reference', () => {
    const ev = profilePublished('labeler_A', 'actor_A', 'community-aggregator', 'e_pA');
    const ok = JSON.parse(JSON.stringify(ev));
    ok.profile.aggregatorOf = ['labeler_B', 'labeler_C'];
    expect(() => applyLabelerEvent(createEmptyLabelersState(), ok)).not.toThrow();

    const loop = JSON.parse(JSON.stringify(ev));
    loop.profile.aggregatorOf = ['labeler_A']; // self
    expect(() => applyLabelerEvent(createEmptyLabelersState(), loop)).toThrow(
      /trust loop|must not include the labeler's own/
    );
  });
});

describe('labeler runtime — lifecycle illegal transitions', () => {
  it('rejects subscribing under an existing subscriptionId', () => {
    let s = createEmptyLabelersState();
    s = applyLabelerEvent(
      s,
      profilePublished('labeler_A', 'actor_A', 'automated-classifier', 'e_pA')
    );
    s = applyLabelerEvent(s, subscribed('sub_A', 'labeler_A', 'e_sA'));
    expect(() => applyLabelerEvent(s, subscribed('sub_A', 'labeler_A', 'e_sA_dup'))).toThrow(
      /already exists/
    );
  });

  it('rejects double-unsubscribe', () => {
    let s = createEmptyLabelersState();
    s = applyLabelerEvent(
      s,
      profilePublished('labeler_A', 'actor_A', 'automated-classifier', 'e_pA')
    );
    s = applyLabelerEvent(s, subscribed('sub_A', 'labeler_A', 'e_sA'));
    s = applyLabelerEvent(s, {
      version: 'lfp2p.labeler-event.v1',
      eventId: 'e_unsub1',
      createdAt: '2026-06-15T00:00:00Z',
      kind: 'safety.labeler.unsubscribed',
      subscriptionId: 'sub_A',
      unsubscribedAt: '2026-06-15T00:00:00Z'
    } as unknown as LabelerEvent);
    expect(() =>
      applyLabelerEvent(s, {
        version: 'lfp2p.labeler-event.v1',
        eventId: 'e_unsub2',
        createdAt: '2026-06-16T00:00:00Z',
        kind: 'safety.labeler.unsubscribed',
        subscriptionId: 'sub_A',
        unsubscribedAt: '2026-06-16T00:00:00Z'
      } as unknown as LabelerEvent)
    ).toThrow(/already unsubscribed/);
  });

  it('rejects re-applying the same labelId', () => {
    let s = createEmptyLabelersState();
    s = applyLabelerEvent(
      s,
      profilePublished('labeler_A', 'actor_A', 'automated-classifier', 'e_pA')
    );
    s = applyLabelerEvent(
      s,
      applied('lbl_A', 'labeler_A', 'actor_A', 'evt_target', 'security.spam', 'e_lA')
    );
    expect(() =>
      applyLabelerEvent(
        s,
        applied('lbl_A', 'labeler_A', 'actor_A', 'evt_target', 'security.spam', 'e_lA2')
      )
    ).toThrow(/already applied/);
  });
});
