/**
 * ROK-2272 S7a — the R7 poll-thread matrix through the R10 routes against a
 * real database: read (card) / reply, the read-only lock (deadline passed),
 * private and hub-less polls (404). Each test builds its own hub + poll.
 * Actors (from the event fixtures): `signed` = hub member who voted,
 * `tentative` = hub member who has not voted, `pug` = voter outside the hub,
 * `bench` = match member who has not voted, `outsider` = neither.
 */
import { randomBytes } from 'crypto';
import type { SubjectDiscussion } from '@raid-ledger/contract';
import { eq } from 'drizzle-orm';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { link, newHub } from '../../posts/hub-posts.test-fixtures';
import {
  FORUM_EVENT_THREAD_MANAGED,
  FORUM_THREAD_READ_ONLY,
} from '../event-discussion/event-discussion.access';
import {
  as,
  bootDiscussion,
  outcome,
  resetThrottles,
  type Actor,
  type DiscussionCtx,
} from '../event-discussion/event-discussion.test-fixtures';
import { PollDiscussionReplyThrottleGuard } from './poll-discussion-throttle.guard';
import { FORUM_NOT_POLL_VOTER } from './poll-discussion.access';
import { POLL_NOT_FOUND } from './poll-discussion.service';

let ctx: DiscussionCtx;

beforeAll(async () => {
  ctx = await bootDiscussion('polldisc');
});

beforeEach(() => {
  resetThrottles(ctx);
  const app = ctx.posts.testApp.app;
  app.get(PollDiscussionReplyThrottleGuard, { strict: false }).reset();
});

const db = () => ctx.posts.testApp.db;
const route = (matchId: number) => `/scheduling-polls/${matchId}/discussion`;

interface PollOpts {
  guildId: number | null;
  visibility?: 'public' | 'private';
}

async function newPoll(opts: PollOpts): Promise<number> {
  const [l] = nonEmpty(
    await db()
      .insert(schema.communityLineups)
      .values({
        title: `Poll access ${Date.now()}`,
        status: 'decided',
        visibility: opts.visibility ?? 'public',
        createdBy: ctx.ids.admin,
        guildId: opts.guildId,
        publicSlug: randomBytes(8).toString('hex'),
      })
      .returning(),
    'lineup',
  );
  const [m] = nonEmpty(
    await db()
      .insert(schema.communityLineupMatches)
      .values({
        lineupId: l.id,
        gameId: ctx.posts.testApp.seed.game.id,
        status: 'scheduling',
      })
      .returning(),
    'match',
  );
  return m.id;
}

/** `signed` + `pug` vote; `bench` joins the match without voting. */
async function seedParticipants(matchId: number): Promise<void> {
  const [slot] = nonEmpty(
    await db()
      .insert(schema.communityLineupScheduleSlots)
      .values({
        matchId,
        proposedTime: new Date(Date.now() + 86_400_000),
        suggestedBy: 'system',
      })
      .returning(),
    'slot',
  );
  for (const who of ['signed', 'pug'] as const) {
    await db()
      .insert(schema.communityLineupScheduleVotes)
      .values({ slotId: slot.id, userId: ctx.ids[who] });
  }
  await db()
    .insert(schema.communityLineupMatchMembers)
    .values({ matchId, userId: ctx.ids.bench, source: 'added' });
}

/** A hub (members: `signed`, `tentative`) with an open public poll. */
async function hubPoll(): Promise<number> {
  const guildId = await newHub(ctx.posts);
  for (const who of ['signed', 'tentative'] as const) {
    await link(ctx.posts, guildId, ctx.ids[who]);
  }
  const matchId = await newPoll({ guildId });
  await seedParticipants(matchId);
  return matchId;
}

/** Move the poll's match to `status` (`scheduled` = decided, R6 close). */
async function setMatchStatus(
  matchId: number,
  status: 'scheduling' | 'scheduled',
): Promise<void> {
  await db()
    .update(schema.communityLineupMatches)
    .set({ status })
    .where(eq(schema.communityLineupMatches.id, matchId));
}

/** Decide the poll, then backdate the stamped deadline so the lock holds. */
async function closePoll(matchId: number): Promise<void> {
  await setMatchStatus(matchId, 'scheduled');
  await db()
    .update(schema.hubForumThreads)
    .set({ writeClosesAt: new Date(Date.now() - 60_000) })
    .where(eq(schema.hubForumThreads.matchId, matchId));
}

async function card(matchId: number, who: Actor): Promise<SubjectDiscussion> {
  const res = await as(ctx, who, 'get', route(matchId));
  expect(outcome(res)).toEqual({ status: 200, message: undefined });
  return res.body as SubjectDiscussion;
}

const replyAs = (matchId: number, who: Actor) =>
  as(ctx, who, 'post', `${route(matchId)}/replies`, { body: 'hi' });

/** The hub-route path of the poll's live thread (create it with a GET first). */
async function hubThreadPath(matchId: number): Promise<string> {
  const [t] = nonEmpty(
    await db()
      .select()
      .from(schema.hubForumThreads)
      .where(eq(schema.hubForumThreads.matchId, matchId)),
    'poll thread',
  );
  return `/guilds/${t.guildId}/forum/${t.id}`;
}

