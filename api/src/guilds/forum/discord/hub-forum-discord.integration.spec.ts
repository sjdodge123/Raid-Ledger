/**
 * ROK-2208 L2b — the hub forum's Discord binding API against a real database
 * (§5.1, §6, §12, AC1–AC3): the permission matrix (one `canManageDiscord`
 * gate to bind, Officers read the status), the ack, create vs existing,
 * sharing a forum (each hub its own tag, Require tags on at the 2nd hub), the
 * 20-tag budget, and unbind keeping the forum unless asked AND unshared.
 * Discord is the in-memory fake behind `HubForumDiscordGateway`.
 */
import type {
  HubForumDiscordChannelOptions,
  HubForumDiscordPreflight,
  HubForumDiscordStatus,
} from '@raid-ledger/contract';
import { eq } from 'drizzle-orm';
import { nonEmpty } from '../../../common/testing/narrow';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import * as schema from '../../../drizzle/schema';
import {
  bootPostsApp,
  newHub,
  type PostsCtx,
  type Who,
} from '../../posts/hub-posts.test-fixtures';
import {
  snowflake,
  stubForumGateway,
  type FakeDiscord,
} from './hub-forum-discord.test-fixtures';
import { forumChannelName } from './hub-forum-discord.helpers';

let ctx: PostsCtx;
let adminToken: string;
let adminId: number;
let fake: FakeDiscord;

/** A value the test needs; a missing one fails loudly with its label. */
function need<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`no ${label}`);
  return value;
}

beforeAll(async () => {
  ctx = await bootPostsApp('hfdbind');
  const [u] = nonEmpty(
    await ctx.testApp.db
      .insert(schema.users)
      .values({
        discordId: 'local:hfdbind-admin@forum.test',
        username: 'hfdbind-admin',
        role: 'admin',
      })
      .returning(),
    'admin',
  );
  adminId = u.id;
  adminToken = await signTestAccessToken(ctx.testApp, {
    sub: u.id,
    username: u.username,
    role: 'admin',
  });
});

beforeEach(() => {
  fake = stubForumGateway(ctx.testApp);
});

afterEach(() => {
  jest.restoreAllMocks();
});

type Actor = Who | 'admin';
type Method = 'get' | 'put' | 'delete';
const route = (g: number) => `/guilds/${g}/forum-discord`;

function as(who: Actor, method: Method, path: string, body?: object) {
  const token = who === 'admin' ? adminToken : ctx.tokens[who];
  const req = ctx.testApp.request[method](path).set(
    'Authorization',
    `Bearer ${token}`,
  );
  return body === undefined ? req : req.send(body);
}

const create = (g: number, who: Actor = 'admin') =>
  as(who, 'put', route(g), { mode: 'create', ack: true });
const join = (g: number, channelId: string, who: Actor = 'admin') =>
  as(who, 'put', route(g), { mode: 'existing', channelId, ack: true });

async function statusOf(g: number, who: Actor = 'admin') {
  const res = await as(who, 'get', route(g));
  expect(res.status).toBe(200);
  return res.body as HubForumDiscordStatus;
}

async function bindingRow(g: number) {
  const [row] = await ctx.testApp.db
    .select()
    .from(schema.hubForumDiscordBindings)
    .where(eq(schema.hubForumDiscordBindings.guildId, g));
  return row ?? null;
}

async function forumRow(channelId: string) {
  const [row] = await ctx.testApp.db
    .select()
    .from(schema.hubForumDiscordForums)
    .where(eq(schema.hubForumDiscordForums.channelId, channelId));
  return row ?? null;
}

async function hubNameOf(g: number): Promise<string> {
  const [row] = nonEmpty(
    await ctx.testApp.db
      .select({ name: schema.guilds.name })
      .from(schema.guilds)
      .where(eq(schema.guilds.id, g)),
    'hub',
  );
  return row.name;
}

/** Bind a fresh hub to a new bot-made forum; returns hub + channel ids. */
async function boundHub(): Promise<{ g: number; channelId: string }> {
  const g = await newHub(ctx);
  const res = await create(g);
  expect(res.status).toBe(200);
  const body = res.body as HubForumDiscordStatus;
  return { g, channelId: need(body.binding, 'binding').channelId };
}

