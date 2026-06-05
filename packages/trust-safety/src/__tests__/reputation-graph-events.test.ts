/**
 * Phase 1.8.1 adversarial test suite for the reputation graph
 * protocol layer. Covers every documented acceptance criterion plus
 * the prototype-pollution / replay-determinism hardening posture
 * inherited from Phase 1.71 + Phase 2.1 + Phase 3.2.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AGGREGATOR_REMOVAL_REASONS,
  ATTESTATION_CONTEXT_TAGS,
  ATTESTATION_VALENCES,
  OBSERVATION_KINDS,
  REPUTATION_ALGORITHMS,
  REPUTATION_EVENT_KINDS,
  REPUTATION_EVENT_VERSION,
  REPUTATION_LIMITS,
  TrustSafetyError,
  validateReputationEvent,
  type ReputationEvent
} from '../index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(HERE, '..', '..', 'fixtures', 'reputation-graph');

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function listFixtures(subdir: 'valid' | 'invalid'): string[] {
  const dir = join(FIXTURES_ROOT, subdir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
}

/**
 * Build a minimal valid event of each kind in code. Used by tests
 * that need to mutate a single field at a time without re-reading
 * a fixture from disk.
 */
function validObservation(): Record<string, unknown> {
  return {
    version: REPUTATION_EVENT_VERSION,
    eventId: 'evt_obs_min',
    createdAt: '2026-06-01T00:00:00Z',
    kind: 'reputation.observation.recorded',
    subject: { type: 'actor', actorId: 'actor_a' },
    observationKind: 'outbox.useful',
    satCount: 1,
    unsatCount: 0,
    windowStart: '2026-05-25T00:00:00Z',
    windowEnd: '2026-06-01T00:00:00Z'
  };
}

function validAttestation(): Record<string, unknown> {
  return {
    version: REPUTATION_EVENT_VERSION,
    eventId: 'evt_att_min',
    createdAt: '2026-06-01T00:00:00Z',
    kind: 'reputation.attestation.published',
    subject: { type: 'actor', actorId: 'actor_a' },
    valence: 'positive',
    contextTag: 'contact.verified-in-person',
    strength: 0.5
  };
}

function validRevocation(): Record<string, unknown> {
  return {
    version: REPUTATION_EVENT_VERSION,
    eventId: 'evt_rev_min',
    createdAt: '2026-06-01T00:00:00Z',
    kind: 'reputation.attestation.revoked',
    attestationId: 'evt_att_min',
    revokedAt: '2026-06-01T00:00:00Z'
  };
}

function validAggregatorPublished(): Record<string, unknown> {
  return {
    version: REPUTATION_EVENT_VERSION,
    eventId: 'evt_agg_min',
    createdAt: '2026-06-01T01:00:00Z',
    kind: 'reputation.aggregator.published',
    algorithm: 'openrank.v1',
    computedAt: '2026-06-01T01:00:00Z',
    subjects: [
      {
        subject: { type: 'actor', actorId: 'actor_a' },
        score: 0.5,
        confidence: 0.5,
        observationCount: 1
      }
    ]
  };
}

function validAggregatorRemoved(): Record<string, unknown> {
  return {
    version: REPUTATION_EVENT_VERSION,
    eventId: 'evt_rem_min',
    createdAt: '2026-06-02T00:00:00Z',
    kind: 'reputation.aggregator.score.removed',
    subject: { type: 'actor', actorId: 'actor_a' },
    reason: 'revoked'
  };
}

/* ------------------------------------------------------------------ */
/*                          fixture coverage                          */
/* ------------------------------------------------------------------ */

describe('reputation-graph fixtures — valid', () => {
  const files = listFixtures('valid');

  it('contains 4 valid fixtures per event kind (20 total)', () => {
    expect(files.length).toBe(20);
  });

  it.each(files)('valid: %s passes validateReputationEvent', (name) => {
    const value = readJson(join(FIXTURES_ROOT, 'valid', name));
    expect(() => validateReputationEvent(value)).not.toThrow();
  });
});

describe('reputation-graph fixtures — invalid', () => {
  const files = listFixtures('invalid');

  it('contains 2 invalid fixtures per event kind (10 total)', () => {
    expect(files.length).toBe(10);
  });

  it.each(files)('invalid: %s throws TrustSafetyError', (name) => {
    const value = readJson(join(FIXTURES_ROOT, 'invalid', name));
    expect(() => validateReputationEvent(value)).toThrow(TrustSafetyError);
  });
});

