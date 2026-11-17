/**
 * ROK-2229 — the event-thread list preview and header numbers against a real
 * database: a moderator- or author-removed reply is never a thread's
 * `latestReply` (the newest live reply is), a thread whose replies are all
 * removed previews nothing, the header's signup count matches the event
 * page's, and its capacity is the allocation capacity (`resolveEventCapacity`,
 * which the event page mirrors in `web/src/lib/event-capacity.ts`). Each test
 * builds its own hub + event + thread (`newScene`).
 */
import type {
  HubForumThread,
  HubForumThreadList,
  HubForumThreadSummary,
} from '@raid-ledger/contract';
import { eq } from 'drizzle-orm';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { call } from '../../posts/hub-posts.test-fixtures';
import {
  latestReplyPreviews,
  withLatestReplies,
} from '../hub-forum-latest-reply';
import { toThreadSummary } from '../hub-forum.mappers';
import {
  bootDiscussion,
  newScene,
  resetThrottles,
  setSignupStatus,
  type DiscussionCtx,
  type Scene,
} from './event-discussion.test-fixtures';

const MIN = 60_000;
let ctx: DiscussionCtx;

beforeAll(async () => {
  ctx = await bootDiscussion('evprev');
});

beforeEach(() => {
  resetThrottles(ctx);
});

interface ReplySeed {
  body: string;
  minutesAgo: number;
  removedAs?: 'author' | 'moderator';
}

/**
 * Insert replies with their own clocks and removed states, then set the
 * thread's `reply_count` to the live count, as the reply transaction does.
 */
async function seedReplies(s: Scene, seeds: ReplySeed[]): Promise<void> {
  const db = ctx.posts.testApp.db;
  const now = Date.now();
  for (const r of seeds) {
    const at = new Date(now - r.minutesAgo * MIN);
    const removed = r.removedAs
      ? { deletedAt: at, deletedAs: r.removedAs, deletedBy: ctx.ids.signed }
      : {};
    await db.insert(schema.hubForumReplies).values({
      threadId: s.threadId,
      guildId: s.guildId,
      authorId: ctx.ids.signed,
      body: r.body,
      createdAt: at,
      updatedAt: at,
      ...removed,
    });
  }
  const live = seeds.filter((r) => r.removedAs === undefined).length;
  await db
    .update(schema.hubForumThreads)
    .set({ replyCount: live })
    .where(eq(schema.hubForumThreads.id, s.threadId));
}

/** The scene's thread as a member sees it in `GET /guilds/:id/forum`. */
async function listedRow(s: Scene): Promise<HubForumThreadSummary> {
  const res = await call(
    ctx.posts,
    'get',
    `/guilds/${s.guildId}/forum`,
    'plain',
  );
  expect(res.status).toBe(200);
  const body = res.body as HubForumThreadList;
  const row = [...body.pinned, ...body.threads].find(
    (t) => t.id === s.threadId,
  );
  if (!row) throw new Error(`thread ${s.threadId} missing from the forum list`);
  return row;
}

describe('event thread latest-reply preview (ROK-2229)', () => {
  it('previews the newest live reply, never a removed one', async () => {
    const s = await newScene(ctx);
    await seedReplies(s, [
      { body: 'Oldest live reply', minutesAgo: 30 },
      { body: 'Newest live reply', minutesAgo: 20 },
      { body: 'Author removed this', minutesAgo: 10, removedAs: 'author' },
      { body: 'Moderator removed this', minutesAgo: 5, removedAs: 'moderator' },
    ]);
    const row = await listedRow(s);
    expect(row.latestReply?.preview).toBe('Newest live reply');
    expect(JSON.stringify(row)).not.toMatch(/removed this/);
  });

  it('previews nothing when every reply is removed', async () => {
    const s = await newScene(ctx);
    await seedReplies(s, [
      { body: 'Author removed this', minutesAgo: 9, removedAs: 'author' },
      { body: 'Moderator removed this', minutesAgo: 3, removedAs: 'moderator' },
    ]);
    const db = ctx.posts.testApp.db;
    const previews = await latestReplyPreviews(db, [s.threadId]);
    expect([...previews.keys()]).toEqual([]);
    const [thread] = nonEmpty(
      await db
        .select()
        .from(schema.hubForumThreads)
        .where(eq(schema.hubForumThreads.id, s.threadId)),
      'thread',
    );
    const summary = toThreadSummary({ thread, author: null, event: null });
    const lists = await withLatestReplies(db, [[summary]]);
    expect(lists[0]?.[0]?.latestReply).toBeNull();
  });
});

describe('event thread header numbers (ROK-2229)', () => {
  it('counts signups exactly like the event page (bench in, inactive out)', async () => {
    const s = await newScene(ctx);
    await setSignupStatus(ctx, s.eventId, 'declined', 'declined');
    await setSignupStatus(ctx, s.eventId, 'pug', 'departed');
    const page = await call(ctx.posts, 'get', `/events/${s.eventId}`, 'plain');
    expect(page.status).toBe(200);
    const pageCount = (page.body as { signupCount: number }).signupCount;
    const res = await call(
      ctx.posts,
      'get',
      `/guilds/${s.guildId}/forum/${s.threadId}`,
      'plain',
    );
    expect(res.status).toBe(200);
    // signed + bench + tentative; declined and departed hold no place.
    expect(pageCount).toBe(3);
    expect((res.body as HubForumThread).event?.signupCount).toBe(pageCount);
  });

  it('reports the slot roster as capacity, not the maxAttendees column', async () => {
    const s = await newScene(ctx);
    await ctx.posts.testApp.db
      .update(schema.events)
      .set({ maxAttendees: 40, slotConfig: { type: 'generic', player: 5 } })
      .where(eq(schema.events.id, s.eventId));
    const res = await call(
      ctx.posts,
      'get',
      `/guilds/${s.guildId}/forum/${s.threadId}`,
      'plain',
    );
    expect(res.status).toBe(200);
    expect((res.body as HubForumThread).event?.maxAttendees).toBe(5);
  });
});