/** An RL thread of hub `g` already synced to Discord thread `discordId`. */
async function syncedThread(g: number, discordId: string): Promise<void> {
  const [t] = nonEmpty(
    await ctx.testApp.db
      .insert(schema.hubForumThreads)
      .values({
        guildId: g,
        authorId: ctx.userIds.plain,
        title: 'Synced',
        body: 'hi',
      })
      .returning({ id: schema.hubForumThreads.id }),
    'thread',
  );
  await ctx.testApp.db.insert(schema.hubForumDiscordLinks).values({
    guildId: g,
    threadId: t.id,
    kind: 'thread',
    discordThreadId: discordId,
    discordMessageId: snowflake(),
    origin: 'raidledger',
    syncState: 'synced',
  });
}

/**
 * `outsider` becomes the WoW hub's GM (rank 0) on the live roster; returns
 * the member row id. Rank 0 alone is a ladder MEMBER, not an Officer:
 * `GM_RANK_IMPLIES_EDIT = false` (wow-hub-kind.adapter.ts) because rank 0 is
 * self-reported via unsigned exports, and every top-rank right is its own
 * operator ruling. A GM manages the hub through a staff `guild_editors`
 * grant (`grantGm`), which makes them an Officer on the ladder.
 */
async function makeGm(g: number): Promise<number> {
  const guid = `Player-1-hfdbind-gm-${g}`;
  const name = `Gm${g}`;
  await ctx.testApp.db.insert(schema.characters).values({
    userId: ctx.userIds.outsider,
    gameId: ctx.testApp.seed.game.id,
    name,
    addonGuid: guid,
    role: 'dps',
    isMain: false,
  });
  const [m] = nonEmpty(
    await ctx.testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId: g,
        guid,
        characterName: name,
        rankIndex: 0,
        rankName: 'Guild Master',
        source: 'addon_import',
        // The posts fixtures' roster snapshot: rows seen at it are the live roster.
        lastSeenAt: new Date('2026-10-12T20:00:00.000Z'),
      })
      .returning({ id: schema.guildMembers.id }),
    'gm member',
  );
  return m.id;
}

/** Staff confirm the GM's link with a member-kind editor grant. */
async function grantGm(g: number, memberId: number): Promise<void> {
  await ctx.testApp.db
    .insert(schema.guildEditors)
    .values({ guildId: g, kind: 'member', guildMemberId: memberId });
}

describe('ROK-2208 binding — permission matrix (§6)', () => {
  it('an Officer reads the status but cannot bind, list or unbind', async () => {
    const { g, channelId } = await boundHub();
    const officer = await statusOf(g, 'officerA');
    expect(officer.binding?.channelId).toBe(channelId);
    const other = await newHub(ctx);
    expect((await create(other, 'officerA')).status).toBe(403);
    expect(
      (await as('officerA', 'get', `${route(other)}/channels`)).status,
    ).toBe(403);
    expect(
      (await as('officerA', 'get', `${route(other)}/preflight`)).status,
    ).toBe(403);
    expect((await as('officerA', 'delete', route(g))).status).toBe(403);
    expect(fake.spies.createForum).toHaveBeenCalledTimes(1);
    expect(await bindingRow(g)).not.toBeNull();
  });

  it('a plain member and an outsider cannot read the status', async () => {
    const { g } = await boundHub();
    expect((await as('plain', 'get', route(g))).status).toBe(403);
    expect((await as('outsider', 'get', route(g))).status).toBe(403);
  });

  it("a WoW hub's GM reads the status once staff-confirmed, never binds (OQ-7)", async () => {
    const { g, channelId } = await boundHub();
    const memberId = await makeGm(g);
    // Rank 0 alone is a ladder member: no section, no status.
    expect((await as('outsider', 'get', route(g))).status).toBe(403);
    await grantGm(g, memberId);
    const gm = await statusOf(g, 'outsider');
    expect(gm.binding?.channelId).toBe(channelId);
    // Not a community hub, so `canManageDiscord` refuses every write.
    const other = await newHub(ctx);
    const otherGm = await makeGm(other);
    await grantGm(other, otherGm);
    expect((await create(other, 'outsider')).status).toBe(403);
    expect((await as('outsider', 'delete', route(g))).status).toBe(403);
    expect(fake.spies.createForum).toHaveBeenCalledTimes(1);
    expect(await bindingRow(g)).not.toBeNull();
    expect(await bindingRow(other)).toBeNull();
  });
});

