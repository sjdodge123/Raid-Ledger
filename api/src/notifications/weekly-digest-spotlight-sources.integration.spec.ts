/**
 * ROK-1771 L3 — spotlight candidate reads against a real database.
 * Per kind: data present → the candidate with the right facts; no data →
 * null; an opted-out member (`show_activity = false`) is never counted or
 * named. Seed helpers mirror `weekly-digest.integration.spec.ts`.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import {
  fetchBossKillsCandidate,
  fetchCommonGroundCandidate,
  fetchMarathonCandidate,
  fetchRisingGameCandidate,
} from './weekly-digest-spotlight-sources.helpers';
import { fetchDuoCandidate } from './weekly-digest-spotlight-duo.helpers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let seq = 0;

function ago(ms: number): Date {
  return new Date(Date.now() - ms);
}

/** `YYYY-MM-DD` for `days` days ago (rollup `period_start`). */
function dateAgo(days: number): string {
  return ago(days * DAY)
    .toISOString()
    .slice(0, 10);
}

/** Per-user overrides: guild-seen (default now), inactive stamps, name. */
type UserRow = {
  guildMemberSeenAt?: Date | null;
  deactivatedAt?: Date;
  bannedAt?: Date;
  kickedAt?: Date;
  displayName?: string;
};

async function seedUser(
  t: TestApp,
  tag: string,
  optOut = false,
  row: UserRow = {},
) {
  seq += 1;
  const [u] = nonEmpty(
    await t.db
      .insert(schema.users)
      .values({
        discordId: `d:sp-${tag}-${seq}`,
        username: tag,
        role: 'member',
        guildMemberSeenAt: new Date(),
        ...row,
      })
      .returning(),
    'user',
  );
  if (optOut) {
    await t.db
      .insert(schema.userPreferences)
      .values({ userId: u.id, key: 'show_activity', value: false });
  }
  return u.id;
}

/** One deactivated, one banned and one kicked member (AC10). */
async function seedGone(t: TestApp): Promise<number[]> {
  const at = new Date();
  return [
    await seedUser(t, 'gone-deactivated', false, { deactivatedAt: at }),
    await seedUser(t, 'gone-banned', false, { bannedAt: at }),
    await seedUser(t, 'gone-kicked', false, { kickedAt: at }),
  ];
}

async function seedGame(t: TestApp, name: string): Promise<number> {
  seq += 1;
  const [g] = nonEmpty(
    await t.db
      .insert(schema.games)
      .values({ name, slug: `sp-game-${seq}` })
      .returning(),
    'game',
  );
  return g.id;
}

async function seedEvent(
  t: TestApp,
  creatorId: number,
  title: string,
  duration: [Date, Date],
): Promise<number> {
  const [e] = nonEmpty(
    await t.db
      .insert(schema.events)
      .values({ title, creatorId, duration })
      .returning(),
    'event',
  );
  return e.id;
}

async function seedAttended(t: TestApp, eventId: number, userId: number) {
  await t.db
    .insert(schema.eventSignups)
    .values({ eventId, userId, attendanceStatus: 'attended' });
}

function useApp(): { t: TestApp; creatorId: number } {
  const ctx = {} as { t: TestApp; creatorId: number };
  beforeAll(async () => {
    ctx.t = await getTestApp();
  });
  beforeEach(async () => {
    ctx.creatorId = await seedUser(ctx.t, 'creator');
  });
  afterEach(async () => {
    ctx.t.seed = await truncateAllTables(ctx.t.db);
  });
  return ctx;
}

async function seedRollup(
  t: TestApp,
  userId: number,
  gameId: number,
  daysAgo: number,
  hours: number,
) {
  await t.db.insert(schema.gameActivityRollups).values({
    userId,
    gameId,
    period: 'day',
    periodStart: dateAgo(daysAgo),
    totalSeconds: hours * 3600,
  });
}

describe('A1 rising game (ROK-1771 L3, integration)', () => {
  const ctx = useApp();

  it('returns null without presence rollups', async () => {
    await expect(fetchRisingGameCandidate(ctx.t.db)).resolves.toBeNull();
  });

  it('reports this vs prior week hours, excluding an opted-out member', async () => {
    const { t } = ctx;
    const game = await seedGame(t, 'Valheim');
    const a = await seedUser(t, 'alice');
    const b = await seedUser(t, 'bob');
    const hidden = await seedUser(t, 'hidden', true);
    await seedRollup(t, a, game, 2, 3);
    await seedRollup(t, b, game, 3, 3);
    await seedRollup(t, a, game, 10, 1);
    await seedRollup(t, hidden, game, 2, 20);
    await expect(fetchRisingGameCandidate(t.db)).resolves.toEqual({
      kind: 'rising_game',
      game: { gameId: game, name: 'Valheim' },
      hoursThisWeek: 6,
      hoursPriorWeek: 1,
      playerCount: 2,
    });
  });
});

