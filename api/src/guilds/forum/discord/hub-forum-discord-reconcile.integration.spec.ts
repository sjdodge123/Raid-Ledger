/**
 * ROK-2208 L6 — reconnect reconcile + outbound retry sweep against a real
 * database (§5.6). Discord is two spied seams: the reconcile gateway (an
 * in-memory forum that honours `after`) and the outbound gateway
 * (`stubOutbound`). The services are called directly, so nothing is hidden
 * behind the CONNECTED handler's catch.
 */
import { eq } from 'drizzle-orm';
import { nonEmpty } from '../../../common/testing/narrow';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import * as schema from '../../../drizzle/schema';
import {
  bootPostsApp,
  newHub,
  resetThrottler,
  type PostsCtx,
} from '../../posts/hub-posts.test-fixtures';
import { HubForumDiscordInboundIngest } from './hub-forum-discord-inbound.ingest';
import { unsentId } from './hub-forum-discord-links.queries';
import {
  stubOutbound,
  type FakeOutbound,
} from './hub-forum-discord-outbound.test-fixtures';
import { HubForumDiscordReconcileGateway } from './hub-forum-discord-reconcile.discord';
import { HubForumDiscordReconcileService } from './hub-forum-discord-reconcile';
import {
  HubForumDiscordRouteResolver,
  type InboundMessage,
  type InboundThread,
} from './hub-forum-discord-route';
import { stubForumGateway } from './hub-forum-discord.test-fixtures';

const EPOCH = 1420070400000n;
const HOUR = 3_600_000;
let seq = 0;
/** A snowflake at `Date.now() + offsetMs`; later calls sort later. */
const idAt = (offsetMs: number): string =>
  (
    ((BigInt(Date.now() + offsetMs) - EPOCH) << 22n) |
    BigInt((seq += 1))
  ).toString();
const freshId = (): string => idAt(60_000);

let ctx: PostsCtx;
let adminId: number;
let ingest: HubForumDiscordInboundIngest;
let sync: HubForumDiscordReconcileService;
let out: FakeOutbound;
/** The in-memory Discord forum the reconcile gateway reads. */
let discord: { threads: InboundThread[]; messages: InboundMessage[] };
let messagesAfter: jest.SpyInstance;

beforeAll(async () => {
  ctx = await bootPostsApp('hfdrc');
  const [u] = nonEmpty(
    await ctx.testApp.db
      .insert(schema.users)
      .values({
        discordId: 'local:hfdrc-admin@forum.test',
        username: 'hfdrc-admin',
        role: 'admin',
      })
      .returning(),
    'admin',
  );
  adminId = u.id;
  ingest = ctx.testApp.app.get(HubForumDiscordInboundIngest);
  sync = ctx.testApp.app.get(HubForumDiscordReconcileService);
});

beforeEach(() => {
  resetThrottler(ctx);
  stubForumGateway(ctx.testApp);
  out = stubOutbound(ctx.testApp);
  ctx.testApp.app.get(HubForumDiscordRouteResolver).invalidate();
  discord = { threads: [], messages: [] };
  const gw = ctx.testApp.app.get(HubForumDiscordReconcileGateway);
  jest.spyOn(gw, 'botUserId').mockReturnValue(null);
  jest
    .spyOn(gw, 'activeThreads')
    .mockImplementation((channelId: string) =>
      Promise.resolve(discord.threads.filter((t) => t.parentId === channelId)),
    );
  messagesAfter = jest
    .spyOn(gw, 'messagesAfter')
    .mockImplementation((threadId: string, after: string, max: number) =>
      Promise.resolve(
        discord.messages
          .filter(
            (m) => m.threadId === threadId && BigInt(m.id) > BigInt(after),
          )
          .slice(0, max),
      ),
    );
});

afterEach(() => jest.restoreAllMocks());

