/**
 * ROK-1175 L3 — the hub forum against a real database: CRUD round trip,
 * the soft-delete shape (Q8), the 24 h edit window (Q5), keyset paging over
 * 1,050 threads with a reply mid-paging (AC9), hidden hub 404 (AC8), the
 * visitor/member write matrix (AC7, AC5) and user delete (AC12). Every test
 * builds its own hub; the four actors come from the posts fixtures.
 */
import { eq } from 'drizzle-orm';
import type {
  HubForumReply,
  HubForumThread,
  HubForumThreadList,
} from '@raid-ledger/contract';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { deleteUserTransaction } from '../../users/users-delete.helpers';
import {
  bootPostsApp,
  call,
  newHub,
  type PostsCtx,
  type Who,
} from '../posts/hub-posts.test-fixtures';
import { HubForumThrottleGuard } from './hub-forum-throttle.guard';

const HOUR = 3_600_000;
let ctx: PostsCtx;

beforeAll(async () => {
  ctx = await bootPostsApp('hforum');
});

beforeEach(() => {
  ctx.testApp.app.get(HubForumThrottleGuard, { strict: false }).reset();
});

const base = (g: number) => `/guilds/${g}/forum`;
const put = (path: string, who: Who) =>
  ctx.testApp.request
    .put(path)
    .set('Authorization', `Bearer ${ctx.tokens[who]}`);

async function createThread(
  g: number,
  who: Who,
  title = 'Raid comp',
): Promise<HubForumThread> {
  const res = await call(ctx, 'post', base(g), who, {
    title,
    body: '**Thoughts?**',
  });
  expect(res.status).toBe(201);
  return res.body as HubForumThread;
}

async function getThread(
  g: number,
  id: number,
  who: Who = 'plain',
): Promise<HubForumThread> {
  const res = await call(ctx, 'get', `${base(g)}/${id}`, who);
  expect(res.status).toBe(200);
  return res.body as HubForumThread;
}

async function list(g: number, query = ''): Promise<HubForumThreadList> {
  const res = await call(ctx, 'get', `${base(g)}${query}`, 'plain');
  expect(res.status).toBe(200);
  return res.body as HubForumThreadList;
}

/** Insert a thread row directly (old clocks, bulk). */
async function insertThreadRow(
  g: number,
  authorId: number,
  at: Date,
  title = 't',
): Promise<number> {
  const [row] = nonEmpty(
    await ctx.testApp.db
      .insert(schema.hubForumThreads)
      .values({
        guildId: g,
        authorId,
        title,
        body: 'b',
        createdAt: at,
        updatedAt: at,
        lastActivityAt: at,
      })
      .returning({ id: schema.hubForumThreads.id }),
    'thread',
  );
  return row.id;
}

