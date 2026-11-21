/**
 * ROK-1175 L2 — row → contract mapping: every output parses against the
 * contract schema, and deleted rows are blanked in every view (Q8).
 */
import {
  HubForumReplySchema,
  HubForumThreadSchema,
  HubForumThreadSummarySchema,
  type HubForumCan,
} from '@raid-ledger/contract';
import type {
  HubForumReplySelect,
  HubForumThreadSelect,
} from '../../drizzle/schema/hub-forum';
import type { HubPostPersonRow } from '../posts/hub-posts.helpers';
import {
  toForumReply,
  toForumThread,
  toThreadSummary,
  type HubForumEventRow,
} from './hub-forum.mappers';

const AT = new Date('2026-11-14T10:00:00.000Z');
const LATER = new Date('2026-11-14T11:00:00.000Z');
const CAN: HubForumCan = { edit: true, delete: true, pin: false };

const person: HubPostPersonRow = {
  userId: 5,
  username: 'thrall',
  displayName: null,
  avatar: null,
  customAvatarUrl: null,
  discordId: null,
};

function thread(
  over: Partial<HubForumThreadSelect> = {},
): HubForumThreadSelect {
  return {
    id: 9,
    guildId: 2,
    authorId: 5,
    title: 'Raid night',
    body: '**Bring** flasks',
    pinnedAt: null,
    pinnedBy: null,
    replyCount: 3,
    lastActivityAt: LATER,
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    deletedAs: null,
    authorDiscordId: null,
    authorDiscordName: null,
    authorDiscordAvatar: null,
    createdAt: AT,
    updatedAt: AT,
    eventId: null,
    eventDetachedAt: null,
    matchId: null,
    lineupId: null,
    writeClosesAt: null,
    ...over,
  };
}

