/**
 * ROK-2208 L1 — the Discord forum sync tables against a real database: a
 * binding is unique on the HUB, not on the channel (several hubs share one
 * forum, each with its own tag — Q10); the link table's kind/origin/state
 * checks and one-link-per-row uniques; hub delete cascades; and claim-on-link
 * (AC9) — a Discord login fills `author_id` on that account's guest rows only,
 * and the API then stops sending the guest `discordAuthor` (AC8 shape).
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import type { HubForumThread } from '@raid-ledger/contract';
import { AUTH_EVENTS, type DiscordLoginPayload } from '../../auth/auth.service';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import {
  bootPostsApp,
  call,
  newHub,
  type PostsCtx,
} from '../posts/hub-posts.test-fixtures';

let ctx: PostsCtx;
let snow = 900_000;

beforeAll(async () => {
  ctx = await bootPostsApp('hfdiscord');
});

/** A fresh 18-digit snowflake per call; tests never share channel ids. */
const snowflake = (): string => `47886${String((snow += 1)).padStart(13, '0')}`;

async function newForum(): Promise<number> {
  const [row] = nonEmpty(
    await ctx.testApp.db
      .insert(schema.hubForumDiscordForums)
      .values({ discordGuildId: snowflake(), channelId: snowflake() })
      .returning({ id: schema.hubForumDiscordForums.id }),
    'forum',
  );
  return row.id;
}

function bind(guildId: number, forumId: number, tagId: string | null) {
  const now = new Date();
  return ctx.testApp.db
    .insert(schema.hubForumDiscordBindings)
    .values({ guildId, forumId, tagId, ackAt: now, boundAt: now });
}

const GUEST = { authorDiscordName: 'Grumbo', authorDiscordAvatar: 'a1b2c3' };

async function guestThread(guildId: number, discordId: string) {
  const [row] = nonEmpty(
    await ctx.testApp.db
      .insert(schema.hubForumThreads)
      .values({
        guildId,
        title: 'From Discord',
        body: 'hello',
        authorDiscordId: discordId,
        ...GUEST,
      })
      .returning({ id: schema.hubForumThreads.id }),
    'thread',
  );
  return row.id;
}

async function guestReply(threadId: number, guildId: number, d: string) {
  const [row] = nonEmpty(
    await ctx.testApp.db
      .insert(schema.hubForumReplies)
      .values({ threadId, guildId, body: 'hi', authorDiscordId: d, ...GUEST })
      .returning({ id: schema.hubForumReplies.id }),
    'reply',
  );
  return row.id;
}

function link(
  guildId: number,
  threadId: number,
  over: Partial<typeof schema.hubForumDiscordLinks.$inferInsert> = {},
) {
  return ctx.testApp.db.insert(schema.hubForumDiscordLinks).values({
    guildId,
    threadId,
    kind: 'thread',
    discordThreadId: snowflake(),
    discordMessageId: snowflake(),
    origin: 'raidledger',
    syncState: 'pending',
    ...over,
  });
}

describe('bindings are unique on the hub, not the channel (Q10)', () => {
  it('lets two hubs share one forum with different tags', async () => {
    const forumId = await newForum();
    const [a, b] = [await newHub(ctx), await newHub(ctx)];
    await bind(a, forumId, snowflake());
    await bind(b, forumId, snowflake());
    const rows = await ctx.testApp.db
      .select()
      .from(schema.hubForumDiscordBindings)
      .where(eq(schema.hubForumDiscordBindings.forumId, forumId));
    expect(rows.map((r) => r.guildId).sort()).toEqual([a, b].sort());
  });

  it('allows several untagged bindings on one forum (no forum-only unique)', async () => {
    const forumId = await newForum();
    await bind(await newHub(ctx), forumId, null);
    await expect(bind(await newHub(ctx), forumId, null)).resolves.toBeDefined();
  });

  it('refuses a second binding for the same hub', async () => {
    const hub = await newHub(ctx);
    await bind(hub, await newForum(), null);
    await expect(bind(hub, await newForum(), null)).rejects.toMatchObject({
      cause: { constraint_name: 'hub_forum_discord_bindings_pkey' },
    });
  });

  it('refuses two hubs on the same tag of one forum', async () => {
    const [forumId, tag] = [await newForum(), snowflake()];
    await bind(await newHub(ctx), forumId, tag);
    await expect(bind(await newHub(ctx), forumId, tag)).rejects.toMatchObject({
      cause: { constraint_name: 'uq_hub_forum_discord_bindings_forum_tag' },
    });
  });

  it('keeps one forum row per Discord channel', async () => {
    const channelId = snowflake();
    const values = { discordGuildId: snowflake(), channelId };
    const forums = schema.hubForumDiscordForums;
    await ctx.testApp.db.insert(forums).values(values);
    await expect(
      ctx.testApp.db.insert(forums).values(values),
    ).rejects.toMatchObject({
      cause: { constraint_name: 'hub_forum_discord_forums_channel_id_unique' },
    });
  });
});

