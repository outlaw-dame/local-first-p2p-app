/**
 * Adversarial tests for the read-only authority trust composition
 * layer (`trust-registry.ts`).
 *
 * Pinned guarantees (from `docs/protocol/trust-boundaries.md`):
 *
 *   1. The module exposes NO writable surface. There is no
 *      `setAuthorityTrust`, no `revokeAuthorityTrust`, no
 *      `markAuthorityCompromised`, no `isAuthorityTrusted` boolean
 *      predicate — these are explicitly absent. A test below
 *      imports the module's barrel and verifies the doctrine-
 *      forbidden symbols stay undefined.
 *
 *   2. A view's `worstCasePrecheck` is `'block'` iff at least one
 *      source surfaced a hard-fail signal. `'continue'` is NEVER a
 *      positive trust signal; absent resolvers contribute nothing.
 *
 *   3. The composition layer never mints sources. A resolver that
 *      returns a posture with the wrong `source` tag (e.g. a
 *      reputation resolver returning `{ source: 'capability', … }`)
 *      throws a `CapabilityError` — sources cannot be silently
 *      relabelled.
 *
 *   4. Pure + frozen output per Phase 3.2 replay/frozen-walk.
 */
import { describe, expect, it } from 'vitest';
import * as capabilities from '../index.js';
import {
  AUTHORITY_PRECHECK_OUTCOMES,
  AUTHORITY_PRECHECK_REASONS,
  AUTHORITY_VIEW_VERSION,
  CapabilityError,
  IDENTITY_POSTURE_STATES,
  REPUTATION_POSTURE_BANDS,
  composeAuthorityView,
  type CapabilityPartyRef,
  type CapabilityPosture,
  type IdentityPosture,
  type ReputationPosture
} from '../index.js';

const NOW = '2026-06-13T12:00:00.000Z';
const AUTHORITY: CapabilityPartyRef = { kind: 'controller', id: 'controller:damon' };

const capabilityAllow = (): CapabilityPosture => ({
  source: 'capability',
  decision: 'allow',
  capabilityIds: ['cap:room:1']
});
const capabilityDeny = (): CapabilityPosture => ({
  source: 'capability',
  decision: 'deny'
});
const reputationHigh = (): ReputationPosture => ({
  source: 'reputation',
  band: 'high'
});
const reputationUntrusted = (): ReputationPosture => ({
  source: 'reputation',
  band: 'untrusted'
});
const identityActive = (): IdentityPosture => ({
  source: 'identity-control',
  status: 'active'
});
const identityRevoked = (): IdentityPosture => ({
  source: 'identity-control',
  status: 'revoked'
});

/* -------------------------------------------------------------------------- */
/*       doctrine pin #1 — no writable surface, no boolean predicate          */
/* -------------------------------------------------------------------------- */

