/**
 * ROK-2272 S10 — a NON-hub standalone scheduling poll gets its Discord-only
 * post in the event-planning forum (this run's own `rl-smoke-forum-<runId>`,
 * the only bound forum, so the resolver picks it — ROK-2208 `setup`):
 *  1. no post before any vote (a sync never creates one);
 *  2. the first vote — a slot suggested by a voter linked to the companion
 *     bot's Discord id (the suggest auto-votes) — creates `<title> — Poll`
 *     tagged ONLY `Poll`, its bot starter linking the poll page;
 *  3. that voter gets ONE ping line (`🗳 <@id> voted: <t:…:f>` — ROK-2295:
 *     it lists their slots); changing the vote adds no second line (anchor: the lock-in line lands after it);
 *  4. the organiser votes (an open poll is locked in only by a voter), then
 *     lock-in posts `is happening!` + the event link;
 *  5. `close-planning-post-now` + `lock-sweep` lock and archive the post.
 * `finally` deletes the post, the event, the binding and the forum, archives
 * the poll's lineup and re-links the DM recipient (the fixture voter is left
 * unlinked: its own fixture id is not a linkable id).
 */
import { ChannelType, type ForumChannel, type ThreadChannel } from "discord.js";
import { getGuild } from "../../client.js";
import { pollForCondition } from "../../helpers/polling.js";
import { linkDiscord, seedFixtureUser, type FixtureUser } from "../fixtures.js";
import type { SmokeTest, TestContext } from "../types.js";
import { expectResolvedForum } from "./event-planning-nonhub-event.test.js";
import {
  fail,
  setup,
  teardown,
  TIMEOUT_MS,
  type Made,
} from "./hub-forum-discord-outbound.test.js";
import {
  BOT_NAME,
  relinkDmRecipient,
} from "./hub-forum-discord-signup-lines.test.js";
import { expectPollStarterCard } from "./forum-starter-card.helpers.js";
import {
  cleanup,
  expectInPost,
  expectLockedArchived,
  lockIn,
  type Poll,
} from "./hub-poll-forum.test.js";

const FIXTURES = "/admin/test/hub-forum-discord";
const POLL_SUFFIX = " — Poll";
/** Fixture-user slot no other smoke uses (1, 5–9 are taken). */
const VOTER_SLOT = 4;

async function createNonHubPoll(
  ctx: TestContext,
  gameId: number,
): Promise<Poll> {
  const res = await ctx.api.post<{ id?: unknown; lineupId?: unknown }>(
    "/scheduling-polls",
    { gameId, durationHours: 48 },
  );
  if (typeof res.id !== "number" || typeof res.lineupId !== "number")
    return fail("create poll: no id / lineupId", res);
  return { matchId: res.id, lineupId: res.lineupId };
}

const schedulePath = (p: Poll) =>
  `/lineups/${String(p.lineupId)}/schedule/${String(p.matchId)}`;

/** Sync (never creates) then prove the run's fresh forum holds no post. */
async function expectNoPostYet(
  ctx: TestContext,
  poll: Poll,
  forum: ForumChannel,
): Promise<void> {
  await ctx.api.post(
    `${FIXTURES}/polls/${String(poll.matchId)}/sync-planning-post`,
    {},
  );
  const active = await forum.threads.fetchActive();
  const names = [...active.threads.values()].map((t) => t.name);
  if (names.length > 0)
    fail("ROK-2272 S10: no poll post may exist before the first vote", names);
}

/** The voter suggests a slot 3 days out; the suggest's auto-vote is the first vote. */
async function voterSuggests(voter: FixtureUser, poll: Poll): Promise<number> {
  const at = new Date(Date.now() + 3 * 24 * 3_600_000);
  at.setUTCSeconds(0, 0);
  const res = await voter.api.post<{ id?: unknown }>(
    `${schedulePath(poll)}/suggest`,
    { proposedTime: at.toISOString() },
  );
  if (typeof res.id !== "number")
    return fail("suggest slot (voter): no id", res);
  return res.id;
}

async function expectPollPost(forum: ForumChannel): Promise<ThreadChannel> {
  let names: string[] = [];
  try {
    return await pollForCondition(async () => {
      const active = await forum.threads.fetchActive();
      names = [...active.threads.values()].map((t) => t.name);
      return (
        active.threads.find(
          (t) =>
            t.name.endsWith(POLL_SUFFIX) && t.name.length > POLL_SUFFIX.length,
        ) ?? null
      );
    }, TIMEOUT_MS);
  } catch {
    return fail(
      `ROK-2272 S10: the first vote should create a "<title>${POLL_SUFFIX}" post`,
      names,
    );
  }
}

async function expectOnlyPollTag(
  forumId: string,
  post: ThreadChannel,
): Promise<void> {
  const forum = await getGuild().channels.fetch(forumId, { force: true });
  if (forum?.type !== ChannelType.GuildForum)
    return fail(`forum ${forumId}: not a forum channel`, forum?.type);
  const tags = forum.availableTags;
  const pollTag = tags.find((t) => t.name === "Poll");
  const applied = post.appliedTags.map(
    (id) => tags.find((t) => t.id === id)?.name ?? id,
  );
  if (
    !pollTag ||
    post.appliedTags.length !== 1 ||
    post.appliedTags[0] !== pollTag.id
  ) {
    fail(
      "ROK-2272 S10: a non-hub poll post carries ONLY the `Poll` tag",
      applied,
    );
  }
}

