import { ConflictException, ForbiddenException } from '@nestjs/common';
import { FORUM_THREAD_READ_ONLY } from '../event-discussion/event-discussion.access';
import {
  FORUM_NOT_POLL_VOTER,
  assertCanReplyToPoll,
  pollThreadActor,
  pollThreadLock,
  type PollThreadFacts,
} from './poll-discussion.access';

const NONE: PollThreadFacts = {
  isMember: false,
  canModerate: false,
  hasVoted: false,
  isMatchMember: false,
};
const NOW = new Date('2026-11-20T12:00:00.000Z');
const BEFORE = new Date(NOW.getTime() - 1);
const AFTER = new Date(NOW.getTime() + 1);

describe('pollThreadActor (R7 matrix)', () => {
  const rows: [
    string,
    Partial<PollThreadFacts>,
    [boolean, boolean, boolean, boolean],
  ][] = [
    // [label, facts, [canRead, canReply, canWrite, canModerate]]
    ['member, not voted', { isMember: true }, [true, false, true, false]],
    [
      'member who voted',
      { isMember: true, hasVoted: true },
      [true, true, true, false],
    ],
    ['voter, not a member', { hasVoted: true }, [true, true, true, false]],
    [
      'match member, not voted',
      { isMatchMember: true },
      [true, true, true, false],
    ],
    [
      'leader, not voted',
      { isMember: true, canModerate: true },
      [true, false, true, true],
    ],
    ['visitor', {}, [false, false, false, false]],
    [
      'canEdit without canView never moderates',
      { canModerate: true },
      [false, false, false, false],
    ],
  ];
  it.each(rows)('%s', (_label, over, [read, reply, write, mod]) => {
    const who = pollThreadActor(7, { ...NONE, ...over });
    expect({
      read: who.canRead,
      reply: who.canReply,
      write: who.canWrite,
      mod: who.canModerate,
    }).toEqual({ read, reply, write, mod });
    expect(who.userId).toBe(7);
  });
});

describe('pollThreadLock', () => {
  const open = { eventDetachedAt: null, writeClosesAt: null };

  it('is null while open (no deadline, or deadline in the future)', () => {
    expect(pollThreadLock(open, NOW)).toBeNull();
    expect(pollThreadLock({ ...open, writeClosesAt: AFTER }, NOW)).toBeNull();
  });

  it('is ended once the deadline has passed (inclusive)', () => {
    expect(pollThreadLock({ ...open, writeClosesAt: BEFORE }, NOW)).toEqual({
      at: BEFORE.toISOString(),
      reason: 'event-ended',
    });
    const exact = pollThreadLock({ ...open, writeClosesAt: NOW }, NOW);
    expect(exact?.reason).toBe('event-ended');
  });

  it('reports detached before the deadline', () => {
    const row = { eventDetachedAt: BEFORE, writeClosesAt: BEFORE };
    expect(pollThreadLock(row, NOW)).toEqual({
      at: BEFORE.toISOString(),
      reason: 'event-detached',
    });
  });
});

describe('assertCanReplyToPoll', () => {
  const lock = { at: NOW.toISOString(), reason: 'event-ended' as const };

  it('lets a voter reply while open', () => {
    expect(() => assertCanReplyToPoll(true, null)).not.toThrow();
  });

  it('refuses a non-voter with 403 and the poll copy', () => {
    const call = (): void => assertCanReplyToPoll(false, null);
    expect(call).toThrow(ForbiddenException);
    expect(call).toThrow(FORUM_NOT_POLL_VOTER);
  });

  it('refuses everyone with 409 once read-only (lock wins)', () => {
    const call = (): void => assertCanReplyToPoll(true, lock);
    expect(call).toThrow(ConflictException);
    expect(call).toThrow(FORUM_THREAD_READ_ONLY);
  });
});
