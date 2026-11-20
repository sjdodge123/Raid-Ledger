/**
 * ROK-2272 S10 (R5) — poll voter pings against a real database. A voter's
 * first committed vote pings them once (`🗳 <@id> voted`, allowedMentions =
 * that one user) into the poll's Discord post: the hub thread's post for a
 * hub poll, the registry post for a non-hub poll. A re-vote never pings
 * again, a second voter gets their own ping, a cleared tap pings nothing.
 * The service is driven directly (listener routing is unit-tested); every
 * poll has a real match in `scheduling` and real vote rows.
 */
import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import type { PollVotedPayload } from '../../../lineups/lineup-events.constants';
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
import {
  stubOutbound,
  type FakeOutbound,
} from './hub-forum-discord-outbound.test-fixtures';
import { HubForumDiscordPollVoterPings } from './hub-forum-discord-poll-voter-pings.service';
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
let pings: HubForumDiscordPollVoterPings;
/** Real (numeric) Discord ids for the two voters, unique per run. */
const discordIds = { signed: '', bench: '' };

const app = () => ctx.posts.testApp.app;
const db = () => ctx.posts.testApp.db;
const numericId = () => `9${BigInt(`0x${randomBytes(7).toString('hex')}`)}`;

beforeAll(async () => {
  ctx = await bootDiscussion('hfdvote');
  pings = app().get(HubForumDiscordPollVoterPings);
  for (const who of ['signed', 'bench'] as const) {
    discordIds[who] = numericId();
    await db()
      .update(schema.users)
      .set({ discordId: discordIds[who] })
      .where(eq(schema.users.id, ctx.ids[who]));
  }
});

