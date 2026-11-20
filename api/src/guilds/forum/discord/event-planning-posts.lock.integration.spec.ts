/**
 * ROK-2272 S4a §3.5 — the registry pass of the Core lock sweep against a
 * real database. Discord is spied (`HubForumDiscordEventLockGateway`), the
 * bot is reported connected, and `syncEvent` is spied. The sweep sees other
 * specs' rows too, so every assertion is scoped to rows this test inserted.
 */
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
        subjectId: (nextSubject += 1),
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
  it('a hub-pass throw does not stop the registry pass', async () => {
    const { setReadOnly } = spies();
    const hub = app().get(HubForumDiscordEventLockSweep);
    jest.spyOn(hub, 'due').mockRejectedValue(new Error('hub pass down'));
    const p = await newPost({ closesInMs: -HOUR });
    await expect(hub.sweep()).resolves.toBeGreaterThanOrEqual(1);
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
