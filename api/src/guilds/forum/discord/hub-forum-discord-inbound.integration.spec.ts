/**
 * ROK-2208 L5 — inbound Discord → RL and pin sync against a real database
 * (§5.4, §5.5, AC7, AC8, AC10, AC12, AC13). The in-memory "gateway" is plain
 * data handed to `HubForumDiscordInboundIngest` (what the listener maps
 * discord.js objects to), so ingest errors surface here instead of being
 * swallowed by the listener's catch. RL → Discord pins go through the real
 * HTTP pin route and a spied `HubForumDiscordPinGateway`.
 */
import { eq } from 'drizzle-orm';
import { nonEmpty } from '../../../common/testing/narrow';
import { waitFor } from '../../../common/testing/integration-helpers';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import * as schema from '../../../drizzle/schema';
import {
  bootPostsApp,
  newHub,
  resetThrottler,
  type PostsCtx,
} from '../../posts/hub-posts.test-fixtures';
import { HubForumDiscordInboundIngest } from './hub-forum-discord-inbound.ingest';
import {
  stubOutbound,
  type FakeOutbound,
} from './hub-forum-discord-outbound.test-fixtures';
import { HubForumDiscordPinGateway } from './hub-forum-discord-pins';
import {
  HubForumDiscordRouteResolver,
  type InboundMessage,
  type InboundThread,
} from './hub-forum-discord-route';
import { stubForumGateway } from './hub-forum-discord.test-fixtures';

const EPOCH = 1420070400000n;
let seq = 0;
/** A snowflake minted "now" (after any binding made by this spec). */
const freshId = (): string =>
  (
    ((BigInt(Date.now() + 60_000) - EPOCH) << 22n) |
    BigInt((seq += 1))
  ).toString();

let ctx: PostsCtx;
let adminToken: string;
let ingest: HubForumDiscordInboundIngest;
let out: FakeOutbound;
let pinGw: { pinnedPost: jest.SpyInstance; setPinned: jest.SpyInstance };
const noBot = { botUserId: null };