beforeEach(() => {
  resetThrottles(ctx);
  app().get(PollDiscussionReplyThrottleGuard, { strict: false }).reset();
  fake = stubForumGateway(ctx.posts.testApp);
  out = stubOutbound(ctx.posts.testApp);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** A public poll (match in `scheduling`, one slot) that `voters` voted on. */
async function newPoll(guildId: number | null, voters: number[]) {
  const [l] = nonEmpty(
    await db()
      .insert(schema.communityLineups)
      .values({
        title: `S10 vote ${randomBytes(4).toString('hex')}`,
        phaseDurationOverride: { standalone: true },
        status: 'decided',
        visibility: 'public',
        createdBy: ctx.ids.admin,
        guildId,
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
  for (const userId of voters) {
    await db()
      .insert(schema.communityLineupScheduleVotes)
      .values({ slotId: slot.id, userId });
  }
  return { lineupId: l.id, matchId: m.id };
}

const voteBy = (
  poll: { lineupId: number; matchId: number },
  userId: number,
  stance: PollVotedPayload['stance'] = 'yes',
): PollVotedPayload => ({ ...poll, userId, stance });

const pingLine = (id: string) => `\u{1F5F3} <@${id}> voted`;

/** Every mention so far as [discordThreadId, content, userIds]. */
const mentions = () => out.spies.mention.mock.calls;

describe('ROK-2272 S10 voter pings — hub poll', () => {
  async function hubPollWithPost() {
    const guildId = await newHub(ctx.posts);
    await link(ctx.posts, guildId, ctx.ids.signed);
    const poll = await newPoll(guildId, [ctx.ids.signed, ctx.ids.bench]);
    const res = await ctx.posts.testApp.request
      .put(`/guilds/${guildId}/forum-discord`)
      .set('Authorization', `Bearer ${ctx.tokens.admin}`)
      .send({ mode: 'create', ack: true });
    expect(res.status).toBe(200);
    const open = await as(
      ctx,
      'signed',
      'get',
      `/scheduling-polls/${poll.matchId}/discussion`,
    );
    expect(outcome(open)).toEqual({ status: 200, message: undefined });
    return poll;
  }

  it('first vote creates the post and pings once; re-vote none; second voter one', async () => {
    const poll = await hubPollWithPost();
    expect(await pings.hubVote(voteBy(poll, ctx.ids.signed))).toBe('pinged');
    expect(out.spies.createPost).toHaveBeenCalledTimes(1);
    expect(mentions()).toHaveLength(1);
    const [[thread, line, users]] = nonEmpty(mentions(), 'mention');
    expect([line, users]).toEqual([
      pingLine(discordIds.signed),
      [discordIds.signed],
    ]);

    expect(await pings.hubVote(voteBy(poll, ctx.ids.signed, 'no'))).toBe(
      'already',
    );
    expect(mentions()).toHaveLength(1);

    expect(await pings.hubVote(voteBy(poll, ctx.ids.bench))).toBe('pinged');
    expect(mentions()).toHaveLength(2);
    expect(mentions()[1]).toEqual([
      thread,
      pingLine(discordIds.bench),
      [discordIds.bench],
    ]);
    expect(out.spies.createPost).toHaveBeenCalledTimes(1);
  });

  it('a cleared tap creates the post (S8) but pings nobody', async () => {
    const poll = await hubPollWithPost();
    const r = await pings.hubVote(voteBy(poll, ctx.ids.signed, null));
    expect(r).toBe('cleared');
    expect(out.spies.createPost).toHaveBeenCalledTimes(1);
    expect(mentions()).toHaveLength(0);
  });
});

describe('ROK-2272 S10 voter pings — non-hub poll (registry post)', () => {
  let createPost: jest.SpyInstance;

  beforeEach(async () => {
    const gw = app().get(EventPlanningPostsGateway);
    jest.spyOn(gw, 'isOnline').mockReturnValue(true);
    jest.spyOn(gw, 'renameThread').mockResolvedValue('ok');
    createPost = jest
      .spyOn(gw, 'createPost')
      .mockImplementation(() => Promise.resolve(snowflake()));
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
  });

  async function postRow(matchId: number) {
    const p = schema.eventPlanningPosts;
    const all = await db().select().from(p).where(eq(p.subjectId, matchId));
    const row = nonEmpty(
      all.filter((r) => r.subjectKind === 'poll'),
      'registry post',
    )[0];
    expect(all.filter((r) => r.subjectKind === 'poll')).toHaveLength(1);
    return row;
  }

  it('first vote creates the post and pings once; re-vote none; second voter one', async () => {
    const poll = await newPoll(null, [ctx.ids.signed, ctx.ids.bench]);
    expect(await pings.planningVote(voteBy(poll, ctx.ids.signed))).toBe(
      'pinged',
    );
    expect(createPost).toHaveBeenCalledTimes(1);
    const row = await postRow(poll.matchId);
    expect(mentions()).toEqual([
      [row.discordThreadId, pingLine(discordIds.signed), [discordIds.signed]],
    ]);

    expect(await pings.planningVote(voteBy(poll, ctx.ids.signed))).toBe(
      'already',
    );
    expect(await pings.planningVote(voteBy(poll, ctx.ids.bench))).toBe(
      'pinged',
    );
    expect(mentions()).toHaveLength(2);
    expect(mentions()[1]).toEqual([
      row.discordThreadId,
      pingLine(discordIds.bench),
      [discordIds.bench],
    ]);
    expect(createPost).toHaveBeenCalledTimes(1);
  });

  it('a cleared tap creates no post and pings nobody', async () => {
    const poll = await newPoll(null, [ctx.ids.signed]);
    const r = await pings.planningVote(voteBy(poll, ctx.ids.signed, null));
    expect(r).toBe('cleared');
    expect(createPost).not.toHaveBeenCalled();
    expect(mentions()).toHaveLength(0);
  });

  it('a hub poll never reaches the registry arm (arms are disjoint)', async () => {
    const guildId = await newHub(ctx.posts);
    const poll = await newPoll(guildId, [ctx.ids.signed]);
    const r = await pings.planningVote(voteBy(poll, ctx.ids.signed));
    expect(r).toBe('no-post');
    expect(createPost).not.toHaveBeenCalled();
    expect(mentions()).toHaveLength(0);
  });
});
