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
import { markDeleted } from './hub-forum-discord-links.queries';
import { HubForumDiscordNotices } from './hub-forum-discord-notice';
import {
  stubOutbound,
  type FakeOutbound,
} from './hub-forum-discord-outbound.test-fixtures';
import {
  HubForumDiscordPinGateway,
  HubForumDiscordPinSync,
} from './hub-forum-discord-pins';
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

  it('codex P2: a post stamped by an outbound 404 is still removed by the gateway delete', async () => {
    const { channelId } = await boundHub();
    const { thread } = await importPost(channelId);
    const l = schema.hubForumDiscordLinks;
    const linkOf = async () =>
      nonEmpty(
        await ctx.testApp.db
          .select()
          .from(l)
          .where(eq(l.discordMessageId, thread.id)),
        'post link',
      )[0];
    const stampedAt = new Date(Date.now() - 60_000);
    await markDeleted(ctx.testApp.db, (await linkOf()).id, stampedAt);
    expect(await ingest.onThreadDelete(thread)).toBe('deleted');
    expect(await threadRow(thread.id)).toMatchObject({
      deletedAs: 'moderator',
      deletedBy: null,
    });
    expect((await linkOf()).discordDeletedAt).toEqual(stampedAt);
    // The RL thread is now removed: a repeat delete event skips.
    expect(await ingest.onThreadDelete(thread)).toBe('skipped');
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

  it('ROK-2274 loop 2: a bot-authored signup line never imports as a reply', async () => {
    const { channelId } = await boundHub();
    const { thread, rlThread } = await importPost(channelId);
    const line = msg(thread, {
      authorId: 'our-bot',
      content: '✅ <@123456789012345678> signed up',
    });
    expect(await ingest.onCreate(line, thread, { botUserId: 'our-bot' })).toBe(
      'skipped',
    );
    expect(await replyRow(line.id)).toBeNull();
    const r = schema.hubForumReplies;
    const rows = await ctx.testApp.db
      .select({ id: r.id })
      .from(r)
      .where(eq(r.threadId, rlThread.id));
    expect(rows).toEqual([]);
    expect((await threadRow(thread.id)).replyCount).toBe(0);
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

/** One live registry post per subject, so each call takes a fresh subject. */
let registrySubjectId = 0;

/** Register a Discord-only post in the forum bound at `channelId`. */
async function registryPost(channelId: string): Promise<InboundThread> {
  const f = schema.hubForumDiscordForums;
  const [forum] = nonEmpty(
    await ctx.testApp.db
      .select({ id: f.id })
      .from(f)
      .where(eq(f.channelId, channelId)),
    'forum',
  );
  const thread = post(channelId, { name: 'Pizza night — Poll' });
  await ctx.testApp.db.insert(schema.eventPlanningPosts).values({
    subjectKind: 'poll',
    subjectId: (registrySubjectId += 1),
    forumId: forum.id,
    discordThreadId: thread.id,
  });
  return thread;
}

describe('ROK-2272 S3: event-planning registry posts stay on Discord', () => {
  it('single-hub forum + registry post ⇒ not imported, no notice', async () => {
    const { g, channelId } = await boundHub();
    const notify = jest.spyOn(
      ctx.testApp.app.get(HubForumDiscordNotices),
      'notify',
    );
    const thread = await registryPost(channelId);
    const starter = msg(thread, { id: thread.id });
    expect(await ingest.onCreate(starter, thread, noBot)).toBe('skipped');
    const reply = msg(thread);
    const fetchStarter = () => Promise.resolve(starter);
    expect(
      await ingest.onCreate(reply, thread, { ...noBot, fetchStarter }),
    ).toBe('skipped');
    expect(await threadCount(g)).toBe(0);
    expect(notify).not.toHaveBeenCalled();
    // Control: an ordinary post in the same forum still imports.
    await importPost(channelId);
    expect(await threadCount(g)).toBe(1);
  });

  it('shared forum + registry post (kind tag only) ⇒ never tag-noticed', async () => {
    const { g, channelId } = await boundHub();
    const b = schema.hubForumDiscordBindings;
    const [aBinding] = nonEmpty(
      await ctx.testApp.db.select().from(b).where(eq(b.guildId, g)),
      'A binding',
    );
    await ctx.testApp.db.insert(b).values({
      guildId: await newHub(ctx),
      forumId: aBinding.forumId,
      ackAt: new Date(),
      boundAt: new Date(),
    });
    ctx.testApp.app.get(HubForumDiscordRouteResolver).invalidate();
    const notify = jest
      .spyOn(ctx.testApp.app.get(HubForumDiscordNotices), 'notify')
      .mockResolvedValue(true);
    const base = await registryPost(channelId);
    const thread = { ...base, appliedTags: [freshId()] }; // the Poll kind tag
    const starter = msg(thread, { id: thread.id });
    expect(await ingest.onCreate(starter, thread, noBot)).toBe('skipped');
    expect(notify).not.toHaveBeenCalled();
    expect(await threadCount(g)).toBe(0);
  });
});

describe('ROK-2272 S4 review MAJOR-2: a registry post deleted on Discord', () => {
  it('thread-delete marks the registry row deleted; imports nothing, DMs nobody', async () => {
    const { g, channelId } = await boundHub();
    const notify = jest.spyOn(
      ctx.testApp.app.get(HubForumDiscordNotices),
      'notify',
    );
    const thread = await registryPost(channelId);
    expect(await ingest.onThreadDelete(thread)).toBe('deleted');
    const p = schema.eventPlanningPosts;
    const [row] = nonEmpty(
      await ctx.testApp.db
        .select()
        .from(p)
        .where(eq(p.discordThreadId, thread.id)),
      'registry post',
    );
    expect(row.discordDeletedAt).not.toBeNull();
    expect(await threadCount(g)).toBe(0);
    expect(notify).not.toHaveBeenCalled();
    // A repeat delete event finds no live row.
    expect(await ingest.onThreadDelete(thread)).toBe('skipped');
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

describe('codex P2: pin sync echoes and re-binds', () => {
  it('codex P2: the hub losing the shared pin keeps its RL pin (our unpin echo)', async () => {
    const { channelId: aCh } = await boundHub();
    const { thread: a } = await importPost(aCh);
    const aPinned = { ...a, pinned: true };
    await ingest.onThreadUpdate(a, aPinned);
    const { g: gB, channelId: bCh } = await boundHub();
    const { thread: b, rlThread } = await importPost(bCh);
    pinGw.pinnedPost.mockResolvedValue(a.id); // A holds the forum's one pin
    const res = await ctx.testApp.request
      .put(`/guilds/${gB}/forum/${rlThread.id}/pin`)
      .set('Authorization', `Bearer ${ctx.tokens.officerA}`);
    expect(res.status).toBe(204);
    await waitFor(async () => {
      expect(pinGw.setPinned).toHaveBeenCalledWith(b.id, true);
      return Promise.resolve();
    });
    expect(pinGw.setPinned).toHaveBeenCalledWith(a.id, false);
    await ingest.onThreadUpdate(aPinned, a); // the gateway echo of that unpin
    expect((await threadRow(a.id)).pinnedAt).not.toBeNull();
  });

  it('codex P2: RL → Discord ignores pinned posts from a forum the hub no longer binds', async () => {
    const { g, channelId } = await boundHub();
    const { thread: old } = await importPost(channelId);
    await ingest.onThreadUpdate(old, { ...old, pinned: true });
    const b = schema.hubForumDiscordBindings;
    await ctx.testApp.db.delete(b).where(eq(b.guildId, g));
    const res = await ctx.testApp.request
      .put(`/guilds/${g}/forum-discord`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'create', ack: true });
    expect(res.status).toBe(200);
    await ctx.testApp.app.get(HubForumDiscordPinSync).pushHub(g);
    expect(pinGw.setPinned).not.toHaveBeenCalledWith(old.id, true);
  });
});

describe('codex P2: a reply racing its own starter import', () => {
  it('imports the reply when the starter event linked the starter meanwhile', async () => {
    const { channelId } = await boundHub();
    const thread = post(channelId);
    const starter = msg(thread, { id: thread.id });
    const reply = msg(thread);
    const fetchStarter = async () => {
      // The starter's own MessageCreate commits while the reply is mid-flight.
      expect(await ingest.onCreate(starter, thread, noBot)).toBe('imported');
      return starter;
    };
    const ctxWithStarter = { ...noBot, fetchStarter };
    expect(await ingest.onCreate(reply, thread, ctxWithStarter)).toBe(
      'imported',
    );
    expect(await replyRow(reply.id)).not.toBeNull();
    expect((await threadRow(thread.id)).replyCount).toBe(1);
  });
});
