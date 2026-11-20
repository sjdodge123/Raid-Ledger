/**
 * ROK-2272 S8 — a hub-tagged standalone scheduling poll's Discord post, end to
 * end against the real guild, on this run's own `rl-smoke-forum-<runId>`
 * (ROK-2208 `setup`; binding it dresses the forum with THIS build's decor, so
 * the `Poll` kind tag exists):
 *  1. the poll gets its RL thread (`GET /scheduling-polls/:id/discussion`);
 *  2. the first vote (the suggest auto-vote) creates the post `<title> — Poll`
 *     carrying the hub tag + `Poll`;
 *  3. the companion bot writes in the post — it is linked to the DM recipient,
 *     who neither voted nor is a member, so the R7 gate refuses it; an RL
 *     reply sent AFTER it is the ordering anchor (mirrored to Discord), and
 *     the discussion must then hold the RL reply and not the bot's text;
 *  4. lock-in posts the closing line (`is happening!` + the event link — the
 *     api copy `CLOSING_LINE_COPY.pollLockedIn` cannot be imported here and
 *     the event title is markdown-escaped, so only the stable parts match);
 *  5. `close-discussion-now` + `lock-sweep` lock and archive the post.
 * `finally` deletes the post, the event, the binding and the forum, and
 * archives the poll's lineup.
 */
import { ChannelType, type ForumChannel, type ThreadChannel } from "discord.js";
import { getGuild } from "../../client.js";
import { pollForCondition } from "../../helpers/polling.js";
import { SmokeAssertionError } from "../assert.js";
import type { SmokeTest, TestContext } from "../types.js";
import { fail, setup, teardown, TIMEOUT_MS, type Made } from "./hub-forum-discord-outbound.test.js";

const FIXTURES = "/admin/test/hub-forum-discord";

export interface Poll {
  matchId: number;
  lineupId: number;
}

interface Discussion {
  guildId: number;
  threadId: number;
  replies: { body: string }[];
  replyCount: number;
}

function readDiscussion(dto: unknown): Discussion | null {
  if (typeof dto !== "object" || dto === null) return null;
  const d = Object.fromEntries(Object.entries(dto));
  if (d.state !== "ready" || typeof d.guildId !== "number" || typeof d.threadId !== "number") return null;
  const raw: unknown[] = Array.isArray(d.latestReplies) ? d.latestReplies : [];
  const replies = raw.map((r) => {
    const body: unknown = typeof r === "object" && r !== null && "body" in r ? r.body : "";
    return { body: typeof body === "string" ? body : "" };
  });
  const replyCount = typeof d.replyCount === "number" ? d.replyCount : -1;
  return { guildId: d.guildId, threadId: d.threadId, replies, replyCount };
}

async function createPoll(ctx: TestContext, hub: number, gameId: number): Promise<Poll> {
  const res = await ctx.api.post<{ id?: unknown; lineupId?: unknown }>("/scheduling-polls", {
    gameId,
    hubId: hub,
    durationHours: 48,
  });
  if (typeof res.id !== "number" || typeof res.lineupId !== "number") return fail("create poll: no id / lineupId", res);
  return { matchId: res.id, lineupId: res.lineupId };
}

const discussionPath = (p: Poll) => `/scheduling-polls/${String(p.matchId)}/discussion`;

async function waitDiscussion(ctx: TestContext, poll: Poll, done: (d: Discussion) => boolean, why: string): Promise<Discussion> {
  let last: unknown = null;
  try {
    return await pollForCondition(async () => {
      last = await ctx.api.get<unknown>(discussionPath(poll));
      const d = readDiscussion(last);
      return d && done(d) ? d : null;
    }, TIMEOUT_MS);
  } catch {
    return fail(why, last);
  }
}

/** The RL thread's title — already `<title> — Poll`, the Discord post name too. */
async function threadTitle(ctx: TestContext, d: Discussion): Promise<string> {
  const t = await ctx.api.get<{ title?: unknown }>(`/guilds/${String(d.guildId)}/forum/${String(d.threadId)}`);
  if (typeof t.title !== "string" || !t.title.endsWith(" — Poll")) return fail("poll thread: title should end ' — Poll'", t);
  return t.title;
}

/** Suggest a slot 3 days out; the suggester's auto-vote is the first vote. */
async function firstVote(ctx: TestContext, poll: Poll): Promise<number> {
  const at = new Date(Date.now() + 3 * 24 * 3_600_000);
  at.setUTCSeconds(0, 0);
  const path = `/lineups/${String(poll.lineupId)}/schedule/${String(poll.matchId)}/suggest`;
  const res = await ctx.api.post<{ id?: unknown }>(path, { proposedTime: at.toISOString() });
  if (typeof res.id !== "number") return fail("suggest slot: no id", res);
  return res.id;
}

async function expectPost(forum: ForumChannel, name: string): Promise<ThreadChannel> {
  let names: string[] = [];
  try {
    return await pollForCondition(async () => {
      const active = await forum.threads.fetchActive();
      names = [...active.threads.values()].map((t) => t.name);
      return active.threads.find((t) => t.name === name) ?? null;
    }, TIMEOUT_MS);
  } catch {
    return fail(`ROK-2272 S8: the first vote should create the post "${name}"`, names);
  }
}

async function expectHubAndPollTags(forumId: string, post: ThreadChannel): Promise<void> {
  const forum = await getGuild().channels.fetch(forumId, { force: true });
  if (forum?.type !== ChannelType.GuildForum) return fail(`forum ${forumId}: not a forum channel`, forum?.type);
  const tags = forum.availableTags;
  const applied = post.appliedTags.map((id) => tags.find((t) => t.id === id)?.name ?? id);
  const poll = tags.find((t) => t.name === "Poll");
  if (!poll || !post.appliedTags.includes(poll.id) || post.appliedTags.length !== 2) {
    fail("ROK-2272 S8: a hub poll post carries exactly its hub tag + `Poll`", applied);
  }
}