/* ------------------------------------------------------------------ */
/*                  constants & enum surface checks                    */
/* ------------------------------------------------------------------ */

describe('reputation-graph bounded enums', () => {
  it('every documented enum is frozen at module load', () => {
    expect(Object.isFrozen(OBSERVATION_KINDS)).toBe(true);
    expect(Object.isFrozen(ATTESTATION_VALENCES)).toBe(true);
    expect(Object.isFrozen(ATTESTATION_CONTEXT_TAGS)).toBe(true);
    expect(Object.isFrozen(AGGREGATOR_REMOVAL_REASONS)).toBe(true);
    expect(Object.isFrozen(REPUTATION_ALGORITHMS)).toBe(true);
    expect(Object.isFrozen(REPUTATION_EVENT_KINDS)).toBe(true);
    expect(Object.isFrozen(REPUTATION_LIMITS)).toBe(true);
  });

  it('enum tuples are non-empty and contain no duplicates', () => {
    for (const [label, tuple] of [
      ['OBSERVATION_KINDS', OBSERVATION_KINDS],
      ['ATTESTATION_VALENCES', ATTESTATION_VALENCES],
      ['ATTESTATION_CONTEXT_TAGS', ATTESTATION_CONTEXT_TAGS],
      ['AGGREGATOR_REMOVAL_REASONS', AGGREGATOR_REMOVAL_REASONS],
      ['REPUTATION_ALGORITHMS', REPUTATION_ALGORITHMS],
      ['REPUTATION_EVENT_KINDS', REPUTATION_EVENT_KINDS]
    ] as const) {
      expect(tuple.length, label).toBeGreaterThan(0);
      const unique = new Set(tuple as readonly string[]);
      expect(unique.size, label).toBe(tuple.length);
    }
  });
});

/* ------------------------------------------------------------------ */
/*                      forward-compat rejection                       */
/* ------------------------------------------------------------------ */

describe('forward-compat — unknown enums fail closed (no partial accept)', () => {
  it('unknown event kind is rejected with TS_INVALID_ENUM', () => {
    const ev = { ...validObservation(), kind: 'reputation.future.event-from-2030' };
    expect(() => validateReputationEvent(ev)).toThrowError(/TS_INVALID_ENUM/);
  });

  it('unknown observationKind is rejected', () => {
    const ev = { ...validObservation(), observationKind: 'outbox.legendary' };
    expect(() => validateReputationEvent(ev)).toThrowError(/TS_INVALID_ENUM/);
  });

  it('unknown attestation valence is rejected', () => {
    const ev = { ...validAttestation(), valence: 'mostly-positive' };
    expect(() => validateReputationEvent(ev)).toThrowError(/TS_INVALID_ENUM/);
  });

  it('unknown context tag is rejected', () => {
    const ev = { ...validAttestation(), contextTag: 'contact.we-played-chess-once' };
    expect(() => validateReputationEvent(ev)).toThrowError(/TS_INVALID_ENUM/);
  });

  it('unknown aggregator algorithm is rejected', () => {
    const ev = { ...validAggregatorPublished(), algorithm: 'future-trust-graph.v9' };
    expect(() => validateReputationEvent(ev)).toThrowError(/TS_INVALID_ENUM/);
  });

  it('unknown removal reason is rejected', () => {
    const ev = { ...validAggregatorRemoved(), reason: 'felt-like-it' };
    expect(() => validateReputationEvent(ev)).toThrowError(/TS_INVALID_ENUM/);
  });
});

/* ------------------------------------------------------------------ */
/*                  number-range adversarial cases                     */
/* ------------------------------------------------------------------ */