async function boundHub(): Promise<{ g: number; channelId: string }> {
  const g = await newHub(ctx);
  const token = await signTestAccessToken(ctx.testApp, {
    sub: adminId,
    username: 'hfdrc-admin',
    role: 'admin',
  });
  const res = await ctx.testApp.request
    .put(`/guilds/${g}/forum-discord`)
    .set('Authorization', `Bearer ${token}`)
    .send({ mode: 'create', ack: true });
  expect(res.status).toBe(200);
  const f = schema.hubForumDiscordForums;
  const b = schema.hubForumDiscordBindings;
  const [row] = nonEmpty(
    await ctx.testApp.db
      .select({ channelId: f.channelId })
      .from(b)
      .innerJoin(f, eq(f.id, b.forumId))
      .where(eq(b.guildId, g)),
    'binding',
  );
  return { g, channelId: row.channelId };
}

function post(parentId: string, id = freshId()): InboundThread {
  return {
    id,
    parentId,
    name: 'From Discord',
    appliedTags: [],
    pinned: false,
    archived: false,
  };
}

function msg(thread: InboundThread, id = freshId()): InboundMessage {
  return {
    id,
    threadId: thread.id,
    authorId: `d${freshId()}`,
    authorName: 'Wanderer',
    authorAvatar: null,
    webhookId: null,
    content: `message ${id}`,
    mentions: new Map(),
    attachments: [],
  };
}

/** The RL row a Discord message imported as, if any. */
async function linkOf(discordMessageId: string) {
  const l = schema.hubForumDiscordLinks;
  const rows = await ctx.testApp.db
    .select()
    .from(l)
    .where(eq(l.discordMessageId, discordMessageId));
  return rows[0] ?? null;
}

async function linkById(id: number) {
  const l = schema.hubForumDiscordLinks;
  const rows = await ctx.testApp.db.select().from(l).where(eq(l.id, id));
  return rows[0] ?? null;
}

/** An RL-origin thread whose outbound link is still queued. */
async function queuedThread(
  g: number,
  title: string,
  link: { syncState: string; attempts: number; sentId?: string },
) {
  const db = ctx.testApp.db;
  const [t] = nonEmpty(
    await db
      .insert(schema.hubForumThreads)
      .values({ guildId: g, title, body: `${title} body`, authorId: adminId })
      .returning(),
    'thread',
  );
  const discordId = link.sentId ?? unsentId('thread', t.id);
  const [row] = nonEmpty(
    await db
      .insert(schema.hubForumDiscordLinks)
      .values({
        guildId: g,
        kind: 'thread',
        threadId: t.id,
        discordThreadId: discordId,
        discordMessageId: discordId,
        origin: 'raidledger',
        syncState: link.syncState,
        attempts: link.attempts,
        createdAt: new Date(Date.now() - 10 * HOUR),
      })
      .returning(),
    'link',
  );
  return { thread: t, link: row };
}

const sentTitles = (): string[] =>
  out.spies.createPost.mock.calls.map((c) => c[1].title);

