/**
 * The run's ONE shared hub forum. Discord throttles webhook creation per
 * guild (~5 fast, then one per 60-78s), and binding a hub to a forum makes
 * the bot create that forum's webhook. A forum per test meant ~14 webhook
 * creates per run, so binds passed the 90s client timeout once two pool
 * runs overlapped (RCA 2026-11-26, forum-put-rca).
 *
 * So the forum tests share one forum (`rl-smoke-forum-<runId>`) and one hub
 * bound to it in `existing` mode, made lazily on first use and memoised.
 * The binding stays up all run: the last unbind deletes the bot's webhook
 * (ROK-2296), which would force a fresh create on the next bind. The
 * runner's teardown calls {@link releaseSharedHubForum}. Only the binding
 * test still creates its own forums (create mode end to end + sharing).
 *
 * Tests isolate by their own post / thread ids and names; a forum-wide
 * check must skip the posts that were there before the test started
 * ({@link activePostIds}).
 */
import { ChannelType, type ForumChannel } from "discord.js";
import { getGuild } from "../../client.js";
import type { ApiClient } from "../api.js";
import { SmokeAssertionError } from "../assert.js";
import { isStaleSharedForum, sharedForumName } from "../shared-forum-name.js";
import type { TestContext } from "../types.js";

const SEED_GUILD = "/admin/test/wow/seed-guild";

/** What a forum test gets: the bound forum, its hub and the hub's seed cast. */
export interface SharedHubForum {
  forum: ForumChannel;
  hub: number;
  gameId: number;
  users: unknown;
}

let pending: Promise<SharedHubForum> | null = null;
/** Ids to undo at teardown, set as soon as each thing exists. */
const made: { forum: string | null; hub: number | null } = { forum: null, hub: null };

function fail(what: string, got: unknown): never {
  throw new SmokeAssertionError(`${what}; got ${JSON.stringify(got)}`);
}

/** Delete `rl-smoke-forum-<id>` leftovers of runs that died before teardown. */
async function sweepStaleForums(): Promise<void> {
  const channels = await getGuild().channels.fetch().catch(() => null);
  const now = Date.now();
  for (const ch of channels?.values() ?? []) {
    if (ch?.type !== ChannelType.GuildForum || !isStaleSharedForum(ch.name, now)) continue;
    console.log(`    Sweeping leftover smoke forum ${ch.name} (${ch.id})`);
    await ch.delete("smoke: stale shared forum").catch((err: unknown) => {
      console.warn(`  forum ${ch.id} sweep failed: ${String(err)}`);
    });
  }
}

async function create(ctx: TestContext): Promise<SharedHubForum> {
  await sweepStaleForums();
  const now = Date.now();
  const forum = await getGuild().channels.create({
    name: sharedForumName(now),
    type: ChannelType.GuildForum,
    reason: "smoke: the run's shared hub forum",
  });
  made.forum = forum.id;
  const seeded = await ctx.api.post<{ guildId?: unknown; gameId?: unknown; users?: unknown }>(SEED_GUILD, {
    name: `SF-O ${now.toString(36)}`,
  });
  if (typeof seeded.guildId !== "number") fail("seed-guild: no guildId", seeded);
  if (typeof seeded.gameId !== "number") fail("seed-guild: no gameId", seeded);
  made.hub = seeded.guildId;
  await ctx.api.put(`/guilds/${String(made.hub)}/forum-discord`, { mode: "existing", channelId: forum.id, ack: true });
  return { forum, hub: seeded.guildId, gameId: seeded.gameId, users: seeded.users };
}

/**
 * The run's shared forum + bound hub, made on the first call. A failed
 * attempt is forgotten (a retry makes a fresh one) but its leftovers stay
 * recorded for {@link releaseSharedHubForum}.
 */
export async function sharedHubForum(ctx: TestContext): Promise<SharedHubForum> {
  if (pending === null) {
    if (made.forum !== null || made.hub !== null) await releaseSharedHubForum(ctx.api);
    pending = create(ctx);
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}

/**
 * Teardown: unbind the hub (its webhook goes with the last unbind, ROK-2296)
 * and delete the forum. Best-effort; never throws.
 */
export async function releaseSharedHubForum(api: Pick<ApiClient, "delete">): Promise<void> {
  pending = null;
  const { forum, hub } = made;
  made.forum = null;
  made.hub = null;
  if (hub !== null) await api.delete(`/guilds/${String(hub)}/forum-discord`).catch(() => undefined);
  if (forum === null) return;
  const ch = await getGuild().channels.fetch(forum, { force: true }).catch(() => null);
  await ch?.delete("smoke teardown: shared hub forum").catch((err: unknown) => {
    console.warn(`  forum ${forum} delete failed: ${String(err)}`);
  });
}

/** The forum's active post ids now — snapshot before a forum-wide check. */
export async function activePostIds(forum: ForumChannel): Promise<Set<string>> {
  const active = await forum.threads.fetchActive();
  return new Set(active.threads.keys());
}