async function seedPull(
  t: TestApp,
  gameId: number,
  p: { encounterId: number; name: string; endAgo: number; success?: boolean },
) {
  seq += 1;
  const endAt = ago(p.endAgo);
  await t.db.insert(schema.addonEncounterPulls).values({
    gameId,
    region: 'us',
    encounterId: p.encounterId,
    encounterName: p.name,
    difficultyId: 9,
    groupSize: 40,
    instanceId: 409,
    startAt: new Date(endAt.getTime() - 5 * 60_000),
    endAt,
    success: p.success ?? true,
    roster: [{ guid: 'Player-1-0001', name: 'Secretcharname' }],
    guildKey: 'the guild',
    payloadSha256: String(seq).padStart(64, '0'),
  });
}

describe('A3 boss kills (ROK-1771 L3, integration)', () => {
  const ctx = useApp();

  it('returns null when the only kill is older than the window', async () => {
    const wow = await seedGame(ctx.t, 'WoW Classic');
    await seedPull(ctx.t, wow, {
      encounterId: 663,
      name: 'Lucifron',
      endAgo: 20 * DAY,
    });
    await expect(fetchBossKillsCandidate(ctx.t.db)).resolves.toBeNull();
  });

  it('counts this week’s kills, flags first-ever ones, never roster names', async () => {
    const { t } = ctx;
    const wow = await seedGame(t, 'WoW Classic');
    await seedPull(t, wow, {
      encounterId: 663,
      name: 'Lucifron',
      endAgo: 20 * DAY,
    });
    await seedPull(t, wow, {
      encounterId: 663,
      name: 'Lucifron',
      endAgo: 2 * DAY,
    });
    await seedPull(t, wow, { encounterId: 664, name: 'Magmadar', endAgo: DAY });
    await seedPull(t, wow, {
      encounterId: 665,
      name: 'Gehennas',
      endAgo: DAY,
      success: false,
    });
    const c = await fetchBossKillsCandidate(t.db);
    expect(c).toEqual({
      kind: 'boss_kills',
      instanceName: null,
      killCount: 2,
      firstEverKills: ['Magmadar'],
    });
    expect(JSON.stringify(c)).not.toContain('Secretcharname');
  });
});

interface LineupOpts {
  decidedAgo: number;
  visibility?: 'public' | 'private';
  standalone?: boolean;
}

async function seedDecidedLineup(
  t: TestApp,
  creatorId: number,
  winner: number,
  opts: LineupOpts,
): Promise<number> {
  seq += 1;
  const [l] = nonEmpty(
    await t.db
      .insert(schema.communityLineups)
      .values({
        title: `Lineup ${seq}`,
        status: 'decided',
        visibility: opts.visibility ?? 'public',
        decidedGameId: winner,
        createdBy: creatorId,
        publicSlug: `sp-l-${seq}`,
        phaseDurationOverride: opts.standalone ? { standalone: true } : null,
      })
      .returning(),
    'lineup',
  );
  await t.db.insert(schema.notificationDedup).values({
    dedupKey: `lineup-decided:${l.id}`,
    createdAt: ago(opts.decidedAgo),
  });
  return l.id;
}

async function seedVotes(
  t: TestApp,
  lineupId: number,
  gameId: number,
  voters: readonly number[],
) {
  for (const userId of voters) {
    await t.db
      .insert(schema.communityLineupVotes)
      .values({ lineupId, userId, gameId });
  }
}