/** ROK-2295: the bot-authored starter is the live poll embed linking the poll. */
async function expectStarterLink(
  post: ThreadChannel,
  poll: Poll,
): Promise<void> {
  await expectPollStarterCard(post, poll, "bot");
}

/** The bot's (non-webhook) voter-ping lines for `me` in the post. */
async function pingLines(post: ThreadChannel, me: string): Promise<string[]> {
  const msgs = await post.messages.fetch({ limit: 50 });
  return msgs
    .filter(
      (m) =>
        m.author.bot &&
        !m.webhookId &&
        m.content.includes(`<@${me}>`) &&
        m.content.includes("voted"),
    )
    .map((m) => m.content);
}

async function changeVote(
  voter: FixtureUser,
  poll: Poll,
  slotId: number,
): Promise<void> {
  const res = await voter.api.post<{ stance?: unknown }>(
    `${schedulePath(poll)}/vote`,
    { slotId, stance: "no" },
  );
  if (res.stance !== "no")
    fail("vote change: expected stance 'no' (a non-null second vote)", res);
}

async function closePostAndSweep(ctx: TestContext, poll: Poll): Promise<void> {
  const closed = await ctx.api.post<{ postId?: unknown }>(
    `${FIXTURES}/polls/${String(poll.matchId)}/close-planning-post-now`,
    {},
  );
  if (typeof closed.postId !== "number")
    fail("close-planning-post-now: expected { postId }", closed);
  const res = await ctx.api.post<{ changed?: unknown }>(
    `${FIXTURES}/lock-sweep`,
    {},
  );
  // `changed` may be 0 if the 5-min cron got there first; the Discord state is the assertion.
  if (typeof res.changed !== "number")
    fail("lock-sweep fixture: expected { changed: number }", res);
}

/**
 * The organiser may lock in an OPEN poll only after voting on it
 * (`assertUserHasVoted`), and here the voter — not the admin — suggested.
 */
async function organiserVotes(
  ctx: TestContext,
  poll: Poll,
  slotId: number,
): Promise<void> {
  const res = await ctx.api.post<{ stance?: unknown }>(
    `${schedulePath(poll)}/vote`,
    { slotId, stance: "yes" },
  );
  if (res.stance !== "yes") fail("organiser vote: expected stance 'yes'", res);
}

/** Steps 3–5: the single ping survives a second vote; lock-in line; lock. */
async function pingThenLockIn(
  ctx: TestContext,
  voter: FixtureUser,
  poll: Poll,
  post: ThreadChannel,
  slotId: number,
  made: Made,
): Promise<void> {
  const me = ctx.testBotDiscordId;
  await expectInPost(
    post,
    `ROK-2295: expected one ping line "<@${me}> voted: <t:…>" listing slots`,
    (c, wh) =>
      !wh && c.includes(`<@${me}>`) && c.includes("voted") && c.includes("<t:"),
  );
  await changeVote(voter, poll, slotId);
  await expectInPost(
    post,
    `ROK-2295: the "<@${me}> voted" line should be edited in place to "no times right now"`,
    (c, wh) =>
      !wh && c.includes(`<@${me}>`) && c.includes("voted: no times right now"),
  );
  await organiserVotes(ctx, poll, slotId);
  const eventId = await lockIn(ctx, poll, slotId, made);
  const link = `/events/${String(eventId)}`;
  await expectInPost(
    post,
    `ROK-2272 S10: expected the lock-in closing line linking ${link}`,
    (c, wh) => !wh && c.includes("is happening!") && c.includes(link),
  );
  const lines = await pingLines(post, me);
  if (lines.length !== 1)
    fail(
      "ROK-2272 S10 R5: a voter is pinged once per post, not once per vote",
      lines,
    );
  await closePostAndSweep(ctx, poll);
  await expectLockedArchived(post.id);
}

async function nonHubPollPost(ctx: TestContext): Promise<void> {
  const runId = Date.now().toString(36);
  const made: Made = { hub: null, forum: null };
  let poll: Poll | null = null;
  let postId: string | null = null;
  let voter: FixtureUser | null = null;
  try {
    const { forum, gameId } = await setup(ctx, runId, made);
    await expectResolvedForum(ctx, forum.id);
    voter = await seedFixtureUser(ctx.api, 3, VOTER_SLOT);
    await linkDiscord(ctx.api, voter.userId, ctx.testBotDiscordId, BOT_NAME);
    poll = await createNonHubPoll(ctx, gameId);
    await expectNoPostYet(ctx, poll, forum);
    const slotId = await voterSuggests(voter, poll);
    const post = await expectPollPost(forum);
    postId = post.id;
    if (post.parentId !== forum.id)
      fail(
        `ROK-2272 S10: the post should be in forum ${forum.id}`,
        post.parentId,
      );
    await expectOnlyPollTag(forum.id, post);
    await expectStarterLink(post, poll);
    await pingThenLockIn(ctx, voter, poll, post, slotId, made);
  } finally {
    await cleanup(ctx, poll, postId);
    await teardown(ctx, made);
    // The bot's id goes back to the DM recipient. The fixture user is left
    // unlinked (its own fixture id is not linkable); the next seed re-creates it.
    await relinkDmRecipient(ctx);
  }
}

export const eventPlanningNonHubPollTests: SmokeTest[] = [
  {
    name: "event-planning: non-hub poll post — on first vote, Poll-tagged, one voter ping, lock-in line, locked after close (ROK-2272 S10)",
    category: "flow",
    serial: true,
    run: nonHubPollPost,
  },
];