function reply(over: Partial<HubForumReplySelect> = {}): HubForumReplySelect {
  return {
    id: 4,
    threadId: 9,
    guildId: 2,
    authorId: 5,
    kind: 'reply',
    subjectUserId: null,
    body: 'see you there',
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    deletedAs: null,
    authorDiscordId: null,
    authorDiscordName: null,
    authorDiscordAvatar: null,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

/** An event thread view whose event carries the given capacity columns. */
function eventThreadWith(
  cap: Pick<HubForumEventRow, 'maxAttendees' | 'slotConfig'>,
): ReturnType<typeof toForumThread> {
  return toForumThread(
    {
      thread: thread({ eventId: 77 }),
      author: person,
      event: {
        id: 77,
        title: 'Molten Core',
        duration: [LATER, LATER],
        cancelledAt: null,
        creatorId: 5,
        ...cap,
      },
    },
    CAN,
    { replies: [], nextReplyCursor: null, signupCount: 3 },
  );
}

describe('toThreadSummary', () => {
  it('maps a live thread with a plain preview and ISO dates', () => {
    const out = toThreadSummary({ thread: thread(), author: person });
    expect(HubForumThreadSummarySchema.parse(out)).toEqual({
      id: 9,
      title: 'Raid night',
      preview: 'Bring flasks',
      author: { userId: 5, displayName: 'thrall', avatarUrl: null },
      createdAt: AT.toISOString(),
      lastActivityAt: LATER.toISOString(),
      replyCount: 3,
      pinnedAt: null,
      deleted: null,
    });
  });

  // Codex P2 (ROK-2226): list rows carry no `can`, so the web's `forumRowCan`
  // tells a lifecycle-owned event thread apart by the PRESENCE of `event` —
  // set (object or null) on every event thread, absent on a normal one.
  it('marks every event thread by an `event` key, even once the event is deleted', () => {
    const normal = toThreadSummary({ thread: thread(), author: person });
    expect('event' in normal).toBe(false);
    const orphan = toThreadSummary(
      { thread: thread({ eventId: 77 }), author: person, event: null },
      LATER,
    );
    expect('event' in orphan).toBe(true);
    expect(orphan.event).toBeNull();
    expect(orphan.lock).toMatchObject({ reason: 'event-deleted' });
  });

  // ROK-2272 S7 Codex: poll / lineup threads are lifecycle-owned too, so the
  // list row must name the subject for `forumRowCan` to withhold Edit/Delete.
  it('names a poll or lineup subject on the row, and nothing on a normal thread', () => {
    const normal = toThreadSummary({ thread: thread(), author: person });
    expect('matchId' in normal || 'lineupId' in normal).toBe(false);
    const poll = toThreadSummary({
      thread: thread({ matchId: 41 }),
      author: person,
    });
    expect(HubForumThreadSummarySchema.parse(poll)).toMatchObject({
      matchId: 41,
    });
    expect('lineupId' in poll).toBe(false);
    const lineup = toThreadSummary({
      thread: thread({ lineupId: 12 }),
      author: person,
    });
    expect(lineup).toMatchObject({ lineupId: 12 });
    expect('matchId' in lineup).toBe(false);
  });

  it('blanks title + preview of a deleted thread and says who removed it', () => {
    const gone = thread({
      deletedAt: LATER,
      deletedAs: 'moderator',
      deletedBy: 7,
    });
    const out = toThreadSummary({ thread: gone, author: person });
    expect(out).toMatchObject({ title: '', preview: '', deleted: 'moderator' });
  });

  it('maps a wiped author to null and a pin to its ISO time', () => {
    const pinned = thread({ authorId: null, pinnedAt: LATER, pinnedBy: 7 });
    const out = toThreadSummary({ thread: pinned, author: null });
    expect(out.author).toBeNull();
    expect(out.pinnedAt).toBe(LATER.toISOString());
  });
});

describe('toForumReply', () => {
  it('maps a live, edited reply', () => {
    const out = toForumReply(
      { reply: reply({ editedAt: LATER }), author: person },
      CAN,
    );
    expect(HubForumReplySchema.parse(out)).toMatchObject({
      id: 4,
      body: 'see you there',
      editedAt: LATER.toISOString(),
      deleted: null,
      can: CAN,
    });
  });

  it('blanks a deleted reply body', () => {
    const gone = reply({ deletedAt: LATER, deletedAs: 'author', deletedBy: 5 });
    const out = toForumReply({ reply: gone, author: person }, CAN);
    expect(out).toMatchObject({ body: '', deleted: 'author' });
  });
});

describe('toForumThread', () => {
  it('adds the root body, can and the replies page', () => {
    const replies = [toForumReply({ reply: reply(), author: null }, CAN)];
    const out = toForumThread({ thread: thread(), author: person }, CAN, {
      replies,
      nextReplyCursor: 'abc',
    });
    const parsed = HubForumThreadSchema.parse(out);
    expect(parsed).toMatchObject({ body: '**Bring** flasks', can: CAN });
    expect(parsed.replies).toEqual(replies);
    expect(parsed.nextReplyCursor).toBe('abc');
  });

  // ROK-2229: the thread view's event header shows "N / M signed up".
  it('folds the signup count and capacity into an event thread', () => {
    const out = toForumThread(
      {
        thread: thread({ eventId: 77 }),
        author: person,
        event: {
          id: 77,
          title: 'Molten Core',
          duration: [LATER, LATER],
          cancelledAt: null,
          creatorId: 5,
          maxAttendees: 40,
        },
      },
      CAN,
      { replies: [], nextReplyCursor: null, signupCount: 18 },
    );
    const parsed = HubForumThreadSchema.parse(out);
    expect(parsed.event).toMatchObject({ signupCount: 18, maxAttendees: 40 });
  });

  // ROK-2229 (Codex P2): capacity matches the event page and auto-bench —
  // a slot roster wins over the legacy maxAttendees column.
  it('uses the slot roster capacity over maxAttendees', () => {
    const parsed = HubForumThreadSchema.parse(
      eventThreadWith({
        maxAttendees: 40,
        slotConfig: { type: 'generic', player: 5 },
      }),
    );
    expect(parsed.event?.maxAttendees).toBe(5);
  });

  it('keeps maxAttendees when there is no slot roster', () => {
    const parsed = HubForumThreadSchema.parse(
      eventThreadWith({ maxAttendees: 40, slotConfig: null }),
    );
    expect(parsed.event?.maxAttendees).toBe(40);
  });

  it('reports an uncapped event as null capacity', () => {
    const parsed = HubForumThreadSchema.parse(
      eventThreadWith({ maxAttendees: null, slotConfig: null }),
    );
    expect(parsed.event?.maxAttendees).toBeNull();
  });

  // m1 (ROK-2229 review): allocation treats 0 as always full, so the header
  // must show "/ 0", never uncapped.
  it('keeps a zero capacity as 0 rather than uncapped', () => {
    const roster = HubForumThreadSchema.parse(
      eventThreadWith({
        maxAttendees: 40,
        slotConfig: { type: 'generic', player: 0 },
      }),
    );
    expect(roster.event?.maxAttendees).toBe(0);
    const legacy = HubForumThreadSchema.parse(
      eventThreadWith({ maxAttendees: 0, slotConfig: null }),
    );
    expect(legacy.event?.maxAttendees).toBe(0);
  });

  it('leaves a normal thread without an event when a count is passed', () => {
    const out = toForumThread({ thread: thread(), author: person }, CAN, {
      replies: [],
      nextReplyCursor: null,
      signupCount: 3,
    });
    expect('event' in out).toBe(false);
  });

  it('blanks the root body of a deleted thread', () => {
    const gone = thread({
      deletedAt: LATER,
      deletedAs: 'author',
      deletedBy: 5,
    });
    const out = toForumThread({ thread: gone, author: person }, CAN, {
      replies: [],
      nextReplyCursor: null,
    });
    expect(out).toMatchObject({ title: '', body: '', preview: '' });
  });
});
