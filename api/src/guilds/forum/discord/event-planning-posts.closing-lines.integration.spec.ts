/**
 * ROK-2272 S10 — closing lines on registry (non-hub, Discord-only) planning
 * posts against a real database and Redis. The registry post is created
 * through `EventPlanningSubjectPosts` with the planning gateway spied; the
 * closing line goes through the outbound gateway (`mention` spied). The
 * service is driven directly: emit → handler routing is unit-tested in the
 * subject listener spec. Copy is S8's `CLOSING_LINE_COPY`, unchanged.
 */
import { randomBytes } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import {
  bootDiscussion,
  type DiscussionCtx,
} from '../event-discussion/event-discussion.test-fixtures';
import { EventPlanningForumResolver } from './event-planning-forum.resolver';
import { EventPlanningPostsGateway } from './event-planning-posts.discord';
import { EventPlanningSubjectPosts } from './event-planning-posts.subjects';
import { CLOSING_LINE_COPY } from './hub-forum-discord-closing-lines.copy';
import { HubForumDiscordClosingLines } from './hub-forum-discord-closing-lines.service';
import { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';
import {
  FAKE_DISCORD_GUILD,
  snowflake,
  stubForumGateway,
} from './hub-forum-discord.test-fixtures';

const HOUR = 3_600_000;

let ctx: DiscussionCtx;
let subjects: EventPlanningSubjectPosts;
let closing: HubForumDiscordClosingLines;
let mention: jest.SpyInstance;
let createPost: jest.SpyInstance;
let seq = 0;

const app = () => ctx.posts.testApp.app;
const db = () => ctx.posts.testApp.db;

async function pinForum(): Promise<void> {
  const fake = stubForumGateway(ctx.posts.testApp);
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

function stubDiscord(): void {
  const gw = app().get(EventPlanningPostsGateway);
  jest.spyOn(gw, 'isOnline').mockReturnValue(true);
  jest.spyOn(gw, 'renameThread').mockResolvedValue('ok');
  createPost = jest
    .spyOn(gw, 'createPost')
    .mockImplementation(() => Promise.resolve(snowflake()));
  const out = app().get(HubForumDiscordOutboundGateway);
  jest.spyOn(out, 'isOnline').mockReturnValue(true);
  mention = jest
    .spyOn(out, 'mention')
    .mockImplementation(() => Promise.resolve(snowflake()));
  // ROK-2295: a voted line may be re-worded in place; never reach Discord.
  jest.spyOn(out, 'editBotMessage').mockResolvedValue('ok');
}

async function newLineup(standalone: boolean, status: 'voting' | 'decided') {
  seq += 1;
  const [l] = nonEmpty(
    await db()
      .insert(schema.communityLineups)
      .values({
        title: `Closing subject ${seq}`,
        phaseDurationOverride: standalone ? { standalone: true } : null,
        status,
        visibility: 'public',
        createdBy: ctx.ids.creator,
        guildId: null,
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
  return l.id;
}

/** A non-hub standalone poll in `scheduling` with one vote on one slot. */
async function newPoll(): Promise<number> {
  const lineupId = await newLineup(true, 'decided');
  const [m] = nonEmpty(
    await db()
      .insert(schema.communityLineupMatches)
      .values({
        lineupId,
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

async function newEvent(title: string): Promise<number> {
  const start = new Date(Date.now() + 24 * HOUR);
  const [e] = nonEmpty(
    await db()
      .insert(schema.events)
      .values({
        title,
        creatorId: ctx.ids.admin,
        gameId: ctx.posts.testApp.seed.game.id,
        duration: [start, new Date(start.getTime() + 2 * HOUR)] as [Date, Date],
      })
      .returning(),
    'event',
  );
  return e.id;
}

async function planningRows(kind: 'poll' | 'lineup', subjectId: number) {
  const p = schema.eventPlanningPosts;
  return db()
    .select()
    .from(p)
    .where(and(eq(p.subjectKind, kind), eq(p.subjectId, subjectId)));
}

/** Flip the poll's storage lineup visibility directly (R6 private flip). */
async function setLineupVisibilityOfMatch(
  matchId: number,
  visibility: 'public' | 'private',
): Promise<void> {
  const m = schema.communityLineupMatches;
  const [row] = nonEmpty(
    await db()
      .select({ lineupId: m.lineupId })
      .from(m)
      .where(eq(m.id, matchId)),
    'match',
  );
  const l = schema.communityLineups;
  await db().update(l).set({ visibility }).where(eq(l.id, row.lineupId));
}

const lines = (): unknown[] => mention.mock.calls.map((c: unknown[]) => c[1]);

beforeAll(async () => {
  ctx = await bootDiscussion('evplcl');
  subjects = app().get(EventPlanningSubjectPosts);
  closing = app().get(HubForumDiscordClosingLines);
});

beforeEach(async () => {
  stubDiscord();
  await pinForum();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ROK-2272 S10 closing lines on non-hub poll posts', () => {
  it('lock-in posts exactly one `is happening!` line into the registry post', async () => {
    const matchId = await newPoll();
    const ref = await subjects.ensurePollPost(matchId);
    if (!ref) throw new Error('expected a registry poll post');
    const eventId = await newEvent('Closing Raid');
    const m = schema.communityLineupMatches;
    await db()
      .update(m)
      .set({ status: 'scheduled', linkedEventId: eventId })
      .where(eq(m.id, matchId));
    await closing.pollLockedIn(matchId, eventId);
    await closing.pollLockedIn(matchId, eventId);
    expect(mention).toHaveBeenCalledTimes(1);
    const [call] = nonEmpty(mention.mock.calls, 'mention');
    expect(call[0]).toBe(ref.discordThreadId);
    expect(call[1]).toEqual(
      expect.stringMatching(
        /^📅 Closing Raid is happening! → .*\/events\/\d+$/,
      ),
    );
    expect(call[2]).toEqual([]);
  });

  it('cancel with a reason posts the reason line', async () => {
    const matchId = await newPoll();
    expect(await subjects.ensurePollPost(matchId)).not.toBeNull();
    await closing.pollCancelled(matchId, 'Nobody free');
    expect(lines()).toEqual([
      CLOSING_LINE_COPY.pollCancelledReason.replace('{reason}', 'Nobody free'),
    ]);
  });

  it('a poll made private after its post exists gets no closing line (MINOR-2)', async () => {
    const matchId = await newPoll();
    expect(await subjects.ensurePollPost(matchId)).not.toBeNull();
    await setLineupVisibilityOfMatch(matchId, 'private');
    await closing.pollCancelled(matchId, 'Nobody free');
    expect(mention).not.toHaveBeenCalled();
    await setLineupVisibilityOfMatch(matchId, 'public');
    await closing.pollCancelled(matchId, 'Nobody free');
    expect(mention).toHaveBeenCalledTimes(1);
  });

  it('no registry post: no line, and no post is created to close it', async () => {
    const matchId = await newPoll();
    await closing.pollCancelled(matchId, null);
    const lineupId = await newLineup(false, 'decided');
    await closing.lineupDecided(lineupId);
    expect(mention).not.toHaveBeenCalled();
    expect(createPost).not.toHaveBeenCalled();
    expect(await planningRows('poll', matchId)).toEqual([]);
    expect(await planningRows('lineup', lineupId)).toEqual([]);
  });
});

describe('ROK-2272 S10 closing lines on non-hub lineup posts', () => {
  it('a lineup made private after its post exists gets no decided line (MINOR-2)', async () => {
    const lineupId = await newLineup(false, 'voting');
    expect(await subjects.ensureLineupPost(lineupId)).not.toBeNull();
    const l = schema.communityLineups;
    await db()
      .update(l)
      .set({
        status: 'decided',
        visibility: 'private',
        decidedGameId: ctx.posts.testApp.seed.game.id,
      })
      .where(eq(l.id, lineupId));
    await closing.lineupDecided(lineupId);
    expect(mention).not.toHaveBeenCalled();
  });

  it('decided posts the `🏆 Decided:` line once', async () => {
    const lineupId = await newLineup(false, 'voting');
    const ref = await subjects.ensureLineupPost(lineupId);
    if (!ref) throw new Error('expected a registry lineup post');
    const l = schema.communityLineups;
    await db()
      .update(l)
      .set({ status: 'decided', decidedGameId: ctx.posts.testApp.seed.game.id })
      .where(eq(l.id, lineupId));
    await closing.lineupDecided(lineupId);
    await closing.lineupDecided(lineupId);
    expect(mention).toHaveBeenCalledTimes(1);
    const [line] = nonEmpty(lines(), 'decided line');
    expect(line).toEqual(
      expect.stringMatching(
        new RegExp(`^🏆 Decided: .+ → .*/community-lineup/${lineupId}$`),
      ),
    );
  });
});
