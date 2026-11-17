/**
 * ROK-2208 S7 (§5.7 items 3–4) against a real database: the inbound write
 * gate for event threads (AC17, R11, OQ-10) and the Core lock sweep (AC18,
 * R12). Discord is spied: `sendEmbedDM` for the notice, the lock gateway
 * for lock/archive. Each test gets a fresh hub + event + thread (`newScene`).
 */
import { and, eq } from 'drizzle-orm';
import { nonEmpty } from '../../../common/testing/narrow';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import * as schema from '../../../drizzle/schema';
import {
  bootDiscussion,
  endEvent,
  newScene,
  resetThrottles,
  untagEvent,
  type DiscussionCtx,
  type Scene,
} from '../event-discussion/event-discussion.test-fixtures';
import { syncEventDiscussion } from '../event-discussion/event-discussion.sync';
import {
  HubForumDiscordEventLockGateway,
  HubForumDiscordEventLockSweep,
} from './hub-forum-discord-event-lock';
import { HubForumDiscordInboundIngest } from './hub-forum-discord-inbound.ingest';
import { stubOutbound } from './hub-forum-discord-outbound.test-fixtures';
import {
  HubForumDiscordRouteResolver,
  type InboundMessage,
  type InboundThread,
} from './hub-forum-discord-route';
import { snowflake, stubForumGateway } from './hub-forum-discord.test-fixtures';

const HOUR = 3_600_000;
const noBot = { botUserId: null };

let ctx: DiscussionCtx;
let dm: jest.SpyInstance;

beforeAll(async () => {
  ctx = await bootDiscussion('hfdev');
});

beforeEach(() => {
  resetThrottles(ctx);
  const app = ctx.posts.testApp;
  stubForumGateway(app);
  stubOutbound(app);
  app.app.get(HubForumDiscordRouteResolver).invalidate();
  const client = app.app.get(DiscordBotClientService);
  dm = jest.spyOn(client, 'sendEmbedDM').mockResolvedValue(undefined);
});

afterEach(() => jest.restoreAllMocks());

/** A scene whose hub is bound and whose event thread has a Discord post. */
async function linkedScene(): Promise<Scene & { post: InboundThread }> {
  const scene = await newScene(ctx);
  const { db, request } = ctx.posts.testApp;
  const res = await request
    .put(`/guilds/${scene.guildId}/forum-discord`)
    .set('Authorization', `Bearer ${ctx.tokens.admin}`)
    .send({ mode: 'create', ack: true });
  expect(res.status).toBe(200);
  const f = schema.hubForumDiscordForums;
  const b = schema.hubForumDiscordBindings;
  const [forum] = nonEmpty(
    await db
      .select({ channelId: f.channelId })
      .from(b)
      .innerJoin(f, eq(f.id, b.forumId))
      .where(eq(b.guildId, scene.guildId)),
    'binding',
  );
  const id = snowflake();
  await db.insert(schema.hubForumDiscordLinks).values({
    guildId: scene.guildId,
    kind: 'thread',
    threadId: scene.threadId,
    replyId: null,
    discordThreadId: id,
    discordMessageId: id,
    origin: 'raidledger',
    syncState: 'synced',
  });
  const post: InboundThread = {
    id,
    parentId: forum.channelId,
    name: 'Molten Core',
    appliedTags: [],
    pinned: false,
    archived: false,
  };
  return { ...scene, post };
}

function msg(post: InboundThread, authorId: string): InboundMessage {
  return {
    id: snowflake(),
    threadId: post.id,
    authorId,
    authorName: 'Wanderer',
    authorAvatar: null,
    webhookId: null,
    content: 'Count me in',
    mentions: new Map(),
    attachments: [],
  };
}

async function say(post: InboundThread, authorId: string) {
  const ingest = ctx.posts.testApp.app.get(HubForumDiscordInboundIngest);
  const m = msg(post, authorId);
  const result = await ingest.onCreate(m, post, noBot);
  const l = schema.hubForumDiscordLinks;
  const r = schema.hubForumReplies;
  const rows = await ctx.posts.testApp.db
    .select({ r })
    .from(l)
    .innerJoin(r, eq(r.id, l.replyId))
    .where(eq(l.discordMessageId, m.id));
  return { result, reply: rows[0]?.r ?? null };
}

