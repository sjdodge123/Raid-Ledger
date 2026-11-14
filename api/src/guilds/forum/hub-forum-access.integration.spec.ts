/**
 * ROK-1175 review r1 — the forum access matrix the first spec left out
 * (AC5, AC7, AC8): staff (admin) on a hub they are not on, unpin and
 * newest-pin-first, visitor reply edit/delete, member-vs-member delete,
 * reply-level IDOR, the inactive hub kind; plus the two Codex P2 fixes
 * (the 50-pin write cap and the Latest widget excluding removed threads
 * before its LIMIT).
 */
import type {
  HubForumLatest,
  HubForumReply,
  HubForumThread,
  HubForumThreadList,
} from '@raid-ledger/contract';
import { nonEmpty } from '../../common/testing/narrow';
import { signTestAccessToken } from '../../common/testing/sign-test-access-token';
import * as schema from '../../drizzle/schema';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import {
  bootPostsApp,
  call,
  newHub,
  type PostsCtx,
  type Who,
} from '../posts/hub-posts.test-fixtures';
import { HUB_PLUGIN_INACTIVE } from '../hub-kind.registry';
import { HubForumThrottleGuard } from './hub-forum-throttle.guard';
import { FORUM_PIN_LIMIT } from './hub-forum.service';

let ctx: PostsCtx;
let adminToken: string;

beforeAll(async () => {
  ctx = await bootPostsApp('hforumacl');
  const [u] = nonEmpty(
    await ctx.testApp.db
      .insert(schema.users)
      .values({
        discordId: 'local:hforumacl-admin@forum.test',
        username: 'hforumacl-admin',
        role: 'admin',
      })
      .returning(),
    'admin',
  );
  adminToken = await signTestAccessToken(ctx.testApp, {
    sub: u.id,
    username: u.username,
    role: 'admin',
  });
});

beforeEach(() => {
  ctx.testApp.app.get(HubForumThrottleGuard, { strict: false }).reset();
});

const base = (g: number) => `/guilds/${g}/forum`;
type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

/** A request as an actor from the posts fixtures, or as `'admin'` (staff). */
function as(who: Who | 'admin', method: Method, path: string, body?: object) {
  const token = who === 'admin' ? adminToken : ctx.tokens[who];
  const req = ctx.testApp.request[method](path).set(
    'Authorization',
    `Bearer ${token}`,
  );
  return body === undefined ? req : req.send(body);
}

async function thread(g: number, who: Who | 'admin', title = 'Raid comp') {
  const res = await as(who, 'post', base(g), { title, body: 'Thoughts?' });
  expect(res.status).toBe(201);
  return res.body as HubForumThread;
}

async function reply(g: number, t: number, who: Who | 'admin' = 'plain') {
  const res = await as(who, 'post', `${base(g)}/${t}/replies`, { body: 'r' });
  expect(res.status).toBe(201);
  return res.body as HubForumReply;
}

async function list(g: number): Promise<HubForumThreadList> {
  const res = await call(ctx, 'get', base(g), 'plain');
  expect(res.status).toBe(200);
  return res.body as HubForumThreadList;
}

describe('ROK-1175 forum — staff row (AC7)', () => {
  it('an admin who is not on the hub reads, writes, pins and moderates, but never rewrites', async () => {
    const g = await newHub(ctx);
    const t = await thread(g, 'plain');
    expect((await as('admin', 'get', base(g))).status).toBe(200);
    expect((await as('admin', 'get', `${base(g)}/latest`)).status).toBe(200);
    expect((await as('admin', 'get', `${base(g)}/${t.id}`)).status).toBe(200);
    const own = await thread(g, 'admin', 'Staff note');
    const r = await reply(g, t.id, 'admin');
    expect(r.can).toMatchObject({ edit: true, delete: true });
    expect((await as('admin', 'put', `${base(g)}/${own.id}/pin`)).status).toBe(
      204,
    );
    const rewrite = await as('admin', 'patch', `${base(g)}/${t.id}`, {
      body: 'x',
    });
    expect(rewrite.status).toBe(403);
    expect((await as('admin', 'delete', `${base(g)}/${t.id}`)).status).toBe(
      204,
    );
    const gone = await call(ctx, 'get', `${base(g)}/${t.id}`, 'plain');
    expect((gone.body as HubForumThread).deleted).toBe('moderator');
  });
});

