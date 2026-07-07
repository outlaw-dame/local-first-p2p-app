import { describe, expect, it } from 'vitest';
import {
  applyChatEvent,
  CHAT_ERROR_CODES,
  ChatProjectionError,
  createEmptyChatThreadState,
  isChatEventKind,
  type ApplyChatEventMeta,
  type ChatThreadState
} from './index.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const T_THREAD = 'thread:alpha';
const T_ALICE = 'device:alice-phone';
const T_BOB = 'device:bob-laptop';
const T0 = '2026-06-29T00:00:00.000Z';
const T1 = '2026-06-29T00:01:00.000Z';
const T2 = '2026-06-29T00:02:00.000Z';
const T3 = '2026-06-29T00:03:00.000Z';

function meta(
  eventId: string,
  kind: ApplyChatEventMeta['kind'],
  authorDeviceId = T_ALICE,
  createdAt = T0
): ApplyChatEventMeta {
  return { eventId, kind, authorDeviceId, createdAt };
}

function createThreadState(): ChatThreadState {
  return applyChatEvent(
    createEmptyChatThreadState(T_THREAD),
    {
      threadId: T_THREAD,
      participantIds: [T_ALICE, T_BOB],
      createdAt: T0
    },
    meta('evt:create', 'chat.thread.created', T_ALICE, T0)
  );
}

// ---------------------------------------------------------------------------
// Kind type guard
// ---------------------------------------------------------------------------

