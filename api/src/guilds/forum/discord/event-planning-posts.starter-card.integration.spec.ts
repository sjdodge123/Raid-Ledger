/**
 * ROK-2292 — a NON-HUB event's registry post opens with the signup card and
 * tracks its starter, against a real database. Discord is spied
 * (`HubForumDiscordGateway` for the forum, `EventPlanningPostsGateway` for
 * the bot post, `HubForumDiscordEventLockGateway` for the lock) and the
 * forum resolver is pinned to a fresh forum row per test. D8: announce and
 * the lazy `ensureEventPost` (first signup line / reply), in either order or
 * at once, leave one post and one starter row (`channel_id = message_id =
 * thread id`). D7 + reopen: the sweep drops the row on lock and restores it
 * (plus a queued re-sync) when a reschedule reopens the post.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import {
  bootDiscussion,
  type DiscussionCtx,
} from '../event-discussion/event-discussion.test-fixtures';
import {
  starterRows,
  stubStarterSync,
} from './forum-starter-card.test-fixtures';
import { EventPlanningForumResolver } from './event-planning-forum.resolver';
import { EventPlanningPostsGateway } from './event-planning-posts.discord';
import { EventPlanningPostsLockSweep } from './event-planning-posts.lock';
import { EventPlanningPostsService } from './event-planning-posts.service';
import { HubForumDiscordAnnounceListener } from './hub-forum-discord-announce.listener';
import { HubForumDiscordEventLockGateway } from './hub-forum-discord-event-lock.gateway';
import {
  FAKE_DISCORD_GUILD,
  snowflake,
  stubForumGateway,
} from './hub-forum-discord.test-fixtures';

const HOUR = 3_600_000;
const posts = schema.eventPlanningPosts;

let ctx: DiscussionCtx;
let createPost: jest.SpiedFunction<EventPlanningPostsGateway['createPost']>;
let enqueue: jest.SpyInstance;
let forumId: number;

const testApp = () => ctx.posts.testApp;
const app = () => testApp().app;
const db = () => testApp().db;

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

beforeAll(async () => {
  ctx = await bootDiscussion('evplcard');
});

beforeEach(async () => {
  const fake = stubForumGateway(testApp());
  const gw = app().get(EventPlanningPostsGateway);
  jest.spyOn(gw, 'isOnline').mockReturnValue(true);
  jest.spyOn(gw, 'renameThread').mockResolvedValue('ok');
  createPost = jest
    .spyOn(gw, 'createPost')
    .mockImplementation(() => Promise.resolve(snowflake()));
  ({ enqueue } = stubStarterSync(testApp()));
  const channelId = fake.put({ tags: [] }).id;
  forumId = await newForumRow(channelId);
  jest
    .spyOn(app().get(EventPlanningForumResolver), 'resolve')
    .mockResolvedValue({
      forum: { forumId, channelId, managed: true, webhookId: null },
      candidates: [],
      warning: null,
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** A non-hub event ending `endInMs` from now (default: in 2 h). */
async function newEvent(endInMs = 2 * HOUR): Promise<number> {
  const end = new Date(Date.now() + endInMs);
  const [e] = nonEmpty(
    await db()
      .insert(schema.events)
      .values({
        title: 'Onyxia',
        creatorId: ctx.ids.creator,
        gameId: testApp().seed.game.id,
        duration: [new Date(end.getTime() - 2 * HOUR), end] as [Date, Date],
      })
      .returning(),
    'event',
  );
  return e.id;
}

const announce = (eventId: number): Promise<void> =>
  app().get(HubForumDiscordAnnounceListener).onAnnounced({ eventId });

const lazyCreate = (eventId: number) =>
  app().get(EventPlanningPostsService).ensureEventPost(eventId);

async function liveRows(eventId: number) {
  return db()
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.subjectKind, 'event'),
        eq(posts.subjectId, eventId),
        isNull(posts.discordDeletedAt),
      ),
    );
}

/** One live registry post whose starter is the one tracked row. */
async function expectOneTrackedPost(eventId: number): Promise<string> {
  const [row, ...extra] = nonEmpty(await liveRows(eventId), 'post row');
  expect(extra).toEqual([]);
  expect(await starterRows(testApp(), eventId)).toEqual([
    { channelId: row.discordThreadId, messageId: row.discordThreadId },
  ]);
  return row.discordThreadId;
}

describe('ROK-2292 D8 registry event post on announce', () => {
  it('announce posts the card and tracks the starter; the lazy creator reuses it', async () => {
    const eventId = await newEvent();
    await announce(eventId);
    expect(createPost).toHaveBeenCalledTimes(1);
    const [[, draft]] = nonEmpty(createPost.mock.calls, 'createPost');
    expect(draft.card?.embeds).toHaveLength(1);
    const threadId = await expectOneTrackedPost(eventId);
    expect((await lazyCreate(eventId))?.discordThreadId).toBe(threadId);
    expect(createPost).toHaveBeenCalledTimes(1);
    expect(await expectOneTrackedPost(eventId)).toBe(threadId);
  });

  it('reverse order: the lazy creator posts first, a later announce adds nothing', async () => {
    const eventId = await newEvent();
    const ref = await lazyCreate(eventId);
    if (!ref) throw new Error('lazy ensureEventPost made no post');
    expect(await expectOneTrackedPost(eventId)).toBe(ref.discordThreadId);
    await announce(eventId);
    expect(createPost).toHaveBeenCalledTimes(1);
    expect(await expectOneTrackedPost(eventId)).toBe(ref.discordThreadId);
  });

  it('a concurrent announce and lazy create leave one post and one starter row', async () => {
    const eventId = await newEvent();
    await Promise.all([announce(eventId), lazyCreate(eventId)]);
    await expectOneTrackedPost(eventId);
  });
});

describe('ROK-2292 D7 registry lock drops the starter row; reopen restores it', () => {
  function lockSpies() {
    const setReadOnly = jest
      .spyOn(app().get(HubForumDiscordEventLockGateway), 'setReadOnly')
      .mockResolvedValue('ok');
    jest
      .spyOn(app().get(EventPlanningPostsService), 'syncEvent')
      .mockResolvedValue(undefined);
    return { setReadOnly, sweep: app().get(EventPlanningPostsLockSweep) };
  }

  async function setClosesAt(eventId: number, at: Date): Promise<void> {
    await db()
      .update(posts)
      .set({ closesAt: at })
      .where(and(eq(posts.subjectKind, 'event'), eq(posts.subjectId, eventId)));
  }

  it('closing drops the row; a reschedule reopens, re-tracks and queues a re-sync', async () => {
    const eventId = await newEvent();
    await announce(eventId);
    const threadId = await expectOneTrackedPost(eventId);
    const { setReadOnly, sweep } = lockSpies();

    await setClosesAt(eventId, new Date(Date.now() - HOUR));
    await sweep.sweep(new Date());
    expect(setReadOnly).toHaveBeenCalledWith(threadId, true);
    expect(await starterRows(testApp(), eventId)).toEqual([]);

    await setClosesAt(eventId, new Date(Date.now() + HOUR));
    await sweep.sweep(new Date());
    expect(setReadOnly).toHaveBeenCalledWith(threadId, false);
    expect(await starterRows(testApp(), eventId)).toEqual([
      { channelId: threadId, messageId: threadId },
    ]);
    expect(enqueue).toHaveBeenCalledWith(eventId, 'forum-starter-reopened');
  });
});
