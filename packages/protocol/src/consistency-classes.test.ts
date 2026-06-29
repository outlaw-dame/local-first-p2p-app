import { describe, expect, it } from 'vitest';
import {
  EVENT_KIND_CONSISTENCY_CLASS,
  OPERATION_CONSISTENCY_CLASSES,
  assertCrdtPayloadAllowedForEventKind,
  assertEventKindConsistencyClass,
  assertLwwAllowedForEventKind,
  consistencyClassForEventKind,
  isOperationConsistencyClass
} from './consistency-classes.js';

describe('operation consistency class registry', () => {
  it('recognizes only declared operation consistency classes', () => {
    expect(OPERATION_CONSISTENCY_CLASSES).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(isOperationConsistencyClass('A')).toBe(true);
    expect(isOperationConsistencyClass('E')).toBe(true);
    expect(isOperationConsistencyClass('LWW')).toBe(false);
    expect(isOperationConsistencyClass('crdt')).toBe(false);
  });

  it('classifies first-class protocol event kinds by doctrine', () => {
    expect(consistencyClassForEventKind('contact.petname.set')).toBe('A');
    expect(consistencyClassForEventKind('identity.capability.revoked')).toBe('B');
    expect(consistencyClassForEventKind('identity.device.revoked')).toBe('C');
    expect(consistencyClassForEventKind('mls.epoch.advanced')).toBe('D');
    expect(consistencyClassForEventKind('mls.fork.recovery.published')).toBe('D');
  });

  it('keeps Loro/Yjs/CRDT-style payload merging out of authority and key-epoch events', () => {
    expect(() => assertCrdtPayloadAllowedForEventKind('note.created')).not.toThrow();
    expect(() => assertCrdtPayloadAllowedForEventKind('identity.device.revoked')).toThrow(
      /CRDT\/Loro\/Yjs-style payload merging is not allowed/
    );
    expect(() => assertCrdtPayloadAllowedForEventKind('mls.commit.published')).toThrow(
      /CRDT\/Loro\/Yjs-style payload merging is not allowed/
    );
  });

  it('keeps last-writer-wins out of lifecycle, authority, and MLS events', () => {
    expect(() => assertLwwAllowedForEventKind('contact.petname.set')).not.toThrow();
    expect(() => assertLwwAllowedForEventKind('identity.capability.revoked')).toThrow(
      /last-writer-wins is not allowed/
    );
    expect(() => assertLwwAllowedForEventKind('identity.controller.created')).toThrow(
      /last-writer-wins is not allowed/
    );
    expect(() => assertLwwAllowedForEventKind('mls.member.removed')).toThrow(
      /last-writer-wins is not allowed/
    );
  });

  it('throws when a caller asserts the wrong class for an event kind', () => {
    expect(() => assertEventKindConsistencyClass('identity.device.authorized', 'C')).not.toThrow();
    expect(() => assertEventKindConsistencyClass('identity.device.authorized', 'A')).toThrow(
      /identity\.device\.authorized is Class C, expected Class A/
    );
  });

  it('has no undefined registry values at runtime', () => {
    for (const [eventKind, consistencyClass] of Object.entries(EVENT_KIND_CONSISTENCY_CLASS)) {
      expect(eventKind.length).toBeGreaterThan(0);
      expect(isOperationConsistencyClass(consistencyClass)).toBe(true);
    }
  });
});
