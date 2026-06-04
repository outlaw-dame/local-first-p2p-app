/**
 * Phase 1.71 — Block-evasion hardening adversarial tests.
 *
 * Two pieces are exercised here:
 *
 *  1. Phase 1.71.A keyword-match normalization:
 *     - NFKC + lowercase + zero-width strip + ASCII confusables map
 *       are applied to BOTH haystack and needle.
 *     - The selector should hide / collapse content that has been
 *       deliberately obfuscated to evade a literal-character mute.
 *
 *  2. Phase 1.71.B report-rate cap:
 *     - `applyReportAppealEvent` enforces a per-(reporter, subject,
 *       UTC day) cap with `TS_REPORT_RATE_LIMITED`.
 *     - Idempotency dedup still wins (a duplicate idempotencyKey is
 *       a no-op and does NOT consume budget).
 *     - The cap is opt-out via `options.maxReportsPerReporterSubjectDay`.
 *     - The cap is per-(reporter, subject, UTC day): bumping any
 *       coordinate resets the counter.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_REPORTS_PER_REPORTER_SUBJECT_DAY,
  applyLocalControlEvent,
  applyReportAppealEvent,
  createEmptyLocalControlState,
  createEmptyReportsAppealsState,
  decideVisibility,
  validateLocalControlEvent
} from '../index.js';
import type {
  LocalControlEvent,
  LocalControlState,
  ReportAppealEvent
} from '../index.js';

// ---------------------------------------------------------------------------
// 1) Phase 1.71.A — Unicode normalization on the match path
// ---------------------------------------------------------------------------

function muteEvent(
  eventId: string,
  keyword: string,
  matchKind: 'substring' | 'word' | 'phrase' | 'hashtag'
): LocalControlEvent {
  return validateLocalControlEvent({
    version: 'lfp2p.local-control-event.v1',
    eventId,
    createdAt: '2026-06-03T00:00:00Z',
    action: 'apply',
    kind: 'safety.keyword.muted',
    keyword,
    matchKind
  });
}

function stateWithMute(
  keyword: string,
  matchKind: 'substring' | 'word' | 'phrase' | 'hashtag'
): LocalControlState {
  return applyLocalControlEvent(
    createEmptyLocalControlState(),
    muteEvent(`evt_p171_${matchKind}_${keyword}`, keyword, matchKind)
  );
}

describe('Phase 1.71.A — substring matcher: Unicode-evasion resistance', () => {
  const s = stateWithMute('spoiler', 'substring');

  it('matches the literal form (control)', () => {
    expect(decideVisibility(s, { text: 'this is a spoiler' })).toBe('collapse');
  });

  it('matches leet-speak digit substitution (sp0iler)', () => {
    expect(decideVisibility(s, { text: 'careful: sp0iler ahead' })).toBe('collapse');
  });

  it('matches zero-width space insertion (sp\\u200Boiler)', () => {
    expect(decideVisibility(s, { text: 'careful: sp​oiler ahead' })).toBe(
      'collapse'
    );
  });

  it('matches zero-width joiner insertion', () => {
    expect(decideVisibility(s, { text: 'careful: sp‍oiler ahead' })).toBe(
      'collapse'
    );
  });

  it('matches Cyrillic homoglyph substitution (ѕpoiler — Cyrillic ѕ)', () => {
    expect(decideVisibility(s, { text: 'careful: ѕpoiler ahead' })).toBe('collapse');
  });

  it('matches full-width Unicode (ＳＰＯＩＬＥＲ)', () => {
    expect(decideVisibility(s, { text: 'careful: ＳＰＯＩＬＥＲ ahead' })).toBe(
      'collapse'
    );
  });

  it('matches mixed evasions stacked (sp\\u200B0îler with combining mark)', () => {
    // NFKC composes the combining mark; zero-width is stripped; the
    // confusables map turns 0→o.
    expect(decideVisibility(s, { text: 'careful: sp​0îler ahead' })).toBe(
      'collapse'
    );
  });

  it('does NOT match unrelated content with similar substrings', () => {
    expect(decideVisibility(s, { text: 'totally normal post' })).toBe('show');
    expect(decideVisibility(s, { text: 'a spool of yarn' })).toBe('show');
  });
});

describe('Phase 1.71.A — word matcher: boundary still enforced after normalization', () => {
  const s = stateWithMute('rage', 'word');

  it('matches the literal token', () => {
    expect(decideVisibility(s, { text: 'pure rage today' })).toBe('collapse');
  });

  it('matches the leet form as a token (r4ge)', () => {
    expect(decideVisibility(s, { text: 'pure r4ge today' })).toBe('collapse');
  });

  it('does NOT match a longer word that contains rage as a substring', () => {
    expect(decideVisibility(s, { text: 'the average is fine' })).toBe('show');
  });
});

describe('Phase 1.71.A — hashtag matcher: normalized tag tokens', () => {
  const s = stateWithMute('spoilers', 'hashtag');

  it('matches a normal #spoilers tag', () => {
    expect(decideVisibility(s, { text: 'look here #spoilers' })).toBe('collapse');
  });

  it('matches a homoglyph hashtag (#ѕpoilers)', () => {
    expect(decideVisibility(s, { text: 'look here #ѕpoilers' })).toBe('collapse');
  });

  it('matches a leet hashtag (#sp0ilers)', () => {
    expect(decideVisibility(s, { text: 'look here #sp0ilers' })).toBe('collapse');
  });

  it('does NOT match a longer hashtag with the term as prefix', () => {
    expect(decideVisibility(s, { text: 'look here #spoilersgalore' })).toBe('show');
  });
});

describe('Phase 1.71.A — phrase matcher: whitespace + Unicode evasion', () => {
  const s = stateWithMute('election fraud', 'phrase');

  it('matches the literal phrase', () => {
    expect(decideVisibility(s, { text: 'they claim election fraud again' })).toBe(
      'collapse'
    );
  });

  it('matches a leet/zero-width-spaced variant', () => {
    expect(
      decideVisibility(s, { text: 'they claim el3ction fr​aud again' })
    ).toBe('collapse');
  });

  it('matches whitespace-collapsed runs', () => {
    expect(decideVisibility(s, { text: 'election    fraud claims' })).toBe(
      'collapse'
    );
  });

  it('does NOT match when only a subset appears', () => {
    expect(decideVisibility(s, { text: 'the election was uneventful' })).toBe(
      'show'
    );
  });
});

describe('Phase 1.71.A — combined block + keyword evasion (defense-in-depth)', () => {
  it('a blocked actor PLUS a leet-spoofed keyword still resolves to hide', () => {
    const blocked = validateLocalControlEvent({
      version: 'lfp2p.local-control-event.v1',
      eventId: 'evt_p171_block_combo',
      createdAt: '2026-06-03T00:00:00Z',
      action: 'apply',
      kind: 'safety.account.blocked',
      targetActorId: 'actor_attacker'
    });
    const muted = muteEvent('evt_p171_kw_combo', 'spoiler', 'substring');
    let state = createEmptyLocalControlState();
    state = applyLocalControlEvent(state, blocked);
    state = applyLocalControlEvent(state, muted);

    const decision = decideVisibility(state, {
      actorId: 'actor_attacker',
      text: 'careful: sp0iler ahead'
    });
    // Block alone is enough; mute alone is enough; together still hide.
    expect(decision).toBe('hide');
  });
});

describe('Phase 1.71.A — performance / DoS resistance', () => {
  it('linear-time on pathological zero-width-padded haystacks', () => {
    const s = stateWithMute('spoiler', 'substring');
    const huge = 'a' + '​'.repeat(20000) + 'b';
    const t0 = Date.now();
    decideVisibility(s, { text: huge });
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it('linear-time on long full-width-padded haystacks', () => {
    const s = stateWithMute('spoiler', 'substring');
    // Full-width digit U+FF10 (0) repeated.
    const huge = 'spo' + '０'.repeat(20000) + 'iler';
    const t0 = Date.now();
    decideVisibility(s, { text: huge });
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// 2) Phase 1.71.B — report rate cap
// ---------------------------------------------------------------------------

function buildReportEvent(input: {
  eventId: string;
  reportId: string;
  idempotencyKey: string;
  createdAt: string;
  reporterActorId?: string;
  subjectEventId?: string;
}): ReportAppealEvent {
  return {
    version: 'lfp2p.report-appeal-event.v1',
    eventId: input.eventId,
    createdAt: input.createdAt,
    kind: 'safety.report.created',
    report: {
      version: 'lfp2p.safety-report.v1',
      reportId: input.reportId,
      reporter: {
        kind: 'actor',
        actor: { actorId: input.reporterActorId ?? 'actor_reporter' }
      },
      subject: {
        type: 'event',
        eventId: input.subjectEventId ?? 'event_target_xyz'
      },
      targetAuthority: {
        version: 'lfp2p.safety-authority.v1',
        authorityId: 'auth_mod_1',
        actorId: 'actor_mod',
        role: 'moderator',
        scope: 'community-local',
        createdAt: '2026-05-01T00:00:00Z'
      },
      reasonCode: 'abuse.harassment',
      scope: 'community-local',
      idempotencyKey: input.idempotencyKey,
      createdAt: input.createdAt,
      reporterPrivacy: 'identified-to-authority'
    }
  } as unknown as ReportAppealEvent;
}

describe('Phase 1.71.B — report-rate cap default behavior', () => {
  it('accepts up to the default cap', () => {
    let state = createEmptyReportsAppealsState();
    for (let i = 0; i < DEFAULT_MAX_REPORTS_PER_REPORTER_SUBJECT_DAY; i += 1) {
      state = applyReportAppealEvent(
        state,
        buildReportEvent({
          eventId: `evt_rep_${i}`,
          reportId: `report_${i}`,
          idempotencyKey: `idem_${i}`,
          createdAt: '2026-06-03T10:00:00Z'
        })
      );
    }
    expect(Object.keys(state.byReportId).length).toBe(
      DEFAULT_MAX_REPORTS_PER_REPORTER_SUBJECT_DAY
    );
  });

  it('throws TS_REPORT_RATE_LIMITED on the one over the cap', () => {
    let state = createEmptyReportsAppealsState();
    for (let i = 0; i < DEFAULT_MAX_REPORTS_PER_REPORTER_SUBJECT_DAY; i += 1) {
      state = applyReportAppealEvent(
        state,
        buildReportEvent({
          eventId: `evt_rep_${i}`,
          reportId: `report_${i}`,
          idempotencyKey: `idem_${i}`,
          createdAt: '2026-06-03T10:00:00Z'
        })
      );
    }
    expect(() =>
      applyReportAppealEvent(
        state,
        buildReportEvent({
          eventId: 'evt_rep_over',
          reportId: 'report_over',
          idempotencyKey: 'idem_over',
          createdAt: '2026-06-03T10:00:00Z'
        })
      )
    ).toThrow(/TS_REPORT_RATE_LIMITED/);
  });

  it('idempotency dedup does NOT consume budget', () => {
    let state = createEmptyReportsAppealsState();
    // Same idempotencyKey replayed many times = still one report.
    for (let i = 0; i < 100; i += 1) {
      state = applyReportAppealEvent(
        state,
        buildReportEvent({
          eventId: `evt_rep_dup_${i}`,
          reportId: 'report_dup',
          idempotencyKey: 'idem_dup',
          createdAt: '2026-06-03T10:00:00Z'
        })
      );
    }
    expect(Object.keys(state.byReportId).length).toBe(1);
    // We can still file (cap - 1) more distinct ones.
    for (let i = 0; i < DEFAULT_MAX_REPORTS_PER_REPORTER_SUBJECT_DAY - 1; i += 1) {
      state = applyReportAppealEvent(
        state,
        buildReportEvent({
          eventId: `evt_rep_more_${i}`,
          reportId: `report_more_${i}`,
          idempotencyKey: `idem_more_${i}`,
          createdAt: '2026-06-03T10:00:00Z'
        })
      );
    }
    expect(Object.keys(state.byReportId).length).toBe(
      DEFAULT_MAX_REPORTS_PER_REPORTER_SUBJECT_DAY
    );
  });

  it('replay of the SAME eventId does not consume budget either', () => {
    let state = createEmptyReportsAppealsState();
    const e = buildReportEvent({
      eventId: 'evt_rep_replay',
      reportId: 'report_replay',
      idempotencyKey: 'idem_replay',
      createdAt: '2026-06-03T10:00:00Z'
    });
    for (let i = 0; i < 50; i += 1) {
      state = applyReportAppealEvent(state, e);
    }
    expect(Object.keys(state.byReportId).length).toBe(1);
  });
});

describe('Phase 1.71.B — report-rate cap: cap key partitioning', () => {
  function fillBucket(args: {
    state: ReturnType<typeof createEmptyReportsAppealsState>;
    reporterActorId?: string;
    subjectEventId?: string;
    createdAt: string;
    prefix: string;
  }): ReturnType<typeof createEmptyReportsAppealsState> {
    let s = args.state;
    for (let i = 0; i < DEFAULT_MAX_REPORTS_PER_REPORTER_SUBJECT_DAY; i += 1) {
      s = applyReportAppealEvent(
        s,
        buildReportEvent({
          eventId: `evt_${args.prefix}_${i}`,
          reportId: `report_${args.prefix}_${i}`,
          idempotencyKey: `idem_${args.prefix}_${i}`,
          createdAt: args.createdAt,
          ...(args.reporterActorId === undefined
            ? {}
            : { reporterActorId: args.reporterActorId }),
          ...(args.subjectEventId === undefined
            ? {}
            : { subjectEventId: args.subjectEventId })
        })
      );
    }
    return s;
  }

  it('cap resets per UTC day', () => {
    let state = fillBucket({
      state: createEmptyReportsAppealsState(),
      createdAt: '2026-06-03T23:59:00Z',
      prefix: 'd1'
    });
    // The 11th in the same UTC day fails…
    expect(() =>
      applyReportAppealEvent(
        state,
        buildReportEvent({
          eventId: 'evt_d1_over',
          reportId: 'report_d1_over',
          idempotencyKey: 'idem_d1_over',
          createdAt: '2026-06-03T23:59:30Z'
        })
      )
    ).toThrow(/TS_REPORT_RATE_LIMITED/);
    // …but the next UTC day starts fresh.
    state = applyReportAppealEvent(
      state,
      buildReportEvent({
        eventId: 'evt_d2_first',
        reportId: 'report_d2_first',
        idempotencyKey: 'idem_d2_first',
        createdAt: '2026-06-04T00:00:01Z'
      })
    );
    expect(state.byReportId['report_d2_first']).toBeDefined();
  });

  it('cap is per-subject: a fresh subject gets its own budget', () => {
    let state = fillBucket({
      state: createEmptyReportsAppealsState(),
      subjectEventId: 'event_A',
      createdAt: '2026-06-03T10:00:00Z',
      prefix: 'A'
    });
    // Different subject → fresh budget.
    state = applyReportAppealEvent(
      state,
      buildReportEvent({
        eventId: 'evt_B_first',
        reportId: 'report_B_first',
        idempotencyKey: 'idem_B_first',
        createdAt: '2026-06-03T10:00:00Z',
        subjectEventId: 'event_B'
      })
    );
    expect(state.byReportId['report_B_first']).toBeDefined();
  });

  it('cap is per-reporter: a different reporter has its own budget', () => {
    let state = fillBucket({
      state: createEmptyReportsAppealsState(),
      reporterActorId: 'actor_attacker',
      createdAt: '2026-06-03T10:00:00Z',
      prefix: 'attacker'
    });
    // Different reporter → fresh budget against the same subject.
    state = applyReportAppealEvent(
      state,
      buildReportEvent({
        eventId: 'evt_other_first',
        reportId: 'report_other_first',
        idempotencyKey: 'idem_other_first',
        createdAt: '2026-06-03T10:00:00Z',
        reporterActorId: 'actor_legit'
      })
    );
    expect(state.byReportId['report_other_first']).toBeDefined();
  });
});

describe('Phase 1.71.B — report-rate cap: bucket-key hardening', () => {
  it('an attacker-crafted actorId containing the delimiter cannot collide with a legitimate bucket', () => {
    // Legitimate combo: reporter=actor_alice, subject=event_X, day=2026-06-03.
    let state = createEmptyReportsAppealsState();
    for (let i = 0; i < DEFAULT_MAX_REPORTS_PER_REPORTER_SUBJECT_DAY; i += 1) {
      state = applyReportAppealEvent(
        state,
        buildReportEvent({
          eventId: `evt_legit_${i}`,
          reportId: `report_legit_${i}`,
          idempotencyKey: `idem_legit_${i}`,
          createdAt: '2026-06-03T10:00:00Z',
          reporterActorId: 'actor_alice',
          subjectEventId: 'event_X'
        })
      );
    }
    // Attacker crafts an actorId that, under a naive `::`-joined key,
    // would produce the same bucket key. With JSON-encoded composite
    // keys this MUST land in the attacker's own bucket (fresh budget),
    // not in actor_alice's.
    const result = applyReportAppealEvent(
      state,
      buildReportEvent({
        eventId: 'evt_attacker',
        reportId: 'report_attacker',
        idempotencyKey: 'idem_attacker',
        createdAt: '2026-06-03T10:00:00Z',
        reporterActorId: 'alice"]::2026-06-03"::event_X',
        subjectEventId: 'event_X'
      })
    );
    expect(result.byReportId['report_attacker']).toBeDefined();
  });
});

describe('Phase 1.71.B — report-rate cap: configurable + opt-out', () => {
  it('respects a custom cap', () => {
    let state = createEmptyReportsAppealsState();
    const cap = 3;
    for (let i = 0; i < cap; i += 1) {
      state = applyReportAppealEvent(
        state,
        buildReportEvent({
          eventId: `evt_cap_${i}`,
          reportId: `report_cap_${i}`,
          idempotencyKey: `idem_cap_${i}`,
          createdAt: '2026-06-03T10:00:00Z'
        }),
        'applyReportAppealEvent',
        { maxReportsPerReporterSubjectDay: cap }
      );
    }
    expect(() =>
      applyReportAppealEvent(
        state,
        buildReportEvent({
          eventId: 'evt_cap_over',
          reportId: 'report_cap_over',
          idempotencyKey: 'idem_cap_over',
          createdAt: '2026-06-03T10:00:00Z'
        }),
        'applyReportAppealEvent',
        { maxReportsPerReporterSubjectDay: cap }
      )
    ).toThrow(/TS_REPORT_RATE_LIMITED/);
  });

  it('disables the cap when set to Infinity', () => {
    let state = createEmptyReportsAppealsState();
    const N = DEFAULT_MAX_REPORTS_PER_REPORTER_SUBJECT_DAY + 5;
    for (let i = 0; i < N; i += 1) {
      state = applyReportAppealEvent(
        state,
        buildReportEvent({
          eventId: `evt_inf_${i}`,
          reportId: `report_inf_${i}`,
          idempotencyKey: `idem_inf_${i}`,
          createdAt: '2026-06-03T10:00:00Z'
        }),
        'applyReportAppealEvent',
        { maxReportsPerReporterSubjectDay: Infinity }
      );
    }
    expect(Object.keys(state.byReportId).length).toBe(N);
  });
});