describe('A4 Common Ground result (ROK-1771 L3, integration)', () => {
  const ctx = useApp();

  async function seedScenario(opts: LineupOpts) {
    const { t, creatorId } = ctx;
    const win = await seedGame(t, 'Deep Rock Galactic');
    const second = await seedGame(t, 'Valheim');
    const voters = await Promise.all(
      ['v1', 'v2', 'v3', 'v4', 'v5'].map((tag) => seedUser(t, tag)),
    );
    const lineupId = await seedDecidedLineup(t, creatorId, win, opts);
    await seedVotes(t, lineupId, win, voters.slice(0, 3));
    await seedVotes(t, lineupId, second, voters.slice(3));
    return { win, second, lineupId };
  }

  it('reports a lineup decided this week with winner, total and runner-up', async () => {
    const { win, second, lineupId } = await seedScenario({ decidedAgo: DAY });
    await expect(fetchCommonGroundCandidate(ctx.t.db)).resolves.toEqual({
      kind: 'common_ground',
      lineupId,
      winner: { gameId: win, name: 'Deep Rock Galactic', votes: 3 },
      totalVotes: 5,
      runnerUp: { gameId: second, name: 'Valheim', votes: 2 },
    });
  });

  it('returns null for a lineup decided last week', async () => {
    await seedScenario({ decidedAgo: 9 * DAY });
    await expect(fetchCommonGroundCandidate(ctx.t.db)).resolves.toBeNull();
  });

  it('returns null when the decided game is hidden or banned', async () => {
    const { win } = await seedScenario({ decidedAgo: DAY });
    await ctx.t.db
      .update(schema.games)
      .set({ banned: true })
      .where(eq(schema.games.id, win));
    await expect(fetchCommonGroundCandidate(ctx.t.db)).resolves.toBeNull();
  });

  it('drops a hidden runner-up instead of naming it', async () => {
    const { second } = await seedScenario({ decidedAgo: DAY });
    await ctx.t.db
      .update(schema.games)
      .set({ hidden: true })
      .where(eq(schema.games.id, second));
    const c = await fetchCommonGroundCandidate(ctx.t.db);
    expect(c?.runnerUp).toBeNull();
    expect(JSON.stringify(c)).not.toContain('Valheim');
  });

  it('ignores private lineups and standalone polls', async () => {
    await seedScenario({ decidedAgo: DAY, visibility: 'private' });
    await seedScenario({ decidedAgo: DAY, standalone: true });
    await expect(fetchCommonGroundCandidate(ctx.t.db)).resolves.toBeNull();
  });
});

describe('A4 Common Ground runner-up fall-through (ROK-1771, integration)', () => {
  const ctx = useApp();

  it('names the next visible game when the top runner-up is hidden', async () => {
    const { t, creatorId } = ctx;
    const [win, second, third] = [
      await seedGame(t, 'Deep Rock Galactic'),
      await seedGame(t, 'Valheim'),
      await seedGame(t, 'Satisfactory'),
    ];
    const voters = await Promise.all(
      ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((tag) => seedUser(t, tag)),
    );
    const lineupId = await seedDecidedLineup(t, creatorId, win, {
      decidedAgo: DAY,
    });
    await seedVotes(t, lineupId, win, voters.slice(0, 3));
    await seedVotes(t, lineupId, second, voters.slice(3, 5));
    await seedVotes(t, lineupId, third, voters.slice(5));
    await t.db
      .update(schema.games)
      .set({ hidden: true })
      .where(eq(schema.games.id, second));
    const c = await fetchCommonGroundCandidate(t.db);
    expect(c?.runnerUp).toEqual({
      gameId: third,
      name: 'Satisfactory',
      votes: 1,
    });
    expect(JSON.stringify(c)).not.toContain('Valheim');
  });
});

describe('A5 marathon (ROK-1771 L3, integration)', () => {
  const ctx = useApp();

  it('returns null when no attended event ended this week', async () => {
    await expect(fetchMarathonCandidate(ctx.t.db)).resolves.toBeNull();
  });

  it('picks the longest attended event; opted-out attendees never count', async () => {
    const { t, creatorId } = ctx;
    const a = await seedUser(t, 'alice');
    const b = await seedUser(t, 'bob');
    const hidden = await seedUser(t, 'hidden', true);
    const end = ago(DAY);
    const long = await seedEvent(t, creatorId, 'MC clear', [
      new Date(end.getTime() - 4 * HOUR),
      end,
    ]);
    const short = await seedEvent(t, creatorId, 'Dungeon', [
      new Date(end.getTime() - 2 * HOUR),
      end,
    ]);
    const secret = await seedEvent(t, creatorId, 'Hidden marathon', [
      new Date(end.getTime() - 8 * HOUR),
      end,
    ]);
    await seedAttended(t, long, a);
    await seedAttended(t, long, b);
    await seedAttended(t, long, hidden);
    await seedAttended(t, short, a);
    await seedAttended(t, secret, hidden);
    await expect(fetchMarathonCandidate(t.db)).resolves.toEqual({
      kind: 'marathon',
      eventId: long,
      eventTitle: 'MC clear',
      durationMinutes: 240,
      attendeeCount: 2,
    });
  });
});