describe('ROK-2208 §5.6 outbound retry sweep', () => {
  it('re-sends pending and failed links under 5 attempts, never one at 5', async () => {
    const { g } = await boundHub();
    const pending = await queuedThread(g, 'rc-pending', {
      syncState: 'pending',
      attempts: 0,
    });
    const failed = await queuedThread(g, 'rc-failed4', {
      syncState: 'failed',
      attempts: 4,
    });
    const dead = await queuedThread(g, 'rc-dead5', {
      syncState: 'failed',
      attempts: 5,
    });
    await sync.retrySweep();
    expect(sentTitles()).toEqual(
      expect.arrayContaining(['rc-pending', 'rc-failed4']),
    );
    expect(sentTitles()).not.toContain('rc-dead5');
    for (const q of [pending, failed]) {
      expect(await linkById(q.link.id)).toMatchObject({
        syncState: 'synced',
        attempts: 0,
      });
      expect(await linkOf(q.link.discordMessageId)).toBeNull(); // placeholder gone
    }
    expect(await linkOf(dead.link.discordMessageId)).toMatchObject({
      syncState: 'failed',
      attempts: 5,
    });
  });

  it('a placeholder reply is sent into its post once the post is re-sent', async () => {
    const { g } = await boundHub();
    const { thread, link } = await queuedThread(g, 'rc-parent', {
      syncState: 'failed',
      attempts: 1,
    });
    const [r] = nonEmpty(
      await ctx.testApp.db
        .insert(schema.hubForumReplies)
        .values({
          guildId: g,
          threadId: thread.id,
          body: 'queued reply',
          authorId: adminId,
        })
        .returning(),
      'reply',
    );
    await ctx.testApp.db.insert(schema.hubForumDiscordLinks).values({
      guildId: g,
      kind: 'reply',
      threadId: thread.id,
      replyId: r.id,
      discordThreadId: link.discordThreadId,
      discordMessageId: unsentId('reply', r.id),
      origin: 'raidledger',
      syncState: 'pending',
      createdAt: new Date(Date.now() - 10 * HOUR),
    });
    await sync.retrySweep();
    const parent = await linkById(link.id);
    const realPost = parent?.discordThreadId ?? 'missing parent link';
    expect(realPost.startsWith('rl:')).toBe(false);
    expect(out.spies.createReply).toHaveBeenCalledWith(
      expect.anything(),
      realPost,
      expect.stringContaining('queued reply'),
      expect.anything(),
    );
    expect(out.spies.editMessage).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ messageId: unsentId('reply', r.id) }),
      expect.anything(),
    );
    expect(await linkOf(unsentId('reply', r.id))).toBeNull();
  });

  it('a sent link whose edit failed is re-edited, not re-created', async () => {
    const { g } = await boundHub();
    const sentId = freshId();
    await queuedThread(g, 'rc-edit', {
      syncState: 'failed',
      attempts: 2,
      sentId,
    });
    await sync.retrySweep();
    expect(sentTitles()).not.toContain('rc-edit');
    expect(out.spies.editMessage).toHaveBeenCalledWith(
      expect.anything(),
      { threadId: sentId, messageId: sentId },
      expect.stringContaining('rc-edit body'),
    );
    expect(await linkOf(sentId)).toMatchObject({
      syncState: 'synced',
      attempts: 0,
    });
  });
});

describe('ROK-2208 §5.6 reconcile on reconnect', () => {
  it('imports a message newer than the newest link and skips an older one', async () => {
    const { channelId } = await boundHub();
    const thread = post(channelId);
    const starter = msg(thread, thread.id);
    expect(await ingest.onCreate(starter, thread, { botUserId: null })).toBe(
      'imported',
    );
    const older = msg(thread); // missed, but older than the newest link
    const linked = msg(thread);
    expect(await ingest.onCreate(linked, thread, { botUserId: null })).toBe(
      'imported',
    );
    const newer = msg(thread);
    discord = { threads: [thread], messages: [starter, older, linked, newer] };
    await sync.reconcileAll();
    expect(messagesAfter).toHaveBeenCalledWith(thread.id, linked.id, 200);
    expect(await linkOf(newer.id)).toMatchObject({
      origin: 'discord',
      kind: 'reply',
    });
    expect(await linkOf(older.id)).toBeNull();
  });

  it('an unknown post created after bound_at imports, starter first', async () => {
    const { channelId } = await boundHub();
    const thread = post(channelId);
    const reply = msg(thread);
    discord = { threads: [thread], messages: [msg(thread, thread.id), reply] };
    const counts = await sync.replayThread(thread);
    expect(counts.imported).toBe(2);
    expect(messagesAfter).toHaveBeenCalledWith(
      thread.id,
      (BigInt(thread.id) - 1n).toString(),
      200,
    );
    expect(await linkOf(thread.id)).toMatchObject({
      kind: 'thread',
      origin: 'discord',
    });
    expect(await linkOf(reply.id)).toMatchObject({ kind: 'reply' });
  });

  it('an unknown post older than bound_at is not imported', async () => {
    const { channelId } = await boundHub();
    const thread = post(channelId, idAt(-24 * HOUR));
    discord = {
      threads: [thread],
      messages: [msg(thread, thread.id), msg(thread)],
    };
    const counts = await sync.replayThread(thread);
    expect(counts).toMatchObject({ imported: 0 });
    expect(await linkOf(thread.id)).toBeNull();
  });
});
