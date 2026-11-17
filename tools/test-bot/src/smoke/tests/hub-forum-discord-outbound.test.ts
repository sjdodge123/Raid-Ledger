/**
 * ROK-2208 (S4) — outbound RL → Discord against the real Discord guild
 * (AC5, AC11): a hub bound to a run-scoped forum `rl-smoke-forum-<runId>`
 * (made by this test, never picked by position); an RL thread appears as a
 * webhook forum post; an RL edit edits it; an RL delete deletes it.
 * Teardown unbinds the hub and deletes the forum.
 */
import { ChannelType, type ForumChannel, type ThreadChannel } from "discord.js";
import { getGuild } from "../../client.js";
import { pollForCondition } from "../../helpers/polling.js";
import { SmokeAssertionError } from "../assert.js";
import type { SmokeTest, TestContext } from "../types.js";

const SEED_GUILD = "/admin/test/wow/seed-guild";
const TIMEOUT_MS = 30_000;

interface Made {
  hub: number | null;
  forum: string | null;
}

function fail(what: string, got: unknown): never {
  throw new SmokeAssertionError(`${what}; got ${JSON.stringify(got)}`);
}

/** The forum's post (active or archived) with this exact name, or null. */
async function findPost(forum: ForumChannel, name: string): Promise<ThreadChannel | null> {
  const active = await forum.threads.fetchActive();
  return active.threads.find((t) => t.name === name) ?? null;
}

async function starterContent(post: ThreadChannel): Promise<{ content: string; webhookId: string | null } | null> {
  const msg = await post.fetchStarterMessage().catch(() => null);
  return msg ? { content: msg.content, webhookId: msg.webhookId } : null;
}

async function expectPost(forum: ForumChannel, title: string, body: string): Promise<ThreadChannel> {
  let last: unknown = null;
  try {
    return await pollForCondition(async () => {
      const post = await findPost(forum, title);
      const starter = post ? await starterContent(post) : null;
      last = starter;
      return post && starter?.content === body && starter.webhookId ? post : null;
    }, TIMEOUT_MS);
  } catch {
    return fail(`forum post "${title}": expected a webhook post with "${body}"`, last);
  }
}

async function expectPostGone(postId: string): Promise<void> {
  try {
    await pollForCondition(async () => {
      const ch = await getGuild().channels.fetch(postId, { force: true }).catch(() => null);
      return ch === null ? true : null;
    }, TIMEOUT_MS);
  } catch {
    fail(`forum post ${postId}: expected it deleted (R4)`, "still there");
  }
}

async function setup(ctx: TestContext, runId: string, made: Made) {
  const forum = await getGuild().channels.create({
    name: `rl-smoke-forum-${runId}`,
    type: ChannelType.GuildForum,
    reason: "ROK-2208 outbound smoke",
  });
  made.forum = forum.id;
  const seeded = await ctx.api.post<{ guildId?: unknown }>(SEED_GUILD, { name: `SF-O ${runId}` });
  if (typeof seeded.guildId !== "number") fail("seed-guild: no guildId", seeded);
  made.hub = seeded.guildId;
  await ctx.api.put(`/guilds/${String(made.hub)}/forum-discord`, {
    mode: "existing",
    channelId: forum.id,
    ack: true,
  });
  return { forum, hub: seeded.guildId };
}

async function outbound(ctx: TestContext): Promise<void> {
  const runId = Date.now().toString(36);
  const made: Made = { hub: null, forum: null };
  try {
    const { forum, hub } = await setup(ctx, runId, made);
    const base = `/guilds/${String(hub)}/forum`;
    const title = `Smoke thread ${runId}`;
    const created = await ctx.api.post<{ id?: unknown }>(base, { title, body: "Outbound smoke body" });
    if (typeof created.id !== "number") fail("POST forum thread: no id", created);
    const post = await expectPost(forum, title, "Outbound smoke body");
    await ctx.api.patch(`${base}/${String(created.id)}`, { body: "Edited on Raid Ledger" });
    await expectPost(forum, title, "Edited on Raid Ledger");
    await ctx.api.delete(`${base}/${String(created.id)}`);
    await expectPostGone(post.id);
  } finally {
    await teardown(ctx, made);
  }
}

/** Best-effort undo; never masks the failure that got us here. */
async function teardown(ctx: TestContext, made: Made): Promise<void> {
  if (made.hub !== null) {
    await ctx.api.delete(`/guilds/${String(made.hub)}/forum-discord`).catch(() => undefined);
  }
  if (made.forum === null) return;
  const forum = await getGuild().channels.fetch(made.forum, { force: true }).catch(() => null);
  await forum?.delete("ROK-2208 smoke teardown").catch((err: unknown) => {
    console.warn(`  forum ${String(made.forum)} delete failed: ${String(err)}`);
  });
}

export const hubForumDiscordOutboundTests: SmokeTest[] = [
  {
    name: "hub-forum-discord: RL thread create/edit/delete → webhook forum post (ROK-2208)",
    category: "flow",
    serial: true,
    run: outbound,
  },
];