describe('ROK-1175 forum — pins (AC6)', () => {
  it('two pins list newest pin first; unpin is moderator-only', async () => {
    const g = await newHub(ctx);
    const a = await thread(g, 'plain', 'first pinned');
    const b = await thread(g, 'plain', 'second pinned');
    expect((await as('officerA', 'put', `${base(g)}/${a.id}/pin`)).status).toBe(
      204,
    );
    expect((await as('officerB', 'put', `${base(g)}/${b.id}/pin`)).status).toBe(
      204,
    );
    expect((await list(g)).pinned.map((x) => x.id)).toEqual([b.id, a.id]);
    const unpin = `${base(g)}/${b.id}/pin`;
    expect((await as('outsider', 'delete', unpin)).status).toBe(403);
    expect((await as('plain', 'delete', unpin)).status).toBe(403);
    expect((await as('officerA', 'delete', unpin)).status).toBe(204);
    const after = await list(g);
    expect(after.pinned.map((x) => x.id)).toEqual([a.id]);
    expect(after.threads.map((x) => x.id)).toEqual([b.id]);
  });

  it('the 51st pin is 409 "Unpin a thread first"; re-pinning and pinning after an unpin work (Codex P2)', async () => {
    const g = await newHub(ctx);
    const at = new Date(Date.now() - 3_600_000);
    const rows = Array.from({ length: 50 }, (_, i) => ({
      guildId: g,
      authorId: ctx.userIds.plain,
      title: `pin ${i}`,
      body: 'b',
      createdAt: at,
      updatedAt: at,
      lastActivityAt: at,
      pinnedAt: new Date(at.getTime() + i * 1000),
      pinnedBy: ctx.userIds.officerA,
    }));
    const pins = await ctx.testApp.db
      .insert(schema.hubForumThreads)
      .values(rows)
      .returning({ id: schema.hubForumThreads.id });
    const extra = await thread(g, 'plain', 'one too many');
    const full = await as('officerA', 'put', `${base(g)}/${extra.id}/pin`);
    expect(full.status).toBe(409);
    expect((full.body as { message: string }).message).toBe(FORUM_PIN_LIMIT);
    const first = nonEmpty(pins, 'pins')[0];
    expect(
      (await as('officerA', 'put', `${base(g)}/${first.id}/pin`)).status,
    ).toBe(204);
    expect(
      (await as('officerA', 'delete', `${base(g)}/${first.id}/pin`)).status,
    ).toBe(204);
    expect(
      (await as('officerA', 'put', `${base(g)}/${extra.id}/pin`)).status,
    ).toBe(204);
    const pinned = (await list(g)).pinned.map((x) => x.id);
    expect(pinned).toHaveLength(50);
    expect(pinned[0]).toBe(extra.id);
  });
});

describe('ROK-1175 forum — Latest threads widget (Codex P2)', () => {
  it('removed threads with live replies never take the three rows or the total', async () => {
    const g = await newHub(ctx);
    const old = Date.now() - 3_600_000;
    const live = [];
    for (let i = 0; i < 4; i++)
      live.push(await thread(g, 'plain', `live ${i}`));
    const removed = Array.from({ length: 3 }, (_, i) => {
      const at = new Date(old + (i + 1) * 60_000 + 7_200_000);
      return {
        guildId: g,
        authorId: ctx.userIds.plain,
        title: `removed ${i}`,
        body: 'b',
        createdAt: at,
        updatedAt: at,
        lastActivityAt: at,
        replyCount: 1,
        deletedAt: at,
        deletedBy: ctx.userIds.plain,
        deletedAs: 'author' as const,
      };
    });
    await ctx.testApp.db.insert(schema.hubForumThreads).values(removed);
    const res = await call(ctx, 'get', `${base(g)}/latest`, 'plain');
    expect(res.status).toBe(200);
    const body = res.body as HubForumLatest;
    expect(body.threads.map((x) => x.title)).toEqual([
      'live 3',
      'live 2',
      'live 1',
    ]);
    expect(body.total).toBe(4);
    expect(live).toHaveLength(4);
  });
});