describe('isChatEventKind', () => {
  it('accepts all chat kinds', () => {
    expect(isChatEventKind('chat.thread.created')).toBe(true);
    expect(isChatEventKind('chat.message.sent')).toBe(true);
    expect(isChatEventKind('chat.message.edited')).toBe(true);
    expect(isChatEventKind('chat.message.deleted')).toBe(true);
    expect(isChatEventKind('chat.thread.accepted')).toBe(true);
  });

  it('rejects non-chat kinds', () => {
    expect(isChatEventKind('note.created')).toBe(false);
    expect(isChatEventKind('identity.device.created')).toBe(false);
    expect(isChatEventKind('mls.group.created')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createEmptyChatThreadState
// ---------------------------------------------------------------------------

describe('createEmptyChatThreadState', () => {
  it('returns a frozen empty state', () => {
    const s = createEmptyChatThreadState('thread:x');
    expect(Object.isFrozen(s)).toBe(true);
    expect(s.threadId).toBe('thread:x');
    expect(s.participants).toHaveLength(0);
    expect(s.messages.size).toBe(0);
    expect(s.acceptedBy.size).toBe(0);
    expect(s.appliedEventIds.size).toBe(0);
    expect(s.createdAt).toBe('');
  });
});

// ---------------------------------------------------------------------------
// chat.thread.created
// ---------------------------------------------------------------------------

describe('chat.thread.created', () => {
  it('initialises the thread state', () => {
    const s = createThreadState();
    expect(s.participants).toEqual([T_ALICE, T_BOB]);
    expect(s.createdAt).toBe(T0);
    expect(s.lastActivityAt).toBe(T0);
    expect(Object.isFrozen(s)).toBe(true);
  });

  it('records optional threadName', () => {
    const s = applyChatEvent(
      createEmptyChatThreadState(T_THREAD),
      { threadId: T_THREAD, participantIds: [T_ALICE], createdAt: T0, threadName: 'My Room' },
      meta('evt:cn', 'chat.thread.created')
    );
    expect(s.threadName).toBe('My Room');
  });

  it('throws CHAT_THREAD_ALREADY_EXISTS on duplicate', () => {
    const s = createThreadState();
    expect(() =>
      applyChatEvent(
        s,
        { threadId: T_THREAD, participantIds: [T_ALICE], createdAt: T1 },
        meta('evt:dup', 'chat.thread.created')
      )
    ).toThrowError(ChatProjectionError);
    expect(() =>
      applyChatEvent(
        s,
        { threadId: T_THREAD, participantIds: [T_ALICE], createdAt: T1 },
        meta('evt:dup', 'chat.thread.created')
      )
    ).toThrow('CHAT_THREAD_ALREADY_EXISTS');
  });

  it('rejects payload with empty participantIds', () => {
    expect(() =>
      applyChatEvent(
        createEmptyChatThreadState(T_THREAD),
        { threadId: T_THREAD, participantIds: [], createdAt: T0 },
        meta('evt:empty-parts', 'chat.thread.created')
      )
    ).toThrow('CHAT_INVALID_PAYLOAD');
  });

  it('is idempotent: same eventId applied twice returns same state', () => {
    const s = createThreadState();
    const s2 = applyChatEvent(
      s,
      { threadId: T_THREAD, participantIds: [T_ALICE, T_BOB], createdAt: T0 },
      meta('evt:create', 'chat.thread.created')
    );
    expect(s2).toBe(s);
  });
});

// ---------------------------------------------------------------------------
// chat.message.sent
// ---------------------------------------------------------------------------

describe('chat.message.sent', () => {
  it('appends a message to the thread', () => {
    const s = applyChatEvent(
      createThreadState(),
      { threadId: T_THREAD, messageId: 'msg:1', body: 'hello', sentAt: T1 },
      meta('evt:msg1', 'chat.message.sent')
    );
    const msg = s.messages.get('msg:1');
    expect(msg).toBeDefined();
    expect(msg?.plaintextBody).toBe('hello');
    expect(msg?.authorDeviceId).toBe(T_ALICE);
    expect(msg?.deleted).toBe(false);
    expect(s.lastActivityAt).toBe(T1);
  });

  it('supports replyToMessageId', () => {
    let s = createThreadState();
    s = applyChatEvent(
      s,
      { threadId: T_THREAD, messageId: 'msg:1', body: 'original', sentAt: T1 },
      meta('evt:msg1', 'chat.message.sent')
    );
    s = applyChatEvent(
      s,
      {
        threadId: T_THREAD,
        messageId: 'msg:2',
        body: 'reply',
        sentAt: T2,
        replyToMessageId: 'msg:1'
      },
      meta('evt:msg2', 'chat.message.sent', T_BOB, T2)
    );
    expect(s.messages.get('msg:2')?.replyToMessageId).toBe('msg:1');
  });

  it('throws CHAT_THREAD_NOT_FOUND on uninitialised thread', () => {
    expect(() =>
      applyChatEvent(
        createEmptyChatThreadState(T_THREAD),
        { threadId: T_THREAD, messageId: 'msg:1', body: 'hello', sentAt: T1 },
        meta('evt:msg-early', 'chat.message.sent')
      )
    ).toThrow('CHAT_THREAD_NOT_FOUND');
  });

  it('is idempotent: duplicate messageId is a no-op', () => {
    let s = createThreadState();
    s = applyChatEvent(
      s,
      { threadId: T_THREAD, messageId: 'msg:1', body: 'hello', sentAt: T1 },
      meta('evt:msg1', 'chat.message.sent')
    );
    const s2 = applyChatEvent(
      s,
      { threadId: T_THREAD, messageId: 'msg:1', body: 'different body', sentAt: T2 },
      meta('evt:msg1-dup', 'chat.message.sent')
    );
    // eventId differs so it's not the appliedEventIds guard — the messageId dedup fires
    expect(s2.messages.get('msg:1')?.plaintextBody).toBe('hello');
    // True no-op: lastActivityAt must not advance to the duplicate's sentAt
    expect(s2.lastActivityAt).toBe(T1);
  });

  it('throws CHAT_INVALID_PAYLOAD when payload threadId does not match state', () => {
    expect(() =>
      applyChatEvent(
        createThreadState(),
        { threadId: 'thread:wrong', messageId: 'msg:1', body: 'hello', sentAt: T1 },
        meta('evt:msg-mismatch', 'chat.message.sent')
      )
    ).toThrow('CHAT_INVALID_PAYLOAD');
  });

  it('is idempotent: same eventId applied twice returns same state', () => {
    let s = createThreadState();
    s = applyChatEvent(
      s,
      { threadId: T_THREAD, messageId: 'msg:1', body: 'hello', sentAt: T1 },
      meta('evt:msg1', 'chat.message.sent')
    );
    const s2 = applyChatEvent(
      s,
      { threadId: T_THREAD, messageId: 'msg:1', body: 'hello', sentAt: T1 },
      meta('evt:msg1', 'chat.message.sent')
    );
    expect(s2).toBe(s);
  });

  it('rejects payload with missing body', () => {
    expect(() =>
      applyChatEvent(
        createThreadState(),
        { threadId: T_THREAD, messageId: 'msg:1', body: '', sentAt: T1 },
        meta('evt:nobody', 'chat.message.sent')
      )
    ).toThrow('CHAT_INVALID_PAYLOAD');
  });
});

// ---------------------------------------------------------------------------
// chat.message.edited
// ---------------------------------------------------------------------------

describe('chat.message.edited', () => {
  function threadWithMessage(): ChatThreadState {
    return applyChatEvent(
      createThreadState(),
      { threadId: T_THREAD, messageId: 'msg:1', body: 'original', sentAt: T1 },
      meta('evt:msg1', 'chat.message.sent')
    );
  }

  it('updates plaintextBody and sets editedAt', () => {
    const s = applyChatEvent(
      threadWithMessage(),
      { threadId: T_THREAD, messageId: 'msg:1', newBody: 'edited', editedAt: T2 },
      meta('evt:edit1', 'chat.message.edited')
    );
    const msg = s.messages.get('msg:1');
    expect(msg?.plaintextBody).toBe('edited');
    expect(msg?.editedAt).toBe(T2);
    expect(s.lastActivityAt).toBe(T2);
  });

  it('throws CHAT_MESSAGE_NOT_FOUND for unknown messageId', () => {
    expect(() =>
      applyChatEvent(
        createThreadState(),
        { threadId: T_THREAD, messageId: 'msg:phantom', newBody: 'x', editedAt: T2 },
        meta('evt:edit-phantom', 'chat.message.edited')
      )
    ).toThrow('CHAT_MESSAGE_NOT_FOUND');
  });

  it('throws CHAT_MESSAGE_ALREADY_DELETED when editing a deleted message', () => {
    let s = threadWithMessage();
    s = applyChatEvent(
      s,
      { threadId: T_THREAD, messageId: 'msg:1', deletedAt: T2 },
      meta('evt:del1', 'chat.message.deleted')
    );
    expect(() =>
      applyChatEvent(
        s,
        { threadId: T_THREAD, messageId: 'msg:1', newBody: 'too late', editedAt: T3 },
        meta('evt:edit-deleted', 'chat.message.edited')
      )
    ).toThrow('CHAT_MESSAGE_ALREADY_DELETED');
  });
});

// ---------------------------------------------------------------------------
// chat.message.deleted
// ---------------------------------------------------------------------------

describe('chat.message.deleted', () => {
  function threadWithMessage(): ChatThreadState {
    return applyChatEvent(
      createThreadState(),
      { threadId: T_THREAD, messageId: 'msg:1', body: 'original', sentAt: T1 },
      meta('evt:msg1', 'chat.message.sent')
    );
  }

  it('marks message deleted and purges plaintextBody', () => {
    const s = applyChatEvent(
      threadWithMessage(),
      { threadId: T_THREAD, messageId: 'msg:1', deletedAt: T2 },
      meta('evt:del1', 'chat.message.deleted')
    );
    const msg = s.messages.get('msg:1');
    expect(msg?.deleted).toBe(true);
    expect(msg?.plaintextBody).toBe('');
    expect(msg?.deletedAt).toBe(T2);
    expect(s.lastActivityAt).toBe(T2);
  });

  it('is idempotent: deleting already-deleted message is no-op', () => {
    let s = threadWithMessage();
    s = applyChatEvent(
      s,
      { threadId: T_THREAD, messageId: 'msg:1', deletedAt: T2 },
      meta('evt:del1', 'chat.message.deleted')
    );
    const s2 = applyChatEvent(
      s,
      { threadId: T_THREAD, messageId: 'msg:1', deletedAt: T3 },
      meta('evt:del1-again', 'chat.message.deleted')
    );
    expect(s2.messages.get('msg:1')?.deletedAt).toBe(T2);
  });

  it('throws CHAT_MESSAGE_NOT_FOUND for unknown messageId', () => {
    expect(() =>
      applyChatEvent(
        createThreadState(),
        { threadId: T_THREAD, messageId: 'msg:phantom', deletedAt: T1 },
        meta('evt:del-phantom', 'chat.message.deleted')
      )
    ).toThrow('CHAT_MESSAGE_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// chat.thread.accepted
// ---------------------------------------------------------------------------

describe('chat.thread.accepted', () => {
  it('records acceptance from the author device', () => {
    const s = applyChatEvent(
      createThreadState(),
      { threadId: T_THREAD, acceptedAt: T1 },
      meta('evt:accept', 'chat.thread.accepted', T_BOB, T1)
    );
    expect(s.acceptedBy.has(T_BOB)).toBe(true);
    expect(s.lastActivityAt).toBe(T1);
  });

  it('is idempotent: same eventId applied twice returns same state', () => {
    let s = createThreadState();
    s = applyChatEvent(
      s,
      { threadId: T_THREAD, acceptedAt: T1 },
      meta('evt:accept', 'chat.thread.accepted', T_BOB, T1)
    );
    const s2 = applyChatEvent(
      s,
      { threadId: T_THREAD, acceptedAt: T1 },
      meta('evt:accept', 'chat.thread.accepted', T_BOB, T1)
    );
    expect(s2).toBe(s);
  });

  it('throws CHAT_THREAD_NOT_FOUND on uninitialised thread', () => {
    expect(() =>
      applyChatEvent(
        createEmptyChatThreadState(T_THREAD),
        { threadId: T_THREAD, acceptedAt: T0 },
        meta('evt:accept-early', 'chat.thread.accepted', T_BOB)
      )
    ).toThrow('CHAT_THREAD_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// Deep-freeze walk (Phase 3.2 invariant)
// ---------------------------------------------------------------------------

describe('Phase 3.2 deep-freeze invariant', () => {
  function deepFrozenWalk(obj: unknown, path = ''): void {
    if (obj === null || typeof obj !== 'object') return;
    if (obj instanceof Map || obj instanceof Set) return;
    expect(Object.isFrozen(obj), `${path} is not frozen`).toBe(true);
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => deepFrozenWalk(item, `${path}[${i}]`));
    } else {
      for (const [k, v] of Object.entries(obj)) {
        deepFrozenWalk(v, `${path}.${k}`);
      }
    }
  }

  it('createEmptyChatThreadState output is deeply frozen', () => {
    deepFrozenWalk(createEmptyChatThreadState(T_THREAD));
  });

  it('chat.thread.created output is deeply frozen', () => {
    deepFrozenWalk(createThreadState());
  });

  it('chat.message.sent output is deeply frozen', () => {
    const s = applyChatEvent(
      createThreadState(),
      { threadId: T_THREAD, messageId: 'msg:1', body: 'hello', sentAt: T1 },
      meta('evt:m1', 'chat.message.sent')
    );
    deepFrozenWalk(s);
  });
});

// ---------------------------------------------------------------------------
// Replay equivalence (Phase 3.2 invariant)
// ---------------------------------------------------------------------------

describe('replay equivalence', () => {
  it('seed([E1…En]) equals reduce(apply, createEmpty(), events) three times', () => {
    const events: Array<{ payload: unknown; m: ApplyChatEventMeta }> = [
      {
        payload: { threadId: T_THREAD, participantIds: [T_ALICE, T_BOB], createdAt: T0 },
        m: meta('evt:c', 'chat.thread.created', T_ALICE, T0)
      },
      {
        payload: { threadId: T_THREAD, messageId: 'msg:1', body: 'hi', sentAt: T1 },
        m: meta('evt:m1', 'chat.message.sent', T_ALICE, T1)
      },
      {
        payload: { threadId: T_THREAD, acceptedAt: T2 },
        m: meta('evt:acc', 'chat.thread.accepted', T_BOB, T2)
      },
      {
        payload: { threadId: T_THREAD, messageId: 'msg:1', newBody: 'hi!', editedAt: T3 },
        m: meta('evt:e1', 'chat.message.edited', T_ALICE, T3)
      }
    ];

    function buildState(): ChatThreadState {
      return events.reduce(
        (s, { payload, m }) => applyChatEvent(s, payload as never, m),
        createEmptyChatThreadState(T_THREAD)
      );
    }

    const s1 = buildState();
    const s2 = buildState();
    const s3 = buildState();
    expect(s1.lastActivityAt).toBe(T3);
    expect(s1.appliedEventIds.size).toBe(4);
    expect(s2.lastActivityAt).toBe(s1.lastActivityAt);
    expect(s3.lastActivityAt).toBe(s1.lastActivityAt);
    expect([...s1.appliedEventIds].sort()).toEqual([...s2.appliedEventIds].sort());
    expect([...s1.appliedEventIds].sort()).toEqual([...s3.appliedEventIds].sort());
  });
});

// ---------------------------------------------------------------------------
// appliedEventIds idempotency guard
// ---------------------------------------------------------------------------

describe('appliedEventIds idempotency guard', () => {
  it('records eventId in appliedEventIds after apply', () => {
    const s = applyChatEvent(
      createEmptyChatThreadState(T_THREAD),
      { threadId: T_THREAD, participantIds: [T_ALICE], createdAt: T0 },
      meta('evt:create', 'chat.thread.created')
    );
    expect(s.appliedEventIds.has('evt:create')).toBe(true);
  });

  it('same eventId on a different kind returns identical state reference', () => {
    const s = createThreadState();
    // Try to apply a message event with the same eventId as the create event
    const s2 = applyChatEvent(
      s,
      { threadId: T_THREAD, messageId: 'msg:X', body: 'X', sentAt: T1 },
      meta('evt:create', 'chat.message.sent')
    );
    expect(s2).toBe(s);
  });
});

// ---------------------------------------------------------------------------
// Error code discipline
// ---------------------------------------------------------------------------

describe('ChatProjectionError', () => {
  it('exposes a stable code property', () => {
    const err = new ChatProjectionError('CHAT_THREAD_NOT_FOUND', 'test');
    expect(err.code).toBe('CHAT_THREAD_NOT_FOUND');
    expect(err.name).toBe('ChatProjectionError');
    expect(err.message).toContain('CHAT_THREAD_NOT_FOUND');
  });

  it('all error codes are in CHAT_ERROR_CODES', () => {
    const codes: string[] = [
      'CHAT_THREAD_ALREADY_EXISTS',
      'CHAT_THREAD_NOT_FOUND',
      'CHAT_MESSAGE_NOT_FOUND',
      'CHAT_MESSAGE_ALREADY_DELETED',
      'CHAT_INVALID_PAYLOAD',
      'CHAT_DECRYPT_FAILED',
      'CHAT_INVALID_PRIVACY',
      'CHAT_INVALID_KIND'
    ];
    for (const code of codes) {
      expect(CHAT_ERROR_CODES as ReadonlyArray<string>).toContain(code);
    }
  });
});
