/**
 * ROK-2272 S2 — the event-planning schema against a real database:
 * `event_planning_posts` keeps one live post per subject (a deleted one frees
 * the slot), refuses an unknown subject kind, and goes with its forum; a hub
 * forum thread discusses at most one subject (event, poll or lineup), one
 * live thread per poll / lineup, and the ROK-2226 detach / write-close
 * columns now serve poll and lineup threads too (R8).
 */
import { eq } from 'drizzle-orm';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import {
  bootPostsApp,
  newHub,
  type PostsCtx,
} from '../posts/hub-posts.test-fixtures';

let ctx: PostsCtx;
let snow = 500_000;
let subject = 900_000;

beforeAll(async () => {
  ctx = await bootPostsApp('evplanning');
});

const snowflake = (): string => `47722${String((snow += 1)).padStart(13, '0')}`;
const nextSubject = (): number => (subject += 1);

async function newForum(): Promise<number> {
  const [row] = nonEmpty(
    await ctx.testApp.db
      .insert(schema.hubForumDiscordForums)
      .values({ discordGuildId: snowflake(), channelId: snowflake() })
      .returning({ id: schema.hubForumDiscordForums.id }),
    'forum',
  );
  return row.id;
}

type PostValues = typeof schema.eventPlanningPosts.$inferInsert;

function post(forumId: number, values: Partial<PostValues> = {}) {
  return ctx.testApp.db.insert(schema.eventPlanningPosts).values({
    subjectKind: 'poll',
    subjectId: nextSubject(),
    forumId,
    discordThreadId: snowflake(),
    ...values,
  });
}

type ThreadValues = typeof schema.hubForumThreads.$inferInsert;

function thread(guildId: number, values: Partial<ThreadValues> = {}) {
  return ctx.testApp.db
    .insert(schema.hubForumThreads)
    .values({ guildId, title: 'Planning', body: 'hello', ...values });
}

describe('event_planning_posts', () => {
  it('refuses a second live post for the same subject', async () => {
    const [forumId, subjectId] = [await newForum(), nextSubject()];
    await post(forumId, { subjectKind: 'event', subjectId });
    await expect(
      post(forumId, { subjectKind: 'event', subjectId }),
    ).rejects.toMatchObject({
      cause: { constraint_name: 'uq_event_planning_posts_subject_live' },
    });
  });

  it('allows a new post once the old one is deleted, and other kinds', async () => {
    const [forumId, subjectId] = [await newForum(), nextSubject()];
    await post(forumId, {
      subjectKind: 'lineup',
      subjectId,
      discordDeletedAt: new Date(),
    });
    await expect(
      post(forumId, { subjectKind: 'lineup', subjectId }),
    ).resolves.toBeDefined();
    await expect(
      post(forumId, { subjectKind: 'poll', subjectId }),
    ).resolves.toBeDefined();
  });

  it('refuses an unknown subject kind', async () => {
    await expect(
      post(await newForum(), { subjectKind: 'raid' }),
    ).rejects.toMatchObject({
      cause: { constraint_name: 'event_planning_posts_subject_kind' },
    });
  });

  it('refuses a Discord thread posted twice', async () => {
    const [forumId, discordThreadId] = [await newForum(), snowflake()];
    await post(forumId, { discordThreadId });
    await expect(post(forumId, { discordThreadId })).rejects.toMatchObject({
      cause: { constraint_name: 'uq_event_planning_posts_discord_thread_id' },
    });
  });

  it('goes with its forum', async () => {
    const forumId = await newForum();
    const subjectId = nextSubject();
    await post(forumId, { subjectId });
    await ctx.testApp.db
      .delete(schema.hubForumDiscordForums)
      .where(eq(schema.hubForumDiscordForums.id, forumId));
    const left = await ctx.testApp.db
      .select({ id: schema.eventPlanningPosts.id })
      .from(schema.eventPlanningPosts)
      .where(eq(schema.eventPlanningPosts.forumId, forumId));
    expect(left).toEqual([]);
  });
});

describe('hub_forum_threads subjects', () => {
  it('refuses a thread on both an event and a poll', async () => {
    const hub = await newHub(ctx);
    await expect(
      thread(hub, { eventId: nextSubject(), matchId: nextSubject() }),
    ).rejects.toMatchObject({
      cause: { constraint_name: 'hub_forum_threads_one_subject' },
    });
  });

  it('keeps one live thread per poll and per lineup', async () => {
    const hub = await newHub(ctx);
    const [matchId, lineupId] = [nextSubject(), nextSubject()];
    await thread(hub, { matchId });
    await expect(thread(hub, { matchId })).rejects.toMatchObject({
      cause: { constraint_name: 'uq_hub_forum_threads_match_live' },
    });
    await thread(hub, { lineupId });
    await expect(thread(hub, { lineupId })).rejects.toMatchObject({
      cause: { constraint_name: 'uq_hub_forum_threads_lineup_live' },
    });
  });

  it('lets poll and lineup threads detach and close writes (R8)', async () => {
    const hub = await newHub(ctx);
    const now = new Date();
    const lifecycle = { eventDetachedAt: now, writeClosesAt: now };
    await expect(
      thread(hub, { matchId: nextSubject(), ...lifecycle }),
    ).resolves.toBeDefined();
    await expect(
      thread(hub, { lineupId: nextSubject(), ...lifecycle }),
    ).resolves.toBeDefined();
  });

  it('still refuses detach / write-close on a thread with no subject', async () => {
    const hub = await newHub(ctx);
    await expect(
      thread(hub, { writeClosesAt: new Date() }),
    ).rejects.toMatchObject({
      cause: { constraint_name: 'hub_forum_threads_write_closes' },
    });
  });
});
