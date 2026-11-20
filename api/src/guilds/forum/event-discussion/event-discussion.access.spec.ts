import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  FORUM_EVENT_THREAD_MANAGED,
  FORUM_NOT_SIGNED_UP,
  FORUM_THREAD_READ_ONLY,
  assertCanReply,
  assertEventEditable,
  assertNotEventThread,
  eventThreadActor,
  eventThreadLock,
  type EventThreadFacts,
} from './event-discussion.access';
import { canFor } from '../hub-forum.helpers';

const NONE: EventThreadFacts = {
  isMember: false,
  canModerate: false,
  isSignedUp: false,
  isCreator: false,
};
const facts = (over: Partial<EventThreadFacts>): EventThreadFacts => ({
  ...NONE,
  ...over,
});
const NOW = new Date('2026-11-20T12:00:00.000Z');
const BEFORE = new Date(NOW.getTime() - 1);
const AFTER = new Date(NOW.getTime() + 1);

describe('eventThreadActor (§6 matrix)', () => {
  const rows: [
    string,
    Partial<EventThreadFacts>,
    [boolean, boolean, boolean, boolean],
  ][] = [
    // [label, facts, [canRead, canReply, canWrite, canModerate]]
    ['member, not signed up', { isMember: true }, [true, false, true, false]],
    [
      'member, signed up / tentative / bench',
      { isMember: true, isSignedUp: true },
      [true, true, true, false],
    ],
    ['signed-up non-member', { isSignedUp: true }, [true, true, true, false]],
    [
      'leader/officer/staff, not signed up',
      { isMember: true, canModerate: true },
      [true, false, true, true],
    ],
    [
      'leader, signed up',
      { isMember: true, canModerate: true, isSignedUp: true },
      [true, true, true, true],
    ],
    [
      'creator, neither member nor signup',
      { isCreator: true },
      [true, false, false, false],
    ],
    ['visitor, not signed up', {}, [false, false, false, false]],
    [
      'canEdit without canView never moderates',
      { canModerate: true },
      [false, false, false, false],
    ],
  ];
  it.each(rows)('%s', (_label, over, [read, reply, write, mod]) => {
    const who = eventThreadActor(9, facts(over));
    expect({
      read: who.canRead,
      reply: who.canReply,
      write: who.canWrite,
      mod: who.canModerate,
    }).toEqual({
      read,
      reply,
      write,
      mod,
    });
    expect(who.userId).toBe(9);
  });
});

describe('eventThreadLock (§5.4)', () => {
  const base = { eventId: 4, eventDetachedAt: null, writeClosesAt: AFTER };

  it('is null for a normal thread', () => {
    expect(
      eventThreadLock(
        { ...base, eventId: null, writeClosesAt: null },
        false,
        NOW,
      ),
    ).toBeNull();
  });

  it('is null while before write_closes_at', () => {
    expect(eventThreadLock(base, true, NOW)).toBeNull();
  });

  it('is event-ended exactly at write_closes_at', () => {
    expect(eventThreadLock({ ...base, writeClosesAt: NOW }, true, NOW)).toEqual(
      {
        at: NOW.toISOString(),
        reason: 'event-ended',
      },
    );
  });

  it('is event-detached once detached and the event still exists (retag/untag)', () => {
    expect(
      eventThreadLock({ ...base, eventDetachedAt: BEFORE }, true, NOW),
    ).toEqual({
      at: BEFORE.toISOString(),
      reason: 'event-detached',
    });
  });

  it('is event-deleted when the event row is gone, detached or not (D1)', () => {
    expect(
      eventThreadLock({ ...base, eventDetachedAt: BEFORE }, false, NOW)?.reason,
    ).toBe('event-deleted');
    expect(eventThreadLock(base, false, NOW)?.reason).toBe('event-deleted');
  });
});

describe('event thread refusals (§12)', () => {
  const lock = { at: NOW.toISOString(), reason: 'event-ended' as const };
  const own = {
    authorId: 9,
    authorDiscordId: null,
    createdAt: BEFORE,
    deletedAt: null,
  };

  it('PATCH/DELETE of an event thread is 403 managed; a normal thread passes', () => {
    expect(() => assertNotEventThread({ eventId: 4 })).toThrow(
      new ForbiddenException(FORUM_EVENT_THREAD_MANAGED),
    );
    expect(() => assertNotEventThread({ eventId: null })).not.toThrow();
    for (const subject of [{ matchId: 5 }, { lineupId: 6 }]) {
      expect(() => assertNotEventThread({ eventId: null, ...subject })).toThrow(
        new ForbiddenException(FORUM_EVENT_THREAD_MANAGED),
      );
    }
    expect(() =>
      assertNotEventThread({ eventId: null, matchId: null, lineupId: null }),
    ).not.toThrow();
  });

  it('reply: 409 read-only first (for everyone), then 403 not signed up', () => {
    expect(() => assertCanReply(false, null)).toThrow(
      new ForbiddenException(FORUM_NOT_SIGNED_UP),
    );
    expect(() => assertCanReply(true, lock)).toThrow(
      new ConflictException(FORUM_THREAD_READ_ONLY),
    );
    expect(() => assertCanReply(false, lock)).toThrow(
      new ConflictException(FORUM_THREAD_READ_ONLY),
    );
    expect(() => assertCanReply(true, null)).not.toThrow();
  });

  it('edit own: 403 read-only first, then 403 lapsed signup', () => {
    expect(() =>
      assertEventEditable({ userId: 9, canReply: true }, own, lock),
    ).toThrow(new ForbiddenException(FORUM_THREAD_READ_ONLY));
    expect(() =>
      assertEventEditable({ userId: 9, canReply: false }, own, null),
    ).toThrow(new ForbiddenException(FORUM_NOT_SIGNED_UP));
    expect(() =>
      assertEventEditable({ userId: 9, canReply: true }, own, null),
    ).not.toThrow();
  });

  it('leaves someone else’s or a deleted row to the generic checks', () => {
    expect(() =>
      assertEventEditable({ userId: 1, canReply: false }, own, lock),
    ).not.toThrow();
    const gone = { ...own, deletedAt: BEFORE };
    expect(() =>
      assertEventEditable({ userId: 9, canReply: false }, gone, lock),
    ).not.toThrow();
  });
});

describe('canFor readOnly', () => {
  const who = { userId: 9, canWrite: true, canModerate: false };
  const row = {
    authorId: 9,
    authorDiscordId: null,
    createdAt: BEFORE,
    deletedAt: null,
  };

  it('blocks edit but never delete-own', () => {
    expect(
      canFor(who, row, { now: NOW, pinnable: false, readOnly: true }),
    ).toEqual({
      edit: false,
      delete: true,
      pin: false,
    });
    expect(canFor(who, row, { now: NOW, pinnable: false }).edit).toBe(true);
  });
});
