/**
 * ROK-2272 S8 (R7, R11) — the inbound Discord write gate on poll and lineup
 * threads against a real database. Poll: a voter or a match member without a
 * vote imports; anyone else is refused with exactly one DM per (thread,
 * user). Lineup: a nominator (carried-over entries included) or a voter
 * imports. A closed thread drops silently. Each test builds its own subject.
 */
import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { nonEmpty } from '../../../common/testing/narrow';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import * as schema from '../../../drizzle/schema';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import {
  bootPostsApp,
  newHub,
  type PostsCtx,
} from '../../posts/hub-posts.test-fixtures';
import {
  HubForumDiscordEventGate,
  eventNoticeKey,
} from './hub-forum-discord-event-gate';

let ctx: PostsCtx;
let gate: HubForumDiscordEventGate;
let dm: jest.SpyInstance;
let seq = 0;

beforeAll(async () => {
  ctx = await bootPostsApp('hfdsg');
  gate = ctx.testApp.app.get(HubForumDiscordEventGate);
});

beforeEach(() => {
  const client = ctx.testApp.app.get(DiscordBotClientService);
  dm = jest.spyOn(client, 'sendEmbedDM').mockResolvedValue(undefined);
});

afterEach(() => jest.restoreAllMocks());

const db = () => ctx.testApp.db;
const gameId = () => ctx.testApp.seed.game.id;

/** A user with a linked Discord account; returns both ids. */
async function discordUser(): Promise<{ id: number; discordId: string }> {
  seq += 1;
  const discordId = `hfdsg-${Date.now()}-${seq}`;
  const [u] = nonEmpty(
    await db()
      .insert(schema.users)
      .values({ discordId, username: `hfdsg-${Date.now()}-${seq}` })
      .returning(),
    'user',
  );
  return { id: u.id, discordId };
}

async function newLineup(guildId: number): Promise<number> {
  const [l] = nonEmpty(
    await db()
      .insert(schema.communityLineups)
      .values({
        title: `Gate lineup ${Date.now()}`,
        status: 'voting',
        visibility: 'public',
        createdBy: ctx.userIds.officerA,
        guildId,
        publicSlug: randomBytes(8).toString('hex'),
      })
      .returning(),
    'lineup',
  );
  return l.id;
}

async function newMatch(lineupId: number): Promise<number> {
  const [m] = nonEmpty(
    await db()
      .insert(schema.communityLineupMatches)
      .values({ lineupId, gameId: gameId(), status: 'scheduling' })
      .returning(),
    'match',
  );
  return m.id;
}

type Subject = { matchId: number } | { lineupId: number };

async function newThread(
  guildId: number,
  subject: Subject,
  writeClosesAt: Date | null = null,
): Promise<number> {
  const [t] = nonEmpty(
    await db()
      .insert(schema.hubForumThreads)
      .values({
        guildId,
        authorId: ctx.userIds.officerA,
        title: 'Subject thread',
        body: 'Subject body',
        writeClosesAt,
        ...subject,
      })
      .returning(),
    'thread',
  );
  return t.id;
}

async function vote(matchId: number, userId: number): Promise<void> {
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
  await db()
    .insert(schema.communityLineupScheduleVotes)
    .values({ slotId: slot.id, userId });
}

/** A hub with an open poll and its thread. */
async function pollThread(closes: Date | null = null) {
  const guildId = await newHub(ctx);
  const lineupId = await newLineup(guildId);
  const matchId = await newMatch(lineupId);
  const threadId = await newThread(guildId, { matchId }, closes);
  return { guildId, lineupId, matchId, threadId };
}