describe('scheduling-poll discussion access (R7, R10)', () => {
  it('a hub member who voted reads and replies; the GET lazily creates the thread', async () => {
    const matchId = await hubPoll();
    const c = await card(matchId, 'signed');
    expect(c).toMatchObject({
      state: 'ready',
      kind: 'poll',
      can: { read: true, reply: true },
      member: true,
    });
    expect(outcome(await replyAs(matchId, 'signed')).status).toBe(201);
    const after = await card(matchId, 'signed');
    expect(after.state === 'ready' && after.replyCount).toBe(1);
  });

  it('a hub member who has not voted reads but may not reply (403)', async () => {
    const matchId = await hubPoll();
    expect(await card(matchId, 'tentative')).toMatchObject({
      can: { read: true, reply: false },
    });
    expect(outcome(await replyAs(matchId, 'tentative'))).toEqual({
      status: 403,
      message: FORUM_NOT_POLL_VOTER,
    });
  });

  it('a voter or match member outside the hub reads and replies; a visitor does neither', async () => {
    const matchId = await hubPoll();
    for (const who of ['pug', 'bench'] as const) {
      expect(await card(matchId, who)).toMatchObject({
        can: { read: true, reply: true },
        member: false,
      });
      expect(outcome(await replyAs(matchId, who)).status).toBe(201);
    }
    expect(await card(matchId, 'outsider')).toMatchObject({
      can: { read: false, reply: false },
      latestReplies: [],
    });
    expect(outcome(await replyAs(matchId, 'outsider'))).toEqual({
      status: 403,
      message: FORUM_NOT_POLL_VOTER,
    });
  });
});

describe('scheduling-poll discussion refusals (R7, §3.7)', () => {
  it('signed-out callers get 401', async () => {
    const matchId = await hubPoll();
    const res = await ctx.posts.testApp.request.get(route(matchId));
    expect(res.status).toBe(401);
  });

  it('a closed thread (deadline passed) reads but refuses replies (409)', async () => {
    const matchId = await hubPoll();
    await card(matchId, 'signed');
    await closePoll(matchId);
    const c = await card(matchId, 'signed');
    expect(c).toMatchObject({ can: { read: true, reply: false } });
    expect(c.state === 'ready' && c.lock?.reason).toBe('event-ended');
    expect(outcome(await replyAs(matchId, 'signed'))).toEqual({
      status: 409,
      message: FORUM_THREAD_READ_ONLY,
    });
  });

  it('reopening a decided poll clears the deadline: replies are allowed again', async () => {
    const matchId = await hubPoll();
    await card(matchId, 'signed');
    await closePoll(matchId);
    expect(outcome(await replyAs(matchId, 'signed')).status).toBe(409);
    await setMatchStatus(matchId, 'scheduling');
    const c = await card(matchId, 'signed');
    expect(c).toMatchObject({ can: { read: true, reply: true } });
    expect(c.state === 'ready' && c.lock).toBeNull();
    expect(outcome(await replyAs(matchId, 'signed')).status).toBe(201);
  });

  it('an unknown match id is 404 on both routes (no existence leak)', async () => {
    const route404 = { status: 404, message: POLL_NOT_FOUND };
    const missing = 2_000_000_000;
    expect(outcome(await as(ctx, 'signed', 'get', route(missing)))).toEqual(
      route404,
    );
    expect(outcome(await replyAs(missing, 'signed'))).toEqual(route404);
  });

  it('a private poll and a hub-less poll are 404 on both routes', async () => {
    const guildId = await newHub(ctx.posts);
    const priv = await newPoll({ guildId, visibility: 'private' });
    const noHub = await newPoll({ guildId: null });
    for (const matchId of [priv, noHub]) {
      const notFound = { status: 404, message: POLL_NOT_FOUND };
      expect(outcome(await as(ctx, 'signed', 'get', route(matchId)))).toEqual(
        notFound,
      );
      expect(outcome(await replyAs(matchId, 'signed'))).toEqual(notFound);
    }
  });
});

describe('scheduling-poll thread through the hub forum routes (§5.5, R7)', () => {
  it.each<Actor>(['admin', 'officerA'])(
    '%s (creator / hub officer) cannot PATCH or DELETE the root (403 managed)',
    async (who) => {
      const matchId = await hubPoll();
      await card(matchId, 'signed');
      const path = await hubThreadPath(matchId);
      const managed = { status: 403, message: FORUM_EVENT_THREAD_MANAGED };
      const patch = await as(ctx, who, 'patch', path, { body: 'x' });
      expect(outcome(patch)).toEqual(managed);
      expect(outcome(await as(ctx, who, 'delete', path))).toEqual(managed);
      const still = await db()
        .select()
        .from(schema.hubForumThreads)
        .where(eq(schema.hubForumThreads.matchId, matchId));
      expect(still.map((t) => t.deletedAt)).toEqual([null]);
    },
  );

  it('R7 holds on the hub reply route: a voter posts (201), a non-voting member is 403', async () => {
    const matchId = await hubPoll();
    await card(matchId, 'signed');
    const replies = `${await hubThreadPath(matchId)}/replies`;
    const post = (who: Actor) => as(ctx, who, 'post', replies, { body: 'x' });
    expect(outcome(await post('signed')).status).toBe(201);
    expect(outcome(await post('tentative'))).toEqual({
      status: 403,
      message: FORUM_NOT_POLL_VOTER,
    });
  });
});
