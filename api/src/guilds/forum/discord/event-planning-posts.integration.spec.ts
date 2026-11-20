/**
 * ROK-2272 S4a — Discord-only posts for NON-HUB events against a real
 * database. Discord is spied on (`HubForumDiscordGateway` for the forum and
 * its tags, `EventPlanningPostsGateway` for the bot-posted thread) and the
 * forum resolver is pinned to a fresh forum row per test, so randomized
 * order and other specs' bound forums share nothing.
 */
import { and, eq } from 'drizzle-orm';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { newHub } from '../../posts/hub-posts.test-fixtures';
import { WRITE_GRACE_MS } from '../event-discussion/event-discussion.sync';
import {
  bootDiscussion,
  type DiscussionCtx,
} from '../event-discussion/event-discussion.test-fixtures';
import { EventPlanningForumResolver } from './event-planning-forum.resolver';
import { EventPlanningPostsGateway } from './event-planning-posts.discord';
import { EventPlanningPostsService } from './event-planning-posts.service';
import { EVENT_TAG_NAME } from './hub-forum-discord-decor';
import { eventPostTitle } from './hub-forum-discord-event-outbound';
import {
  FAKE_DISCORD_GUILD,
  snowflake,
  stubForumGateway,
  type FakeDiscord,
} from './hub-forum-discord.test-fixtures';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MISSING_FORUM_ID = 2_000_000_000;

let ctx: DiscussionCtx;
let svc: EventPlanningPostsService;
let fake: FakeDiscord;
let channelId: string;
let forumId: number;

const app = () => ctx.posts.testApp.app;
const db = () => ctx.posts.testApp.db;

/** Spy every bot write; each create returns a fresh thread id. */
function stubPlanning() {
  const gw = app().get(EventPlanningPostsGateway);
  return {
    isOnline: jest.spyOn(gw, 'isOnline').mockReturnValue(true),
    createPost: jest
      .spyOn(gw, 'createPost')
      .mockImplementation(() => Promise.resolve(snowflake())),
    renameThread: jest.spyOn(gw, 'renameThread').mockResolvedValue('ok'),
    deleteThread: jest.spyOn(gw, 'deleteThread').mockResolvedValue('ok'),
  };
}
let planning: ReturnType<typeof stubPlanning>;

/** Pin the resolver to `id` (null = no forum resolves). */
function resolveTo(id: number | null) {
  const resolver = app().get(EventPlanningForumResolver);
  const forum =
    id === null
      ? null
      : { forumId: id, channelId, managed: true, webhookId: null };
  jest
    .spyOn(resolver, 'resolve')
    .mockResolvedValue({ forum, candidates: [], warning: null });
  return jest.spyOn(resolver, 'invalidate');
}

async function newForumRow(channel: string): Promise<number> {
  const [f] = nonEmpty(
    await db()
      .insert(schema.hubForumDiscordForums)
      .values({ discordGuildId: FAKE_DISCORD_GUILD, channelId: channel })
      .returning(),
    'forum',
  );
  return f.id;
}

interface EventOver {
  guildId?: number;
  isAdHoc?: boolean;
  cancelledAt?: Date;
  endInMs?: number;
}

async function newEvent(over: EventOver = {}): Promise<number> {
  const end = new Date(Date.now() + (over.endInMs ?? 2 * HOUR));
  const [e] = nonEmpty(
    await db()
      .insert(schema.events)
      .values({
        title: 'Onyxia',
        creatorId: ctx.ids.creator,
        gameId: ctx.posts.testApp.seed.game.id,
        guildId: over.guildId ?? null,
        isAdHoc: over.isAdHoc ?? false,
        cancelledAt: over.cancelledAt ?? null,
        duration: [new Date(end.getTime() - 2 * HOUR), end] as [Date, Date],
      })
      .returning(),
    'event',
  );
  return e.id;
}

async function eventRow(eventId: number) {
  const [e] = nonEmpty(
    await db()
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId)),
    'event',
  );
  return e;
}

async function liveRows(eventId: number) {
  const p = schema.eventPlanningPosts;
  return db()
    .select()
    .from(p)
    .where(and(eq(p.subjectKind, 'event'), eq(p.subjectId, eventId)));
}