async function seedVoice(
  t: TestApp,
  eventId: number,
  userId: number,
  fromAgo: number,
  minutes: number,
) {
  const joinAt = ago(fromAgo);
  const leaveAt = new Date(joinAt.getTime() + minutes * 60_000);
  await t.db.insert(schema.eventVoiceSessions).values({
    eventId,
    userId,
    discordUserId: `vd-${userId}`,
    discordUsername: `vd-${userId}`,
    firstJoinAt: joinAt,
    lastLeaveAt: leaveAt,
    totalDurationSec: minutes * 60,
    segments: [
      {
        joinAt: joinAt.toISOString(),
        leaveAt: leaveAt.toISOString(),
        durationSec: minutes * 60,
      },
    ],
  });
}

describe('A2 duo (ROK-1771 L3, integration)', () => {
  const ctx = useApp();

  it('returns null without voice sessions this week', async () => {
    await expect(fetchDuoCandidate(ctx.t.db)).resolves.toBeNull();
  });

  it('sums overlap across events; a pair with an opted-out member is dropped', async () => {
    const { t, creatorId } = ctx;
    const a = await seedUser(t, 'alice');
    const b = await seedUser(t, 'bob');
    const hidden = await seedUser(t, 'hidden', true);
    const e1 = await seedEvent(t, creatorId, 'Raid night', [
      ago(3 * DAY),
      ago(2 * DAY),
    ]);
    const e2 = await seedEvent(t, creatorId, 'Dungeon run', [
      ago(2 * DAY),
      ago(DAY),
    ]);
    const old = await seedEvent(t, creatorId, 'Old raid', [
      ago(12 * DAY),
      ago(11 * DAY),
    ]);
    await seedVoice(t, e1, a, 3 * DAY, 300);
    await seedVoice(t, e1, b, 3 * DAY, 90);
    await seedVoice(t, e1, hidden, 3 * DAY, 300);
    await seedVoice(t, e2, a, 2 * DAY, 40);
    await seedVoice(t, e2, b, 2 * DAY, 40);
    await seedVoice(t, old, a, 12 * DAY, 600);
    await seedVoice(t, old, b, 12 * DAY, 600);
    const c = await fetchDuoCandidate(t.db);
    expect(c).toEqual({
      kind: 'duo',
      members: [
        { userId: a, name: 'alice' },
        { userId: b, name: 'bob' },
      ],
      minutesTogether: 130,
      eventCount: 2,
      eventTitles: ['Raid night', 'Dungeon run'],
    });
    expect(JSON.stringify(c)).not.toContain('hidden');
  });
});

describe('AC10 — inactive members and guests contribute to nothing (integration)', () => {
  const ctx = useApp();

  it('A1: rollups of inactive members raise no game', async () => {
    const { t } = ctx;
    const game = await seedGame(t, 'Gone Game');
    // One active player: any single inactive one would make the 2-player bar.
    await seedRollup(t, await seedUser(t, 'alice'), game, 1, 10);
    for (const id of await seedGone(t)) await seedRollup(t, id, game, 1, 10);
    await expect(fetchRisingGameCandidate(t.db)).resolves.toBeNull();
  });

  it('A5: an event attended only by inactive members is no marathon', async () => {
    const { t, creatorId } = ctx;
    const end = ago(DAY);
    const event = await seedEvent(t, creatorId, 'Gone marathon', [
      new Date(end.getTime() - 8 * HOUR),
      end,
    ]);
    for (const id of await seedGone(t)) await seedAttended(t, event, id);
    await expect(fetchMarathonCandidate(t.db)).resolves.toBeNull();
  });

  it('A2: never pairs an inactive member or a never-guild-seen guest', async () => {
    const { t, creatorId } = ctx;
    const a = await seedUser(t, 'alice', false, { displayName: '' });
    const b = await seedUser(t, 'bob');
    const guest = await seedUser(t, 'guest', false, {
      guildMemberSeenAt: null,
    });
    const e1 = await seedEvent(t, creatorId, 'Raid night', [
      ago(3 * DAY),
      ago(2 * DAY),
    ]);
    await seedVoice(t, e1, a, 3 * DAY, 300);
    await seedVoice(t, e1, b, 3 * DAY, 90);
    await seedVoice(t, e1, guest, 3 * DAY, 300);
    for (const id of await seedGone(t))
      await seedVoice(t, e1, id, 3 * DAY, 300);
    await expect(fetchDuoCandidate(t.db)).resolves.toEqual({
      kind: 'duo',
      members: [
        { userId: a, name: 'alice' },
        { userId: b, name: 'bob' },
      ],
      minutesTogether: 90,
      eventCount: 1,
      eventTitles: ['Raid night'],
    });
  });
});
