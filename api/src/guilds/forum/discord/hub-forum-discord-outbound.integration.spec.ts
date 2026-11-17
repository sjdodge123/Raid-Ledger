/**
 * ROK-2208 L4 — outbound RL → Discord against a real database (§5.2, §5.3,
 * AC5, AC11): HTTP forum writes emit `hub-forum.changed`; the listener
 * posts/edits/deletes through the in-memory outbound gateway and records a
 * link row. Unbound hubs and Discord-origin rows send nothing. The
 * binding is made through the real PUT with L2's in-memory binding gateway.
 */
import { and, eq } from 'drizzle-orm';
import type { Response } from 'supertest';
import { nonEmpty } from '../../../common/testing/narrow';
import { waitFor } from '../../../common/testing/integration-helpers';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import * as schema from '../../../drizzle/schema';
import {
  bootPostsApp,
  newHub,
  resetThrottler,
  settle,
  type PostsCtx,
  type Who,
} from '../../posts/hub-posts.test-fixtures';
import {
  stubOutbound,
  type FakeOutbound,
} from './hub-forum-discord-outbound.test-fixtures';
import { stubForumGateway } from './hub-forum-discord.test-fixtures';

let ctx: PostsCtx;
let adminToken: string;
let out: FakeOutbound;

beforeAll(async () => {
  ctx = await bootPostsApp('hfdout');
  const [u] = nonEmpty(
    await ctx.testApp.db
      .insert(schema.users)
      .values({
        discordId: 'local:hfdout-admin@forum.test',
        username: 'hfdout-admin',
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
  resetThrottler(ctx);
  stubForumGateway(ctx.testApp);
  out = stubOutbound(ctx.testApp);
});

afterEach(() => {
  jest.restoreAllMocks();
});

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

function as(who: Who | 'admin', method: Method, path: string, body?: object) {
  const token = who === 'admin' ? adminToken : ctx.tokens[who];
  const req = ctx.testApp.request[method](path).set(
    'Authorization',
    `Bearer ${token}`,
  );
  return body === undefined ? req : req.send(body);
}

function idOf(res: Response): number {
  const id: unknown = Reflect.get(Object(res.body), 'id');
  if (typeof id !== 'number') throw new Error(`no id: ${res.status}`);
  return id;
}

/** Wait for the async listener's `apply` calls, then await them all. */
async function synced(calls = 1): Promise<void> {
  await waitFor(async () => {
    expect(out.apply).toHaveBeenCalledTimes(calls);
    return Promise.resolve();
  });
  await settle(out.apply);
}

async function bind(g: number, body: object): Promise<void> {
  const res = await as('admin', 'put', `/guilds/${g}/forum-discord`, {
    ...body,
    ack: true,
  });
  expect(res.status).toBe(200);
}

async function forumOf(g: number) {
  const [row] = nonEmpty(
    await ctx.testApp.db
      .select({
        forum: schema.hubForumDiscordForums,
        tagId: schema.hubForumDiscordBindings.tagId,
      })
      .from(schema.hubForumDiscordBindings)
      .innerJoin(
        schema.hubForumDiscordForums,
        eq(
          schema.hubForumDiscordForums.id,
          schema.hubForumDiscordBindings.forumId,
        ),
      )
      .where(eq(schema.hubForumDiscordBindings.guildId, g)),
    'binding',
  );
  return row;
}

async function linkRows(threadId: number) {
  const l = schema.hubForumDiscordLinks;
  return ctx.testApp.db.select().from(l).where(eq(l.threadId, threadId));
}

async function newThread(
  g: number,
  title = 'Raid night',
  body = 'Bring flasks',
) {
  const res = await as('officerA', 'post', `/guilds/${g}/forum`, {
    title,
    body,
  });
  expect(res.status).toBe(201);
  return idOf(res);
}

describe('ROK-2208 outbound RL → Discord', () => {
  it('AC5: a new thread posts through the webhook with the hub tag (shared forum)', async () => {
    const [a, b] = [await newHub(ctx), await newHub(ctx)];
    await bind(a, { mode: 'create' });
    await bind(b, {
      mode: 'existing',
      channelId: (await forumOf(a)).forum.channelId,
    });
    const { forum, tagId } = await forumOf(b);
    expect(tagId).not.toBeNull();
    const threadId = await newThread(b);
    await synced();
    expect(out.spies.createPost).toHaveBeenCalledTimes(1);
    const [[target, post, author]] = nonEmpty(
      out.spies.createPost.mock.calls,
      'createPost',
    );
    expect(target).toEqual({
      channelId: forum.channelId,
      webhookId: forum.webhookId,
    });
    expect(post).toEqual({
      title: 'Raid night',
      content: 'Bring flasks',
      tagIds: [tagId],
    });
    expect(author.username).toBe('hfdout officerA');
    const [link] = nonEmpty(await linkRows(threadId), 'link');
    expect(link).toMatchObject({
      kind: 'thread',
      origin: 'raidledger',
      syncState: 'synced',
    });
    expect(link.discordMessageId).toMatch(/^\d+$/);
  });

  it('an unshared forum posts with no tag; edit → edited + renamed', async () => {
    const g = await newHub(ctx);
    await bind(g, { mode: 'create' });
    const threadId = await newThread(g);
    await synced();
    const [[, post]] = nonEmpty(out.spies.createPost.mock.calls, 'createPost');
    expect(post.tagIds).toEqual([]);
    const [link] = nonEmpty(await linkRows(threadId), 'link');
    const edit = { title: 'Raid night moved', body: 'Now Friday' };
    expect(
      (await as('officerA', 'patch', `/guilds/${g}/forum/${threadId}`, edit))
        .status,
    ).toBe(200);
    await synced(2);
    const ref = {
      threadId: link.discordThreadId,
      messageId: link.discordMessageId,
    };
    expect(out.spies.editMessage).toHaveBeenCalledWith(
      expect.anything(),
      ref,
      'Now Friday',
    );
    expect(out.spies.renameThread).toHaveBeenCalledWith(
      link.discordThreadId,
      'Raid night moved',
      expect.any(Function),
    );
  });

  it('a reply posts into the post; deleting it deletes the message; R4 thread delete', async () => {
    const g = await newHub(ctx);
    await bind(g, { mode: 'create' });
    const threadId = await newThread(g);
    await synced();
    const [thread] = nonEmpty(await linkRows(threadId), 'thread link');
    const res = await as(
      'officerA',
      'post',
      `/guilds/${g}/forum/${threadId}/replies`,
      { body: 'Count me in' },
    );
    expect(res.status).toBe(201);
    const replyId = idOf(res);
    await synced(2);
    expect(out.spies.createReply).toHaveBeenCalledWith(
      expect.anything(),
      thread.discordThreadId,
      'Count me in',
      expect.anything(),
    );
    await as(
      'officerA',
      'delete',
      `/guilds/${g}/forum/${threadId}/replies/${replyId}`,
    ).expect(204);
    await synced(3);
    const l = schema.hubForumDiscordLinks;
    const [reply] = nonEmpty(
      await ctx.testApp.db.select().from(l).where(eq(l.replyId, replyId)),
      'reply link',
    );
    expect(out.spies.deleteMessage).toHaveBeenCalledWith({
      threadId: thread.discordThreadId,
      messageId: reply.discordMessageId,
    });
    expect(reply.discordDeletedAt).not.toBeNull();
    await as('officerA', 'delete', `/guilds/${g}/forum/${threadId}`).expect(
      204,
    );
    await synced(4);
    expect(out.spies.deleteThread).toHaveBeenCalledWith(thread.discordThreadId);
  });

  it('a failed send leaves a retryable failed link row', async () => {
    const g = await newHub(ctx);
    await bind(g, { mode: 'create' });
    out.spies.createPost.mockRejectedValueOnce(new Error('Discord 500'));
    const threadId = await newThread(g);
    await synced();
    const [link] = nonEmpty(await linkRows(threadId), 'link');
    expect(link).toMatchObject({
      syncState: 'failed',
      attempts: 1,
      lastError: 'Discord 500',
    });
  });

  it('an unbound hub sends nothing', async () => {
    const g = await newHub(ctx);
    const threadId = await newThread(g);
    await synced();
    // The listener swallows a throw, so assert the apply itself returned
    // cleanly: a broken binding guard would reject on the null binding.
    const [listened] = nonEmpty(out.apply.mock.results, 'apply result');
    await expect(listened.value).resolves.toBeUndefined();
    await expect(
      out.service.apply({
        guildId: g,
        op: 'thread.created',
        threadId,
        actorId: 0,
      }),
    ).resolves.toBeUndefined();
    expect(out.spies.createPost).not.toHaveBeenCalled();
    expect(await linkRows(threadId)).toEqual([]);
  });

  it('a Discord-origin thread is never echoed back out', async () => {
    const g = await newHub(ctx);
    await bind(g, { mode: 'create' });
    out.apply.mockResolvedValueOnce(undefined);
    const threadId = await newThread(g);
    await synced();
    const t = schema.hubForumThreads;
    await ctx.testApp.db
      .update(t)
      .set({
        authorDiscordId: '478880000000000001',
        authorDiscordName: 'guest',
      })
      .where(and(eq(t.id, threadId), eq(t.guildId, g)));
    await out.service.apply({
      guildId: g,
      op: 'thread.created',
      threadId,
      actorId: 0,
    });
    expect(out.spies.createPost).not.toHaveBeenCalled();
    expect(await linkRows(threadId)).toEqual([]);
  });
  it('review MAJOR-2: a re-bound hub never drives its old forum (reply, edit, delete)', async () => {
    const g = await newHub(ctx);
    await bind(g, { mode: 'create' });
    const threadId = await newThread(g);
    await synced();
    // A re-bind stamps a fresh bound_at: this post lives in the OLD forum.
    const b = schema.hubForumDiscordBindings;
    await ctx.testApp.db
      .update(b)
      .set({ boundAt: new Date(Date.now() + 3_600_000) })
      .where(eq(b.guildId, g));
    const res = await as(
      'officerA',
      'post',
      `/guilds/${g}/forum/${threadId}/replies`,
      { body: 'Into the old forum?' },
    );
    expect(res.status).toBe(201);
    await synced(2);
    for (const op of ['thread.updated', 'thread.deleted'] as const) {
      await out.service.apply({ guildId: g, op, threadId, actorId: 0 });
    }
    expect(out.spies.createReply).not.toHaveBeenCalled();
    expect(out.spies.editMessage).not.toHaveBeenCalled();
    expect(out.spies.deleteThread).not.toHaveBeenCalled();
  });
});
