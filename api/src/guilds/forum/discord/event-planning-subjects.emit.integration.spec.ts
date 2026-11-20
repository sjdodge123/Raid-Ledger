/**
 * ROK-2272 S10 (review MINOR-5) — the real S6 lifecycle events driven
 * through the app's `EventEmitter2` with real DI: BOTH subject listeners
 * (`EventPlanningSubjectsListener` for the registry path,
 * `HubForumDiscordSubjectListener` for the hub path) receive every emit.
 * Handlers are `{ async: true }` (fire-and-forget), so each case spies the
 * service methods the listeners call (calls go through to the real code)
 * and awaits every promise they returned before asserting — no sleeps.
 */
import { randomBytes } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, eq } from 'drizzle-orm';
import { waitFor } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import {
  LINEUP_LIFECYCLE_EVENTS,
  type LineupStatusChangedPayload,
  type PollCancelledPayload,
  type PollVotedPayload,
} from '../../../lineups/lineup-events.constants';
import { LINEUP_MATCH_EVENTS } from '../../../lineups/lineups-scheduling-hook.helpers';
import { link, newHub } from '../../posts/hub-posts.test-fixtures';
import {
  as,
  bootDiscussion,
  outcome,
  resetThrottles,
  type DiscussionCtx,
} from '../event-discussion/event-discussion.test-fixtures';
import { PollDiscussionReplyThrottleGuard } from '../subject-discussion/poll-discussion-throttle.guard';
import { EventPlanningForumResolver } from './event-planning-forum.resolver';
import { EventPlanningPostsGateway } from './event-planning-posts.discord';
import { EventPlanningSubjectPosts } from './event-planning-posts.subjects';
import { CLOSING_LINE_COPY } from './hub-forum-discord-closing-lines.copy';
import { HubForumDiscordClosingLines } from './hub-forum-discord-closing-lines.service';
import {
  stubOutbound,
  type FakeOutbound,
} from './hub-forum-discord-outbound.test-fixtures';
import { HubForumDiscordPollVoterPings } from './hub-forum-discord-poll-voter-pings.service';
import { subjectPostTitle } from './hub-forum-discord-subject';
import {
  FAKE_DISCORD_GUILD,
  snowflake,
  stubForumGateway,
  type FakeDiscord,
} from './hub-forum-discord.test-fixtures';

const HOUR = 3_600_000;
let ctx: DiscussionCtx;
let out: FakeOutbound;
let fake: FakeDiscord;
let createPlanningPost: jest.SpyInstance;
let discordId = '';

const app = () => ctx.posts.testApp.app;
const db = () => ctx.posts.testApp.db;
const emitter = () => app().get(EventEmitter2);
const pings = () => app().get(HubForumDiscordPollVoterPings);
const subjects = () => app().get(EventPlanningSubjectPosts);

beforeAll(async () => {
  ctx = await bootDiscussion('evplem');
  discordId = `9${BigInt(`0x${randomBytes(7).toString('hex')}`)}`;
  await db()
    .update(schema.users)
    .set({ discordId })
    .where(eq(schema.users.id, ctx.ids.signed));
});