describe('ROK-2208 binding — PUT (AC1, AC2)', () => {
  it('AC1: no ack (missing or false) is 400 and creates no channel', async () => {
    const g = await newHub(ctx);
    for (const body of [{ mode: 'create' }, { mode: 'create', ack: false }]) {
      const res = await as('admin', 'put', route(g), body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'FORUM_DISCORD_ACK_REQUIRED' });
    }
    expect(fake.spies.createForum).not.toHaveBeenCalled();
    expect(await bindingRow(g)).toBeNull();
  });

  it("AC2: create makes a managed forum, one webhook and an acked binding with the hub's tag", async () => {
    const before = Date.now();
    const { g, channelId } = await boundHub();
    // ROK-2258 ruling: a lone hub gets its own tag at bind.
    const tagName = (await hubNameOf(g)).trim().slice(0, 20).trim();
    const tags = need(fake.forums.get(channelId), 'forum').tags;
    const tagId = need(tags.find((t) => t.name === tagName)?.id, 'hub tag');
    const s = await statusOf(g);
    expect(s.binding).toMatchObject({
      channelId,
      channelName: forumChannelName(await hubNameOf(g)),
      managed: true,
      shared: false,
      sharedWith: 0,
      tagName,
      health: 'ok',
      missingPermissions: [],
    });
    const forum = need(await forumRow(channelId), 'forum');
    expect(forum).toMatchObject({ managed: true, requireTagSet: false });
    expect(forum.webhookId).toBe(`9${channelId.slice(1)}`);
    expect(fake.spies.ensureWebhook).toHaveBeenCalledWith(channelId, null);
    const row = need(await bindingRow(g), 'binding');
    expect(row).toMatchObject({
      forumId: forum.id,
      tagId,
      ackBy: adminId,
    });
    expect(row.boundAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(fake.spies.requireTags).not.toHaveBeenCalled();
  });

  it('existing binds an unmanaged forum and reuses a live webhook', async () => {
    const g = await newHub(ctx);
    const f = fake.put({ name: 'guild-chat' });
    const res = await join(g, f.id);
    expect(res.status).toBe(200);
    expect((res.body as HubForumDiscordStatus).binding).toMatchObject({
      channelId: f.id,
      channelName: 'guild-chat',
      managed: false,
    });
    expect(fake.spies.createForum).not.toHaveBeenCalled();
    expect((await forumRow(f.id))?.managed).toBe(false);
  });

  it('a second PUT on a bound hub is 409 ALREADY_BOUND', async () => {
    const { g } = await boundHub();
    const res = await join(g, fake.put().id);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'FORUM_DISCORD_ALREADY_BOUND' });
  });
});

describe('ROK-2208 binding — PUT refusals (§12)', () => {
  it("a hub's media channel is 409 CHANNEL_IN_USE", async () => {
    const g = await newHub(ctx);
    const f = fake.put();
    await ctx.testApp.db
      .insert(schema.guildProfiles)
      .values({ guildId: await newHub(ctx), mediaChannelId: f.id });
    const res = await join(g, f.id);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'FORUM_DISCORD_CHANNEL_IN_USE' });
    expect(await bindingRow(g)).toBeNull();
  });

  it('a channel that is not a forum is 422 NOT_A_FORUM', async () => {
    const res = await join(await newHub(ctx), snowflake());
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'FORUM_DISCORD_NOT_A_FORUM' });
  });

  it('missing permissions are 422 with the list, for existing and create', async () => {
    const f = fake.put({ missing: ['Manage Webhooks'] });
    const existing = await join(await newHub(ctx), f.id);
    expect(existing.status).toBe(422);
    expect(existing.body).toMatchObject({
      code: 'FORUM_DISCORD_MISSING_PERMS',
      missing: ['Manage Webhooks'],
    });
    fake.state.missingToCreate = ['Manage Channels'];
    const created = await create(await newHub(ctx));
    expect(created.status).toBe(422);
    expect(created.body).toMatchObject({ missing: ['Manage Channels'] });
    expect(fake.spies.createForum).not.toHaveBeenCalled();
  });

  it('the bot offline is 503 on PUT and bot-offline health on GET', async () => {
    const { g } = await boundHub();
    fake.state.online = false;
    const res = await create(await newHub(ctx));
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'DISCORD_BOT_OFFLINE' });
    expect((await statusOf(g)).binding?.health).toBe('bot-offline');
  });
});