describe('ROK-1175 forum — round trip (AC2, AC3, AC5, AC6)', () => {
  it('create → reply → edit → pin → author delete → moderator delete', async () => {
    const g = await newHub(ctx);
    const t = await createThread(g, 'plain');
    expect(t).toMatchObject({
      title: 'Raid comp',
      replyCount: 0,
      deleted: null,
      can: { edit: true, delete: true, pin: false },
    });
    const r = await call(
      ctx,
      'post',
      `${base(g)}/${t.id}/replies`,
      'officerA',
      { body: 'Two healers' },
    );
    expect(r.status).toBe(201);
    const reply = r.body as HubForumReply;
    const edited = await call(ctx, 'patch', `${base(g)}/${t.id}`, 'plain', {
      title: 'Raid comp v2',
    });
    expect(edited.status).toBe(200);
    expect((edited.body as HubForumThread).editedAt).not.toBeNull();
    expect((await put(`${base(g)}/${t.id}/pin`, 'officerA')).status).toBe(204);
    expect((await put(`${base(g)}/${t.id}/pin`, 'plain')).status).toBe(403);
    const pinnedList = await list(g);
    expect(pinnedList.pinned.map((p) => p.id)).toEqual([t.id]);
    expect(pinnedList.pinned[0]).toMatchObject({
      title: 'Raid comp v2',
      replyCount: 1,
    });
    expect(
      (await call(ctx, 'delete', `${base(g)}/${t.id}`, 'plain')).status,
    ).toBe(204);
    const gone = await getThread(g, t.id);
    expect(gone).toMatchObject({
      title: '',
      body: '',
      preview: '',
      deleted: 'author',
      pinnedAt: null,
    });
    expect(gone.replies.map((x) => [x.id, x.body, x.deleted])).toEqual([
      [reply.id, 'Two healers', null],
    ]);
    expect((await list(g)).threads.map((x) => x.id)).toEqual([t.id]);
    const late = await call(
      ctx,
      'post',
      `${base(g)}/${t.id}/replies`,
      'plain',
      { body: 'late' },
    );
    expect(late.status).toBe(409);
    const mod = await call(
      ctx,
      'delete',
      `${base(g)}/${t.id}/replies/${reply.id}`,
      'officerB',
    );
    expect(mod.status).toBe(204);
    expect((await getThread(g, t.id)).replies[0]).toMatchObject({
      body: '',
      deleted: 'moderator',
    });
    expect((await list(g)).threads).toEqual([]);
  });

  it('a reply moves its thread to the top of the feed (AC3)', async () => {
    const g = await newHub(ctx);
    const older = await createThread(g, 'plain', 'older');
    const newer = await createThread(g, 'plain', 'newer');
    expect((await list(g)).threads.map((x) => x.id)).toEqual([
      newer.id,
      older.id,
    ]);
    await call(ctx, 'post', `${base(g)}/${older.id}/replies`, 'plain', {
      body: 'bump',
    });
    expect((await list(g)).threads.map((x) => x.id)).toEqual([
      older.id,
      newer.id,
    ]);
  });

  it('a reply never moves last activity backwards (concurrent replies)', async () => {
    const g = await newHub(ctx);
    // A newer reply already committed: stored activity is ahead of this request's clock.
    const ahead = new Date(Date.now() + HOUR);
    const id = await insertThreadRow(g, ctx.userIds.plain, ahead);
    const res = await call(ctx, 'post', `${base(g)}/${id}/replies`, 'plain', {
      body: 'late',
    });
    expect(res.status).toBe(201);
    const [row] = nonEmpty(
      await ctx.testApp.db
        .select({ at: schema.hubForumThreads.lastActivityAt })
        .from(schema.hubForumThreads)
        .where(eq(schema.hubForumThreads.id, id)),
      'thread',
    );
    expect(row.at.toISOString()).toBe(ahead.toISOString());
  });
});

describe('ROK-1175 forum — authorship (AC4)', () => {
  it('the author is refused after 24 h; an officer can never rewrite', async () => {
    const g = await newHub(ctx);
    const old = await insertThreadRow(
      g,
      ctx.userIds.plain,
      new Date(Date.now() - 25 * HOUR),
    );
    const late = await call(ctx, 'patch', `${base(g)}/${old}`, 'plain', {
      body: 'x',
    });
    expect(late.status).toBe(403);
    expect((late.body as { message: string }).message).toBe(
      'Edit window closed',
    );
    const fresh = await createThread(g, 'plain');
    const officer = await call(
      ctx,
      'patch',
      `${base(g)}/${fresh.id}`,
      'officerA',
      { body: 'x' },
    );
    expect(officer.status).toBe(403);
    expect((await getThread(g, fresh.id)).body).toBe('**Thoughts?**');
  });
});

