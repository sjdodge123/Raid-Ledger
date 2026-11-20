/**
 * ROK-2272 S10 — Discord-only posts for NON-HUB polls and lineups against a
 * real database. Discord is spied on (forum gateway + bot gateway) and the
 * resolver is pinned to a fresh forum row per test, as in the S4a spec. The
 * service is driven directly (the listener routing is unit-tested), so a
 * subject's state is set on its rows instead of through votes / nominations.
 */
import { randomBytes } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { newHub } from '../../posts/hub-posts.test-fixtures';
import {
  bootDiscussion,
  type DiscussionCtx,
} from '../event-discussion/event-discussion.test-fixtures';
import { EventPlanningForumResolver } from './event-planning-forum.resolver';
import { EventPlanningPostsGateway } from './event-planning-posts.discord';
import { EventPlanningSubjectPosts } from './event-planning-posts.subjects';
import { LINEUP_TAG_NAME, POLL_TAG_NAME } from './hub-forum-discord-decor';
import {
  FAKE_DISCORD_GUILD,
  snowflake,
  stubForumGateway,
  type FakeDiscord,
} from './hub-forum-discord.test-fixtures';

const HOUR = 3_600_000;

let ctx: DiscussionCtx;
let subjects: EventPlanningSubjectPosts;
let fake: FakeDiscord;
let channelId: string;
let createPost: jest.SpyInstance;
let seq = 0;

const app = () => ctx.posts.testApp.app;
const db = () => ctx.posts.testApp.db;

function stubPlanning(): jest.SpyInstance {
  const gw = app().get(EventPlanningPostsGateway);
  jest.spyOn(gw, 'isOnline').mockReturnValue(true);
  jest.spyOn(gw, 'renameThread').mockResolvedValue('ok');
  jest.spyOn(gw, 'deleteThread').mockResolvedValue('ok');
  return jest
    .spyOn(gw, 'createPost')
    .mockImplementation(() => Promise.resolve(snowflake()));
}

