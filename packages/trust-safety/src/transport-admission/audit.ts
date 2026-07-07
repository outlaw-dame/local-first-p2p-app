/**
 * Audit-log entries for transport admission. The redaction rules are
 * non-negotiable:
 *
 *  - No encrypted payload bytes ever appear in the log.
 *  - No encryption-key DigestRef ever appears (only its redacted form).
 *  - No full DigestRef body — use `redactDigestRef` for an 8-char
 *    prefix only.
 *  - No CID body beyond a short prefix.
 *  - Timestamps are rounded to whole seconds so the log cannot serve
 *    as a high-resolution timing oracle for fingerprinting requests.
 *  - The log is capped; oldest-first eviction.
 *
 * The entries are JSON-serializable so they can be persisted by an
 * operator's audit store without further transformation.
 */

import { redactDigestRef } from '@lfp2p/content-addressing';
import type { BlockRef, DigestRef } from '@lfp2p/content-addressing';
import { tsError } from '../errors.js';
import type { SafetyReasonCode } from '../reason-codes.js';
import { assertFiniteNumberInRange, assertId, assertOneOf } from '../validation.js';

/** Maximum number of entries retained in an in-memory audit log. */
export const DEFAULT_AUDIT_LOG_CAPACITY = 1_000;

export const AUDIT_ACTIONS = [
  'accept',
  'accept-limited',
  'reject',
  'quarantine',
  'rate-limit',
  'drop-duplicate'
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditEntry = Readonly<{
  /** Whole-second epoch timestamp. */
  ts: number;
  /** Operator's authorityId — does not leak the underlying actor. */
  operatorAuthorityId: string;
  /** Bridge / relay / super-peer / public-index / media-store. */
  surface: string;
  action: AuditAction;
  reasonCode: SafetyReasonCode;
  /** Optional peer identifier (already an opaque id). */
  peerId?: string;
  /**
   * Optional redacted subject reference, e.g. `cid:raw:bafkrei…` or
   * `sha-256:47DEQpj8…`. Never contains the full digest or full CID.
   */
  subjectRef?: string;
}>;

export type AuditLog = Readonly<{
  capacity: number;
  entries: ReadonlyArray<AuditEntry>;
}>;

export function createAuditLog(capacity: number = DEFAULT_AUDIT_LOG_CAPACITY): AuditLog {
  assertFiniteNumberInRange(capacity, 'AuditLog.capacity', 1, 1_000_000);
  if (!Number.isSafeInteger(capacity)) {
    throw tsError('TS_INVALID_NUMBER', 'AuditLog.capacity must be a safe integer');
  }
  return Object.freeze({ capacity, entries: Object.freeze([]) });
}

export type AuditAppendInput = Readonly<{
  operatorAuthorityId: string;
  surface: string;
  action: AuditAction;
  reasonCode: SafetyReasonCode;
  peerId?: string;
  /**
   * Pre-redacted subject string. Callers SHOULD build this via the
   * provided helpers `redactDigestForAudit` / `redactBlockRefForAudit`
   * so the redaction rules are enforced in one place.
   */
  subjectRef?: string;
}>;

export function appendAuditEntry(
  log: AuditLog,
  input: AuditAppendInput,
  now: number,
  validReasonCodes: ReadonlyArray<SafetyReasonCode>
): AuditLog {
  // Whole-second timestamp to avoid high-resolution timing fingerprints.
  const ts = Math.floor(now / 1000);
  assertId(input.operatorAuthorityId, 'AuditEntry.operatorAuthorityId');
  assertId(input.surface, 'AuditEntry.surface');
  assertOneOf(input.action, AUDIT_ACTIONS, 'AuditEntry.action');
  assertOneOf(input.reasonCode, validReasonCodes, 'AuditEntry.reasonCode');
  if (input.peerId !== undefined) {
    assertId(input.peerId, 'AuditEntry.peerId');
  }
  if (input.subjectRef !== undefined) {
    assertId(input.subjectRef, 'AuditEntry.subjectRef', 256);
  }

  const entry: AuditEntry = Object.freeze({
    ts,
    operatorAuthorityId: input.operatorAuthorityId,
    surface: input.surface,
    action: input.action,
    reasonCode: input.reasonCode,
    ...(input.peerId !== undefined ? { peerId: input.peerId } : {}),
    ...(input.subjectRef !== undefined ? { subjectRef: input.subjectRef } : {})
  });

  // FIFO eviction at capacity.
  const next = [...log.entries, entry];
  while (next.length > log.capacity) {
    next.shift();
  }
  return Object.freeze({ capacity: log.capacity, entries: Object.freeze(next) });
}

/** Redact a digest ref for audit display (8-char prefix + algorithm). */
export function redactDigestForAudit(ref: DigestRef): string {
  return redactDigestRef(ref);
}

/**
 * Redact a block ref. Never reveal the encryption key digest (the
 * `redactBlockRef` from content-addressing already drops it), and
 * confine the source digest / CID to a short prefix.
 */
export function redactBlockRefForAudit(block: BlockRef): string {
  if (block.source.kind === 'digest') {
    return `block(${block.privacy}, ${redactDigestForAudit(block.source.digest)}, len=${block.byteLength})`;
  }
  const cid = block.source.link.cid;
  const head = cid.length <= 9 ? cid : `${cid.slice(0, 9)}…`;
  return `block(${block.privacy}, cid:${block.source.link.codec}:${head}, len=${block.byteLength})`;
}
