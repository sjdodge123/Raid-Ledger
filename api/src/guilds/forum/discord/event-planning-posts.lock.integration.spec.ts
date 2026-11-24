/**
 * ROK-2272 S4a §3.5 — the registry pass of the Core lock sweep against a
 * real database. Discord is spied (`HubForumDiscordEventLockGateway`), the
 * bot is reported connected, and `syncEvent` is spied. The sweep sees other
 * specs' rows too, so every assertion is scoped to rows this test inserted.
 */
import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { nonEmpty } from '../../../common/testing/narrow';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import * as schema from '../../../drizzle/schema';
import {
  bootDiscussion,
  type DiscussionCtx,
} from '../event-discussion/event-discussion.test-fixtures';
import {
  dueRegistryLockChanges,
  EventPlanningPostsLockSweep,
} from './event-planning-posts.lock';
import { EventPlanningPostsService } from './event-planning-posts.service';
import { EventPlanningSubjectPosts } from './event-planning-posts.subjects';
import { HubForumDiscordEventLockSweep } from './hub-forum-discord-event-lock';
import { HubForumDiscordEventLockGateway } from './hub-forum-discord-event-lock.gateway';
import {
  FAKE_DISCORD_GUILD,
  snowflake,
} from './hub-forum-discord.test-fixtures';

const HOUR = 3_600_000;
const posts = schema.eventPlanningPosts;

let ctx: DiscussionCtx;
let forumId: number;

const app = () => ctx.posts.testApp.app;
const db = () => ctx.posts.testApp.db;

interface PostOver {
  closesInMs?: number | null;
  locked?: boolean;
  deleted?: boolean;
  subjectKind?: 'event' | 'poll' | 'lineup';
  subjectId?: number;
}

let nextSubject = 900_000 + Math.floor(Math.random() * 50_000);

async function newPost(over: PostOver = {}) {
  const now = Date.now();
  const closesInMs = over.closesInMs === undefined ? -HOUR : over.closesInMs;
  const [p] = nonEmpty(
    await db()
      .insert(posts)
      .values({
        subjectKind: over.subjectKind ?? 'event',
        subjectId: over.subjectId ?? (nextSubject += 1),
        forumId,
        discordThreadId: snowflake(),
        closesAt: closesInMs === null ? null : new Date(now + closesInMs),
        discordLockedAt: over.locked ? new Date(now - 2 * HOUR) : null,
        discordDeletedAt: over.deleted ? new Date(now) : null,
      })
      .returning(),
    'post',
  );
  return p;
}

async function lockedAt(postId: number): Promise<Date | null> {
  const [p] = nonEmpty(
    await db().select().from(posts).where(eq(posts.id, postId)),
    'post',
  );
  return p.discordLockedAt;
}

function spies() {
  jest
    .spyOn(app().get(DiscordBotClientService), 'isConnected')
    .mockReturnValue(true);
  const setReadOnly = jest
    .spyOn(app().get(HubForumDiscordEventLockGateway), 'setReadOnly')
    .mockResolvedValue('ok');
  const syncEvent = jest
    .spyOn(app().get(EventPlanningPostsService), 'syncEvent')
    .mockResolvedValue(undefined);
  return { setReadOnly, syncEvent };
}

beforeAll(async () => {
  ctx = await bootDiscussion('evpll');
});

beforeEach(async () => {
  const [f] = nonEmpty(
    await db()
      .insert(schema.hubForumDiscordForums)
      .values({ discordGuildId: FAKE_DISCORD_GUILD, channelId: snowflake() })
      .returning(),
    'forum',
  );
  forumId = f.id;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ROK-2272 S4a dueRegistryLockChanges', () => {
  it.each<[string, PostOver, boolean | 'none']>([
    ['past and unlocked → close', { closesInMs: -HOUR }, true],
    ['future and locked → reopen', { closesInMs: HOUR, locked: true }, false],
    ['deleted → skipped', { closesInMs: -HOUR, deleted: true }, 'none'],
    ['null closes_at → skipped', { closesInMs: null }, 'none'],
    ['already closed and past → not due', { locked: true }, 'none'],
    ['open and future → not due', { closesInMs: HOUR }, 'none'],
  ])('%s', async (_, over, expected) => {
    const p = await newPost(over);
    const due = await dueRegistryLockChanges(db(), new Date());
    const mine = due.find((d) => d.postId === p.id);
    if (expected === 'none') {
      expect(mine).toBeUndefined();
    } else {
      expect(mine).toEqual({
        postId: p.id,
        subjectKind: 'event',
        subjectId: p.subjectId,
        discordThreadId: p.discordThreadId,
        readOnly: expected,
      });
    }
  });
});