async function pinForum(): Promise<void> {
  channelId = fake.put({ tags: [] }).id;
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

interface LineupOver {
  guildId?: number;
  visibility?: 'public' | 'private';
  standalone?: boolean;
  status?: 'building' | 'voting' | 'decided' | 'archived';
  phaseDeadline?: Date | null;
}

async function newLineup(over: LineupOver = {}): Promise<number> {
  seq += 1;
  const [l] = nonEmpty(
    await db()
      .insert(schema.communityLineups)
      .values({
        title: `Planning subject ${seq}`,
        phaseDurationOverride:
          over.standalone === false ? null : { standalone: true },
        status: over.status ?? 'decided',
        visibility: over.visibility ?? 'public',
        createdBy: ctx.ids.creator,
        guildId: over.guildId ?? null,
        phaseDeadline: over.phaseDeadline ?? null,
        publicSlug: randomBytes(8).toString('hex'),
      })
      .returning(),
    'lineup',
  );
  return l.id;
}

/** A standalone poll (match in `scheduling`) on a fresh carrier lineup. */
async function newPoll(over: LineupOver = {}) {
  const lineupId = await newLineup(over);
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
  return { lineupId, matchId: m.id, title: `Planning subject ${seq}` };
}

async function setMatch(
  matchId: number,
  status: 'scheduling' | 'scheduled' | 'archived',
) {
  const m = schema.communityLineupMatches;
  await db().update(m).set({ status }).where(eq(m.id, matchId));
}

async function setLineup(lineupId: number, set: LineupOver) {
  const l = schema.communityLineups;
  await db().update(l).set(set).where(eq(l.id, lineupId));
}

async function rows(kind: 'poll' | 'lineup', subjectId: number) {
  const p = schema.eventPlanningPosts;
  return db()
    .select()
    .from(p)
    .where(and(eq(p.subjectKind, kind), eq(p.subjectId, subjectId)));
}

async function only(kind: 'poll' | 'lineup', subjectId: number) {
  const all = await rows(kind, subjectId);
  expect(all).toHaveLength(1);
  return nonEmpty(all, 'post row')[0];
}

const tagId = (name: string) =>
  fake.forums.get(channelId)?.tags.find((t) => t.name === name)?.id;

beforeAll(async () => {
  ctx = await bootDiscussion('evplsub');
  subjects = app().get(EventPlanningSubjectPosts);
});

beforeEach(async () => {
  fake = stubForumGateway(ctx.posts.testApp);
  createPost = stubPlanning();
  await pinForum();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ROK-2272 S10 non-hub poll posts', () => {
  it('first vote creates ONE `— Poll` post with the Poll tag and no closes_at', async () => {
    const { matchId, lineupId, title } = await newPoll();
    const first = await subjects.ensurePollPost(matchId);
    const second = await subjects.ensurePollPost(matchId);
    expect(second).toEqual(first);
    expect(createPost).toHaveBeenCalledTimes(1);
    expect(createPost).toHaveBeenCalledWith(channelId, {
      title: `${title} — Poll`,
      content: expect.stringContaining(
        `/community-lineup/${lineupId}/schedule/${matchId}`,
      ) as string,
      tagIds: [tagId(POLL_TAG_NAME)],
    });
    const row = await only('poll', matchId);
    expect(row.closesAt).toBeNull();
    expect(first?.postId).toBe(row.id);
  });

  it.each([
    ['hub-tagged', async () => newPoll({ guildId: await newHub(ctx.posts) })],
    ['private', () => newPoll({ visibility: 'private' })],
  ])('a %s poll gets no registry post', async (_, make) => {
    const { matchId } = await make();
    expect(await subjects.ensurePollPost(matchId)).toBeNull();
    expect(createPost).not.toHaveBeenCalled();
    expect(await rows('poll', matchId)).toEqual([]);
  });
});

describe('ROK-2272 S10 non-hub poll post closes_at', () => {
  it('lock-in stamps now + 1 h; a reopen clears it', async () => {
    const { matchId } = await newPoll();
    await subjects.ensurePollPost(matchId);
    const now = new Date();
    await setMatch(matchId, 'scheduled');
    await subjects.syncPoll(matchId, now);
    expect((await only('poll', matchId)).closesAt?.getTime()).toBe(
      now.getTime() + HOUR,
    );
    await setMatch(matchId, 'scheduling');
    await subjects.syncPoll(matchId, new Date());
    expect((await only('poll', matchId)).closesAt).toBeNull();
  });

  it('cancel stamps now + 1 h', async () => {
    const { matchId } = await newPoll();
    await subjects.ensurePollPost(matchId);
    const now = new Date();
    await setMatch(matchId, 'archived');
    await subjects.syncPoll(matchId, now);
    expect((await only('poll', matchId)).closesAt?.getTime()).toBe(
      now.getTime() + HOUR,
    );
  });

  it('a public → private flip makes the post due now (R6)', async () => {
    const { matchId, lineupId } = await newPoll();
    await subjects.ensurePollPost(matchId);
    await setLineup(lineupId, { visibility: 'private' });
    const now = new Date();
    await subjects.syncPoll(matchId, now);
    const closesAt = (await only('poll', matchId)).closesAt;
    expect(closesAt?.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it('syncOpenPolls stamps phase_deadline + 1 h for an expired poll', async () => {
    const { matchId, lineupId } = await newPoll();
    await subjects.ensurePollPost(matchId);
    const deadline = new Date(Date.now() - 2 * HOUR);
    await setLineup(lineupId, { phaseDeadline: deadline });
    expect(await subjects.syncOpenPolls(new Date())).toBeGreaterThanOrEqual(1);
    expect((await only('poll', matchId)).closesAt?.getTime()).toBe(
      deadline.getTime() + HOUR,
    );
  });
});

describe('ROK-2272 S10 non-hub lineup posts', () => {
  it('a lineup in voting gets a `— Lineup` post; decided stamps now + 1 h', async () => {
    const lineupId = await newLineup({ standalone: false, status: 'voting' });
    expect(await subjects.ensureLineupPost(lineupId)).not.toBeNull();
    expect(createPost).toHaveBeenCalledWith(channelId, {
      title: `Planning subject ${seq} — Lineup`,
      content: expect.stringContaining(
        `/community-lineup/${lineupId}`,
      ) as string,
      tagIds: [tagId(LINEUP_TAG_NAME)],
    });
    expect((await only('lineup', lineupId)).closesAt).toBeNull();
    await setLineup(lineupId, { status: 'decided' });
    const now = new Date();
    await subjects.syncLineup(lineupId, now);
    expect((await only('lineup', lineupId)).closesAt?.getTime()).toBe(
      now.getTime() + HOUR,
    );
  });

  it.each<[string, LineupOver]>([
    ['standalone-carrier', { standalone: true, status: 'voting' }],
    ['building', { standalone: false, status: 'building' }],
    ['private', { standalone: false, status: 'voting', visibility: 'private' }],
  ])('a %s lineup gets no post', async (_, over) => {
    const lineupId = await newLineup(over);
    expect(await subjects.ensureLineupPost(lineupId)).toBeNull();
    expect(createPost).not.toHaveBeenCalled();
    expect(await rows('lineup', lineupId)).toEqual([]);
  });

  it('a hub-tagged lineup gets no post', async () => {
    const guildId = await newHub(ctx.posts);
    const lineupId = await newLineup({
      standalone: false,
      status: 'voting',
      guildId,
    });
    expect(await subjects.ensureLineupPost(lineupId)).toBeNull();
    expect(createPost).not.toHaveBeenCalled();
  });
});