describe('ROK-2272 S8 — poll thread write gate', () => {
  it('imports a voter without a DM', async () => {
    const p = await pollThread();
    const u = await discordUser();
    await vote(p.matchId, u.id);
    expect(await gate.admits({ threadId: p.threadId }, u.discordId)).toBe(true);
    expect(dm).not.toHaveBeenCalled();
  });

  it('imports a match member who has not voted', async () => {
    const p = await pollThread();
    const u = await discordUser();
    await db()
      .insert(schema.communityLineupMatchMembers)
      .values({ matchId: p.matchId, userId: u.id, source: 'added' });
    expect(await gate.admits({ threadId: p.threadId }, u.discordId)).toBe(true);
  });

  it('refuses a non-voter and DMs them exactly once with the poll link', async () => {
    const p = await pollThread();
    const u = await discordUser();
    const post = { threadId: p.threadId };
    expect(await gate.admits(post, u.discordId)).toBe(false);
    expect(await gate.admits(post, u.discordId)).toBe(false);
    expect(dm).toHaveBeenCalledTimes(1);
    expect(dm.mock.calls[0]?.[1]).toMatchObject({
      data: {
        description: expect.stringMatching(
          new RegExp(
            `^Only players who voted in .+ can post in its discussion\\. Join Raid Ledger and vote: \\S+/community-lineup/${p.lineupId}/schedule/${p.matchId}$`,
          ),
        ),
      },
    });
    const redis = ctx.testApp.app.get<Redis>(REDIS_CLIENT);
    expect(await redis.get(eventNoticeKey(p.threadId, u.discordId))).toBe('1');
  });

  it('refuses an unlinked Discord user (no anonymous path for polls)', async () => {
    const p = await pollThread();
    const stranger = `hfdsg-anon-${Date.now()}`;
    expect(await gate.admits({ threadId: p.threadId }, stranger)).toBe(false);
    expect(dm).toHaveBeenCalledTimes(1);
  });

  it('drops a message in a closed poll thread without a DM', async () => {
    const p = await pollThread(new Date(Date.now() - 60_000));
    const u = await discordUser();
    expect(await gate.admits({ threadId: p.threadId }, u.discordId)).toBe(
      false,
    );
    expect(dm).not.toHaveBeenCalled();
  });
});

describe('ROK-2272 S8 review — detached poll thread', () => {
  it('drops a message in a DETACHED poll thread without a DM, even from a voter', async () => {
    const p = await pollThread();
    await db()
      .update(schema.hubForumThreads)
      .set({ eventDetachedAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.hubForumThreads.id, p.threadId));
    const voter = await discordUser();
    await vote(p.matchId, voter.id);
    const stranger = await discordUser();
    const post = { threadId: p.threadId };
    expect(await gate.admits(post, voter.discordId)).toBe(false);
    expect(await gate.admits(post, stranger.discordId)).toBe(false);
    expect(dm).not.toHaveBeenCalled();
  });
});

/** A hub with an open lineup and its thread. */
async function lineupThread() {
  const guildId = await newHub(ctx);
  const lineupId = await newLineup(guildId);
  const threadId = await newThread(guildId, { lineupId });
  return { guildId, lineupId, threadId };
}

describe('ROK-2272 S8 — lineup thread write gate', () => {
  it('imports a nominator', async () => {
    const l = await lineupThread();
    const u = await discordUser();
    await db()
      .insert(schema.communityLineupEntries)
      .values({ lineupId: l.lineupId, gameId: gameId(), nominatedBy: u.id });
    expect(await gate.admits({ threadId: l.threadId }, u.discordId)).toBe(true);
    expect(dm).not.toHaveBeenCalled();
  });

  it('imports the original nominator of a carried-over entry', async () => {
    const l = await lineupThread();
    const previous = await newLineup(l.guildId);
    const u = await discordUser();
    await db().insert(schema.communityLineupEntries).values({
      lineupId: l.lineupId,
      gameId: gameId(),
      nominatedBy: u.id,
      carriedOverFrom: previous,
    });
    expect(await gate.admits({ threadId: l.threadId }, u.discordId)).toBe(true);
  });

  it('imports a voter who nominated nothing', async () => {
    const l = await lineupThread();
    const nominator = await discordUser();
    const voter = await discordUser();
    await db().insert(schema.communityLineupEntries).values({
      lineupId: l.lineupId,
      gameId: gameId(),
      nominatedBy: nominator.id,
    });
    await db()
      .insert(schema.communityLineupVotes)
      .values({ lineupId: l.lineupId, gameId: gameId(), userId: voter.id });
    expect(await gate.admits({ threadId: l.threadId }, voter.discordId)).toBe(
      true,
    );
  });

  it('refuses an outsider with the lineup DM', async () => {
    const l = await lineupThread();
    const u = await discordUser();
    expect(await gate.admits({ threadId: l.threadId }, u.discordId)).toBe(
      false,
    );
    expect(dm).toHaveBeenCalledTimes(1);
    expect(dm.mock.calls[0]?.[1]).toMatchObject({
      data: {
        description: expect.stringMatching(
          new RegExp(
            `^Only players who nominated or voted in Gate lineup \\d+ can post in its discussion\\. Join Raid Ledger and take part: \\S+/community-lineup/${l.lineupId}$`,
          ),
        ),
      },
    });
  });
});