describe('ROK-2208 binding — sharing a forum (AC3, D6)', () => {
  it('the 2nd hub gets its own tag, the 1st hub its tag on its posts, Require tags on', async () => {
    const { g: a, channelId } = await boundHub();
    const postId = snowflake();
    await syncedThread(a, postId);
    const b = await newHub(ctx);
    const res = await join(b, channelId);
    expect(res.status).toBe(200);
    const tags = need(fake.forums.get(channelId), 'forum').tags;
    const tagOf = (name: string) => tags.find((t) => t.name === name)?.id;
    const [nameA, nameB] = [await hubNameOf(a), await hubNameOf(b)];
    const rowA = need(await bindingRow(a), 'binding A');
    const rowB = need(await bindingRow(b), 'binding B');
    expect(rowA.tagId).toBe(tagOf(nameA));
    expect(rowB.tagId).toBe(tagOf(nameB));
    expect(rowA.tagId).not.toBeNull();
    expect(rowA.tagId).not.toBe(rowB.tagId);
    expect(fake.spies.applyTag).toHaveBeenCalledWith(
      channelId,
      [postId],
      rowA.tagId,
    );
    expect(fake.spies.requireTags).toHaveBeenCalledWith(channelId);
    expect((await forumRow(channelId))?.requireTagSet).toBe(true);
    expect((res.body as HubForumDiscordStatus).binding).toMatchObject({
      shared: true,
      sharedWith: 1,
      tagName: nameB,
    });
    expect((await statusOf(a)).binding?.tagName).toBe(nameA);
  });
});

describe('ROK-2208 binding — the picker and the tag budget', () => {
  it("the picker lists a shared forum with its free tag slots (the lone hub's tag and Event spent)", async () => {
    const { channelId } = await boundHub();
    const res = await as(
      'admin',
      'get',
      `${route(await newHub(ctx))}/channels`,
    );
    expect(res.status).toBe(200);
    const opts = (res.body as HubForumDiscordChannelOptions).channels;
    expect(opts.find((c) => c.id === channelId)).toMatchObject({
      sharedWith: 1,
      tagsFree: 18, // ROK-2258: 20 − (hub tag + Event tag), nothing left to reserve
    });
  });

  it("a forum with 19 tags: the lone hub's tag fills it, 0 free slots, a 2nd hub refused before any Discord write", async () => {
    const own = Array.from({ length: 19 }, (_, i) => ({
      id: snowflake(),
      name: `mod ${String(i)}`,
    }));
    const f = fake.put({ tags: own });
    const a = await newHub(ctx);
    expect((await join(a, f.id)).status).toBe(200);
    // ROK-2258: the lone hub's tag takes slot 20; Event (best-effort) is skipped.
    const tags = need(fake.forums.get(f.id), 'forum').tags;
    expect(tags).toHaveLength(20);
    expect(need(await bindingRow(a), 'binding A').tagId).toBe(tags[19]?.id);
    fake.spies.addTags.mockClear();
    fake.spies.requireTags.mockClear();
    const b = await newHub(ctx);
    const list = await as('admin', 'get', `${route(b)}/channels`);
    const opt = (list.body as HubForumDiscordChannelOptions).channels.find(
      (c) => c.id === f.id,
    );
    expect(opt?.tagsFree).toBe(0);
    const res = await join(b, f.id);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'FORUM_DISCORD_TAG_LIMIT' });
    expect(await bindingRow(b)).toBeNull();
    expect(fake.spies.addTags).not.toHaveBeenCalled();
    expect(fake.spies.requireTags).not.toHaveBeenCalled();
  });
});

describe('ROK-2208 binding — DELETE (D9, OQ-8)', () => {
  it('without deleteForum the forum stays on Discord and in the table', async () => {
    const { g, channelId } = await boundHub();
    expect((await as('admin', 'delete', route(g))).status).toBe(204);
    expect(await bindingRow(g)).toBeNull();
    expect(fake.spies.deleteForum).not.toHaveBeenCalled();
    expect(await forumRow(channelId)).not.toBeNull();
    expect((await statusOf(g)).binding).toBeNull();
  });

  it('deleteForum removes a bot-made forum nobody else shares', async () => {
    const { g, channelId } = await boundHub();
    const res = await as('admin', 'delete', `${route(g)}?deleteForum=true`);
    expect(res.status).toBe(204);
    expect(fake.spies.deleteForum).toHaveBeenCalledWith(channelId);
    expect(await forumRow(channelId)).toBeNull();
  });
});

