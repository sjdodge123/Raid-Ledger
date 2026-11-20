/**
 * ROK-2272 S8 — closing lines against a real database. A hub poll / lineup
 * thread whose Discord post exists gets ONE bot line when the poll locks in
 * or is cancelled, or the lineup is decided; a thread with no post gets no
 * line and no post. Discord is the in-memory gateway (`mention` spy).
 */
import { randomBytes } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { waitFor } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { LINEUP_EVENTS } from '../../../lineups/lineup-events.constants';
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
import { neutralise } from './hub-forum-discord-closing-lines';
import { CLOSING_LINE_COPY } from './hub-forum-discord-closing-lines.copy';
import {
  stubOutbound,
  type FakeOutbound,
} from './hub-forum-discord-outbound.test-fixtures';
import { HubForumDiscordSubjectListener } from './hub-forum-discord-subject.listener';
import { stubForumGateway } from './hub-forum-discord.test-fixtures';

const HOUR = 3_600_000;
let ctx: DiscussionCtx;
let out: FakeOutbound;

beforeAll(async () => {
  ctx = await bootDiscussion('hfdclose');
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
const app = () => ctx.posts.testApp.app;
const emit = (name: string, payload: object) =>
  app().get(EventEmitter2).emit(name, payload);
const listener = () => app().get(HubForumDiscordSubjectListener);
const pollRoute = (id: number) => `/scheduling-polls/${id}/discussion`;
const lineupRoute = (id: number) => `/lineups/${id}/discussion`;

/** A bound hub with `signed` as a member. */
async function boundHub(): Promise<number> {
  const guildId = await newHub(ctx.posts);
  await link(ctx.posts, guildId, ctx.ids.signed);
  const res = await ctx.posts.testApp.request
    .put(`/guilds/${guildId}/forum-discord`)
    .set('Authorization', `Bearer ${ctx.tokens.admin}`)
    .send({ mode: 'create', ack: true });
  expect(res.status).toBe(200);
  return guildId;
}

async function newLineup(guildId: number, status: 'voting' | 'decided') {
  const [l] = nonEmpty(
    await db()
      .insert(schema.communityLineups)
      .values({
        title: `S8 close ${randomBytes(4).toString('hex')}`,
        status,
        visibility: 'public',
        createdBy: ctx.ids.admin,
        guildId,
        publicSlug: randomBytes(8).toString('hex'),
      })
      .returning(),
    'lineup',
  );
  return l;
}

/** An open poll `signed` voted on; returns match + lineup ids. */
async function hubPoll(guildId: number) {
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
  return { matchId: m.id, lineupId: lineup.id };
}

/** Open the card's thread as `signed`; with `posted`, one reply creates its post. */
async function openThread(route: string, posted: boolean): Promise<number> {
  const res = await as(ctx, 'signed', 'get', route);
  expect(outcome(res)).toEqual({ status: 200, message: undefined });
  const t = schema.hubForumThreads;
  const id = Number(route.split('/')[2]);
  const where = route.startsWith('/lineups/')
    ? eq(t.lineupId, id)
    : eq(t.matchId, id);
  const [row] = nonEmpty(await db().select().from(t).where(where), 'thread');
  if (!posted) return row.id;
  const sent = await as(ctx, 'signed', 'post', `${route}/replies`, {
    body: 'Hi',
  });
  expect(outcome(sent).status).toBe(201);
  await waitFor(async () => {
    expect(out.spies.createReply).toHaveBeenCalledTimes(1);
    return Promise.resolve();
  });
  await settle(out.apply);
  return row.id;
}

async function newEvent(guildId: number, title: string): Promise<number> {
  const start = new Date(Date.now() + 24 * HOUR);
  const [e] = nonEmpty(
    await db()
      .insert(schema.events)
      .values({
        title,
        creatorId: ctx.ids.admin,
        gameId: ctx.posts.testApp.seed.game.id,
        guildId,
        duration: [start, new Date(start.getTime() + 2 * HOUR)] as [Date, Date],
      })
      .returning(),
    'event',
  );
  return e.id;
}

async function mentions(count: number): Promise<string[]> {
  await waitFor(async () => {
    expect(out.spies.mention).toHaveBeenCalledTimes(count);
    return Promise.resolve();
  });
  return out.spies.mention.mock.calls.map((c) => c[1]);
}

describe('ROK-2272 S8 closing lines in the Discord post', () => {
  it('a poll lock-in posts one event line; a second lock-in posts nothing', async () => {
    const guildId = await boundHub();
    const { matchId } = await hubPoll(guildId);
    await openThread(pollRoute(matchId), true);
    const eventId = await newEvent(guildId, 'Friday Raid');
    await db()
      .update(schema.communityLineupMatches)
      .set({ status: 'scheduled', linkedEventId: eventId })
      .where(eq(schema.communityLineupMatches.id, matchId));

    emit(LINEUP_MATCH_EVENTS.POLL_LOCKED_IN, { matchId, eventId });
    const [line] = nonEmpty(await mentions(1), 'lock-in line');
    expect(line).toMatch(/^\u{1F4C5} Friday Raid is happening! \u{2192} /u);
    expect(line.endsWith(`/events/${eventId}`)).toBe(true);
    const [call] = nonEmpty(out.spies.mention.mock.calls, 'mention');
    expect(call[2]).toEqual([]);

    emit(LINEUP_MATCH_EVENTS.POLL_LOCKED_IN, { matchId, eventId });
    await listener().onPollLockedIn({ matchId, eventId });
    expect(out.spies.mention).toHaveBeenCalledTimes(1);
  });

  it('a poll cancel with a reason posts the reason line', async () => {
    const guildId = await boundHub();
    const { matchId, lineupId } = await hubPoll(guildId);
    await openThread(pollRoute(matchId), true);
    emit(LINEUP_MATCH_EVENTS.POLL_CANCELLED, {
      matchId,
      lineupId,
      reason: 'Nobody free',
    });
    expect(await mentions(1)).toEqual(['Poll cancelled — Nobody free']);
  });

  it('a decided lineup posts the decided line with its game and link', async () => {
    const guildId = await boundHub();
    const lineup = await newLineup(guildId, 'voting');
    await db().insert(schema.communityLineupEntries).values({
      lineupId: lineup.id,
      gameId: ctx.posts.testApp.seed.game.id,
      nominatedBy: ctx.ids.signed,
    });
    await openThread(lineupRoute(lineup.id), true);
    await db()
      .update(schema.communityLineups)
      .set({ decidedGameId: ctx.posts.testApp.seed.game.id })
      .where(eq(schema.communityLineups.id, lineup.id));
    emit(LINEUP_EVENTS.DECIDED, { lineupId: lineup.id });
    const [line] = nonEmpty(await mentions(1), 'decided line');
    const game = neutralise(ctx.posts.testApp.seed.game.name);
    expect(line.startsWith(`\u{1F3C6} Decided: ${game} \u{2192} `)).toBe(true);
    expect(line.endsWith(`/community-lineup/${lineup.id}`)).toBe(true);
  });

  it('a thread with no Discord post gets no line and no post', async () => {
    const guildId = await boundHub();
    const { matchId, lineupId } = await hubPoll(guildId);
    const threadId = await openThread(pollRoute(matchId), false);
    await listener().onPollCancelled({ matchId, lineupId, reason: null });
    expect(out.spies.mention).not.toHaveBeenCalled();
    expect(out.spies.createPost).not.toHaveBeenCalled();
    const l = schema.hubForumDiscordLinks;
    expect(await db().select().from(l).where(eq(l.threadId, threadId))).toEqual(
      [],
    );
    expect(CLOSING_LINE_COPY.pollCancelled).toBe('Poll cancelled');
  });
});
