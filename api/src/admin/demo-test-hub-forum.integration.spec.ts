/**
 * ROK-1175 — POST /admin/test/hubs/:id/forum/seed (integration, real DB):
 * the jwt + admin + DEMO_MODE guard trio, 404 for an unknown hub, the base
 * fixture the smoke spec pins, the `full: true` test-plan extras, and a
 * re-seed replacing the hub's whole forum.
 */
import type { HubForumThread, HubForumThreadList } from '@raid-ledger/contract';
import { loginAsAdmin } from '../common/testing/integration-helpers';
import {
  bootPostsApp,
  call,
  newHub,
  type PostsCtx,
} from '../guilds/posts/hub-posts.test-fixtures';
import { SettingsService } from '../settings/settings.service';
import type { HubForumSeedResult } from './demo-test-hub-forum.helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
let ctx: PostsCtx;
let adminToken: string;

const route = (g: number) => `/admin/test/hubs/${g}/forum/seed`;

beforeAll(async () => {
  ctx = await bootPostsApp('hforumseed');
  adminToken = await loginAsAdmin(ctx.testApp.request, ctx.testApp.seed);
  process.env.DEMO_MODE = 'true';
  await ctx.testApp.app.get(SettingsService).setDemoMode(true);
});

afterAll(() => {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

function post(g: number, token: string, body: object) {
  return ctx.testApp.request
    .post(route(g))
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

async function seed(g: number, full = false): Promise<HubForumSeedResult> {
  const res = await post(g, adminToken, {
    memberUserId: ctx.userIds.plain,
    full,
  });
  expect(res.status).toBe(200);
  return res.body as HubForumSeedResult;
}

async function read<T>(path: string): Promise<{ status: number; body: T }> {
  const res = await call(ctx, 'get', path, 'plain');
  return { status: res.status, body: res.body as T };
}

describe('ROK-1175 forum seed — guards', () => {
  it('refuses a non-admin, an unknown hub, and DEMO_MODE off', async () => {
    const g = await newHub(ctx);
    const body = { memberUserId: ctx.userIds.plain };
    expect((await post(g, ctx.tokens.plain, body)).status).toBe(403);
    expect((await post(2_000_000_000, adminToken, body)).status).toBe(404);
    process.env.DEMO_MODE = 'false';
    try {
      expect((await post(g, adminToken, body)).status).toBe(403);
    } finally {
      process.env.DEMO_MODE = 'true';
    }
    expect((await read<HubForumThreadList>(`/guilds/${g}/forum`)).body).toEqual(
      { pinned: [], threads: [], nextCursor: null },
    );
  });
});

describe('ROK-1175 forum seed — fixtures', () => {
  it('the base fixture: one pin, then member + stale by activity, no extras', async () => {
    const g = await newHub(ctx);
    const s = await seed(g);
    expect(s.extras).toBeNull();
    const { body } = await read<HubForumThreadList>(`/guilds/${g}/forum`);
    expect(body.pinned.map((t) => t.id)).toEqual([s.pinnedThreadId]);
    expect(body.threads.map((t) => t.id)).toEqual([
      s.memberThreadId,
      s.staleThreadId,
    ]);
  });

  it('full: two pins, an author-deleted thread with a live reply, a 30-reply thread; a re-seed replaces it all', async () => {
    const g = await newHub(ctx);
    const s = await seed(g, true);
    const x = s.extras;
    if (x === null) throw new Error('full seed returned no extras');
    const { body } = await read<HubForumThreadList>(`/guilds/${g}/forum`);
    expect(body.pinned.map((t) => t.id)).toEqual(x.pinnedThreadIds);
    const removed = body.threads.find((t) => t.id === x.removedThreadId);
    expect(removed).toMatchObject({ deleted: 'author', replyCount: 1 });
    const long = await read<HubForumThread>(
      `/guilds/${g}/forum/${x.longThreadId}`,
    );
    const replies = long.body.replies;
    expect(replies).toHaveLength(30);
    expect(
      replies.filter((r) => r.deleted === 'author').map((r) => r.id),
    ).toEqual([x.authorDeletedReplyId]);
    expect(replies.filter((r) => r.deleted === 'moderator')).toHaveLength(1);
    expect(long.body.replyCount).toBe(28);
    await seed(g);
    const gone = await read(`/guilds/${g}/forum/${x.removedThreadId}`);
    expect(gone.status).toBe(404);
  });
});