describe('ROK-2208 binding — DELETE of a shared or unmanaged forum', () => {
  it('deleteForum keeps a shared forum, and the leaving hub keeps its tag on Discord', async () => {
    const { g: a, channelId } = await boundHub();
    const b = await newHub(ctx);
    expect((await join(b, channelId)).status).toBe(200);
    const tagB = need(await bindingRow(b), 'binding B').tagId;
    expect(tagB).not.toBeNull();
    const res = await as('admin', 'delete', `${route(b)}?deleteForum=true`);
    expect(res.status).toBe(204);
    expect(fake.spies.deleteForum).not.toHaveBeenCalled();
    expect(await forumRow(channelId)).not.toBeNull();
    const tags = fake.forums.get(channelId)?.tags.map((t) => t.id) ?? [];
    expect(tags).toContain(tagB);
    expect((await statusOf(a)).binding).toMatchObject({
      shared: false,
      tagName: await hubNameOf(a),
    });
  });

  it('deleteForum never deletes a forum the bot did not make', async () => {
    const g = await newHub(ctx);
    const f = fake.put();
    expect((await join(g, f.id)).status).toBe(200);
    await as('admin', 'delete', `${route(g)}?deleteForum=true`);
    expect(fake.spies.deleteForum).not.toHaveBeenCalled();
    expect(fake.forums.has(f.id)).toBe(true);
  });
});

const shareIn = (g: number, who: Actor = 'admin') =>
  as(who, 'put', route(g), { mode: 'create', target: 'shared', ack: true });

async function preflightOf(g: number): Promise<HubForumDiscordPreflight> {
  const res = await as('admin', 'get', `${route(g)}/preflight`);
  expect(res.status).toBe(200);
  return res.body as HubForumDiscordPreflight;
}

const modTags = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: snowflake(),
    name: `m${String(i)}`,
  }));

describe("ROK-2208 Q10(c) create — the hub's own forum", () => {
  it('create without a target makes a forum named after the hub, never #hub-forums', async () => {
    const { g, channelId } = await boundHub();
    const name = forumChannelName(await hubNameOf(g));
    expect(name).not.toBe('hub-forums');
    expect(fake.spies.createForum).toHaveBeenCalledWith(name);
    expect((await forumRow(channelId))?.managed).toBe(true);
  });

  it('create takes a name from the request and refuses the shared name', async () => {
    const g = await newHub(ctx);
    const body = { mode: 'create', name: 'Hub Forums', ack: true };
    const reserved = await as('admin', 'put', route(g), body);
    expect(reserved.status).toBe(400);
    expect(reserved.body).toMatchObject({
      code: 'FORUM_DISCORD_NAME_RESERVED',
    });
    expect(fake.spies.createForum).not.toHaveBeenCalled();
    const ok = await as('admin', 'put', route(g), { ...body, name: 'Our Den' });
    expect(ok.status).toBe(200);
    expect(fake.spies.createForum).toHaveBeenCalledWith('our-den');
  });
});

describe('ROK-2208 Q10(c) create shared — one #hub-forums, reused', () => {
  it('the 1st hub creates #hub-forums, the 2nd joins it with a tag', async () => {
    const a = await newHub(ctx);
    expect((await shareIn(a)).status).toBe(200);
    expect(fake.spies.createForum).toHaveBeenCalledWith('hub-forums');
    const b = await newHub(ctx);
    const res = await shareIn(b);
    expect(res.status).toBe(200);
    expect(fake.spies.createForum).toHaveBeenCalledTimes(1);
    const first = need((await statusOf(a)).binding, 'a binding');
    expect((res.body as HubForumDiscordStatus).binding).toMatchObject({
      channelId: first.channelId,
      shared: true,
      sharedWith: 1,
    });
    expect(need(await bindingRow(b), 'b row').tagId).not.toBeNull();
  });

  it('Codex P2: two hubs sharing at once make ONE #hub-forums and both join it', async () => {
    const a = await newHub(ctx);
    const b = await newHub(ctx);
    const [ra, rb] = await Promise.all([shareIn(a), shareIn(b)]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    expect(fake.spies.createForum).toHaveBeenCalledTimes(1);
    const first = need((await statusOf(a)).binding, 'a binding');
    const second = need((await statusOf(b)).binding, 'b binding');
    expect(second.channelId).toBe(first.channelId);
  });

  it('an existing #hub-forums on Discord is reused, never a second one', async () => {
    const f = fake.put({ name: 'hub-forums' });
    const g = await newHub(ctx);
    const res = await shareIn(g);
    expect(res.status).toBe(200);
    expect((res.body as HubForumDiscordStatus).binding?.channelId).toBe(f.id);
    expect(fake.spies.createForum).not.toHaveBeenCalled();
  });

  it('a full #hub-forums is 409 TAG_LIMIT for the 2nd hub, and no new forum', async () => {
    fake.put({ name: 'hub-forums', tags: modTags(19) });
    expect((await shareIn(await newHub(ctx))).status).toBe(200);
    const b = await newHub(ctx);
    expect((await preflightOf(b)).shared?.tagsFree).toBe(0);
    const res = await shareIn(b);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'FORUM_DISCORD_TAG_LIMIT' });
    expect(fake.spies.createForum).not.toHaveBeenCalled();
    expect(await bindingRow(b)).toBeNull();
  });
});