describe('ROK-2272 S4a EventPlanningPostsLockSweep', () => {
  it('closes a due post: lock + archive, then records discord_locked_at', async () => {
    const { setReadOnly, syncEvent } = spies();
    const p = await newPost({ closesInMs: -HOUR });
    await app().get(EventPlanningPostsLockSweep).sweep();
    expect(setReadOnly).toHaveBeenCalledWith(p.discordThreadId, true);
    expect(await lockedAt(p.id)).not.toBeNull();
    expect(syncEvent).not.toHaveBeenCalledWith(p.subjectId);
  });

  it('reopens a rescheduled event post and re-syncs its title', async () => {
    const { setReadOnly, syncEvent } = spies();
    const p = await newPost({ closesInMs: HOUR, locked: true });
    await app().get(EventPlanningPostsLockSweep).sweep();
    expect(setReadOnly).toHaveBeenCalledWith(p.discordThreadId, false);
    expect(await lockedAt(p.id)).toBeNull();
    expect(syncEvent).toHaveBeenCalledWith(p.subjectId);
  });

  it('reopening a poll post does not call syncEvent', async () => {
    const { syncEvent } = spies();
    const p = await newPost({
      closesInMs: HOUR,
      locked: true,
      subjectKind: 'poll',
    });
    await app().get(EventPlanningPostsLockSweep).sweep();
    expect(await lockedAt(p.id)).toBeNull();
    expect(syncEvent).not.toHaveBeenCalledWith(p.subjectId);
  });

  it('a Discord failure leaves the row untouched and is not counted', async () => {
    const { setReadOnly } = spies();
    const p = await newPost({ closesInMs: -HOUR });
    setReadOnly.mockImplementation((threadId) =>
      threadId === p.discordThreadId
        ? Promise.reject(new Error('discord 500'))
        : Promise.resolve('ok' as const),
    );
    const n = await app().get(EventPlanningPostsLockSweep).sweep();
    expect(await lockedAt(p.id)).toBeNull();
    expect(n).toBe(setReadOnly.mock.calls.length - 1);
  });

  it('bot offline: nothing changes', async () => {
    const { setReadOnly } = spies();
    jest
      .spyOn(app().get(DiscordBotClientService), 'isConnected')
      .mockReturnValue(false);
    const p = await newPost({ closesInMs: -HOUR });
    expect(await app().get(EventPlanningPostsLockSweep).sweep()).toBe(0);
    expect(setReadOnly).not.toHaveBeenCalled();
    expect(await lockedAt(p.id)).toBeNull();
  });
});

describe('ROK-2272 S4a HubForumDiscordEventLockSweep runs both passes', () => {
  it('a hub-pass throw still runs the registry pass, then rethrows', async () => {
    const { setReadOnly } = spies();
    const hub = app().get(HubForumDiscordEventLockSweep);
    jest.spyOn(hub, 'due').mockRejectedValue(new Error('hub pass down'));
    const p = await newPost({ closesInMs: -HOUR });
    await expect(hub.sweep()).rejects.toThrow('hub pass down');
    expect(setReadOnly).toHaveBeenCalledWith(p.discordThreadId, true);
    expect(await lockedAt(p.id)).not.toBeNull();
  });
});

