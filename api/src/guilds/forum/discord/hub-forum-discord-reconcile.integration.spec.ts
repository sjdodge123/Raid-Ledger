/**
 * ROK-2208 L6 — reconnect reconcile + outbound retry sweep against a real
 * database (§5.6). Discord is two spied seams: the reconcile gateway (an
 * in-memory forum that honours `after`) and the outbound gateway
 * (`stubOutbound`). The services are called directly, so nothing is hidden
 * behind the CONNECTED handler's catch.
 */
import { eq, inArray } from 'drizzle-orm';
import { nonEmpty } from '../../../common/testing/narrow';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import * as schema from '../../../drizzle/schema';
import {
  bootPostsApp,
  newHub,
  resetThrottler,
  type PostsCtx,
} from '../../posts/hub-posts.test-fixtures';
import { requeueHeldReplies } from './hub-forum-discord-event-lock.reopen';
import { HubForumDiscordInboundIngest } from './hub-forum-discord-inbound.ingest';
import {
  heldReplyTarget,
  markSent,
  rehomeReplies,
  unsentId,
} from './hub-forum-discord-links.queries';
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
  jest.spyOn(gw, 'isOnline').mockReturnValue(true);
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
  link: {
    syncState: string;
    attempts: number;
    sentId?: string;
    origin?: string;
  },
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
        origin: link.origin ?? 'raidledger',
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

describe('ROK-2208 §5.6 outbound retry sweep — bot offline (Codex P1)', () => {
  it('bot offline: the sweep sends nothing and consumes no attempt', async () => {
    const { g } = await boundHub();
    const q = await queuedThread(g, 'rc-offline', {
      syncState: 'failed',
      attempts: 4,
    });
    const gw = ctx.testApp.app.get(HubForumDiscordReconcileGateway);
    jest.spyOn(gw, 'isOnline').mockReturnValue(false);
    expect(await sync.retrySweep()).toBe(0);
    expect(sentTitles()).not.toContain('rc-offline');
    expect(await linkById(q.link.id)).toMatchObject({
      syncState: 'failed',
      attempts: 4,
    });
  });
});

describe('ROK-2208 §5.6 retry sweep — Discord-origin moderation deletes (Codex P2)', () => {
  it('re-drives a failed delete of an imported post an RL moderator removed', async () => {
    const { g } = await boundHub();
    const sentId = '1200000000000000001';
    const q = await queuedThread(g, 'rc-modded', {
      syncState: 'failed',
      attempts: 1,
      sentId,
      origin: 'discord',
    });
    await ctx.testApp.db
      .update(schema.hubForumThreads)
      .set({ deletedAt: new Date(), deletedAs: 'moderator' })
      .where(eq(schema.hubForumThreads.id, q.thread.id));
    await sync.retrySweep();
    expect(out.spies.deleteThread).toHaveBeenCalledWith(sentId);
    const after = await linkById(q.link.id);
    expect(after?.discordDeletedAt).not.toBeNull();
  });

  it('never echoes a failed Discord-origin row whose RL row still exists', async () => {
    const { g } = await boundHub();
    const q = await queuedThread(g, 'rc-inbound', {
      syncState: 'failed',
      attempts: 1,
      sentId: '1200000000000000002',
      origin: 'discord',
    });
    await sync.retrySweep();
    expect(sentTitles()).not.toContain('rc-inbound');
    expect(out.spies.editMessage).not.toHaveBeenCalled();
    expect(out.spies.renameThread).not.toHaveBeenCalled();
    expect(await linkById(q.link.id)).toMatchObject({ syncState: 'synced' });
  });
});

