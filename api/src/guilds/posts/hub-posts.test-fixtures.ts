/**
 * ROK-1868 — shared seeding + Discord stubs for the hub-post integration
 * specs (`hub-posts.integration.spec.ts`, `hub-posts.relay.integration.spec.ts`).
 * Excluded from `nest build` by the `*.test-fixtures.ts` pattern.
 *
 * Users are created once per file; every test gets a FRESH hub (`newHub`) with
 * officer A + officer B (editor grants) and a plain member on its live roster,
 * so randomized order never shares posts between tests. Discord is stubbed on
 * the singleton `DiscordBotClientService` instance the relay holds (never a
 * `jest.mock` — it would not reach the app).
 */
import { ChannelType, PermissionFlagsBits, type Guild } from 'discord.js';
import { asc, eq } from 'drizzle-orm';
import type { Message } from 'discord.js';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { nonEmpty } from '../../common/testing/narrow';
import { signTestAccessToken } from '../../common/testing/sign-test-access-token';
import { DiscordBotClientService } from '../../discord-bot/discord-bot-client.service';
import * as schema from '../../drizzle/schema';
import { DiscordNotificationService } from '../../notifications/discord-notification.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import { SettingsService } from '../../settings/settings.service';

export type Who = 'officerA' | 'officerB' | 'plain' | 'outsider';
export const CLIENT_URL = 'https://rl.posts.test';
export const CHANNEL_ID = '478860000000000001';
export const DISCORD_GUILD_ID = '478860000000000900';
const SNAP = new Date('2026-10-12T20:00:00.000Z');
const SEND_FLAGS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
];

export interface PostsCtx {
  testApp: TestApp;
  tokens: Record<Who, string>;
  userIds: Record<Who, number>;
}

let seq = 0;