beforeEach(async () => {
  resetThrottles(ctx);
  app().get(PollDiscussionReplyThrottleGuard, { strict: false }).reset();
  fake = stubForumGateway(ctx.posts.testApp);
  out = stubOutbound(ctx.posts.testApp);
  const gw = app().get(EventPlanningPostsGateway);
  jest.spyOn(gw, 'isOnline').mockReturnValue(true);
  jest.spyOn(gw, 'renameThread').mockResolvedValue('ok');
  createPlanningPost = jest
    .spyOn(gw, 'createPost')
    .mockImplementation(() => Promise.resolve(snowflake()));
  await pinPlanningForum();
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function pinPlanningForum(): Promise<void> {
  const channelId = fake.put({ tags: [] }).id;
  const [f] = nonEmpty(
    await db()
      .insert(schema.hubForumDiscordForums)
      .values({ discordGuildId: FAKE_DISCORD_GUILD, channelId })
      .returning(),
    'forum',
  );
  const forum = { forumId: f.id, channelId, managed: true, webhookId: null };
  jest
    .spyOn(app().get(EventPlanningForumResolver), 'resolve')
    .mockResolvedValue({ forum, candidates: [], warning: null });
}

/** Wait until every spy was called, then for every promise it returned. */
async function settled(...spies: jest.SpyInstance[]): Promise<void> {
  await waitFor(async () => {
    for (const spy of spies) expect(spy).toHaveBeenCalled();
    return Promise.resolve();
  });
  for (const spy of spies) {
    const results: { value: unknown }[] = spy.mock.results;
    await Promise.allSettled(results.map((r) => r.value));
  }
}

async function newLineup(opts: {
  standalone: boolean;
  status: 'voting' | 'decided';
  guildId?: number | null;
}): Promise<{ id: number; title: string }> {
  const title = `S10 emit ${randomBytes(4).toString('hex')}`;
  const [l] = nonEmpty(
    await db()
      .insert(schema.communityLineups)
      .values({
        title,
        phaseDurationOverride: opts.standalone ? { standalone: true } : null,
        status: opts.status,
        visibility: 'public',
        createdBy: ctx.ids.admin,
        guildId: opts.guildId ?? null,
        publicSlug: randomBytes(8).toString('hex'),
      })
      .returning(),
    'lineup',
  );
  await db().insert(schema.communityLineupEntries).values({
    lineupId: l.id,
    gameId: ctx.posts.testApp.seed.game.id,
    nominatedBy: ctx.ids.signed,
  });
  return { id: l.id, title };
}

/** A public standalone poll in `scheduling` with the signed user's vote. */
async function newPoll(guildId: number | null) {
  const lineup = await newLineup({
    standalone: true,
    status: 'decided',
    guildId,
  });
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
  return { lineupId: lineup.id, matchId: m.id };
}

async function registryRows(kind: 'poll' | 'lineup', subjectId: number) {
  const p = schema.eventPlanningPosts;
  return db()
    .select()
    .from(p)
    .where(and(eq(p.subjectKind, kind), eq(p.subjectId, subjectId)));
}

async function emitVote(poll: { lineupId: number; matchId: number }) {
  const hub = jest.spyOn(pings(), 'hubVote');
  const planning = jest.spyOn(pings(), 'planningVote');
  const payload: PollVotedPayload = {
    ...poll,
    userId: ctx.ids.signed,
    stance: 'yes',
  };
  emitter().emit(LINEUP_MATCH_EVENTS.POLL_VOTED, payload);
  await settled(hub, planning);
}

const mentions = () => out.spies.mention.mock.calls;

describe('ROK-2272 S10 emit — POLL_VOTED through both listeners', () => {
  it('5a: a non-hub poll vote makes ONE registry post and ONE mention', async () => {
    const poll = await newPoll(null);
    await emitVote(poll);
    expect(createPlanningPost).toHaveBeenCalledTimes(1);
    const [row] = nonEmpty(await registryRows('poll', poll.matchId), 'row');
    expect(await registryRows('poll', poll.matchId)).toHaveLength(1);
    expect(mentions()).toEqual([
      [row.discordThreadId, `\u{1F5F3} <@${discordId}> voted`, [discordId]],
    ]);
  });

  it('5b: a hub poll vote makes ONE mention in total and NO registry row', async () => {
    const guildId = await newHub(ctx.posts);
    await link(ctx.posts, guildId, ctx.ids.signed);
    const poll = await newPoll(guildId);
    const bound = await ctx.posts.testApp.request
      .put(`/guilds/${guildId}/forum-discord`)
      .set('Authorization', `Bearer ${ctx.tokens.admin}`)
      .send({ mode: 'create', ack: true });
    expect(bound.status).toBe(200);
    const route = `/scheduling-polls/${poll.matchId}/discussion`;
    const open = await as(ctx, 'signed', 'get', route);
    expect(outcome(open)).toEqual({ status: 200, message: undefined });
    await emitVote(poll);
    expect(mentions()).toHaveLength(1);
    const [[, line, users]] = nonEmpty(mentions(), 'mention');
    expect([line, users]).toEqual([
      `\u{1F5F3} <@${discordId}> voted`,
      [discordId],
    ]);
    expect(createPlanningPost).not.toHaveBeenCalled();
    expect(await registryRows('poll', poll.matchId)).toEqual([]);
  });
});

describe('ROK-2272 S10 emit — POLL_CANCELLED through both listeners', () => {
  it('5d: one closing line and closes_at ≈ now + 1 h on the registry post', async () => {
    const poll = await newPoll(null);
    const ref = await subjects().ensurePollPost(poll.matchId);
    if (!ref) throw new Error('expected a registry poll post');
    const m = schema.communityLineupMatches;
    await db()
      .update(m)
      .set({ status: 'archived' })
      .where(eq(m.id, poll.matchId));
    const closing = jest.spyOn(
      app().get(HubForumDiscordClosingLines),
      'pollCancelled',
    );
    const sync = jest.spyOn(subjects(), 'syncPoll');
    const before = Date.now();
    const payload: PollCancelledPayload = { ...poll, reason: 'Nobody free' };
    emitter().emit(LINEUP_MATCH_EVENTS.POLL_CANCELLED, payload);
    await settled(closing, sync);
    const after = Date.now();
    expect(mentions()).toEqual([
      [
        ref.discordThreadId,
        CLOSING_LINE_COPY.pollCancelledReason.replace(
          '{reason}',
          'Nobody free',
        ),
        [],
      ],
    ]);
    const [row] = nonEmpty(await registryRows('poll', poll.matchId), 'row');
    const closesAt = row.closesAt?.getTime() ?? 0;
    expect(closesAt).toBeGreaterThanOrEqual(before + HOUR - 1000);
    expect(closesAt).toBeLessThanOrEqual(after + HOUR + 1000);
  });
});

describe('ROK-2272 S10 emit — lineup STATUS_CHANGED building → voting', () => {
  async function emitFlip(lineupId: number, standalone: boolean) {
    const sync = jest.spyOn(subjects(), 'syncLineup');
    const payload: LineupStatusChangedPayload = {
      lineupId,
      from: 'building',
      to: 'voting',
      standalone,
      visibility: 'public',
      guildId: null,
    };
    emitter().emit(LINEUP_LIFECYCLE_EVENTS.STATUS_CHANGED, payload);
    await settled(sync);
  }

  it('5c: a real lineup gets its `— Lineup` post', async () => {
    const lineup = await newLineup({ standalone: false, status: 'voting' });
    await emitFlip(lineup.id, false);
    expect(await registryRows('lineup', lineup.id)).toHaveLength(1);
    expect(createPlanningPost).toHaveBeenCalledTimes(1);
    expect(createPlanningPost).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        title: subjectPostTitle('lineup', lineup.title),
      }),
    );
  });

  it("5c: a standalone carrier's flip makes no post", async () => {
    const lineup = await newLineup({ standalone: true, status: 'voting' });
    await emitFlip(lineup.id, true);
    expect(await registryRows('lineup', lineup.id)).toEqual([]);
    expect(createPlanningPost).not.toHaveBeenCalled();
  });
});