/** An RL reply held on its post's placeholder id (pending, long due). */
async function heldReply(
  g: number,
  threadId: number,
  body: string,
  opts: { replyDeleted?: boolean; linkDeleted?: boolean } = {},
) {
  const db = ctx.testApp.db;
  const gone = new Date(Date.now() - HOUR);
  const [r] = nonEmpty(
    await db
      .insert(schema.hubForumReplies)
      .values({
        guildId: g,
        threadId,
        body,
        authorId: adminId,
        deletedAt: opts.replyDeleted ? gone : null,
        deletedAs: opts.replyDeleted ? 'author' : null,
      })
      .returning(),
    'reply',
  );
  const [link] = nonEmpty(
    await db
      .insert(schema.hubForumDiscordLinks)
      .values({
        guildId: g,
        kind: 'reply',
        threadId,
        replyId: r.id,
        discordThreadId: unsentId('thread', threadId),
        discordMessageId: unsentId('reply', r.id),
        origin: 'raidledger',
        syncState: opts.linkDeleted ? 'synced' : 'pending',
        discordDeletedAt: opts.linkDeleted ? gone : null,
        createdAt: new Date(Date.now() - 10 * HOUR),
      })
      .returning(),
    'reply link',
  );
  return { reply: r, link };
}

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

  it('a placeholder reply is sent into its post once, when the post is re-sent', async () => {
    const { g } = await boundHub();
    const { thread, link } = await queuedThread(g, 'rc-parent', {
      syncState: 'failed',
      attempts: 1,
    });
    const { reply: r } = await heldReply(g, thread.id, 'queued reply');
    await sync.retrySweep();
    const parent = await linkById(link.id);
    const realPost = parent?.discordThreadId ?? 'missing parent link';
    expect(realPost.startsWith('rl:')).toBe(false);
    // ROK-2292 Codex P2: the post's re-send sends it; the sweep's stale copy
    // of the reply row must not send it a second time.
    expect(out.spies.createReply).toHaveBeenCalledTimes(1);
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

  it('a held reply deleted before its post lands is never published (Codex P2)', async () => {
    const { g } = await boundHub();
    const { thread } = await queuedThread(g, 'rc-gone-replies', {
      syncState: 'failed',
      attempts: 1,
    });
    const deleted = { replyDeleted: true };
    const pending = await heldReply(g, thread.id, 'deleted body', deleted);
    const closed = await heldReply(g, thread.id, 'closed body', {
      ...deleted,
      linkDeleted: true,
    });
    await sync.retrySweep();
    expect(sentTitles()).toContain('rc-gone-replies');
    expect(out.spies.createReply).not.toHaveBeenCalled();
    const after = await linkById(pending.link.id);
    expect(after?.discordDeletedAt).not.toBeNull(); // closed out, not sent
    expect(after?.syncState).toBe('synced');
    expect((await linkById(closed.link.id))?.discordMessageId).toBe(
      unsentId('reply', closed.reply.id),
    );
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

describe('review MAJOR-3: the retry queue never stalls', () => {
  it('a placeholder reply under a deleted post is closed out of the queue', async () => {
    const { g } = await boundHub();
    const { thread, link } = await queuedThread(g, 'rc-gone-parent', {
      syncState: 'synced',
      attempts: 0,
    });
    const l = schema.hubForumDiscordLinks;
    await ctx.testApp.db
      .update(l)
      .set({ discordDeletedAt: new Date() })
      .where(eq(l.id, link.id));
    const [r] = nonEmpty(
      await ctx.testApp.db
        .insert(schema.hubForumReplies)
        .values({
          guildId: g,
          threadId: thread.id,
          body: 'orphan',
          authorId: adminId,
        })
        .returning(),
      'reply',
    );
    await ctx.testApp.db.insert(l).values({
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
    expect(out.spies.createReply).not.toHaveBeenCalled();
    expect(await linkOf(unsentId('reply', r.id))).toMatchObject({
      syncState: 'failed',
      attempts: 5,
      lastError: expect.stringContaining('Nothing left to send'),
    });
  });

  it('a due row is retried even behind 100 not-yet-due rows', async () => {
    const { g } = await boundHub();
    const db = ctx.testApp.db;
    const waiting = await db
      .insert(schema.hubForumThreads)
      .values(
        Array.from({ length: 100 }, (_, i) => ({
          guildId: g,
          title: `rc-wait-${i}`,
          body: 'not due',
          authorId: adminId,
        })),
      )
      .returning();
    await db.insert(schema.hubForumDiscordLinks).values(
      waiting.map((t) => ({
        guildId: g,
        kind: 'thread',
        threadId: t.id,
        discordThreadId: unsentId('thread', t.id),
        discordMessageId: unsentId('thread', t.id),
        origin: 'raidledger',
        syncState: 'failed',
        attempts: 4, // backoff 75 min from created_at (now) → not due
      })),
    );
    await queuedThread(g, 'rc-due-last', { syncState: 'failed', attempts: 1 });
    await sync.retrySweep();
    expect(sentTitles()).toContain('rc-due-last');
    expect(sentTitles()).not.toContain('rc-wait-0');
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

/** A reply of `threadId` whose outbound link is in the given state. */
async function replyLink(
  g: number,
  threadId: number,
  link: {
    syncState: string;
    origin?: string;
    deleted?: boolean;
  },
) {
  const db = ctx.testApp.db;
  const [r] = nonEmpty(
    await db
      .insert(schema.hubForumReplies)
      .values({ guildId: g, threadId, body: 'held', authorId: adminId })
      .returning(),
    'reply',
  );
  const [row] = nonEmpty(
    await db
      .insert(schema.hubForumDiscordLinks)
      .values({
        guildId: g,
        kind: 'reply',
        threadId,
        replyId: r.id,
        discordThreadId: freshId(),
        discordMessageId: freshId(),
        origin: link.origin ?? 'raidledger',
        syncState: link.syncState,
        attempts: 5,
        lastError: 'archived',
        discordDeletedAt: link.deleted ? new Date() : null,
      })
      .returning(),
    'reply link',
  );
  return row;
}

describe('ROK-2314 MAJOR-2 requeueHeldReplies', () => {
  it("resets only the thread's failed, live website reply links", async () => {
    const { g } = await boundHub();
    const sent = { syncState: 'synced', attempts: 0, sentId: freshId() };
    const { thread } = await queuedThread(g, 'rq-mine', sent);
    const { thread: other } = await queuedThread(g, 'rq-other', {
      ...sent,
      sentId: freshId(),
    });
    const held = [
      await replyLink(g, thread.id, { syncState: 'failed' }),
      await replyLink(g, thread.id, { syncState: 'failed' }),
    ];
    const untouched = [
      await replyLink(g, thread.id, { syncState: 'synced' }),
      await replyLink(g, thread.id, { syncState: 'pending' }),
      await replyLink(g, thread.id, { syncState: 'failed', origin: 'discord' }),
      await replyLink(g, thread.id, { syncState: 'failed', deleted: true }),
      await replyLink(g, other.id, { syncState: 'failed' }),
    ];
    const reset = await requeueHeldReplies(ctx.testApp.db, thread.id);
    expect(reset.map((l) => l.id)).toEqual(held.map((l) => l.id));
    for (const l of held) {
      expect(await linkById(l.id)).toMatchObject({
        syncState: 'failed',
        attempts: 0,
        lastError: null,
      });
    }
    for (const l of untouched) {
      expect(await linkById(l.id)).toMatchObject({
        attempts: 5,
        lastError: 'archived',
      });
    }
  });
});

describe('ROK-2292 review M1: heldReplyTarget (a reply claimed while its post was in flight)', () => {
  /**
   * Each case leaves a due pending post + held reply in a bound hub, and the
   * outbound retry sweep is global — unbind these hubs afterwards so a later
   * sweep-asserting case (in CI's randomized order) never sends them.
   */
  const hubs: number[] = [];
  afterEach(async () => {
    if (hubs.length === 0) return;
    const b = schema.hubForumDiscordBindings;
    await ctx.testApp.db.delete(b).where(inArray(b.guildId, hubs.splice(0)));
  });

  /** A post claimed but unsent, with one reply held on its placeholder. */
  async function inFlight(title: string) {
    const { g } = await boundHub();
    hubs.push(g);
    const pending = { syncState: 'pending', attempts: 0 };
    const { thread, link: post } = await queuedThread(g, title, pending);
    const { link: reply } = await heldReply(g, thread.id, `${title} reply`);
    return { thread, post, reply };
  }
  const db = () => ctx.testApp.db;
  const sendPost = async (post: { id: number }) => {
    const id = freshId();
    await markSent(db(), post.id, { threadId: id, messageId: id }, new Date());
    return id;
  };

  it('the post was sent after the reply read it: the reply moves onto it itself', async () => {
    const { post, reply } = await inFlight('hrt-adopt');
    const real = await sendPost(post); // and its re-home ran before the claim
    expect(await heldReplyTarget(db(), reply, post)).toBe(real);
    expect((await linkById(reply.id))?.discordThreadId).toBe(real);
  });

  it("the post's own re-home took the reply first: held (null), never sent twice", async () => {
    const { thread, post, reply } = await inFlight('hrt-lose');
    const real = await sendPost(post);
    const moved = await rehomeReplies(db(), thread.id, real);
    expect(moved.map((l) => l.id)).toEqual([reply.id]);
    expect(await heldReplyTarget(db(), reply, post)).toBeNull();
    expect((await linkById(reply.id))?.discordThreadId).toBe(real);
  });

  it('the post is still in flight: held (null), the reply stays on the placeholder', async () => {
    const { thread, post, reply } = await inFlight('hrt-held');
    expect(await heldReplyTarget(db(), reply, post)).toBeNull();
    expect((await linkById(reply.id))?.discordThreadId).toBe(
      unsentId('thread', thread.id),
    );
  });

  it('a parent already sent when read: its post id, no re-read', async () => {
    const { post, reply } = await inFlight('hrt-sent');
    await sendPost(post);
    const sent = await linkById(post.id);
    if (!sent) throw new Error('post link vanished');
    expect(await heldReplyTarget(db(), reply, sent)).toBe(sent.discordThreadId);
  });
});