describe('trust-registry — doctrine non-negotiable: no writable surface', () => {
  it('does NOT export setAuthorityTrust / revokeAuthorityTrust / markAuthorityCompromised / isAuthorityTrusted', () => {
    // These violated `docs/protocol/trust-boundaries.md` ("MUST NOT
    // introduce a trustLevel that becomes an authority input"). Pin
    // their absence so a future commit that reintroduces them fails
    // CI here.
    const surface = capabilities as Record<string, unknown>;
    expect(surface.setAuthorityTrust).toBeUndefined();
    expect(surface.revokeAuthorityTrust).toBeUndefined();
    expect(surface.markAuthorityCompromised).toBeUndefined();
    expect(surface.isAuthorityTrusted).toBeUndefined();
    expect(surface.getAuthorityTrust).toBeUndefined();
    expect(surface.AuthorityTrustRecord).toBeUndefined();
    expect(surface.AUTHORITY_TRUST_STATES).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/*           pure compositional view — labelled per-source postures           */
/* -------------------------------------------------------------------------- */

describe('composeAuthorityView — labelled per-source postures', () => {
  it('returns a frozen, versioned view that records the composedAt timestamp', () => {
    const view = composeAuthorityView({ authority: AUTHORITY, now: NOW });
    expect(view.version).toBe(AUTHORITY_VIEW_VERSION);
    expect(view.version).toBe('lfp2p.capability.authority-view.v1');
    expect(view.authority.id).toBe('controller:damon');
    expect(view.composedAt).toBe(NOW);
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.blockReasons)).toBe(true);
  });

  it('omits a posture entirely when its resolver is not supplied (no default trust)', () => {
    const view = composeAuthorityView({ authority: AUTHORITY, now: NOW });
    expect(view.capabilityPosture).toBeUndefined();
    expect(view.reputationPosture).toBeUndefined();
    expect(view.identityPosture).toBeUndefined();
  });

  it('omits a posture when its resolver returns undefined (subsystem abstains)', () => {
    const view = composeAuthorityView({
      authority: AUTHORITY,
      now: NOW,
      resolveCapabilityPosture: () => undefined,
      resolveReputationPosture: () => undefined,
      resolveIdentityPosture: () => undefined
    });
    expect(view.capabilityPosture).toBeUndefined();
    expect(view.reputationPosture).toBeUndefined();
    expect(view.identityPosture).toBeUndefined();
  });

  it('forwards each resolver output verbatim with source labels intact', () => {
    const view = composeAuthorityView({
      authority: AUTHORITY,
      now: NOW,
      resolveCapabilityPosture: capabilityAllow,
      resolveReputationPosture: reputationHigh,
      resolveIdentityPosture: identityActive
    });
    expect(view.capabilityPosture?.source).toBe('capability');
    expect(view.capabilityPosture?.decision).toBe('allow');
    expect(view.capabilityPosture?.capabilityIds).toEqual(['cap:room:1']);
    expect(view.reputationPosture?.source).toBe('reputation');
    expect(view.reputationPosture?.band).toBe('high');
    expect(view.identityPosture?.source).toBe('identity-control');
    expect(view.identityPosture?.status).toBe('active');
  });
});

/* -------------------------------------------------------------------------- */
/*           worst-case pre-check — fail closed under hard signals            */
/* -------------------------------------------------------------------------- */

describe('worstCasePrecheck — fail closed iff a source says no', () => {
  it('all postures absent → continue (NOT a positive trust signal — just no hard fail surfaced)', () => {
    const view = composeAuthorityView({ authority: AUTHORITY, now: NOW });
    expect(view.worstCasePrecheck).toBe('continue');
    expect(view.blockReasons).toEqual([]);
  });

  it('every posture present and good → continue with empty blockReasons', () => {
    const view = composeAuthorityView({
      authority: AUTHORITY,
      now: NOW,
      resolveCapabilityPosture: capabilityAllow,
      resolveReputationPosture: reputationHigh,
      resolveIdentityPosture: identityActive
    });
    expect(view.worstCasePrecheck).toBe('continue');
    expect(view.blockReasons).toEqual([]);
  });

  it('capability decision deny → block with capability-deny reason', () => {
    const view = composeAuthorityView({
      authority: AUTHORITY,
      now: NOW,
      resolveCapabilityPosture: capabilityDeny
    });
    expect(view.worstCasePrecheck).toBe('block');
    expect(view.blockReasons).toEqual(['capability-deny']);
  });

  it('reputation untrusted → block with reputation-untrusted reason', () => {
    const view = composeAuthorityView({
      authority: AUTHORITY,
      now: NOW,
      resolveReputationPosture: reputationUntrusted
    });
    expect(view.worstCasePrecheck).toBe('block');
    expect(view.blockReasons).toEqual(['reputation-untrusted']);
  });

  it('identity revoked → block with identity-not-active reason', () => {
    const view = composeAuthorityView({
      authority: AUTHORITY,
      now: NOW,
      resolveIdentityPosture: identityRevoked
    });
    expect(view.worstCasePrecheck).toBe('block');
    expect(view.blockReasons).toEqual(['identity-not-active']);
  });

  it('multiple sources blocking → all reasons surface, in deterministic order', () => {
    const view = composeAuthorityView({
      authority: AUTHORITY,
      now: NOW,
      resolveCapabilityPosture: capabilityDeny,
      resolveReputationPosture: reputationUntrusted,
      resolveIdentityPosture: identityRevoked
    });
    expect(view.worstCasePrecheck).toBe('block');
    expect(view.blockReasons).toEqual([
      'capability-deny',
      'reputation-untrusted',
      'identity-not-active'
    ]);
  });

  it('a good capability decision does NOT cancel a revoked device — the worst case wins', () => {
    const view = composeAuthorityView({
      authority: AUTHORITY,
      now: NOW,
      resolveCapabilityPosture: capabilityAllow,
      resolveIdentityPosture: identityRevoked
    });
    expect(view.worstCasePrecheck).toBe('block');
    expect(view.blockReasons).toEqual(['identity-not-active']);
  });

  it('identity status "rotated" blocks (codex review on PR #80 — rotated keys do not authorize)', () => {
    const view = composeAuthorityView({
      authority: AUTHORITY,
      now: NOW,
      resolveIdentityPosture: () => ({ source: 'identity-control', status: 'rotated' })
    });
    expect(view.worstCasePrecheck).toBe('block');
    expect(view.blockReasons).toEqual(['identity-not-active']);
  });

  it('identity status "unknown" blocks (subsystem was asked and explicitly cannot confirm — fail closed)', () => {
    const view = composeAuthorityView({
      authority: AUTHORITY,
      now: NOW,
      resolveIdentityPosture: () => ({ source: 'identity-control', status: 'unknown' })
    });
    expect(view.worstCasePrecheck).toBe('block');
    expect(view.blockReasons).toEqual(['identity-not-active']);
  });

  it('an ABSENT identity posture is distinct from an "unknown" status — absence contributes nothing', () => {
    // Resolver omitted entirely — caller did not consult identity.
    // No identity reason should surface; pre-check stays "continue".
    const view = composeAuthorityView({ authority: AUTHORITY, now: NOW });
    expect(view.worstCasePrecheck).toBe('continue');
    expect(view.identityPosture).toBeUndefined();
  });

  it('resolver returning undefined is also "absent" — contributes nothing', () => {
    const view = composeAuthorityView({
      authority: AUTHORITY,
      now: NOW,
      resolveIdentityPosture: () => undefined
    });
    expect(view.worstCasePrecheck).toBe('continue');
    expect(view.identityPosture).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/*    source-label discipline — the layer never mints or relabels sources     */
/* -------------------------------------------------------------------------- */

describe('source-label discipline — postures must carry their declared source tag', () => {
  it('throws when a capability resolver returns a posture without source: "capability"', () => {
    expect(() =>
      composeAuthorityView({
        authority: AUTHORITY,
        now: NOW,
        // @ts-expect-error: testing runtime guard
        resolveCapabilityPosture: () => ({ source: 'reputation', decision: 'allow' })
      })
    ).toThrow(CapabilityError);
  });

  it('throws when a reputation resolver returns a posture without source: "reputation"', () => {
    expect(() =>
      composeAuthorityView({
        authority: AUTHORITY,
        now: NOW,
        // @ts-expect-error: testing runtime guard
        resolveReputationPosture: () => ({ source: 'identity-control', band: 'high' })
      })
    ).toThrow(CapabilityError);
  });

  it('throws when an identity resolver returns a posture without source: "identity-control"', () => {
    expect(() =>
      composeAuthorityView({
        authority: AUTHORITY,
        now: NOW,
        // @ts-expect-error: testing runtime guard
        resolveIdentityPosture: () => ({ source: 'capability', status: 'active' })
      })
    ).toThrow(CapabilityError);
  });

  it('throws on an unsupported reputation band', () => {
    expect(() =>
      composeAuthorityView({
        authority: AUTHORITY,
        now: NOW,
        // @ts-expect-error: testing runtime guard
        resolveReputationPosture: () => ({ source: 'reputation', band: 'awesome' })
      })
    ).toThrow(CapabilityError);
  });

  it('throws on an unsupported identity status', () => {
    expect(() =>
      composeAuthorityView({
        authority: AUTHORITY,
        now: NOW,
        // @ts-expect-error: testing runtime guard
        resolveIdentityPosture: () => ({ source: 'identity-control', status: 'gone' })
      })
    ).toThrow(CapabilityError);
  });

  it('throws on an unsupported capability decision', () => {
    expect(() =>
      composeAuthorityView({
        authority: AUTHORITY,
        now: NOW,
        // @ts-expect-error: testing runtime guard
        resolveCapabilityPosture: () => ({ source: 'capability', decision: 'maybe' })
      })
    ).toThrow(CapabilityError);
  });
});

/* -------------------------------------------------------------------------- */
/*             input guards — fail closed on malformed callers                */
/* -------------------------------------------------------------------------- */

describe('composeAuthorityView — input guards', () => {
  it('throws on a missing/non-object input', () => {
    // @ts-expect-error: testing runtime guard
    expect(() => composeAuthorityView(null)).toThrow(CapabilityError);
  });

  it('throws when a resolver field is not a function', () => {
    expect(() =>
      composeAuthorityView({
        authority: AUTHORITY,
        now: NOW,
        // @ts-expect-error: testing runtime guard
        resolveCapabilityPosture: 'nope'
      })
    ).toThrow(CapabilityError);
  });

  it('throws on a bad authority', () => {
    expect(() =>
      // @ts-expect-error: testing runtime guard
      composeAuthorityView({ authority: { kind: 'unknown-kind', id: 'x' }, now: NOW })
    ).toThrow(CapabilityError);
  });

  it('throws on a bad timestamp', () => {
    expect(() => composeAuthorityView({ authority: AUTHORITY, now: 'not-a-time' })).toThrow(
      CapabilityError
    );
  });
});

/* -------------------------------------------------------------------------- */
/*                          enum-integrity sanity                             */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*    regression: prototype-pollution + array-input guards (gemini #80)       */
/* -------------------------------------------------------------------------- */

describe('regression — gemini #80: prototype-pollution + array-input defense', () => {
  it('rejects an input that is an array (typeof [] === "object" hazard)', () => {
    expect(() =>
      // @ts-expect-error: testing runtime guard
      composeAuthorityView([{ authority: AUTHORITY, now: NOW }])
    ).toThrow(CapabilityError);
  });

  it('rejects a CapabilityPosture delivered with prototype pollution via __proto__', () => {
    expect(() =>
      composeAuthorityView({
        authority: AUTHORITY,
        now: NOW,
        resolveCapabilityPosture: () =>
          // Construct a literal whose own-property __proto__ is set
          // — the same JSON-parse-shape that landed real exploits in
          // other codebases.
          // @ts-expect-error: testing runtime guard
          ({ source: 'capability', decision: 'allow', __proto__: { polluted: true } })
      })
    ).toThrow(CapabilityError);
  });

  it('rejects a ReputationPosture delivered as an array (defense in depth)', () => {
    expect(() =>
      composeAuthorityView({
        authority: AUTHORITY,
        now: NOW,
        // @ts-expect-error: testing runtime guard
        resolveReputationPosture: () => [{ source: 'reputation', band: 'high' }]
      })
    ).toThrow(CapabilityError);
  });

  it('rejects an IdentityPosture delivered with a forbidden key on the object', () => {
    expect(() =>
      composeAuthorityView({
        authority: AUTHORITY,
        now: NOW,
        // @ts-expect-error: testing runtime guard
        resolveIdentityPosture: () => ({
          source: 'identity-control',
          status: 'active',
          constructor: 'evil'
        })
      })
    ).toThrow(CapabilityError);
  });
});

describe('exported enums', () => {
  it('reputation bands exactly match Phase 1.8.3 doctrine values', () => {
    expect([...REPUTATION_POSTURE_BANDS]).toEqual(['high', 'mid', 'low', 'untrusted']);
  });

  it('identity posture states are the 4 documented values', () => {
    expect([...IDENTITY_POSTURE_STATES]).toEqual(['active', 'revoked', 'rotated', 'unknown']);
  });

  it('pre-check outcomes are only block / continue', () => {
    expect([...AUTHORITY_PRECHECK_OUTCOMES]).toEqual(['block', 'continue']);
  });

  it('pre-check reasons are exactly the three hard-fail signals', () => {
    expect([...AUTHORITY_PRECHECK_REASONS]).toEqual([
      'capability-deny',
      'reputation-untrusted',
      'identity-not-active'
    ]);
  });
});