async function expectedTitle(eventId: number): Promise<string> {
  const e = await eventRow(eventId);
  const zone = await app().get(SettingsService).getDefaultTimezone();
  return eventPostTitle(e.title, e.duration[0], zone);
}

beforeAll(async () => {
  ctx = await bootDiscussion('evplp');
  svc = app().get(EventPlanningPostsService);
});

beforeEach(async () => {
  fake = stubForumGateway(ctx.posts.testApp);
  planning = stubPlanning();
  channelId = fake.put({ tags: [] }).id;
  forumId = await newForumRow(channelId);
  resolveTo(forumId);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ROK-2272 S4a ensureEventPost', () => {
  it('creates a bot post with only the Event tag and records closes_at = end + grace', async () => {
    const eventId = await newEvent();
    const ref = await svc.ensureEventPost(eventId);
    const tag = fake.forums
      .get(channelId)
      ?.tags.find((t) => t.name === EVENT_TAG_NAME);
    expect(tag).toBeDefined();
    expect(planning.createPost).toHaveBeenCalledTimes(1);
    expect(planning.createPost).toHaveBeenCalledWith(channelId, {
      title: await expectedTitle(eventId),
      content: expect.stringContaining(`/events/${eventId}`) as string,
      tagIds: [tag?.id],
    });
    const [row] = nonEmpty(await liveRows(eventId), 'post row');
    expect(ref).toEqual({
      postId: row.id,
      forumId,
      discordThreadId: row.discordThreadId,
    });
    const end = (await eventRow(eventId)).duration[1];
    expect(row.closesAt?.getTime()).toBe(end.getTime() + WRITE_GRACE_MS);
  });

  it('returns the same post on the second call and creates nothing more', async () => {
    const eventId = await newEvent();
    const first = await svc.ensureEventPost(eventId);
    const second = await svc.ensureEventPost(eventId);
    expect(second).toEqual(first);
    expect(planning.createPost).toHaveBeenCalledTimes(1);
    expect(await liveRows(eventId)).toHaveLength(1);
  });
});

describe('ROK-2272 S4a ensureEventPost refusals', () => {
  it.each([
    ['hub-tagged', async () => newEvent({ guildId: await newHub(ctx.posts) })],
    ['ad-hoc', () => newEvent({ isAdHoc: true })],
    ['cancelled', () => newEvent({ cancelledAt: new Date() })],
    [
      'ended past the grace',
      () => newEvent({ endInMs: -(WRITE_GRACE_MS + HOUR) }),
    ],
  ])('returns null for a %s event and touches no Discord', async (_, make) => {
    const eventId = await make();
    expect(await svc.ensureEventPost(eventId)).toBeNull();
    expect(planning.createPost).not.toHaveBeenCalled();
    expect(await liveRows(eventId)).toEqual([]);
  });

  it('returns null when no forum resolves', async () => {
    resolveTo(null);
    const eventId = await newEvent();
    expect(await svc.ensureEventPost(eventId)).toBeNull();
    expect(planning.createPost).not.toHaveBeenCalled();
  });

  it('returns null when the bot is offline', async () => {
    planning.isOnline.mockReturnValue(false);
    const eventId = await newEvent();
    expect(await svc.ensureEventPost(eventId)).toBeNull();
    expect(planning.createPost).not.toHaveBeenCalled();
  });
});

describe('ROK-2272 S4a ensureEventPost races', () => {
  it('forum row vanished (FK): null, cache invalidated, created thread deleted', async () => {
    const invalidate = resolveTo(MISSING_FORUM_ID);
    const eventId = await newEvent();
    expect(await svc.ensureEventPost(eventId)).toBeNull();
    const created = await planning.createPost.mock.results[0]?.value;
    expect(planning.deleteThread).toHaveBeenCalledWith(created);
    expect(invalidate).toHaveBeenCalled();
    expect(await liveRows(eventId)).toEqual([]);
  });

  it('lost create race: returns the winner and deletes its own thread', async () => {
    const eventId = await newEvent();
    const winner = snowflake();
    const own = snowflake();
    planning.createPost.mockImplementation(async () => {
      await db().insert(schema.eventPlanningPosts).values({
        subjectKind: 'event',
        subjectId: eventId,
        forumId,
        discordThreadId: winner,
      });
      return own;
    });
    const ref = await svc.ensureEventPost(eventId);
    expect(ref?.discordThreadId).toBe(winner);
    expect(planning.deleteThread).toHaveBeenCalledWith(own);
    expect(await liveRows(eventId)).toHaveLength(1);
  });

  it('any other insert failure deletes the created thread and rethrows (MINOR-2)', async () => {
    const eventId = await newEvent();
    const other = await newEvent();
    const own = snowflake();
    // Another subject already holds this thread id: a 23505 that is not
    // "this event already has a post", so the insert rethrows it.
    planning.createPost.mockImplementation(async () => {
      await db().insert(schema.eventPlanningPosts).values({
        subjectKind: 'event',
        subjectId: other,
        forumId,
        discordThreadId: own,
      });
      return own;
    });
    await expect(svc.ensureEventPost(eventId)).rejects.toThrow();
    expect(planning.deleteThread).toHaveBeenCalledWith(own);
    expect(await liveRows(eventId)).toEqual([]);
  });
});