describe('ROK-2272 S4 review MAJOR-2: lock sweep on a deleted post', () => {
  it('review MAJOR-2: a post gone from Discord is marked deleted, not locked, and not due again', async () => {
    const { setReadOnly } = spies();
    const p = await newPost({ closesInMs: -HOUR });
    setReadOnly.mockImplementation((threadId) =>
      Promise.resolve(threadId === p.discordThreadId ? 'gone' : 'ok'),
    );
    await app().get(EventPlanningPostsLockSweep).sweep();
    expect(setReadOnly).toHaveBeenCalledWith(p.discordThreadId, true);
    const [row] = nonEmpty(
      await db().select().from(posts).where(eq(posts.id, p.id)),
      'post',
    );
    expect(row.discordDeletedAt).not.toBeNull();
    expect(row.discordLockedAt).toBeNull();
    const due = await dueRegistryLockChanges(db(), new Date());
    expect(due.find((d) => d.postId === p.id)).toBeUndefined();
  });
});

describe('ROK-2272 S10 deadline pass for non-hub poll posts', () => {
  /** A non-hub standalone poll whose phase_deadline passed 2 h ago. */
  async function expiredPoll(): Promise<number> {
    const [l] = nonEmpty(
      await db()
        .insert(schema.communityLineups)
        .values({
          title: `Expired poll ${nextSubject}`,
          phaseDurationOverride: { standalone: true },
          status: 'decided',
          visibility: 'public',
          createdBy: ctx.ids.creator,
          guildId: null,
          phaseDeadline: new Date(Date.now() - 2 * HOUR),
          publicSlug: randomBytes(8).toString('hex'),
        })
        .returning(),
      'lineup',
    );
    const [m] = nonEmpty(
      await db()
        .insert(schema.communityLineupMatches)
        .values({
          lineupId: l.id,
          gameId: ctx.posts.testApp.seed.game.id,
          status: 'scheduling',
        })
        .returning(),
      'match',
    );
    return m.id;
  }

  it('an expired poll post with no closes_at is stamped and locked by one sweep', async () => {
    const { setReadOnly } = spies();
    const matchId = await expiredPoll();
    const p = await newPost({
      subjectKind: 'poll',
      subjectId: matchId,
      closesInMs: null,
    });
    await app().get(EventPlanningPostsLockSweep).sweep(new Date());
    const [row] = nonEmpty(
      await db().select().from(posts).where(eq(posts.id, p.id)),
      'post',
    );
    expect(row.closesAt?.getTime()).toBeLessThanOrEqual(Date.now() - HOUR / 2);
    expect(row.discordLockedAt).not.toBeNull();
    expect(setReadOnly).toHaveBeenCalledWith(p.discordThreadId, true);
  });

  it('a throwing deadline pass is warned and the flip loop still runs', async () => {
    const { setReadOnly } = spies();
    jest
      .spyOn(app().get(EventPlanningSubjectPosts), 'syncOpenPolls')
      .mockRejectedValue(new Error('boom'));
    const p = await newPost();
    await app().get(EventPlanningPostsLockSweep).sweep(new Date());
    expect(await lockedAt(p.id)).not.toBeNull();
    expect(setReadOnly).toHaveBeenCalledWith(p.discordThreadId, true);
  });
});

describe('ROK-2272 S10 reopen of a poll / lineup post (Codex P2)', () => {
  it('Codex P2: a locked poll or lineup post whose closes_at was cleared is reopened', async () => {
    const { setReadOnly } = spies();
    const poll = await newPost({
      closesInMs: null,
      locked: true,
      subjectKind: 'poll',
    });
    const lineup = await newPost({
      closesInMs: null,
      locked: true,
      subjectKind: 'lineup',
    });
    await app().get(EventPlanningPostsLockSweep).sweep();
    expect(setReadOnly).toHaveBeenCalledWith(poll.discordThreadId, false);
    expect(setReadOnly).toHaveBeenCalledWith(lineup.discordThreadId, false);
    expect(await lockedAt(poll.id)).toBeNull();
    expect(await lockedAt(lineup.id)).toBeNull();
  });

  it('a locked EVENT post with a null closes_at stays locked', async () => {
    const { setReadOnly } = spies();
    const p = await newPost({ closesInMs: null, locked: true });
    await app().get(EventPlanningPostsLockSweep).sweep();
    expect(setReadOnly).not.toHaveBeenCalledWith(p.discordThreadId, false);
    expect(await lockedAt(p.id)).not.toBeNull();
  });
});