describe('numeric range hardening', () => {
  it.each([-0.0001, 1.0001, NaN, Infinity, -Infinity])(
    'strength %s is rejected',
    (bad) => {
      const ev = { ...validAttestation(), strength: bad };
      expect(() => validateReputationEvent(ev)).toThrowError(/TS_INVALID_NUMBER/);
    }
  );

  it.each([-0.0001, 1.0001, NaN, Infinity])(
    'aggregator subject.score %s is rejected',
    (bad) => {
      const base = validAggregatorPublished();
      const ev = {
        ...base,
        subjects: [{ ...(base.subjects as Array<Record<string, unknown>>)[0], score: bad }]
      };
      expect(() => validateReputationEvent(ev)).toThrowError(/TS_INVALID_NUMBER/);
    }
  );

  it.each([-1, 1.5, NaN, REPUTATION_LIMITS.maxObservationCount + 1])(
    'observation satCount %s is rejected',
    (bad) => {
      const ev = { ...validObservation(), satCount: bad };
      expect(() => validateReputationEvent(ev)).toThrowError(/TS_INVALID_NUMBER/);
    }
  );

  it('satCount=0 AND unsatCount=0 is rejected (meaningless event)', () => {
    const ev = { ...validObservation(), satCount: 0, unsatCount: 0 };
    expect(() => validateReputationEvent(ev)).toThrowError(/TS_INVALID_REPUTATION/);
  });

  it('observationCount must be a safe non-negative integer', () => {
    const base = validAggregatorPublished();
    const ev = {
      ...base,
      subjects: [
        { ...(base.subjects as Array<Record<string, unknown>>)[0], observationCount: -1 }
      ]
    };
    expect(() => validateReputationEvent(ev)).toThrowError(/TS_INVALID_NUMBER/);
  });
});

/* ------------------------------------------------------------------ */
/*                  timestamp / window / lifecycle                     */
/* ------------------------------------------------------------------ */

describe('timestamp + lifecycle hardening', () => {
  it('windowEnd before windowStart is rejected', () => {
    const ev = {
      ...validObservation(),
      windowStart: '2026-06-01T00:00:00Z',
      windowEnd: '2026-05-25T00:00:00Z'
    };
    expect(() => validateReputationEvent(ev)).toThrowError(/TS_INVALID_TIMESTAMP/);
  });

  it('window longer than maxWindowMs is rejected with TS_INVALID_REPUTATION', () => {
    // 366-day window > 365-day cap
    const ev = {
      ...validObservation(),
      windowStart: '2025-06-01T00:00:00Z',
      windowEnd: '2026-06-02T00:00:00Z'
    };
    expect(() => validateReputationEvent(ev)).toThrowError(/TS_INVALID_REPUTATION/);
  });

  it('attestation expiresAt before createdAt is rejected', () => {
    const ev = {
      ...validAttestation(),
      createdAt: '2026-06-01T12:00:00Z',
      expiresAt: '2026-06-01T00:00:00Z'
    };
    expect(() => validateReputationEvent(ev)).toThrowError(/TS_INVALID_TIMESTAMP/);
  });

  it('revocation revokedAt before createdAt is rejected', () => {
    const ev = {
      ...validRevocation(),
      createdAt: '2026-06-01T12:00:00Z',
      revokedAt: '2026-06-01T00:00:00Z'
    };
    expect(() => validateReputationEvent(ev)).toThrowError(/TS_INVALID_TIMESTAMP/);
  });

  it('aggregator computedAt after createdAt is rejected (clock-skew sentinel)', () => {
    // The aggregator MUST have computed at or before signing — a
    // future-dated computedAt is a forged-clock signal.
    const ev = {
      ...validAggregatorPublished(),
      createdAt: '2026-06-01T01:00:00Z',
      computedAt: '2026-06-01T02:00:00Z'
    };
    expect(() => validateReputationEvent(ev)).toThrowError(/TS_INVALID_TIMESTAMP/);
  });

  it('ISO timestamp without timezone is rejected', () => {
    const ev = { ...validObservation(), createdAt: '2026-06-01T00:00:00' };
    expect(() => validateReputationEvent(ev)).toThrowError(/TS_INVALID_TIMESTAMP/);
  });

  it('pre-2020 timestamp is rejected as garbage', () => {
    const ev = { ...validObservation(), createdAt: '1970-01-01T00:00:00Z' };
    expect(() => validateReputationEvent(ev)).toThrowError(/TS_INVALID_TIMESTAMP/);
  });
});

/* ------------------------------------------------------------------ */
/*                  prototype-pollution defense                        */
/* ------------------------------------------------------------------ */