export async function expectInPost(post: ThreadChannel, why: string, match: (content: string, webhook: boolean) => boolean): Promise<void> {
  let seen: string[] = [];
  try {
    await pollForCondition(async () => {
      const msgs = await post.messages.fetch({ limit: 30 });
      seen = msgs.map((m) => m.content);
      return msgs.some((m) => match(m.content, m.webhookId !== null)) ? true : null;
    }, TIMEOUT_MS);
  } catch {
    fail(why, seen);
  }
}

/** Bot writes (refused), then an RL reply; the RL reply proves time passed. */
async function refusedThenReply(ctx: TestContext, poll: Poll, post: ThreadChannel, runId: string): Promise<void> {
  const botText = `Companion not a voter ${runId}`;
  const rlText = `RL poll reply ${runId}`;
  await post.send(botText);
  await ctx.api.post(`${discussionPath(poll)}/replies`, { body: rlText });
  await expectInPost(post, `ROK-2272 S8: the RL reply should reach post ${post.id} as a webhook message`, (c, wh) => wh && c.includes(rlText));
  const d = await waitDiscussion(ctx, poll, (x) => x.replies.some((r) => r.body.includes(rlText)), "discussion: expected the RL reply");
  if (d.replies.some((r) => r.body.includes(botText)) || d.replyCount !== 1) {
    fail("ROK-2272 S8 R7: a non-voter's Discord message must not be imported", d);
  }
}

export async function lockIn(ctx: TestContext, poll: Poll, slotId: number, made: Made): Promise<number> {
  const path = `/lineups/${String(poll.lineupId)}/schedule/${String(poll.matchId)}/create-event`;
  const res = await ctx.api.post<{ eventId?: unknown }>(path, { slotId });
  if (typeof res.eventId !== "number") return fail("create-event (lock-in): no eventId", res);
  made.event = res.eventId;
  return res.eventId;
}

async function closeAndSweep(ctx: TestContext, poll: Poll): Promise<void> {
  const closed = await ctx.api.post<{ closed?: unknown }>(`${FIXTURES}/polls/${String(poll.matchId)}/close-discussion-now`, {});
  if (typeof closed.closed !== "number" || closed.closed < 1) fail("close-discussion-now: expected { closed >= 1 }", closed);
  const res = await ctx.api.post<{ changed?: unknown }>(`${FIXTURES}/lock-sweep`, {});
  // `changed` may be 0 if the 5-min cron got there first; the Discord state is the assertion.
  if (typeof res.changed !== "number") fail("lock-sweep fixture: expected { changed: number }", res);
}

export async function expectLockedArchived(postId: string): Promise<void> {
  let last: unknown = null;
  try {
    await pollForCondition(async () => {
      const ch = await getGuild().channels.fetch(postId, { force: true }).catch(() => null);
      last = ch?.isThread() ? { locked: ch.locked, archived: ch.archived } : ch?.type;
      return ch?.isThread() && ch.locked === true && ch.archived === true ? true : null;
    }, TIMEOUT_MS);
  } catch (err) {
    if (err instanceof SmokeAssertionError) throw err;
    fail(`ROK-2272 S8: poll post ${postId} should be locked AND archived after its window closed`, last);
  }
}

export async function cleanup(ctx: TestContext, poll: Poll | null, postId: string | null): Promise<void> {
  if (postId !== null) {
    const ch = await getGuild().channels.fetch(postId, { force: true }).catch(() => null);
    await ch?.delete("ROK-2272 S8 smoke teardown").catch((err: unknown) => {
      console.warn(`  post ${postId} delete failed: ${String(err)}`);
    });
  }
  if (poll !== null) {
    await ctx.api.patch(`/lineups/${String(poll.lineupId)}/status`, { status: "archived" }).catch(() => null);
  }
}

async function hubPollForum(ctx: TestContext): Promise<void> {
  const runId = Date.now().toString(36);
  const made: Made = { hub: null, forum: null };
  let poll: Poll | null = null;
  let postId: string | null = null;
  try {
    const { forum, hub, gameId } = await setup(ctx, runId, made);
    poll = await createPoll(ctx, hub, gameId);
    const thread = await waitDiscussion(ctx, poll, () => true, "ROK-2272 S7: the hub poll should get its RL thread");
    const name = await threadTitle(ctx, thread);
    const slotId = await firstVote(ctx, poll);
    const post = await expectPost(forum, name);
    postId = post.id;
    await expectHubAndPollTags(forum.id, post);
    await refusedThenReply(ctx, poll, post, runId);
    const eventId = await lockIn(ctx, poll, slotId, made);
    const link = `/events/${String(eventId)}`;
    await expectInPost(post, `ROK-2272 S8: expected the lock-in closing line linking ${link}`, (c, wh) => !wh && c.includes("is happening!") && c.includes(link));
    await closeAndSweep(ctx, poll);
    await expectLockedArchived(post.id);
  } finally {
    await cleanup(ctx, poll, postId);
    await teardown(ctx, made);
  }
}

export const hubPollForumTests: SmokeTest[] = [
  {
    name: "hub-forum-discord: hub poll → post on first vote, R7 refusal, lock-in line, locked after close (ROK-2272 S8)",
    category: "flow",
    serial: true,
    run: hubPollForum,
  },
];