describe('ROK-2272 S4a syncEvent / closeForDeletedEvent', () => {
  it('a reschedule retitles the post and moves closes_at', async () => {
    const eventId = await newEvent();
    const ref = await svc.ensureEventPost(eventId);
    const start = new Date(Date.now() + 3 * DAY);
    await db()
      .update(schema.events)
      .set({
        title: 'Blackwing Lair',
        duration: [start, new Date(start.getTime() + 2 * HOUR)],
      })
      .where(eq(schema.events.id, eventId));
    await svc.syncEvent(eventId);
    expect(planning.renameThread).toHaveBeenCalledWith(
      ref?.discordThreadId,
      await expectedTitle(eventId),
    );
    const [row] = nonEmpty(await liveRows(eventId), 'post row');
    const end = (await eventRow(eventId)).duration[1];
    expect(row.closesAt?.getTime()).toBe(end.getTime() + WRITE_GRACE_MS);
  });

  it('a cancel moves closes_at to cancelled_at + grace', async () => {
    const eventId = await newEvent();
    await svc.ensureEventPost(eventId);
    await db()
      .update(schema.events)
      .set({ cancelledAt: new Date() })
      .where(eq(schema.events.id, eventId));
    await svc.syncEvent(eventId);
    const cancelledAt = (await eventRow(eventId)).cancelledAt;
    const [row] = nonEmpty(await liveRows(eventId), 'post row');
    expect(row.closesAt?.getTime()).toBe(
      (cancelledAt?.getTime() ?? NaN) + WRITE_GRACE_MS,
    );
  });

  it('never creates a post', async () => {
    const eventId = await newEvent();
    await svc.syncEvent(eventId);
    expect(planning.createPost).not.toHaveBeenCalled();
    expect(await liveRows(eventId)).toEqual([]);
  });

  it('a deleted event makes its post due now', async () => {
    const eventId = await newEvent();
    await svc.ensureEventPost(eventId);
    await db().delete(schema.events).where(eq(schema.events.id, eventId));
    const before = Date.now();
    await svc.closeForDeletedEvent(eventId);
    const [row] = nonEmpty(await liveRows(eventId), 'post row');
    expect(row.closesAt?.getTime()).toBeLessThanOrEqual(Date.now());
    expect(row.closesAt?.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe('ROK-2272 S4 syncEvent — the event left the non-hub path', () => {
  it.each<[string, () => Promise<Partial<typeof schema.events.$inferInsert>>]>([
    ['hub-tagged', async () => ({ guildId: await newHub(ctx.posts) })],
    ['ad-hoc', () => Promise.resolve({ isAdHoc: true })],
  ])(
    'an event that became %s: its live post is due now, not retitled (MINOR-4)',
    async (_label, change) => {
      const eventId = await newEvent();
      await svc.ensureEventPost(eventId);
      await db()
        .update(schema.events)
        .set(await change())
        .where(eq(schema.events.id, eventId));
      const before = Date.now();
      await svc.syncEvent(eventId);
      const [row] = nonEmpty(await liveRows(eventId), 'post row');
      expect(row.closesAt?.getTime()).toBeGreaterThanOrEqual(before);
      expect(row.closesAt?.getTime()).toBeLessThanOrEqual(Date.now());
      expect(planning.renameThread).not.toHaveBeenCalled();
    },
  );
});
