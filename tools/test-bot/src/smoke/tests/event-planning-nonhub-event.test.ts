/**
 * ROK-2272 S4b — a NON-hub event (no hub tag, not ad-hoc) gets its Discord
 * post in the event-planning forum, lazily: none before a signup, one on the
 * first signup line (tagged only `Event`, dated title, event page link),
 * and it is locked + archived once the event ended more than 1 h ago.
 * The forum is this run's own `rl-smoke-forum-<runId>` (ROK-2208 setup), the
 * only bound forum in the guild, so the event-planning resolver picks it.
 * `finally` deletes this test's Discord post, event, binding and forum by id.
 */
import { ChannelType, type ForumChannel, type ThreadChannel } from "discord.js";
import { getGuild } from "../../client.js";
import { pollForCondition } from "../../helpers/polling.js";
import { createEvent, futureTime, linkDiscord, signupAs } from "../fixtures.js";
import type { SmokeTest, TestContext } from "../types.js";
import { farOffTimes, fail, flushPings, setup, teardown, TIMEOUT_MS, type Made } from "./hub-forum-discord-outbound.test.js";
import { BOT_NAME, relinkDmRecipient, seededMember } from "./hub-forum-discord-signup-lines.test.js";

const FIXTURES = "/admin/test/hub-forum-discord";
const DASH = " — ";

/** Precondition: the event-planning resolver answers with THIS run's forum. */
async function expectResolvedForum(ctx: TestContext, forumId: string): Promise<void> {
  const dto = await ctx.api.get<{ resolvedChannelId?: unknown }>("/admin/discord/event-planning-forum");
  if (dto.resolvedChannelId !== forumId) fail(`precondition: event-planning forum should resolve to ${forumId}`, dto);
}

async function syncPlanningPost(ctx: TestContext, eventId: number): Promise<void> {
  await ctx.api.post(`${FIXTURES}/events/${String(eventId)}/sync-planning-post`, {});
}

/** No empty posts: the run's fresh forum holds no post before any line. */
async function expectNoPost(forum: ForumChannel): Promise<void> {
  const active = await forum.threads.fetchActive();
  const names = [...active.threads.values()].map((t) => t.name);
  if (names.length > 0) fail("ROK-2272: no post may exist before the first signup line", names);
}

async function expectOnlyEventTag(forumId: string, post: ThreadChannel): Promise<void> {
  const forum = await getGuild().channels.fetch(forumId, { force: true });
  if (forum?.type !== ChannelType.GuildForum) return fail(`forum ${forumId}: not a forum channel`, forum?.type);
  const tags = forum.availableTags;
  const eventTag = tags.find((t) => t.name === "Event");
  if (!eventTag) return fail("ROK-2272: the forum has no `Event` tag after the post", tags.map((t) => t.name));
  const applied = post.appliedTags.map((id) => tags.find((t) => t.id === id)?.name ?? id);
  if (post.appliedTags.length !== 1 || post.appliedTags[0] !== eventTag.id) {
    fail("ROK-2272: a non-hub event post carries ONLY the `Event` tag (no hub tag)", applied);
  }
}

function expectDatedTitle(post: ThreadChannel, title: string): void {
  const prefix = `${title}${DASH}`;
  if (!post.name.startsWith(prefix) || post.name.length <= prefix.length) {
    fail(`ROK-2272: post title should be "${prefix}<date>"`, post.name);
  }
}

async function expectStarterLink(post: ThreadChannel, eventId: number): Promise<void> {
  const starter = await post.fetchStarterMessage().catch(() => null);
  const content = starter?.content ?? null;
  if (!content?.includes(`/events/${String(eventId)}`) || starter?.webhookId) {
    fail(`ROK-2272: the starter is a bot message linking /events/${String(eventId)}`, { content, webhookId: starter?.webhookId ?? null });
  }
}

async function expectSignupLine(post: ThreadChannel, me: string): Promise<void> {
  let seen: string[] = [];
  try {
    await pollForCondition(async () => {
      const msgs = await post.messages.fetch({ limit: 30 });
      seen = msgs.filter((m) => m.author.bot && !m.webhookId).map((m) => m.content);
      return seen.some((l) => l.includes(`<@${me}>`) && l.includes("signed up")) ? true : null;
    }, TIMEOUT_MS);
  } catch {
    fail(`ROK-2272: expected <@${me}> "signed up" in post ${post.id}`, seen);
  }
}

/** End the event 2 h ago, re-sync its post, run the lock sweep now. */
async function closeEvent(ctx: TestContext, eventId: number): Promise<void> {
  await ctx.api.post("/admin/test/set-event-times", { eventId, startTime: futureTime(-180), endTime: futureTime(-120) });
  await syncPlanningPost(ctx, eventId);
  const res = await ctx.api.post<{ changed?: unknown }>(`${FIXTURES}/lock-sweep`, {});
  if (typeof res.changed !== "number" || res.changed < 1) fail("ROK-2272: the lock sweep should close the ended event's post", res);
}

async function expectLockedArchived(postId: string): Promise<void> {
  let last: unknown = null;
  try {
    await pollForCondition(async () => {
      const ch = await getGuild().channels.fetch(postId, { force: true }).catch(() => null);
      last = ch?.isThread() ? { locked: ch.locked, archived: ch.archived } : ch?.type;
      return ch?.isThread() && ch.locked === true && ch.archived === true ? true : null;
    }, TIMEOUT_MS);
  } catch {
    fail(`ROK-2272: post ${postId} should be locked AND archived after the event closed`, last);
  }
}

async function deletePost(postId: string | null): Promise<void> {
  if (postId === null) return;
  const ch = await getGuild().channels.fetch(postId, { force: true }).catch(() => null);
  await ch?.delete("ROK-2272 smoke teardown").catch((err: unknown) => {
    console.warn(`  post ${postId} delete failed: ${String(err)}`);
  });
}

async function nonHubEventPost(ctx: TestContext): Promise<void> {
  const runId = Date.now().toString(36);
  const made: Made = { hub: null, forum: null };
  const me = ctx.testBotDiscordId;
  let postId: string | null = null;
  try {
    const { forum, users } = await setup(ctx, runId, made);
    await expectResolvedForum(ctx, forum.id);
    const member = seededMember(users);
    await linkDiscord(ctx.api, member.userId, me, BOT_NAME);
    const event = await createEvent(ctx.api, "planning-post", farOffTimes());
    made.event = event.id;
    await syncPlanningPost(ctx, event.id);
    await expectNoPost(forum);
    await signupAs(ctx.api, event.id, member.userId);
    const post = await flushPings(ctx, event.id);
    postId = post.id;
    if (post.parentId !== forum.id) fail(`ROK-2272: the post should be in forum ${forum.id}`, post.parentId);
    await expectOnlyEventTag(forum.id, post);
    expectDatedTitle(post, event.title);
    await expectStarterLink(post, event.id);
    await expectSignupLine(post, me);
    await closeEvent(ctx, event.id);
    await expectLockedArchived(post.id);
  } finally {
    await deletePost(postId);
    await teardown(ctx, made);
    await relinkDmRecipient(ctx);
  }
}

export const eventPlanningNonHubEventTests: SmokeTest[] = [
  {
    name: "event-planning: non-hub event post — lazy, Event-tagged, locked after close (ROK-2272)",
    category: "flow",
    serial: true,
    run: nonHubEventPost,
  },
];