describe('message links', () => {
  it('refuses a reply link without a reply id', async () => {
    const hub = await newHub(ctx);
    const threadId = await guestThread(hub, snowflake());
    await expect(link(hub, threadId, { kind: 'reply' })).rejects.toMatchObject({
      cause: { constraint_name: 'hub_forum_discord_links_kind_reply' },
    });
  });

  it('refuses an unknown origin and sync state', async () => {
    const hub = await newHub(ctx);
    const threadId = await guestThread(hub, snowflake());
    await expect(link(hub, threadId, { origin: 'slack' })).rejects.toMatchObject(
      { cause: { constraint_name: 'hub_forum_discord_links_origin' } },
    );
    await expect(
      link(hub, threadId, { syncState: 'lost' }),
    ).rejects.toMatchObject({
      cause: { constraint_name: 'hub_forum_discord_links_sync_state' },
    });
  });

  it('holds one link per thread and per Discord message', async () => {
    const hub = await newHub(ctx);
    const threadId = await guestThread(hub, snowflake());
    const messageId = snowflake();
    await link(hub, threadId, { discordMessageId: messageId });
    await expect(link(hub, threadId)).rejects.toMatchObject({
      cause: { constraint_name: 'uq_hub_forum_discord_links_thread' },
    });
    const other = await guestThread(hub, snowflake());
    await expect(
      link(hub, other, { discordMessageId: messageId }),
    ).rejects.toMatchObject({
      cause: {
        constraint_name: 'hub_forum_discord_links_discord_message_id_unique',
      },
    });
  });

  it('cascades a hub delete to its binding and links', async () => {
    const hub = await newHub(ctx);
    await bind(hub, await newForum(), null);
    const threadId = await guestThread(hub, snowflake());
    const replyId = await guestReply(threadId, hub, snowflake());
    await link(hub, threadId);
    await link(hub, threadId, { kind: 'reply', replyId });
    await ctx.testApp.db.delete(schema.guilds).where(eq(schema.guilds.id, hub));
    const db = ctx.testApp.db;
    const [binds, links] = await Promise.all([
      db
        .select()
        .from(schema.hubForumDiscordBindings)
        .where(eq(schema.hubForumDiscordBindings.guildId, hub)),
      db
        .select()
        .from(schema.hubForumDiscordLinks)
        .where(eq(schema.hubForumDiscordLinks.guildId, hub)),
    ]);
    expect({ binds: binds.length, links: links.length }).toEqual({
      binds: 0,
      links: 0,
    });
  });
});

describe('claim-on-link (AC9)', () => {
  async function getThread(hub: number, id: number): Promise<HubForumThread> {
    const res = await call(ctx, 'get', `/guilds/${hub}/forum/${id}`, 'plain');
    expect(res.status).toBe(200);
    return res.body as HubForumThread;
  }

  async function login(discordId: string): Promise<void> {
    const payload: DiscordLoginPayload = {
      userId: ctx.userIds.plain,
      discordId,
    };
    await ctx.testApp.app
      .get(EventEmitter2)
      .emitAsync(AUTH_EVENTS.DISCORD_LOGIN, payload);
  }

  it('shows a guest row as "via Discord" until the account links', async () => {
    const [hub, discordId] = [await newHub(ctx), snowflake()];
    const threadId = await guestThread(hub, discordId);
    await guestReply(threadId, hub, discordId);
    const before = await getThread(hub, threadId);
    expect(before.author).toBeNull();
    expect(before.source).toBe('discord');
    expect(before.discordAuthor).toEqual({
      name: 'Grumbo',
      avatarUrl: `https://cdn.discordapp.com/avatars/${discordId}/a1b2c3.png?size=64`,
    });
    expect(before.replies[0]?.discordAuthor?.name).toBe('Grumbo');

    await login(discordId);

    const after = await getThread(hub, threadId);
    expect(after.author?.id).toBe(ctx.userIds.plain);
    expect(after.replies[0]?.author?.id).toBe(ctx.userIds.plain);
    expect(after.source).toBe('discord');
    expect(after.discordAuthor).toBeNull();
  });

  it('never claims a row that already has an author or another Discord id', async () => {
    const [hub, discordId] = [await newHub(ctx), snowflake()];
    const owned = await guestThread(hub, discordId);
    const officerA = ctx.userIds.officerA;
    await ctx.testApp.db
      .update(schema.hubForumThreads)
      .set({ authorId: officerA })
      .where(eq(schema.hubForumThreads.id, owned));
    const stranger = await guestThread(hub, snowflake());

    await login(discordId);

    const rows = await ctx.testApp.db
      .select({
        id: schema.hubForumThreads.id,
        authorId: schema.hubForumThreads.authorId,
      })
      .from(schema.hubForumThreads)
      .where(eq(schema.hubForumThreads.guildId, hub));
    const byId = new Map(rows.map((r) => [r.id, r.authorId]));
    expect(byId.get(owned)).toBe(officerA);
    expect(byId.get(stranger)).toBeNull();
  });

  it('leaves RL-origin rows without the sync fields', async () => {
    const hub = await newHub(ctx);
    const res = await call(ctx, 'post', `/guilds/${hub}/forum`, 'plain', {
      title: 'Native',
      body: 'from RL',
    });
    expect(res.status).toBe(201);
    const thread = res.body as HubForumThread;
    expect('source' in thread).toBe(false);
    expect('discordAuthor' in thread).toBe(false);
  });
});