beforeAll(async () => {
  ctx = await bootPostsApp('hfdin');
  const [u] = nonEmpty(
    await ctx.testApp.db
      .insert(schema.users)
      .values({
        discordId: 'local:hfdin-admin@forum.test',
        username: 'hfdin-admin',
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
  ingest = ctx.testApp.app.get(HubForumDiscordInboundIngest);
});

beforeEach(() => {
  resetThrottler(ctx);
  stubForumGateway(ctx.testApp);
  out = stubOutbound(ctx.testApp);
  ctx.testApp.app.get(HubForumDiscordRouteResolver).invalidate();
  const gw = ctx.testApp.app.get(HubForumDiscordPinGateway);
  pinGw = {
    pinnedPost: jest.spyOn(gw, 'pinnedPost').mockResolvedValue(null),
    setPinned: jest.spyOn(gw, 'setPinned').mockResolvedValue(undefined),
  };
});

afterEach(() => jest.restoreAllMocks());

async function boundHub(): Promise<{
  g: number;
  channelId: string;
  webhookId: string | null;
}> {
  const g = await newHub(ctx);
  const res = await ctx.testApp.request
    .put(`/guilds/${g}/forum-discord`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ mode: 'create', ack: true });
  expect(res.status).toBe(200);
  const f = schema.hubForumDiscordForums;
  const b = schema.hubForumDiscordBindings;
  const [row] = nonEmpty(
    await ctx.testApp.db
      .select({ channelId: f.channelId, webhookId: f.webhookId })
      .from(b)
      .innerJoin(f, eq(f.id, b.forumId))
      .where(eq(b.guildId, g)),
    'binding',
  );
  return { g, ...row };
}

function post(
  parentId: string | null,
  over: Partial<InboundThread> = {},
): InboundThread {
  return {
    id: freshId(),
    parentId,
    name: 'From Discord',
    appliedTags: [],
    pinned: false,
    archived: false,
    ...over,
  };
}

function msg(
  thread: InboundThread,
  over: Partial<InboundMessage> = {},
): InboundMessage {
  return {
    id: freshId(),
    threadId: thread.id,
    authorId: `d${freshId()}`,
    authorName: 'Wanderer',
    authorAvatar: null,
    webhookId: null,
    content: 'Hello from Discord',
    mentions: new Map(),
    attachments: [],
    ...over,
  };
}

/** Import a Discord post (starter message id = thread id). */
async function importPost(parentId: string, over: Partial<InboundThread> = {}) {
  const thread = post(parentId, over);
  const starter = msg(thread, { id: thread.id });
  expect(await ingest.onCreate(starter, thread, noBot)).toBe('imported');
  return { thread, rlThread: await threadRow(thread.id) };
}

async function threadRow(discordThreadId: string) {
  const l = schema.hubForumDiscordLinks;
  const t = schema.hubForumThreads;
  const [row] = nonEmpty(
    await ctx.testApp.db
      .select({ t })
      .from(l)
      .innerJoin(t, eq(t.id, l.threadId))
      .where(eq(l.discordMessageId, discordThreadId)),
    'imported thread',
  );
  return row.t;
}

async function replyRow(discordMessageId: string) {
  const l = schema.hubForumDiscordLinks;
  const r = schema.hubForumReplies;
  const rows = await ctx.testApp.db
    .select({ r })
    .from(l)
    .innerJoin(r, eq(r.id, l.replyId))
    .where(eq(l.discordMessageId, discordMessageId));
  return rows[0]?.r ?? null;
}

async function threadCount(g: number): Promise<number> {
  const t = schema.hubForumThreads;
  return (
    await ctx.testApp.db.select({ id: t.id }).from(t).where(eq(t.guildId, g))
  ).length;
}

describe('ROK-2208 inbound Discord → RL', () => {
  it('AC8: an unlinked author imports as a guest thread with source discord', async () => {
    const { g, channelId } = await boundHub();
    const { rlThread } = await importPost(channelId, { name: 'Raid tonight?' });
    expect(rlThread).toMatchObject({
      guildId: g,
      authorId: null,
      title: 'Raid tonight?',
      authorDiscordName: 'Wanderer',
    });
    const res = await ctx.testApp.request
      .get(`/guilds/${g}/forum/${rlThread.id}`)
      .set('Authorization', `Bearer ${ctx.tokens.officerA}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain('"source":"discord"');
    expect(out.apply).not.toHaveBeenCalled(); // D2: inbound never emits
  });

  it('R2: a linked Discord user replies as themselves; a guest reply bumps the count', async () => {
    const { channelId } = await boundHub();
    const { thread, rlThread } = await importPost(channelId);
    const discordId = `d${freshId()}`;
    const [u] = nonEmpty(
      await ctx.testApp.db
        .insert(schema.users)
        .values({ discordId, username: `linked-${seq}` })
        .returning(),
      'linked user',
    );
    const linked = msg(thread, { authorId: discordId, authorName: 'Linked' });
    const guest = msg(thread);
    expect(await ingest.onCreate(linked, thread, noBot)).toBe('imported');
    expect(await ingest.onCreate(guest, thread, noBot)).toBe('imported');
    expect(await replyRow(linked.id)).toMatchObject({
      authorId: u.id,
      authorDiscordId: discordId,
    });
    expect(await replyRow(guest.id)).toMatchObject({
      authorId: null,
      authorDiscordName: 'Wanderer',
    });
    expect((await threadRow(thread.id)).replyCount).toBe(
      rlThread.replyCount + 2,
    );
  });

  it('AC10/R3: a Discord edit of an old Discord-origin reply lands; a delete soft-deletes as author', async () => {
    const { channelId } = await boundHub();
    const { thread } = await importPost(channelId);
    const reply = msg(thread);
    await ingest.onCreate(reply, thread, noBot);
    const late = new Date(Date.now() + 3 * 86_400_000);
    expect(
      await ingest.onUpdate(
        { ...reply, content: 'Edited on Discord' },
        channelId,
        late,
      ),
    ).toBe('updated');
    expect(await replyRow(reply.id)).toMatchObject({
      body: 'Edited on Discord',
      editedAt: late,
    });
    expect(await ingest.onDelete(reply.id, channelId)).toBe('deleted');
    expect(await replyRow(reply.id)).toMatchObject({
      deletedAs: 'author',
      deletedBy: null,
    });
    expect((await threadRow(thread.id)).replyCount).toBe(0);
  });

  it('a deleted Discord post soft-deletes the RL thread as moderator', async () => {
    const { channelId } = await boundHub();
    const { thread } = await importPost(channelId);
    expect(await ingest.onThreadDelete(thread)).toBe('deleted');
    expect(await threadRow(thread.id)).toMatchObject({
      deletedAs: 'moderator',
      deletedBy: null,
    });
  });

  it('AC7/D5: our webhook, our bot and already-linked messages are echoes', async () => {
    const { g, channelId, webhookId } = await boundHub();
    expect(webhookId).not.toBeNull();
    const t1 = post(channelId);
    expect(
      await ingest.onCreate(msg(t1, { id: t1.id, webhookId }), t1, noBot),
    ).toBe('skipped');
    const t2 = post(channelId);
    const bot = msg(t2, { id: t2.id, authorId: 'our-bot' });
    expect(await ingest.onCreate(bot, t2, { botUserId: 'our-bot' })).toBe(
      'skipped',
    );
    const { thread } = await importPost(channelId);
    const again = msg(thread, { id: thread.id });
    expect(await ingest.onCreate(again, thread, noBot)).toBe('skipped');
    expect(await threadCount(g)).toBe(1);
  });

  it('an unbound channel and a post older than bound_at are ignored (AC13)', async () => {
    const { g, channelId } = await boundHub();
    const stray = post(freshId());
    expect(
      await ingest.onCreate(msg(stray, { id: stray.id }), stray, noBot),
    ).toBe('skipped');
    const oldId = ((BigInt(Date.now() - 86_400_000) - EPOCH) << 22n).toString();
    const old = post(channelId, { id: oldId });
    expect(await ingest.onCreate(msg(old), old, noBot)).toBe('skipped');
    expect(await threadCount(g)).toBe(0);
  });
});

describe('review MAJOR-2: inbound follows the CURRENT binding', () => {
  it('shared forum: after hub A unbinds, a reply in an A post is skipped', async () => {
    const { g, channelId } = await boundHub();
    const { thread } = await importPost(channelId);
    const b = schema.hubForumDiscordBindings;
    const [aBinding] = nonEmpty(
      await ctx.testApp.db.select().from(b).where(eq(b.guildId, g)),
      'A binding',
    );
    const other = await newHub(ctx);
    await ctx.testApp.db.insert(b).values({
      guildId: other,
      forumId: aBinding.forumId,
      ackAt: new Date(),
      boundAt: new Date(),
    });
    await ctx.testApp.db.delete(b).where(eq(b.guildId, g));
    ctx.testApp.app.get(HubForumDiscordRouteResolver).invalidate();
    const reply = msg(thread);
    expect(await ingest.onCreate(reply, thread, noBot)).toBe('skipped');
    expect(await replyRow(reply.id)).toBeNull();
  });
});

describe('ROK-2208 pin sync (R5)', () => {
  it('Discord → RL: pinning pins; unpinning the newest unpins; archiving keeps the pin', async () => {
    const { channelId } = await boundHub();
    const { thread } = await importPost(channelId);
    const pinned = { ...thread, pinned: true };
    await ingest.onThreadUpdate(thread, pinned);
    const row = await threadRow(thread.id);
    expect(row.pinnedAt).not.toBeNull();
    expect(row.pinnedBy).toBeNull();
    await ingest.onThreadUpdate(pinned, { ...thread, archived: true });
    expect((await threadRow(thread.id)).pinnedAt).not.toBeNull();
    await ingest.onThreadUpdate(pinned, thread);
    expect((await threadRow(thread.id)).pinnedAt).toBeNull();
  });

  it('RL → Discord: an RL pin moves the forum pin to the newest pinned post', async () => {
    const { g, channelId } = await boundHub();
    const { thread: a } = await importPost(channelId);
    const { thread: b, rlThread } = await importPost(channelId);
    pinGw.pinnedPost.mockResolvedValue(a.id);
    const res = await ctx.testApp.request
      .put(`/guilds/${g}/forum/${rlThread.id}/pin`)
      .set('Authorization', `Bearer ${ctx.tokens.officerA}`);
    expect(res.status).toBe(204);
    await waitFor(async () => {
      expect(pinGw.setPinned).toHaveBeenCalledWith(b.id, true);
      return Promise.resolve();
    });
    expect(pinGw.pinnedPost).toHaveBeenCalledWith(channelId);
    expect(pinGw.setPinned).toHaveBeenCalledWith(a.id, false);
  });
});