describe('ROK-2208 preflight — before Turn on sync (review web MAJOR 2)', () => {
  it('offline is 200 botOnline:false, never a 503', async () => {
    fake.state.online = false;
    const g = await newHub(ctx);
    expect(await preflightOf(g)).toEqual({
      botOnline: false,
      missingToCreate: [],
      suggestedName: forumChannelName(await hubNameOf(g)),
      shared: null,
    });
  });

  it('no #hub-forums yet: the shared option needs the create permissions', async () => {
    fake.state.missingToCreate = ['Manage Channels'];
    const p = await preflightOf(await newHub(ctx));
    expect(p).toMatchObject({
      botOnline: true,
      missingToCreate: ['Manage Channels'],
    });
    expect(p.shared).toEqual({
      channelId: null,
      name: 'hub-forums',
      sharedWith: 0,
      tagsUsed: 0,
      tagsFree: 20,
      tagName: null,
      missingPermissions: ['Manage Channels'],
    });
  });

  it('a #hub-forums with one hub reports its tags, the tag to come and missing perms', async () => {
    const f = fake.put({ name: 'hub-forums', tags: modTags(3) });
    expect((await shareIn(await newHub(ctx))).status).toBe(200);
    const g = await newHub(ctx);
    const forum = need(fake.forums.get(f.id), 'forum');
    forum.missing = ['Manage Webhooks'];
    expect((await preflightOf(g)).shared).toEqual({
      channelId: f.id,
      name: 'hub-forums',
      sharedWith: 1,
      tagsUsed: 5, // ROK-2258: 3 moderator tags + the 1st hub's tag + Event
      tagsFree: 15,
      tagName: (await hubNameOf(g)).trim().slice(0, 20).trim(),
      missingPermissions: ['Manage Webhooks'],
    });
  });

  it('each picker option carries the permissions the bot lacks there', async () => {
    const f = fake.put({ name: 'raid-talk', missing: ['Manage Threads'] });
    const res = await as(
      'admin',
      'get',
      `${route(await newHub(ctx))}/channels`,
    );
    const opt = (res.body as HubForumDiscordChannelOptions).channels.find(
      (c) => c.id === f.id,
    );
    expect(opt?.missingPermissions).toEqual(['Manage Threads']);
  });
});

describe('ROK-2208 private forums (review api MAJOR-4)', () => {
  it('binding a forum @everyone cannot view is 409 CHANNEL_PRIVATE', async () => {
    const f = fake.put({ name: 'staff-forum', isPublic: false });
    const g = await newHub(ctx);
    const res = await join(g, f.id);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'FORUM_DISCORD_CHANNEL_PRIVATE',
      message:
        'This forum is private in Discord. Raid Ledger only syncs forums everyone in the server can see.',
    });
    expect(await bindingRow(g)).toBeNull();
    expect(await forumRow(f.id)).toBeNull();
  });

  it('the picker never lists a private forum', async () => {
    const hidden = fake.put({ name: 'staff-forum', isPublic: false });
    const shown = fake.put({ name: 'open-forum' });
    const res = await as(
      'admin',
      'get',
      `${route(await newHub(ctx))}/channels`,
    );
    const ids = (res.body as HubForumDiscordChannelOptions).channels.map(
      (c) => c.id,
    );
    expect(ids).toContain(shown.id);
    expect(ids).not.toContain(hidden.id);
  });
});
