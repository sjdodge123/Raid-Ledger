/**
 * ROK-1868 §2.7 — the hub post feed against a real database (P1–P8, P13,
 * P14, P17–P19, P21–P25): list paging + cursor validation, the read/write
 * permission matrix, body validation (length, HTML, unsafe links) with DB
 * reads proving nothing was written, normalisation, no-op edits, the legacy
 * `gmPost` 400, `latestPost` on the profile and the markdown-stripped /mine
 * headline. Relay + notification-dedup rows live in
 * `hub-posts.relay.integration.spec.ts`. Every test builds its own hub.
 */
import { eq } from 'drizzle-orm';
import { HUB_POST_MARKDOWN_MESSAGES } from '@raid-ledger/contract';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { HubNotificationService } from '../../notifications/hub-notification.service';
import { GM_POST_MOVED_MESSAGE } from '../guild-profile.service';
import {
  bootPostsApp,
  call,
  clearPostCooldowns,
  createPost,
  insertPostRow,
  leaderRows,
  newHub,
  postRows,
  resetThrottler,
  settle,
  stubDiscord,
  type PostsCtx,
} from './hub-posts.test-fixtures';

const HTML_MSG = HUB_POST_MARKDOWN_MESSAGES.html;
const LINK_MSG = HUB_POST_MARKDOWN_MESSAGES['unsafe-link'];
const T0 = new Date('2026-10-01T12:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

let ctx: PostsCtx;
let discord: ReturnType<typeof stubDiscord>;
let leaderSpy: jest.SpiedFunction<HubNotificationService['notifyLeaderPost']>;

beforeAll(async () => {
  ctx = await bootPostsApp('hpcore');
});

beforeEach(async () => {
  await clearPostCooldowns(ctx);
  resetThrottler(ctx);
  discord = stubDiscord(ctx);
  leaderSpy = jest.spyOn(
    ctx.testApp.app.get(HubNotificationService),
    'notifyLeaderPost',
  );
});

afterEach(() => jest.restoreAllMocks());

const list = (g: number, query = '', who: 'plain' | 'outsider' = 'plain') =>
  call(ctx, 'get', `/guilds/${g}/posts${query}`, who);

interface Listed {
  posts: { id: number; author: { displayName: string | null } }[];
  nextCursor: string | null;
}

describe('P1–P3 — list', () => {
  it('P1: newest first, no next cursor, author display name set', async () => {
    const g = await newHub(ctx);
    const oldest = await insertPostRow(ctx, g, 'one', at(0));
    const middle = await insertPostRow(ctx, g, 'two', at(5));
    const newest = await insertPostRow(ctx, g, 'three', at(10));
    const res = await list(g);
    expect(res.status).toBe(200);
    const body = res.body as Listed;
    expect(body.posts.map((p) => p.id)).toEqual([newest, middle, oldest]);
    expect(body.nextCursor).toBeNull();
    expect(body.posts[0]?.author.displayName).toBe('hpcore officerA');
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('P2: 12 posts page as 10 + 2, no overlap, stable on equal created_at', async () => {
    const g = await newHub(ctx);
    const ids: { id: number; t: number }[] = [];
    for (let i = 0; i < 12; i += 1) {
      // Six timestamps, two posts each: the id tie-break must order them.
      const t = Math.floor(i / 2);
      ids.push({ id: await insertPostRow(ctx, g, `post ${i}`, at(t)), t });
    }
    const expected = [...ids]
      .sort((a, b) => b.t - a.t || b.id - a.id)
      .map((p) => p.id);
    const first = await list(g, '?limit=10');
    expect(first.status).toBe(200);
    const page1 = first.body as Listed;
    expect(page1.posts).toHaveLength(10);
    const cursor = page1.nextCursor;
    if (cursor === null) throw new Error('P2: page 1 must carry a nextCursor');
    const second = await list(
      g,
      `?limit=10&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(second.status).toBe(200);
    const page2 = second.body as Listed;
    expect(page2.posts).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();
    const all = [...page1.posts, ...page2.posts].map((p) => p.id);
    expect(all).toEqual(expected);
    expect(new Set(all).size).toBe(12);
  });

  it.each([
    ['garbage cursor', '?cursor=not-a-real-cursor'],
    ['limit=51', '?limit=51'],
    ['limit=0', '?limit=0'],
  ])('P3: %s → 400', async (_label, query) => {
    const g = await newHub(ctx);
    expect((await list(g, query)).status).toBe(400);
  });
});

describe('P4–P5 — read access', () => {
  it('P4: a visitor (not on the roster) gets 403 on the list and one post, before 404', async () => {
    const g = await newHub(ctx);
    const id = await insertPostRow(ctx, g, 'members only', at(0));
    const results = await Promise.all([
      list(g, '', 'outsider'),
      call(ctx, 'get', `/guilds/${g}/posts/${id}`, 'outsider'),
      call(ctx, 'get', `/guilds/${g}/posts/999999999`, 'outsider'),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403, 403]);
  });

  it('P5: a post id from guild B is 404 under guild A (read and write)', async () => {
    const a = await newHub(ctx);
    const b = await newHub(ctx);
    const idB = await insertPostRow(ctx, b, 'guild B post', at(0));
    const path = `/guilds/${a}/posts/${idB}`;
    expect((await call(ctx, 'get', path, 'plain')).status).toBe(404);
    const patch = await call(ctx, 'patch', path, 'officerA', { body: 'x' });
    expect(patch.status).toBe(404);
    expect((await call(ctx, 'delete', path, 'officerA')).status).toBe(404);
    expect((await postRows(ctx, b)).map((p) => p.body)).toEqual([
      'guild B post',
    ]);
  });
});

describe('P6–P8 — create', () => {
  it('P6: officer posts → 201 not_requested, no send, one notice per OTHER member', async () => {
    const g = await newHub(ctx);
    const res = await createPost(ctx, g, 'Raid moved to **Thursday**');
    expect(res.status).toBe(201);
    expect(res.body.relayOutcome).toBe('not_requested');
    expect(discord.sendEmbed).not.toHaveBeenCalled();
    expect(leaderSpy).toHaveBeenCalledTimes(1);
    await settle(leaderSpy);
    expect(await leaderRows(ctx, ctx.userIds.plain, g)).toHaveLength(1);
    expect(await leaderRows(ctx, ctx.userIds.officerB, g)).toHaveLength(1);
    expect(await leaderRows(ctx, ctx.userIds.officerA, g)).toHaveLength(0);
    expect(await leaderRows(ctx, ctx.userIds.outsider, g)).toHaveLength(0);
  });

  it('P7: a plain member is refused POST / PATCH / DELETE with 403', async () => {
    const g = await newHub(ctx);
    const id = await insertPostRow(ctx, g, 'untouched', at(0));
    const path = `/guilds/${g}/posts/${id}`;
    const results = await Promise.all([
      createPost(ctx, g, 'nope', 'plain'),
      call(ctx, 'patch', path, 'plain', { body: 'changed' }),
      call(ctx, 'delete', path, 'plain'),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403, 403]);
    for (const r of results) {
      expect(r.body.message).toBe('Guild editor access required');
    }
    expect((await postRows(ctx, g)).map((p) => p.body)).toEqual(['untouched']);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['4001 chars', 'a'.repeat(4001)],
  ])('P8: %s body → 400 on POST and PATCH', async (_label, body) => {
    const g = await newHub(ctx);
    const id = await insertPostRow(ctx, g, 'original', at(0));
    expect((await createPost(ctx, g, body)).status).toBe(400);
    const patch = await call(
      ctx,
      'patch',
      `/guilds/${g}/posts/${id}`,
      'officerA',
      {
        body,
      },
    );
    expect(patch.status).toBe(400);
    expect((await postRows(ctx, g)).map((p) => p.body)).toEqual(['original']);
  });

  it('P8: exactly 4000 chars → 201', async () => {
    const g = await newHub(ctx);
    const res = await createPost(ctx, g, 'a'.repeat(4000));
    expect(res.status).toBe(201);
    const [row] = await postRows(ctx, g);
    expect(row?.body).toHaveLength(4000);
  });
});

describe('P13–P14 — edit', () => {
  it.each([
    ['identical', 'Line one\nLine two'],
    ['CRLF-only difference', 'Line one\r\nLine two'],
  ])('P13: %s body → 200, updatedAt / editedBy unchanged', async (_l, next) => {
    const g = await newHub(ctx);
    const created = await createPost(ctx, g, 'Line one\nLine two');
    expect(created.status).toBe(201);
    const post = created.body.post as { id: number; updatedAt: string };
    const res = await call(
      ctx,
      'patch',
      `/guilds/${g}/posts/${post.id}`,
      'officerB',
      {
        body: next,
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.updatedAt).toBe(post.updatedAt);
    expect(res.body.editedBy).toBeNull();
    const [row] = await postRows(ctx, g);
    expect(row?.updatedBy).toBeNull();
    expect(row?.updatedAt.toISOString()).toBe(post.updatedAt);
  });

  it("P14: officer B edits officer A's post → 200, editedBy = B", async () => {
    const g = await newHub(ctx);
    const created = await createPost(ctx, g, 'Draft by A');
    const id = (created.body.post as { id: number }).id;
    const res = await call(
      ctx,
      'patch',
      `/guilds/${g}/posts/${id}`,
      'officerB',
      {
        body: 'Fixed by B',
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.editedBy).toMatchObject({ userId: ctx.userIds.officerB });
    expect(res.body.author).toMatchObject({ userId: ctx.userIds.officerA });
    const [row] = await postRows(ctx, g);
    expect(row).toMatchObject({
      body: 'Fixed by B',
      updatedBy: ctx.userIds.officerB,
    });
  });
});

describe('P17–P19 — profile + headline', () => {
  it('P17: PATCH profile {gmPost} → 400; {rules} still 200', async () => {
    const g = await newHub(ctx);
    const path = `/guilds/${g}/profile`;
    const bad = await call(ctx, 'patch', path, 'officerA', { gmPost: 'x' });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain(GM_POST_MOVED_MESSAGE);
    const ok = await call(ctx, 'patch', path, 'officerA', {
      rules: [{ title: 'Loot', body: 'Need before greed' }],
    });
    expect(ok.status).toBe(200);
    expect(await postRows(ctx, g)).toHaveLength(0);
  });

  it('P18: GET profile carries latestPost = newest and gmPost.body = its body', async () => {
    const g = await newHub(ctx);
    await insertPostRow(ctx, g, 'older post', at(0));
    const newest = await insertPostRow(ctx, g, 'newest post', at(30));
    const res = await call(ctx, 'get', `/guilds/${g}/profile`, 'plain');
    expect(res.status).toBe(200);
    expect(res.body.latestPost).toMatchObject({
      id: newest,
      body: 'newest post',
    });
    expect(res.body.gmPost).toMatchObject({ body: 'newest post' });
  });

  it('P19: /mine headline is the newest post, markdown-stripped', async () => {
    const g = await newHub(ctx);
    const res = await createPost(
      ctx,
      g,
      '**Raid night** moved\n- bring flasks',
    );
    expect(res.status).toBe(201);
    const mine = await call(ctx, 'get', '/plugins/wow/guilds/mine', 'plain');
    expect(mine.status).toBe(200);
    const row = (mine.body.guilds as { id: number }[]).find((x) => x.id === g);
    expect(row).toMatchObject({ gmPostHeadline: 'Raid night moved' });
  });
});

describe('P21 — wiped author', () => {
  it('reads an all-null author once the user row is gone', async () => {
    const g = await newHub(ctx);
    const [ghost] = nonEmpty(
      await ctx.testApp.db
        .insert(schema.users)
        .values({
          discordId: `local:ghost-${g}@hub-posts.test`,
          username: `ghost-${g}`,
        })
        .returning(),
      'ghost',
    );
    await ctx.testApp.db
      .insert(schema.hubPosts)
      .values({ guildId: g, body: 'orphaned', authorId: ghost.id });
    await ctx.testApp.db
      .delete(schema.users)
      .where(eq(schema.users.id, ghost.id));
    const res = await list(g);
    expect(res.status).toBe(200);
    expect(res.body.posts[0]?.author).toEqual({
      userId: null,
      displayName: null,
      avatarUrl: null,
    });
  });
});

describe('P22–P23 — rejected markdown', () => {
  it.each([
    ['script tag', 'hi <script>alert(1)</script>'],
    ['img onerror', '<img src=x onerror=alert(1)>'],
    ['HTML comment', '<!-- x -->'],
  ])('P22: %s → 400 HTML message; nothing written', async (_l, body) => {
    const g = await newHub(ctx);
    const created = await createPost(ctx, g, body);
    expect(created.status).toBe(400);
    expect(created.body).toMatchObject({ body: [HTML_MSG] });
    expect(await postRows(ctx, g)).toHaveLength(0);
    const id = await insertPostRow(ctx, g, 'clean body', at(0));
    const patch = await call(
      ctx,
      'patch',
      `/guilds/${g}/posts/${id}`,
      'officerA',
      {
        body,
      },
    );
    expect(patch.status).toBe(400);
    expect(patch.body).toMatchObject({ body: [HTML_MSG] });
    const [row] = await postRows(ctx, g);
    expect(row).toMatchObject({ body: 'clean body', updatedBy: null });
    expect(leaderSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['javascript: link', '[x](javascript:alert(1))'],
    ['protocol-relative link', '[x](//evil.com)'],
  ])('P23: %s → 400 unsafe-link message; no row', async (_l, body) => {
    const g = await newHub(ctx);
    const res = await createPost(ctx, g, body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ body: [LINK_MSG] });
    expect(await postRows(ctx, g)).toHaveLength(0);
  });
});

describe('P24–P25 — accepted bodies', () => {
  it.each([
    ['a bare less-than', 'I <3 raids, a < b'],
    ['HTML inside a code span', '`<div>`'],
    ['heading syntax', '# not a heading'],
  ])('P24: %s → 201, stored verbatim', async (_l, body) => {
    const g = await newHub(ctx);
    const res = await createPost(ctx, g, body);
    expect(res.status).toBe(201);
    const [row] = await postRows(ctx, g);
    expect(row?.body).toBe(body);
  });

  it('P25: CRLF, zero-width, 5 blank lines and BEL are normalised on write', async () => {
    const g = await newHub(ctx);
    const zw = String.fromCodePoint(0x200b);
    const bel = String.fromCodePoint(0x07);
    const raw = `a\r\nb${zw}c\n\n\n\n\n\nd${bel}e`;
    const res = await createPost(ctx, g, raw);
    expect(res.status).toBe(201);
    const [row] = await postRows(ctx, g);
    const stored = row?.body ?? '';
    expect(stored).toBe('a\nbc\n\nde');
    for (const banned of ['\r', zw, bel, '\n\n\n']) {
      expect(stored.includes(banned)).toBe(false);
    }
  });
});

describe('create throttle — 10/min per user', () => {
  it('a user\'s first 10 creates → 201, the 11th → 429; a second editor on the same IP is not blocked', async () => {
    const g = await newHub(ctx);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      statuses.push((await createPost(ctx, g, `Post ${i}`)).status);
    }
    expect(statuses).toEqual([...Array.from({ length: 10 }, () => 201), 429]);
    expect(await postRows(ctx, g)).toHaveLength(10);
    const other = await createPost(ctx, g, 'Officer B post', 'officerB');
    expect(other.status).toBe(201);
    expect(await postRows(ctx, g)).toHaveLength(11);
  });
});