async function mkUser(testApp: TestApp, who: Who, tag: string) {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${tag}-${who}@hub-posts.test`,
        username: `${tag}-${who}`,
        displayName: `${tag} ${who}`,
        role: 'member',
      })
      .returning(),
    'user',
  );
  const token = await signTestAccessToken(testApp, {
    sub: u.id,
    username: u.username,
    role: 'member',
  });
  return { id: u.id, token };
}

/** Boot the singleton app (blizzard active) and create the four actors. */
export async function bootPostsApp(tag: string): Promise<PostsCtx> {
  const testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  const tokens = {} as Record<Who, string>;
  const userIds = {} as Record<Who, number>;
  for (const who of ['officerA', 'officerB', 'plain', 'outsider'] as const) {
    const u = await mkUser(testApp, who, tag);
    tokens[who] = u.token;
    userIds[who] = u.id;
  }
  return { testApp, tokens, userIds };
}

/** A character on the hub's live roster ⇒ a member; returns the member id. */
async function link(ctx: PostsCtx, guildId: number, userId: number) {
  const guid = `Player-1-hubposts-${guildId}-${userId}`;
  const name = `Hp${guildId}x${userId}`;
  await ctx.testApp.db.insert(schema.characters).values({
    userId,
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
        guildId,
        guid,
        characterName: name,
        rankIndex: 3,
        rankName: 'Rank 3',
        source: 'addon_import',
        lastSeenAt: SNAP,
      })
      .returning(),
    'member',
  );
  return m.id;
}

/** A fresh WoW hub: officers A + B (editor grants) and a plain member. */
export async function newHub(ctx: PostsCtx): Promise<number> {
  seq += 1;
  const name = `Hub Posts ${seq}`;
  const [g] = nonEmpty(
    await ctx.testApp.db
      .insert(schema.guilds)
      .values({
        gameId: ctx.testApp.seed.game.id,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        lastSnapshotAt: SNAP,
      })
      .returning(),
    'guild',
  );
  for (const who of ['officerA', 'officerB', 'plain'] as const) {
    const memberId = await link(ctx, g.id, ctx.userIds[who]);
    if (who === 'plain') continue;
    await ctx.testApp.db
      .insert(schema.guildEditors)
      .values({ guildId: g.id, kind: 'member', guildMemberId: memberId });
  }
  return g.id;
}

type Method = 'get' | 'post' | 'patch' | 'delete';

/** An authenticated request as `who`. */
export function call(
  ctx: PostsCtx,
  method: Method,
  path: string,
  who: Who,
  body?: object,
) {
  const req = ctx.testApp.request[method](path).set(
    'Authorization',
    `Bearer ${ctx.tokens[who]}`,
  );
  return body ? req.send(body) : req;
}

/** POST a post as `who` (relay off unless asked). */
export const createPost = (
  ctx: PostsCtx,
  guildId: number,
  body: string,
  who: Who = 'officerA',
  relayToDiscord = false,
) =>
  call(ctx, 'post', `/guilds/${guildId}/posts`, who, { body, relayToDiscord });

/** Insert a post row directly (explicit `created_at`, no notification). */
export async function insertPostRow(
  ctx: PostsCtx,
  guildId: number,
  body: string,
  createdAt: Date,
): Promise<number> {
  const [row] = nonEmpty(
    await ctx.testApp.db
      .insert(schema.hubPosts)
      .values({
        guildId,
        body,
        authorId: ctx.userIds.officerA,
        createdAt,
        updatedAt: createdAt,
      })
      .returning(),
    'post',
  );
  return row.id;
}

/** Every post row of a hub, oldest id first. */
export const postRows = (ctx: PostsCtx, guildId: number) =>
  ctx.testApp.db
    .select()
    .from(schema.hubPosts)
    .where(eq(schema.hubPosts.guildId, guildId))
    .orderBy(asc(schema.hubPosts.id));

/** `hub_leader_post` notification rows for one user. */
export async function leaderRows(ctx: PostsCtx, userId: number) {
  const rows = await ctx.testApp.db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId));
  return rows.filter((r) => r.type === 'hub_leader_post');
}

/** The hub's profile row (relay default, bound channel). */
export async function profileRow(ctx: PostsCtx, guildId: number) {
  const [row] = await ctx.testApp.db
    .select()
    .from(schema.guildProfiles)
    .where(eq(schema.guildProfiles.guildId, guildId));
  return row;
}

/** Bind the hub to `CHANNEL_ID` (ROK-1788 column the relay reads). */
export async function bindChannel(ctx: PostsCtx, guildId: number) {
  await ctx.testApp.db
    .insert(schema.guildProfiles)
    .values({ guildId, discordChannelId: CHANNEL_ID });
}

interface RedisLike {
  keys(pattern: string): Promise<string[]>;
  del(...keys: string[]): Promise<number>;
}

/** Clear the leader-post cooldown keys (the 1-hour `hub-post:<id>` dedup). */
export async function clearPostCooldowns(ctx: PostsCtx): Promise<void> {
  const redis = ctx.testApp.app.get<RedisLike>(REDIS_CLIENT);
  const keys = await redis.keys('hub-post:*');
  if (keys.length > 0) await redis.del(...keys);
}

/** Awaits every promise a spied fire-and-forget method returned. */
export async function settle(spy: {
  mock: { results: ReadonlyArray<{ value: unknown }> };
}): Promise<void> {
  await Promise.allSettled(spy.mock.results.map((r) => r.value));
}

function fakeGuild(perms: bigint[]): Guild {
  const has = (flags: bigint[]) => flags.every((f) => perms.includes(f));
  const channel = {
    id: CHANNEL_ID,
    name: 'announcements',
    type: ChannelType.GuildText,
    permissionsFor: () => ({ has }),
  };
  return {
    id: DISCORD_GUILD_ID,
    channels: { cache: new Map([[CHANNEL_ID, channel]]) },
    members: { me: { id: 'bot' } },
  } as unknown as Guild;
}

/**
 * A connected bot whose bound channel grants `perms` (default: all three D8
 * flags), a trusted client URL, DM dispatch muted, and spies on every Discord
 * write the relay could make. `sendEmbed` resolves a message id per call.
 */
export function stubDiscord(ctx: PostsCtx, perms: bigint[] = SEND_FLAGS) {
  const client = ctx.testApp.app.get(DiscordBotClientService);
  jest.spyOn(client, 'isConnected').mockReturnValue(true);
  jest.spyOn(client, 'getGuild').mockReturnValue(fakeGuild(perms));
  jest
    .spyOn(ctx.testApp.app.get(SettingsService), 'getTrustedClientUrl')
    .mockResolvedValue(CLIENT_URL);
  jest
    .spyOn(ctx.testApp.app.get(DiscordNotificationService), 'dispatch')
    .mockResolvedValue(false);
  let n = 0;
  const sendEmbed = jest.spyOn(client, 'sendEmbed').mockImplementation(() => {
    n += 1;
    return Promise.resolve({ id: `47886000000000${1000 + n}` } as Message);
  });
  const editEmbed = jest
    .spyOn(client, 'editEmbed')
    .mockRejectedValue(new Error('editEmbed must not be called'));
  const deleteMessage = jest
    .spyOn(client, 'deleteMessage')
    .mockResolvedValue(undefined);
  return { sendEmbed, editEmbed, deleteMessage };
}
