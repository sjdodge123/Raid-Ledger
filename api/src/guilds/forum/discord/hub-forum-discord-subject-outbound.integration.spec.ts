/**
 * ROK-2272 S8 — scheduling-poll and lineup threads outbound against a real
 * database. Like an event thread, a poll/lineup thread gets no Discord post
 * when it is created; its first live RL reply creates the post (titled
 * `<title> — Poll|Lineup`, kind tag requested from the gateway) and the reply
 * lands in it. A thread created before the hub was bound still posts (its
 * sync is born with its post link); a closed poll thread never posts.
 * Discord is the in-memory gateway.
 */
import { randomBytes } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { waitFor } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { LINEUP_MATCH_EVENTS } from '../../../lineups/lineups-scheduling-hook.helpers';
import { link, newHub, settle } from '../../posts/hub-posts.test-fixtures';
import {
  as,
  bootDiscussion,
  outcome,
  resetThrottles,
  type DiscussionCtx,
} from '../event-discussion/event-discussion.test-fixtures';
import { LineupDiscussionReplyThrottleGuard } from '../subject-discussion/lineup-discussion-throttle.guard';
import { PollDiscussionReplyThrottleGuard } from '../subject-discussion/poll-discussion-throttle.guard';
import {
  stubOutbound,
  type FakeOutbound,
} from './hub-forum-discord-outbound.test-fixtures';
import { subjectPostTitle } from './hub-forum-discord-subject';
import { stubForumGateway } from './hub-forum-discord.test-fixtures';

const HOUR = 3_600_000;
let ctx: DiscussionCtx;
let out: FakeOutbound;

beforeAll(async () => {
  ctx = await bootDiscussion('hfdsubj');
});

