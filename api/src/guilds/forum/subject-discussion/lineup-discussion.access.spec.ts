import { ConflictException, ForbiddenException } from '@nestjs/common';
import { FORUM_THREAD_READ_ONLY } from '../event-discussion/event-discussion.access';
import {
  FORUM_NOT_LINEUP_PARTICIPANT,
  assertCanReplyToLineup,
  lineupThreadActor,
  lineupThreadLock,
  type LineupThreadFacts,
} from './lineup-discussion.access';

const NONE: LineupThreadFacts = {
  isMember: false,
  canModerate: false,
  hasNominated: false,
  hasVoted: false,
};
const NOW = new Date('2026-11-20T12:00:00.000Z');
const BEFORE = new Date(NOW.getTime() - 1);
const AFTER = new Date(NOW.getTime() + 1);

describe('lineupThreadActor (R7 matrix)', () => {
  const rows: [
    string,
    Partial<LineupThreadFacts>,
    [boolean, boolean, boolean, boolean],
  ][] = [
    // [label, facts, [canRead, canReply, canWrite, canModerate]]
    [
      'member, no nomination or vote',
      { isMember: true },
      [true, false, true, false],
    ],
    [
      'member who nominated',
      { isMember: true, hasNominated: true },
      [true, true, true, false],
    ],
    [
      'nominator, not a member',
      { hasNominated: true },
      [true, true, true, false],
    ],
    ['voter only, not a member', { hasVoted: true }, [true, true, true, false]],
    [
      'leader, not a participant',
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
    const who = lineupThreadActor(7, { ...NONE, ...over });
    expect({
      read: who.canRead,
      reply: who.canReply,
      write: who.canWrite,
      mod: who.canModerate,
    }).toEqual({ read, reply, write, mod });
    expect(who.userId).toBe(7);
  });
});

describe('lineupThreadLock', () => {
  const open = { eventDetachedAt: null, writeClosesAt: null };

  it('is null while open (no deadline, or deadline in the future)', () => {
    expect(lineupThreadLock(open, NOW)).toBeNull();
    expect(lineupThreadLock({ ...open, writeClosesAt: AFTER }, NOW)).toBeNull();
  });

  it('is ended once the deadline has passed', () => {
    expect(lineupThreadLock({ ...open, writeClosesAt: BEFORE }, NOW)).toEqual({
      at: BEFORE.toISOString(),
      reason: 'event-ended',
    });
  });

  it('reports detached before the deadline', () => {
    const row = { eventDetachedAt: BEFORE, writeClosesAt: BEFORE };
    expect(lineupThreadLock(row, NOW)?.reason).toBe('event-detached');
  });
});

describe('assertCanReplyToLineup', () => {
  const lock = { at: NOW.toISOString(), reason: 'event-ended' as const };

  it('lets a participant reply while open', () => {
    expect(() => assertCanReplyToLineup(true, null)).not.toThrow();
  });

  it('refuses a non-participant with 403 and the lineup copy', () => {
    const call = (): void => assertCanReplyToLineup(false, null);
    expect(call).toThrow(ForbiddenException);
    expect(call).toThrow(FORUM_NOT_LINEUP_PARTICIPANT);
  });

  it('refuses everyone with 409 once read-only (lock wins)', () => {
    const call = (): void => assertCanReplyToLineup(true, lock);
    expect(call).toThrow(ConflictException);
    expect(call).toThrow(FORUM_THREAD_READ_ONLY);
  });
});