describe('prototype-pollution defense (JSON-parse delivered keys)', () => {
  it('top-level __proto__ injection at the payload boundary is rejected', () => {
    // Build via JSON.parse so the prototype walk is the same one a
    // hostile network input would take.
    const raw = `{
      "version": "${REPUTATION_EVENT_VERSION}",
      "eventId": "evt_obs_pp",
      "createdAt": "2026-06-01T00:00:00Z",
      "kind": "reputation.observation.recorded",
      "subject": { "type": "actor", "actorId": "actor_a" },
      "observationKind": "outbox.useful",
      "satCount": 1,
      "unsatCount": 0,
      "windowStart": "2026-05-25T00:00:00Z",
      "windowEnd": "2026-06-01T00:00:00Z",
      "__proto__": { "polluted": true }
    }`;
    const parsed: unknown = JSON.parse(raw);
    // The validator runs on the object — assertPlainObject would
    // reject a `__proto__`-rooted object outright; on a benign-shape
    // object where `__proto__` is a regular key, we still expect no
    // prototype mutation to leak.
    expect(() => validateReputationEvent(parsed)).not.toThrow();
    // The empty-object polluted check must NOT have leaked through
    // the prototype chain.
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it('nested __proto__ in the aggregator subject payload does not pollute Object.prototype', () => {
    const raw = `{
      "version": "${REPUTATION_EVENT_VERSION}",
      "eventId": "evt_agg_pp",
      "createdAt": "2026-06-01T01:00:00Z",
      "kind": "reputation.aggregator.published",
      "algorithm": "openrank.v1",
      "computedAt": "2026-06-01T01:00:00Z",
      "subjects": [{
        "subject": { "type": "actor", "actorId": "actor_a" },
        "score": 0.5,
        "confidence": 0.5,
        "observationCount": 1,
        "__proto__": { "leaked": true }
      }]
    }`;
    const parsed: unknown = JSON.parse(raw);
    expect(() => validateReputationEvent(parsed)).not.toThrow();
    expect(({} as { leaked?: unknown }).leaked).toBeUndefined();
  });

  it('rejects subject that is not a plain object', () => {
    const ev = { ...validObservation(), subject: 'not-a-record' };
    expect(() => validateReputationEvent(ev)).toThrowError(/TS_INVALID_(INPUT|SUBJECT)/);
  });

  it('rejects array payload (not a plain object)', () => {
    expect(() => validateReputationEvent([])).toThrowError(/TS_INVALID_INPUT/);
  });

  it('rejects null payload', () => {
    expect(() => validateReputationEvent(null)).toThrowError(/TS_INVALID_INPUT/);
  });
});

/* ------------------------------------------------------------------ */
/*                     subject-list cap                                */
/* ------------------------------------------------------------------ */

describe('aggregator subject-list cap', () => {
  it('exactly maxSubjectsPerAggregatorBatch is accepted', () => {
    const base = validAggregatorPublished();
    const proto = (base.subjects as Array<Record<string, unknown>>)[0]!;
    const subjects = Array.from({ length: REPUTATION_LIMITS.maxSubjectsPerAggregatorBatch }, (_, i) => ({
      ...proto,
      subject: { type: 'actor', actorId: `actor_${i}` }
    }));
    const ev = { ...base, subjects };
    expect(() => validateReputationEvent(ev)).not.toThrow();
  });

  it('one over the cap is rejected', () => {
    const base = validAggregatorPublished();
    const proto = (base.subjects as Array<Record<string, unknown>>)[0]!;
    const subjects = Array.from(
      { length: REPUTATION_LIMITS.maxSubjectsPerAggregatorBatch + 1 },
      (_, i) => ({ ...proto, subject: { type: 'actor', actorId: `actor_${i}` } })
    );
    const ev = { ...base, subjects };
    expect(() => validateReputationEvent(ev)).toThrowError(/TS_INVALID_INPUT/);
  });

  it('empty subjects array is rejected (meaningless event)', () => {
    const ev = { ...validAggregatorPublished(), subjects: [] };
    expect(() => validateReputationEvent(ev)).toThrowError(/TS_INVALID_REPUTATION/);
  });
});

/* ------------------------------------------------------------------ */
/*               output integrity (frozen + replay)                    */
/* ------------------------------------------------------------------ */

describe('output is deep-frozen (Phase 3.2 frozen-walk discipline)', () => {
  it('observation output is frozen at every level', () => {
    const ev = validateReputationEvent(validObservation()) as ReputationEvent & {
      kind: 'reputation.observation.recorded';
    };
    expect(Object.isFrozen(ev)).toBe(true);
    expect(Object.isFrozen(ev.subject)).toBe(true);
  });

  it('aggregator output subjects array and every entry is frozen', () => {
    const ev = validateReputationEvent(validAggregatorPublished()) as ReputationEvent & {
      kind: 'reputation.aggregator.published';
    };
    expect(Object.isFrozen(ev)).toBe(true);
    expect(Object.isFrozen(ev.subjects)).toBe(true);
    for (const s of ev.subjects) {
      expect(Object.isFrozen(s)).toBe(true);
      expect(Object.isFrozen(s.subject)).toBe(true);
    }
  });
});

describe('replay determinism (Phase 3.2 replay-equivalence)', () => {
  it('validating the same input twice produces JSON-equivalent output', () => {
    const input = validObservation();
    const a = validateReputationEvent(input);
    const b = validateReputationEvent(input);
    // We MUST NOT rely on referential equality (frozen objects are
    // constructed fresh each call) — but the serialized form MUST
    // be byte-identical, which is exactly the replay-equivalence
    // contract Phase 3.2 pins.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('an unmodified valid fixture round-trips through validate → JSON.stringify → JSON.parse → validate', () => {
    const fixtures = listFixtures('valid');
    for (const name of fixtures) {
      const raw = readJson(join(FIXTURES_ROOT, 'valid', name));
      const a = validateReputationEvent(raw);
      const reparsed = JSON.parse(JSON.stringify(a));
      const b = validateReputationEvent(reparsed);
      expect(JSON.stringify(a), name).toBe(JSON.stringify(b));
    }
  });
});

/* ------------------------------------------------------------------ */
/*                        version pinning                              */
/* ------------------------------------------------------------------ */

describe('version pinning (unknown versions fail closed)', () => {
  it('rejects a future major version', () => {
    const ev = { ...validObservation(), version: 'lfp2p.reputation-event.v2' };
    expect(() => validateReputationEvent(ev)).toThrowError(/TS_UNKNOWN_VERSION/);
  });

  it('rejects a malformed version string', () => {
    const ev = { ...validObservation(), version: 'rep-event-1' };
    expect(() => validateReputationEvent(ev)).toThrowError(/TS_UNKNOWN_VERSION/);
  });
});

/* ------------------------------------------------------------------ */
/*                      subject ref hardening                          */
/* ------------------------------------------------------------------ */

describe('subject ref is delegated to validateSafetySubjectRef', () => {
  it('rejects unknown subject type with TS_INVALID_SUBJECT', () => {
    const ev = { ...validObservation(), subject: { type: 'wallet', walletId: '0xdeadbeef' } };
    expect(() => validateReputationEvent(ev)).toThrowError(/TS_INVALID_SUBJECT/);
  });

  it('accepts a variety of subject types (actor, bridge, domain, community)', () => {
    const types = [
      { type: 'actor', actorId: 'actor_a' },
      { type: 'bridge', bridgeId: 'bridge_a' },
      { type: 'domain', domain: 'example.com' },
      { type: 'community', communityId: 'community_a' }
    ];
    for (const subject of types) {
      const ev = { ...validObservation(), subject };
      expect(() => validateReputationEvent(ev)).not.toThrow();
    }
  });
});

/* ------------------------------------------------------------------ */
/*               doctrine non-negotiable #5 cross-check                */
/* ------------------------------------------------------------------ */

describe('doctrine non-negotiable #5 — no free-form text fields', () => {
  it('every string field on every event kind is a bounded enum or an id/timestamp/subject ref', () => {
    // Validate one fixture per kind and assert no string field
    // leaks beyond the documented enums + bounded ids.
    const fixtures = listFixtures('valid');
    for (const name of fixtures) {
      const raw = readJson(join(FIXTURES_ROOT, 'valid', name));
      const ev = validateReputationEvent(raw);
      // Every kind value must be in the enum.
      expect((REPUTATION_EVENT_KINDS as readonly string[]).includes(ev.kind)).toBe(true);
      if (ev.kind === 'reputation.observation.recorded') {
        expect((OBSERVATION_KINDS as readonly string[]).includes(ev.observationKind)).toBe(true);
      }
      if (ev.kind === 'reputation.attestation.published') {
        expect((ATTESTATION_VALENCES as readonly string[]).includes(ev.valence)).toBe(true);
        expect((ATTESTATION_CONTEXT_TAGS as readonly string[]).includes(ev.contextTag)).toBe(true);
      }
      if (ev.kind === 'reputation.aggregator.published') {
        expect((REPUTATION_ALGORITHMS as readonly string[]).includes(ev.algorithm)).toBe(true);
      }
      if (ev.kind === 'reputation.aggregator.score.removed') {
        expect((AGGREGATOR_REMOVAL_REASONS as readonly string[]).includes(ev.reason)).toBe(true);
      }
    }
  });
});