describe('AC17 — event-thread write gate (R11)', () => {
  it('a non-signup is not imported and gets exactly one DM', async () => {
    const { post } = await linkedScene();
    const stranger = snowflake();
    const first = await say(post, stranger);
    expect(first).toEqual({ result: 'skipped', reply: null });
    const second = await say(post, stranger);
    expect(second).toEqual({ result: 'skipped', reply: null });
    expect(dm).toHaveBeenCalledTimes(1);
    expect(dm.mock.calls[0]?.[0]).toBe(stranger);
  });

  it('a signed-up RL user (via discord_id) is imported, no DM', async () => {
    const { post } = await linkedScene();
    const discordId = snowflake();
    await ctx.posts.testApp.db
      .update(schema.users)
      .set({ discordId })
      .where(eq(schema.users.id, ctx.ids.signed));
    const { result, reply } = await say(post, discordId);
    expect(result).toBe('imported');
    expect(reply?.authorId).toBe(ctx.ids.signed);
    expect(dm).not.toHaveBeenCalled();
  });

  it('an anonymous Discord signup is imported as a guest (OQ-10)', async () => {
    const { post, eventId } = await linkedScene();
    const anon = snowflake();
    await ctx.posts.testApp.db
      .insert(schema.eventSignups)
      .values({ eventId, discordUserId: anon, status: 'signed_up' });
    const { result, reply } = await say(post, anon);
    expect(result).toBe('imported');
    expect(reply?.authorId).toBeNull();
    expect(reply?.authorDiscordId).toBe(anon);
    expect(dm).not.toHaveBeenCalled();
  });
});

async function lockedAt(threadId: number): Promise<Date | null> {
  const l = schema.hubForumDiscordLinks;
  const [row] = nonEmpty(
    await ctx.posts.testApp.db
      .select({ at: l.discordLockedAt })
      .from(l)
      .where(and(eq(l.threadId, threadId), eq(l.kind, 'thread'))),
    'link',
  );
  return row.at;
}

function lockSpies() {
  const app = ctx.posts.testApp.app;
  jest
    .spyOn(app.get(DiscordBotClientService), 'isConnected')
    .mockReturnValue(true);
  const gw = app.get(HubForumDiscordEventLockGateway);
  const set = jest.spyOn(gw, 'setReadOnly').mockResolvedValue(undefined);
  const sweep = app.get(HubForumDiscordEventLockSweep);
  const callsFor = (id: string) =>
    set.mock.calls.filter((c) => c[0] === id).map((c) => c[1]);
  return { sweep, callsFor };
}

describe('AC18 — read-only lock sweep (R12)', () => {
  it('locks + archives once after write_closes_at; a reschedule unlocks', async () => {
    const { post, eventId, threadId } = await linkedScene();
    const { sweep, callsFor } = lockSpies();
    await sweep.sweep(new Date());
    expect(callsFor(post.id)).toEqual([]);
    await endEvent(ctx, eventId);
    await sweep.sweep(new Date());
    await sweep.sweep(new Date());
    expect(callsFor(post.id)).toEqual([true]);
    expect(await lockedAt(threadId)).not.toBeNull();
    const start = new Date(Date.now() + 2 * HOUR);
    const duration: [Date, Date] = [start, new Date(start.getTime() + HOUR)];
    await ctx.posts.testApp.db
      .update(schema.events)
      .set({ duration })
      .where(eq(schema.events.id, eventId));
    await syncEventDiscussion(ctx.posts.testApp.db, eventId, new Date());
    await sweep.sweep(new Date());
    expect(callsFor(post.id)).toEqual([true, false]);
    expect(await lockedAt(threadId)).toBeNull();
  });

  it('locks a detached (untagged) event thread', async () => {
    const { post, eventId } = await linkedScene();
    const { sweep, callsFor } = lockSpies();
    await untagEvent(ctx, eventId);
    await sweep.sweep(new Date());
    expect(callsFor(post.id)).toEqual([true]);
  });
});