describe('ROK-2314 an event post is closed while its reschedule poll runs', () => {
  /** A real (non-hub) event, optionally mid-reschedule. */
  async function newEvent(rescheduling: boolean): Promise<number> {
    const start = Date.now() + 24 * HOUR;
    const [e] = nonEmpty(
      await db()
        .insert(schema.events)
        .values({
          title: 'Rescheduling event',
          creatorId: ctx.ids.creator,
          gameId: ctx.posts.testApp.seed.game.id,
          isAdHoc: false,
          reschedulingPollId: rescheduling ? 1 : null,
          duration: [new Date(start), new Date(start + 2 * HOUR)] as [
            Date,
            Date,
          ],
        })
        .returning(),
      'event',
    );
    return e.id;
  }

  async function clearRescheduling(eventId: number): Promise<void> {
    await db()
      .update(schema.events)
      .set({ reschedulingPollId: null })
      .where(eq(schema.events.id, eventId));
  }

  const dueFor = async (postId: number, eventId: number) =>
    (await dueRegistryLockChanges(db(), new Date(), eventId)).find(
      (d) => d.postId === postId,
    )?.readOnly;

  it('an open post with a future close is due to close while rescheduling', async () => {
    const subjectId = await newEvent(true);
    const p = await newPost({ closesInMs: HOUR, subjectId });
    expect(await dueFor(p.id, subjectId)).toBe(true);
  });

  it('a locked post stays closed while rescheduling, reopens once cleared', async () => {
    const subjectId = await newEvent(true);
    const p = await newPost({ closesInMs: HOUR, locked: true, subjectId });
    expect(await dueFor(p.id, subjectId)).toBeUndefined();
    await clearRescheduling(subjectId);
    expect(await dueFor(p.id, subjectId)).toBe(false);
  });

  it('cleared with a past close: the locked post stays closed', async () => {
    const subjectId = await newEvent(true);
    const p = await newPost({ closesInMs: -HOUR, locked: true, subjectId });
    await clearRescheduling(subjectId);
    expect(await dueFor(p.id, subjectId)).toBeUndefined();
  });

  it('the eventId filter returns only that event’s posts', async () => {
    const subjectId = await newEvent(true);
    await newPost({ closesInMs: -HOUR });
    const due = await dueRegistryLockChanges(db(), new Date(), subjectId);
    expect(due.every((d) => d.subjectId === subjectId)).toBe(true);
  });

  it('reopenIfPending reports closed while rescheduling (no Discord call)', async () => {
    const { setReadOnly } = spies();
    const subjectId = await newEvent(true);
    const locked = await newPost({ closesInMs: HOUR, locked: true, subjectId });
    const open = await newPost({
      closesInMs: HOUR,
      subjectId: await newEvent(true),
    });
    const sweep = app().get(EventPlanningPostsLockSweep);
    expect(await sweep.reopenIfPending(locked.id)).toBe('closed');
    expect(await sweep.reopenIfPending(open.id)).toBe('closed');
    expect(setReadOnly).not.toHaveBeenCalled();
  });

  it('sweepEvent closes then reopens just that event’s post', async () => {
    const { setReadOnly } = spies();
    const subjectId = await newEvent(true);
    const p = await newPost({ closesInMs: HOUR, subjectId });
    const sweep = app().get(EventPlanningPostsLockSweep);
    expect(await sweep.sweepEvent(subjectId)).toBe(1);
    expect(setReadOnly).toHaveBeenCalledWith(p.discordThreadId, true);
    expect(await lockedAt(p.id)).not.toBeNull();
    await clearRescheduling(subjectId);
    expect(await sweep.sweepEvent(subjectId)).toBe(1);
    expect(setReadOnly).toHaveBeenLastCalledWith(p.discordThreadId, false);
    expect(await lockedAt(p.id)).toBeNull();
  });
});