describe('ROK-1175 forum — access (AC7, AC8)', () => {
  it('a visitor gets 403 on every read and write', async () => {
    const g = await newHub(ctx);
    const t = await createThread(g, 'plain');
    const p = `${base(g)}/${t.id}`;
    const statuses = [
      (await call(ctx, 'get', base(g), 'outsider')).status,
      (await call(ctx, 'get', `${base(g)}/latest`, 'outsider')).status,
      (await call(ctx, 'get', p, 'outsider')).status,
      (await call(ctx, 'post', base(g), 'outsider', { title: 'x', body: 'y' }))
        .status,
      (await call(ctx, 'post', `${p}/replies`, 'outsider', { body: 'y' }))
        .status,
      (await call(ctx, 'patch', p, 'outsider', { body: 'y' })).status,
      (await call(ctx, 'delete', p, 'outsider')).status,
      (await put(`${p}/pin`, 'outsider')).status,
    ];
    expect(statuses).toEqual([403, 403, 403, 403, 403, 403, 403, 403]);
    expect((await getThread(g, t.id)).deleted).toBeNull();
  });

  it('a hidden hub is 404 to members on every forum route', async () => {
    const g = await newHub(ctx);
    const t = await createThread(g, 'plain');
    await ctx.testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, g));
    const statuses = [
      (await call(ctx, 'get', base(g), 'plain')).status,
      (await call(ctx, 'get', `${base(g)}/${t.id}`, 'plain')).status,
      (await call(ctx, 'post', base(g), 'plain', { title: 'x', body: 'y' }))
        .status,
    ];
    expect(statuses).toEqual([404, 404, 404]);
  });

  it('a thread of another hub is 404', async () => {
    const [a, b] = [await newHub(ctx), await newHub(ctx)];
    const t = await createThread(b, 'plain');
    expect((await call(ctx, 'get', `${base(a)}/${t.id}`, 'plain')).status).toBe(
      404,
    );
  });
});

describe('ROK-1175 forum — paging (AC9)', () => {
  it('1,050 threads page exactly once each, with a reply arriving mid-paging', async () => {
    const g = await newHub(ctx);
    const t0 = Date.now() - 2_000 * 60_000;
    const rows = Array.from({ length: 1050 }, (_, i) => {
      const at = new Date(t0 + Math.floor(i / 2) * 60_000);
      return {
        guildId: g,
        authorId: ctx.userIds.plain,
        title: `t${i}`,
        body: 'b',
        createdAt: at,
        updatedAt: at,
        lastActivityAt: at,
      };
    });
    await ctx.testApp.db.insert(schema.hubForumThreads).values(rows);
    const seen: number[] = [];
    let cursor: string | null = null;
    do {
      const q: string =
        cursor === null
          ? '?limit=50'
          : `?limit=50&cursor=${encodeURIComponent(cursor)}`;
      const page = await list(g, q);
      seen.push(...page.threads.map((x) => x.id));
      if (seen.length === 50) {
        const r = await call(
          ctx,
          'post',
          `${base(g)}/${seen[0]}/replies`,
          'plain',
          { body: 'mid-paging' },
        );
        expect(r.status).toBe(201);
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen).toHaveLength(1050);
    expect(new Set(seen).size).toBe(1050);
  });

  it('a junk cursor is 400', async () => {
    const g = await newHub(ctx);
    expect(
      (await call(ctx, 'get', `${base(g)}?cursor=junk`, 'plain')).status,
    ).toBe(400);
  });
});

describe('ROK-1175 forum — user delete (AC12)', () => {
  it("a deleted user's thread stays with a null author", async () => {
    const g = await newHub(ctx);
    const [u] = nonEmpty(
      await ctx.testApp.db
        .insert(schema.users)
        .values({
          discordId: `local:hforum-gone-${g}@forum.test`,
          username: `hforum-gone-${g}`,
          role: 'member',
        })
        .returning(),
      'user',
    );
    const id = await insertThreadRow(g, u.id, new Date(), 'orphan');
    await deleteUserTransaction(ctx.testApp.db, u.id, ctx.userIds.officerA);
    const t = await getThread(g, id);
    expect(t).toMatchObject({ title: 'orphan', author: null, deleted: null });
  });
});
