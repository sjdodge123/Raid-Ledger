/**
 * ROK-2208 (S4) — outbound RL → Discord against the real Discord guild
 * (AC5, AC11): the hub bound to the run's shared forum (`hub-forum-shared.ts`,
 * found by the id it made, never by position); an RL thread appears as a
 * webhook forum post; an RL edit edits it; an RL delete deletes it.
 * ROK-2260: signups on an event tagged to the bound hub create the event's
 * post and get one bot @mention (which adds them); a cancel removes them.
 * Teardown deletes the event; the shared hub + forum outlive the test.
 */
import type { ForumChannel, ThreadChannel } from "discord.js";
import { getGuild } from "../../client.js";
import { pollForCondition } from "../../helpers/polling.js";
import { SmokeAssertionError } from "../assert.js";
import { cancelSignupAs, createEvent, futureTime, linkDiscord, signupAs } from "../fixtures.js";
import type { SmokeTest, TestContext } from "../types.js";
import { activePostIds, sharedHubForum, type SharedHubForum } from "./hub-forum-shared.js";

export const TIMEOUT_MS = 30_000;

/** What a test's teardown must undo (the shared hub + forum are not its). */
export interface Made {
  event?: number;
}

export function fail(what: string, got: unknown): never {
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

/** The run's shared forum + the hub bound to it (made on first use). */
export async function setup(ctx: TestContext): Promise<SharedHubForum> {
  return sharedHubForum(ctx);
}

async function outbound(ctx: TestContext): Promise<void> {
  const runId = Date.now().toString(36);
  const made: Made = {};
  try {
    const { forum, hub } = await setup(ctx);
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

const flushPath = (eventId: number) => `/admin/test/hub-forum-discord/events/${String(eventId)}/flush-signup-pings`;

/** Force the debounced flush now; resolves the event's post id once it pinged. */
export async function flushPings(ctx: TestContext, eventId: number): Promise<ThreadChannel> {
  let last: unknown = null;
  try {
    const postId = await pollForCondition(async () => {
      const res = await ctx.api.post<{ outcome?: unknown; discordThreadId?: unknown }>(flushPath(eventId), {});
      last = res;
      return res.outcome === "pinged" && typeof res.discordThreadId === "string" ? res.discordThreadId : null;
    }, TIMEOUT_MS);
    const post = await getGuild().channels.fetch(postId, { force: true });
    if (!post?.isThread()) return fail(`event ${eventId}: post ${postId} is not a thread`, post?.type);
    return post;
  } catch (err) {
    if (err instanceof SmokeAssertionError) throw err;
    return fail(`flush-signup-pings on event ${eventId}: expected "pinged" with a post`, last);
  }
}

/** Poll for a bot (not webhook) message in the post that @mentions `userId`. */
async function expectMention(post: ThreadChannel, userId: string): Promise<void> {
  let seen: string[] = [];
  try {
    await pollForCondition(async () => {
      const msgs = await post.messages.fetch({ limit: 20 });
      seen = msgs.filter((m) => m.author.bot && !m.webhookId).map((m) => m.content);
      return seen.some((c) => c.includes(`<@${userId}>`)) ? true : null;
    }, TIMEOUT_MS);
  } catch {
    fail(`ROK-2260 ruling 2: expected one bot message in post ${post.id} mentioning <@${userId}>`, seen);
  }
}

/** Poll until `userId` is (or is no longer) a member of the post. */
async function expectMember(post: ThreadChannel, userId: string, present: boolean, why: string): Promise<void> {
  let ids: string[] = [];
  try {
    await pollForCondition(async () => {
      const members = await post.members.fetch();
      ids = [...members.keys()];
      return ids.includes(userId) === present ? true : null;
    }, TIMEOUT_MS);
  } catch {
    fail(`${why}: ${userId} ${present ? "in" : "out of"} post ${post.id}`, ids);
  }
}

/**
 * Pre-flush check: `userId` is in no post this test made (every post not in
 * `before`, the forum's posts when the test started), so the membership seen
 * after the flush can only have come from the @mention.
 */
async function expectInNoPost(forum: ForumChannel, userId: string, before: Set<string>): Promise<void> {
  const active = await forum.threads.fetchActive();
  const inPosts: string[] = [];
  for (const post of active.threads.values()) {
    if (before.has(post.id)) continue;
    const members = await post.members.fetch();
    if (members.has(userId)) inPosts.push(post.id);
  }
  if (inPosts.length > 0) fail(`ROK-2260 ruling 2: ${userId} must not be in any post before the flush`, inPosts);
}

/**
 * ROK-2271: an event 48 h out, so a cancel is a graceful decline (debounced)
 * — inside 24 h it is a roach-out that flushes AT ONCE, racing this test's
 * own forced flush (which would then find nothing left: `unchanged`).
 */
export function farOffTimes(): { startTime: string; endTime: string } {
  return { startTime: futureTime(48 * 60), endTime: futureTime(49 * 60) };
}

async function signupPings(ctx: TestContext): Promise<void> {
  const made: Made = {};
  const me = ctx.testBotDiscordId;
  try {
    const { forum, hub, gameId } = await setup(ctx);
    const before = await activePostIds(forum);
    await linkDiscord(ctx.api, ctx.dmRecipientUserId, me, "SmokeTestBot");
    const event = await createEvent(ctx.api, "forum-pings", { guildId: hub, gameId, ...farOffTimes() });
    made.event = event.id;
    await signupAs(ctx.api, event.id, ctx.dmRecipientUserId);
    await expectInNoPost(forum, me, before);
    const post = await flushPings(ctx, event.id);
    await expectMention(post, me);
    await expectMember(post, me, true, "ROK-2260 ruling 2: the mention must add the signed-up player to the post");
    await cancelSignupAs(ctx.api, event.id, ctx.dmRecipientUserId);
    await flushPings(ctx, event.id);
    await expectMember(post, me, false, "ROK-2260 ruling 3: a cancel must remove the player from the post");
  } finally {
    await teardown(ctx, made);
  }
}

/** Best-effort undo; never masks the failure that got us here. */
export async function teardown(ctx: TestContext, made: Made): Promise<void> {
  if (made.event !== undefined) {
    await ctx.api.delete(`/events/${String(made.event)}`).catch(() => undefined);
  }
}

export const hubForumDiscordOutboundTests: SmokeTest[] = [
  {
    name: "hub-forum-discord: RL thread create/edit/delete → webhook forum post (ROK-2208)",
    category: "flow",
    serial: true,
    run: outbound,
  },
  {
    name: "hub-forum-discord: event signups → one @mention in the event's post; cancel removes (ROK-2260)",
    category: "flow",
    serial: true,
    run: signupPings,
  },
];
