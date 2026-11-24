/**
 * ROK-2297 — "copy earlier chat", end to end on this run's own
 * `rl-smoke-forum-<runId>` (ROK-2208 `setup`):
 *  1. a hub event's RL thread gets a member reply (`pre-reschedule <runId>`),
 *     which reaches the event's Discord post;
 *  2. opening a reschedule poll for the event copies that chat into the poll
 *     thread: the poll's post shows the `Earlier chat from` header and the
 *     reply, both as webhook messages;
 *  3. an RL reply in the poll (`in-poll <runId>`), then the reschedule lock-in,
 *     copies the poll chat back into the event: the event's post gets the
 *     `in-poll` text, and `pre-reschedule` is still there exactly ONCE (the
 *     round trip never duplicates the event's own reply).
 * The copies are newer than nothing else in the post, and are sent oldest
 * first, so a duplicate would land BEFORE `in-poll` — seeing `in-poll` is the
 * ordering anchor for the "exactly once" read. Guest-author copies are covered
 * by the api integration spec (the test bot cannot post as a member).
 */
import type { ForumChannel, ThreadChannel } from "discord.js";
import { pollForCondition } from "../../helpers/polling.js";
import { getGuild } from "../../client.js";
import { awaitProcessing, createEvent } from "../fixtures.js";
import type { SmokeTest, TestContext } from "../types.js";
import { fail, farOffTimes, setup, teardown, TIMEOUT_MS, type Made } from "./hub-forum-discord-outbound.test.js";
import { cleanup, expectInPost, type Poll } from "./hub-poll-forum.test.js";

/** POST a reply once the RL thread exists (its sync is async). */
async function replyWhenReady(ctx: TestContext, path: string, body: string): Promise<void> {
  let last: unknown = null;
  try {
    await pollForCondition(async () => {
      try {
        await ctx.api.post(path, { body });
        return true;
      } catch (err) {
        last = String(err);
        return null;
      }
    }, TIMEOUT_MS);
  } catch {
    fail(`reply "${body}" to ${path}: the RL thread never accepted it`, last);
  }
}

/** The run's (fresh) forum post holding `text`, skipping `except`. */
async function postWith(forum: ForumChannel, text: string, why: string, except?: string): Promise<ThreadChannel> {
  let seen: string[] = [];
  try {
    return await pollForCondition(async () => {
      const active = await forum.threads.fetchActive();
      seen = [];
      for (const post of active.threads.values()) {
        if (post.id === except) continue;
        const msgs = await post.messages.fetch({ limit: 30 });
        seen.push(...msgs.map((m) => `${post.name}: ${m.content}`));
        if (msgs.some((m) => m.webhookId !== null && m.content.includes(text))) return post;
      }
      return null;
    }, TIMEOUT_MS);
  } catch {
    return fail(why, seen);
  }
}

async function openReschedulePoll(ctx: TestContext, gameId: number, eventId: number): Promise<Poll> {
  const res = await ctx.api.post<{ id?: unknown; lineupId?: unknown }>("/scheduling-polls", { gameId, linkedEventId: eventId });
  if (typeof res.id !== "number" || typeof res.lineupId !== "number") return fail("reschedule poll: no id / lineupId", res);
  return { matchId: res.id, lineupId: res.lineupId };
}

/** Seed a slot 3 days out and lock the reschedule in at it (ROK-2040). */
async function rescheduleLockIn(ctx: TestContext, poll: Poll): Promise<void> {
  const base = `/lineups/${String(poll.lineupId)}/schedule/${String(poll.matchId)}`;
  const at = new Date(Date.now() + 3 * 24 * 3_600_000);
  at.setUTCSeconds(0, 0);
  const { id } = await ctx.api.post<{ id: number }>(`${base}/suggest`, { proposedTime: at.toISOString() });
  const page = await ctx.api.get<{ slots?: { id: number; proposedTime: string }[] }>(base);
  const slot = (page.slots ?? []).find((s) => s.id === id);
  if (!slot) return fail(`slot ${String(id)} missing from poll ${String(poll.matchId)}`, page.slots);
  const endTime = new Date(Date.parse(slot.proposedTime) + 3_600_000).toISOString();
  await ctx.api.post(`/scheduling-polls/${String(poll.matchId)}/reschedule-lock-in`, { startTime: slot.proposedTime, endTime });
  await awaitProcessing(ctx.api);
}

/** Exactly one webhook message in `post` contains `text`. */
async function expectOnce(post: ThreadChannel, text: string): Promise<void> {
  const msgs = await post.messages.fetch({ limit: 50 });
  const hits = msgs.filter((m) => m.content.includes(text)).map((m) => m.content);
  if (hits.length !== 1) fail(`ROK-2297 D-2: "${text}" should appear exactly once in the event post ${post.id}`, hits);
}

/** ROK-2314: poll until the post is closed (locked + archived) or reopened (neither). */
async function expectPostClosed(postId: string, closed: boolean, why: string): Promise<void> {
  let last: unknown = null;
  try {
    await pollForCondition(async () => {
      const ch = await getGuild().channels.fetch(postId, { force: true }).catch(() => null);
      last = ch?.isThread() ? { locked: ch.locked, archived: ch.archived } : ch?.type;
      return ch?.isThread() && ch.locked === closed && ch.archived === closed ? true : null;
    }, TIMEOUT_MS);
  } catch {
    fail(why, last);
  }
}

async function chatCopy(ctx: TestContext): Promise<void> {
  const runId = Date.now().toString(36);
  const made: Made = { hub: null, forum: null };
  let poll: Poll | null = null;
  let pollPostId: string | null = null;
  const before = `pre-reschedule ${runId}`;
  const during = `in-poll ${runId}`;
  try {
    const { forum, hub, gameId } = await setup(ctx, runId, made);
    const event = await createEvent(ctx.api, "chat-copy", { guildId: hub, gameId, ...farOffTimes() });
    made.event = event.id;
    await replyWhenReady(ctx, `/events/${String(event.id)}/discussion/replies`, before);
    const eventPost = await postWith(forum, before, "setup: the event reply should reach the event's post");
    poll = await openReschedulePoll(ctx, gameId, event.id);
    await awaitProcessing(ctx.api);
    const pollPost = await postWith(forum, "Earlier chat from", "ROK-2297 D-1: the poll's post should get the copy header", eventPost.id);
    pollPostId = pollPost.id;
    await expectPostClosed(eventPost.id, true, `ROK-2314: event post ${eventPost.id} should be locked + archived while the poll runs`);
    await expectInPost(pollPost, `ROK-2297 D-1: the event reply should be copied into poll post ${pollPost.id}`, (c, wh) => wh && c.includes(before));
    await replyWhenReady(ctx, `/scheduling-polls/${String(poll.matchId)}/discussion/replies`, during);
    await rescheduleLockIn(ctx, poll);
    await expectPostClosed(eventPost.id, false, `ROK-2314: event post ${eventPost.id} should reopen at lock-in`);
    await expectInPost(eventPost, `ROK-2297 D-2: the poll reply should be copied into event post ${eventPost.id}`, (c, wh) => wh && c.includes(during));
    await expectOnce(eventPost, before);
  } finally {
    await cleanup(ctx, poll, pollPostId);
    await teardown(ctx, made);
  }
}

export const hubForumChatCopyTests: SmokeTest[] = [
  {
    name: "hub-forum-discord: reschedule poll copies the event chat in, lock-in copies the poll chat back once (ROK-2297)",
    category: "flow",
    serial: true,
    run: chatCopy,
  },
];