describe('ROK-1175 forum — writes on others and visitors (AC5, AC7)', () => {
  it('a member cannot delete another member thread; a visitor cannot edit or delete a reply', async () => {
    const g = await newHub(ctx);
    const t = await thread(g, 'officerA');
    expect((await as('plain', 'delete', `${base(g)}/${t.id}`)).status).toBe(
      403,
    );
    const r = await reply(g, t.id, 'plain');
    const rp = `${base(g)}/${t.id}/replies/${r.id}`;
    expect((await as('outsider', 'patch', rp, { body: 'x' })).status).toBe(403);
    expect((await as('outsider', 'delete', rp)).status).toBe(403);
    expect((await as('officerB', 'patch', rp, { body: 'x' })).status).toBe(403);
    const after = await call(ctx, 'get', `${base(g)}/${t.id}`, 'plain');
    const body = after.body as HubForumThread;
    expect(body.deleted).toBeNull();
    expect(body.replies.map((x) => [x.body, x.deleted])).toEqual([['r', null]]);
  });
});

describe('ROK-1175 forum — reply IDOR (AC7)', () => {
  it('a reply id under another thread or another hub is 404 and untouched', async () => {
    const [g, other] = [await newHub(ctx), await newHub(ctx)];
    const t = await thread(g, 'plain');
    const sibling = await thread(g, 'plain', 'sibling');
    const foreign = await thread(other, 'plain', 'foreign');
    const r = await reply(g, t.id, 'plain');
    const paths = [
      `${base(g)}/${sibling.id}/replies/${r.id}`,
      `${base(other)}/${foreign.id}/replies/${r.id}`,
    ];
    const statuses = [];
    for (const p of paths) {
      statuses.push((await as('plain', 'patch', p, { body: 'x' })).status);
      statuses.push((await as('plain', 'delete', p)).status);
    }
    expect(statuses).toEqual([404, 404, 404, 404]);
    const kept = await call(ctx, 'get', `${base(g)}/${t.id}`, 'plain');
    expect((kept.body as HubForumThread).replies[0]).toMatchObject({
      id: r.id,
      body: 'r',
      deleted: null,
    });
  });
});

describe('ROK-1175 forum — inactive hub kind (AC8)', () => {
  it('every forum route refuses once the hub kind plugin is inactive', async () => {
    const g = await newHub(ctx);
    const t = await thread(g, 'plain');
    const registry = ctx.testApp.app.get(PluginRegistryService);
    await registry.deactivate('blizzard');
    try {
      const responses = [
        await as('plain', 'get', base(g)),
        await as('plain', 'get', `${base(g)}/latest`),
        await as('plain', 'get', `${base(g)}/${t.id}`),
        await as('plain', 'post', base(g), { title: 'x', body: 'y' }),
        await as('plain', 'post', `${base(g)}/${t.id}/replies`, { body: 'y' }),
        await as('officerA', 'put', `${base(g)}/${t.id}/pin`),
      ];
      expect(responses.map((r) => r.status)).toEqual([
        403, 403, 403, 403, 403, 403,
      ]);
      expect(responses.map((r) => (r.body as { code?: string }).code)).toEqual(
        Array(6).fill(HUB_PLUGIN_INACTIVE),
      );
    } finally {
      await registry.activate('blizzard');
    }
    expect((await list(g)).threads.map((x) => x.id)).toEqual([t.id]);
  });
});