beforeEach(() => {
  resetThrottles(ctx);
  const app = ctx.posts.testApp.app;
  app.get(PollDiscussionReplyThrottleGuard, { strict: false }).reset();
  app.get(LineupDiscussionReplyThrottleGuard, { strict: false }).reset();
  stubForumGateway(ctx.posts.testApp);
  out = stubOutbound(ctx.posts.testApp);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const db = () => ctx.posts.testApp.db;
const pollRoute = (id: number) => `/scheduling-polls/${id}/discussion`;
const lineupRoute = (id: number) => `/lineups/${id}/discussion`;

async function bind(guildId: number): Promise<void> {
  const res = await ctx.posts.testApp.request
    .put(`/guilds/${guildId}/forum-discord`)
    .set('Authorization', `Bearer ${ctx.tokens.admin}`)
    .send({ mode: 'create', ack: true });
  expect(res.status).toBe(200);
}

/** A hub with `signed` as a member; returns its id. */
async function hubWithSigned(): Promise<number> {
  const guildId = await newHub(ctx.posts);
  await link(ctx.posts, guildId, ctx.ids.signed);
  return guildId;
}

async function newLineup(
  guildId: number,
  status: 'voting' | 'decided',
): Promise<{ id: number; title: string }> {
  const [l] = nonEmpty(
    await db()
      .insert(schema.communityLineups)
      .values({
        title: `S8 lineup ${randomBytes(4).toString('hex')}`,
        status,
        visibility: 'public',
        createdBy: ctx.ids.admin,
        guildId,
        publicSlug: randomBytes(8).toString('hex'),
      })
      .returning(),
    'lineup',
  );
  return { id: l.id, title: l.title };
}

/** An open public poll in `guildId` that `signed` voted on; returns the match id. */
async function hubPoll(guildId: number): Promise<number> {
  const lineup = await newLineup(guildId, 'decided');
  const [m] = nonEmpty(
    await db()
      .insert(schema.communityLineupMatches)
      .values({
        lineupId: lineup.id,
        gameId: ctx.posts.testApp.seed.game.id,
        status: 'scheduling',
      })
      .returning(),
    'match',
  );
  const [slot] = nonEmpty(
    await db()
      .insert(schema.communityLineupScheduleSlots)
      .values({
        matchId: m.id,
        proposedTime: new Date(Date.now() + 24 * HOUR),
        suggestedBy: 'system',
      })
      .returning(),
    'slot',
  );
  await db()
    .insert(schema.communityLineupScheduleVotes)
    .values({ slotId: slot.id, userId: ctx.ids.signed });
  return m.id;
}

/** An open public lineup in `guildId` that `signed` nominated in. */
async function hubLineup(guildId: number) {
  const lineup = await newLineup(guildId, 'voting');
  await db().insert(schema.communityLineupEntries).values({
    lineupId: lineup.id,
    gameId: ctx.posts.testApp.seed.game.id,
    nominatedBy: ctx.ids.signed,
  });
  return lineup;
}

/** GET the card as `signed` (lazily creates the thread); returns the thread. */
async function openThread(route: string) {
  const res = await as(ctx, 'signed', 'get', route);
  expect(outcome(res)).toEqual({ status: 200, message: undefined });
  const t = schema.hubForumThreads;
  const where = route.startsWith('/lineups/')
    ? eq(t.lineupId, Number(route.split('/')[2]))
    : eq(t.matchId, Number(route.split('/')[2]));
  const [row] = nonEmpty(await db().select().from(t).where(where), 'thread');
  return row;
}

/** Reply as `signed` and wait for the outbound sync to apply it. */
async function reply(route: string, body: string, calls: number) {
  const res = await as(ctx, 'signed', 'post', `${route}/replies`, { body });
  expect(outcome(res).status).toBe(201);
  await waitFor(async () => {
    expect(out.apply).toHaveBeenCalledTimes(calls);
    return Promise.resolve();
  });
  await settle(out.apply);
}

async function threadLinks(threadId: number) {
  const l = schema.hubForumDiscordLinks;
  return db().select().from(l).where(eq(l.threadId, threadId));
}

async function bindingTagIds(guildId: number): Promise<string[]> {
  const b = schema.hubForumDiscordBindings;
  const [row] = nonEmpty(
    await db().select().from(b).where(eq(b.guildId, guildId)),
    'binding',
  );
  return row.tagId ? [row.tagId] : [];
}

/** The post created, its link, and the first reply sent into it. */
async function expectPostThenReply(threadId: number, replyBody: string) {
  expect(out.spies.createPost).toHaveBeenCalledTimes(1);
  const [[, post, author]] = nonEmpty(
    out.spies.createPost.mock.calls,
    'createPost',
  );
  expect(author.username).toBe('Raid Ledger');
  const [postLink] = nonEmpty(await threadLinks(threadId), 'post link');
  expect(postLink).toMatchObject({ kind: 'thread', syncState: 'synced' });
  const [first] = nonEmpty(out.spies.createReply.mock.calls, 'createReply');
  expect([first[1], first[2]]).toEqual([postLink.discordThreadId, replyBody]);
  return post;
}

describe('ROK-2272 S8 poll / lineup threads → Discord', () => {
  it('a poll thread: no post at creation; the first reply creates "<game> — Poll", the second reuses it', async () => {
    const guildId = await hubWithSigned();
    const matchId = await hubPoll(guildId);
    await bind(guildId);
    const thread = await openThread(pollRoute(matchId));
    expect(out.spies.createPost).not.toHaveBeenCalled();
    expect(await threadLinks(thread.id)).toEqual([]);

    await reply(pollRoute(matchId), 'When works?', 1);
    const post = await expectPostThenReply(thread.id, 'When works?');
    const game = ctx.posts.testApp.seed.game.name;
    expect(post).toMatchObject({
      title: subjectPostTitle('poll', game),
      kind: 'poll',
      tagIds: await bindingTagIds(guildId),
    });
    expect(post.content).toContain(`/schedule/${matchId})`);

    await reply(pollRoute(matchId), 'Friday!', 2);
    expect(out.spies.createPost).toHaveBeenCalledTimes(1);
    expect(out.spies.createReply).toHaveBeenCalledTimes(2);
  });

  it('a lineup thread: the first reply creates "<title> — Lineup" with the Lineup kind', async () => {
    const guildId = await hubWithSigned();
    const lineup = await hubLineup(guildId);
    await bind(guildId);
    const thread = await openThread(lineupRoute(lineup.id));
    await reply(lineupRoute(lineup.id), 'Nominated!', 1);
    const post = await expectPostThenReply(thread.id, 'Nominated!');
    expect(post).toMatchObject({
      title: subjectPostTitle('lineup', lineup.title),
      kind: 'lineup',
      tagIds: await bindingTagIds(guildId),
    });
  });
});

describe('ROK-2272 S8 poll thread post edges', () => {
  it('syncBornAt: a poll thread created before the hub was bound is still posted', async () => {
    const guildId = await hubWithSigned();
    const matchId = await hubPoll(guildId);
    const thread = await openThread(pollRoute(matchId));
    await db()
      .update(schema.hubForumThreads)
      .set({ createdAt: new Date(Date.now() - 2 * HOUR) })
      .where(eq(schema.hubForumThreads.id, thread.id));
    await bind(guildId);
    await reply(pollRoute(matchId), 'Late bind', 1);
    await expectPostThenReply(thread.id, 'Late bind');
  });

  it('the first vote creates the poll post (no reply needed, no mention)', async () => {
    const guildId = await hubWithSigned();
    const matchId = await hubPoll(guildId);
    await bind(guildId);
    const thread = await openThread(pollRoute(matchId));
    expect(out.spies.createPost).not.toHaveBeenCalled();
    const lineupId = nonEmpty(
      await db()
        .select({ id: schema.communityLineupMatches.lineupId })
        .from(schema.communityLineupMatches)
        .where(eq(schema.communityLineupMatches.id, matchId)),
      'match',
    )[0].id;
    ctx.posts.testApp.app
      .get(EventEmitter2)
      .emit(LINEUP_MATCH_EVENTS.POLL_VOTED, {
        matchId,
        lineupId,
        userId: ctx.ids.signed,
        stance: null,
      });
    await waitFor(async () => {
      const [postLink] = nonEmpty(await threadLinks(thread.id), 'post link');
      expect(postLink).toMatchObject({ kind: 'thread', syncState: 'synced' });
    });
    expect(out.spies.createPost).toHaveBeenCalledTimes(1);
    const [[, post]] = nonEmpty(out.spies.createPost.mock.calls, 'createPost');
    expect(post).toMatchObject({ kind: 'poll' });
    expect(out.spies.mention).not.toHaveBeenCalled();
    expect(out.spies.createReply).not.toHaveBeenCalled();
  });

  it('a closed poll thread never posts', async () => {
    const guildId = await hubWithSigned();
    const matchId = await hubPoll(guildId);
    await bind(guildId);
    const thread = await openThread(pollRoute(matchId));
    await db()
      .update(schema.hubForumThreads)
      .set({ writeClosesAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.hubForumThreads.id, thread.id));
    const posted = await out.service.ensureEventPost({
      guildId,
      threadId: thread.id,
    });
    expect(posted).toBeNull();
    expect(out.spies.createPost).not.toHaveBeenCalled();
    expect(await threadLinks(thread.id)).toEqual([]);
  });
});
