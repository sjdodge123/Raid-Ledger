/**
 * ROK-1430 — game lifecycle activity derivation, real DB (spec §2.11 D1–D14).
 *
 * WHY INTEGRATION: the event signal reads `lower(duration)` off a tsrange and
 * the candidate set is a union of signal rows and bindings — neither is
 * faithfully mockable. Each case seeds fresh games and reads the derived row.
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { decideGame } from './channel-lifecycle.decide';
import {
  selectGameLifecycleActivity,
  type GameLifecycleActivityRow,
} from './game-activity.queries';
import { DEFAULT_SIGNALS } from './game-activity.signals';

const DAY = 86_400_000;
const GUILD = 'rok1430-guild';
const NOW = new Date();
const at = (days: number): Date => new Date(NOW.getTime() + days * DAY);

let testApp: TestApp;
let gameSeq = 0;
let lineupSeq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

const userId = (): number => testApp.seed.adminUser.id;

async function makeGame(): Promise<number> {
  gameSeq += 1;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({
        name: `L3 Game ${gameSeq}`,
        slug: `l3-game-${gameSeq}-${Date.now()}`,
        igdbId: null,
      })
      .returning({ id: schema.games.id }),
    'game',
  );
  return g.id;
}

async function makeEvent(
  gameId: number,
  startDays: number,
  o: { cancelled?: boolean; adHoc?: boolean } = {},
): Promise<void> {
  const start = at(startDays);
  await testApp.db.insert(schema.events).values({
    title: 'L3 event',
    gameId,
    creatorId: userId(),
    duration: [start, new Date(start.getTime() + 3_600_000)],
    isAdHoc: o.adHoc ?? false,
    cancelledAt: o.cancelled ? at(-1) : null,
  });
}

async function makeLineup(): Promise<number> {
  lineupSeq += 1;
  const [l] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'L3 lineup',
        createdBy: userId(),
        // public_slug is varchar(16) + unique.
        publicSlug: `l3-${lineupSeq}-${Date.now()}`.slice(0, 16),
      })
      .returning({ id: schema.communityLineups.id }),
    'lineup',
  );
  return l.id;
}

/** A poll = a match with `slots` slots, one admin vote per slot at `voteDays`. */
async function makePoll(
  gameId: number,
  o: { createdDays: number; slots: number; voteDays?: number },
): Promise<void> {
  const lineupId = await makeLineup();
  const [m] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineupMatches)
      .values({
        lineupId,
        gameId,
        status: 'scheduling',
        createdAt: at(o.createdDays),
      })
      .returning({ id: schema.communityLineupMatches.id }),
    'match',
  );
  for (let i = 0; i < o.slots; i += 1) {
    const [s] = nonEmpty(
      await testApp.db
        .insert(schema.communityLineupScheduleSlots)
        .values({ matchId: m.id, proposedTime: at(3 + i), suggestedBy: 'user' })
        .returning({ id: schema.communityLineupScheduleSlots.id }),
      'slot',
    );
    if (o.voteDays !== undefined) {
      await testApp.db
        .insert(schema.communityLineupScheduleVotes)
        .values({ slotId: s.id, userId: userId(), createdAt: at(o.voteDays) });
    }
  }
}

async function makePlan(gameId: number, createdDays: number): Promise<void> {
  await testApp.db.insert(schema.eventPlans).values({
    creatorId: userId(),
    title: 'L3 plan',
    gameId,
    durationMinutes: 60,
    pollOptions: [{ date: at(2).toISOString(), label: 'A' }],
    pollDurationHours: 24,
    createdAt: at(createdDays),
  });
}

async function makeBinding(
  gameId: number,
  o: { purpose?: string; series?: boolean; auto?: boolean; channel?: string },
): Promise<void> {
  await testApp.db.insert(schema.channelBindings).values({
    guildId: GUILD,
    channelId:
      o.channel ?? `ch-${gameId}-${o.purpose ?? 'ann'}-${o.series ? 's' : 'n'}`,
    channelType: o.purpose === 'game-voice-monitor' ? 'voice' : 'text',
    bindingPurpose: o.purpose ?? 'game-announcements',
    gameId,
    recurrenceGroupId: o.series ? '11111111-1111-4111-8111-111111111111' : null,
    autoManaged: o.auto ?? false,
  });
}

async function derive(windowDays = 30): Promise<GameLifecycleActivityRow[]> {
  return selectGameLifecycleActivity(testApp.db, {
    now: NOW,
    windowDays,
    signals: DEFAULT_SIGNALS,
    guildId: GUILD,
  });
}

async function rowFor(
  gameId: number,
  windowDays = 30,
): Promise<GameLifecycleActivityRow | undefined> {
  return (await derive(windowDays)).find((r) => r.gameId === gameId);
}

function countOf(
  row: GameLifecycleActivityRow | undefined,
  kind: string,
): number {
  return row?.signals.find((s) => s.kind === kind)?.itemCount ?? 0;
}

describe('game lifecycle activity — events (D1–D5, D14)', () => {
  it('D1: an event 5 days out counts once', async () => {
    const g = await makeGame();
    await makeEvent(g, 5);
    const row = await rowFor(g);
    expect(countOf(row, 'event')).toBe(1);
    expect(row?.itemCount).toBe(1);
  });

  it('D2: an event 400 days out still counts (upcoming, A3)', async () => {
    const g = await makeGame();
    await makeEvent(g, 400);
    expect(countOf(await rowFor(g), 'event')).toBe(1);
  });

  it('D3: 29 days ago counts, 31 days ago is absent', async () => {
    const inside = await makeGame();
    const outside = await makeGame();
    await makeEvent(inside, -29);
    await makeEvent(outside, -31);
    expect(countOf(await rowFor(inside), 'event')).toBe(1);
    expect(await rowFor(outside)).toBeUndefined();
  });

  it('D4: a cancelled event inside the window is absent', async () => {
    const g = await makeGame();
    await makeEvent(g, 3, { cancelled: true });
    expect(await rowFor(g)).toBeUndefined();
  });

  it('D5: an ad-hoc event counts as one event item (operator ruling A4)', async () => {
    const g = await makeGame();
    await makeEvent(g, -2, { adHoc: true });
    expect(countOf(await rowFor(g), 'event')).toBe(1);
  });

  it('D14: windowDays 7 drops the 29-day-old event', async () => {
    const g = await makeGame();
    await makeEvent(g, -29);
    expect(await rowFor(g, 7)).toBeUndefined();
  });
});

describe('game lifecycle activity — polls, plans, lineup votes (D6–D10)', () => {
  it('D6: a 40-day-old poll voted 2 days ago counts, last activity = the vote', async () => {
    const g = await makeGame();
    await makePoll(g, { createdDays: -40, slots: 1, voteDays: -2 });
    const row = await rowFor(g);
    expect(countOf(row, 'poll')).toBe(1);
    const last =
      row?.signals.find((s) => s.kind === 'poll')?.lastActivityAt.getTime() ??
      0;
    expect(Math.abs(last - at(-2).getTime())).toBeLessThan(1000);
  });

  it('D7: one poll with 12 votes is ONE item and never creates (A1, X3)', async () => {
    const g = await makeGame();
    await makePoll(g, { createdDays: -1, slots: 12, voteDays: -1 });
    const row = await rowFor(g);
    expect(countOf(row, 'poll')).toBe(1);
    expect(row?.itemCount).toBe(1);
    expect(
      row &&
        decideGame(row, { createThreshold: 2, recentActivityDays: 30 }).action,
    ).toBe('none');
  });

  it('D8: an event plan created 10 days ago counts', async () => {
    const g = await makeGame();
    await makePlan(g, -10);
    expect(countOf(await rowFor(g), 'event_plan')).toBe(1);
  });

  it('D9: lineup votes on one game in two lineups are two items', async () => {
    const g = await makeGame();
    for (const lineupId of [await makeLineup(), await makeLineup()]) {
      await testApp.db
        .insert(schema.communityLineupVotes)
        .values({ lineupId, gameId: g, userId: userId() });
    }
    expect(countOf(await rowFor(g), 'lineup_vote')).toBe(2);
  });

  it('D10: a nomination with no votes is not activity (A6)', async () => {
    const g = await makeGame();
    const lineupId = await makeLineup();
    await testApp.db
      .insert(schema.communityLineupEntries)
      .values({ lineupId, gameId: g, nominatedBy: userId() });
    expect(await rowFor(g)).toBeUndefined();
  });

  it('D11: event + poll on one game → 2 items → decideGame create', async () => {
    const g = await makeGame();
    await makeEvent(g, 2);
    await makePoll(g, { createdDays: -1, slots: 1 });
    const row = await rowFor(g);
    expect(row?.itemCount).toBe(2);
    expect(
      row &&
        decideGame(row, { createThreshold: 2, recentActivityDays: 30 }).action,
    ).toBe('create');
  });
});

describe('game lifecycle activity — candidate bindings (D12, D13)', () => {
  it('D12: a series-only binding is invisible — candidate binding is null', async () => {
    const g = await makeGame();
    await makeEvent(g, 2);
    await makeBinding(g, { series: true, auto: true });
    const row = await rowFor(g);
    expect(row).toBeDefined();
    expect(row?.binding).toBeNull();
  });

  it('D13: general-lobby + voice-monitor bindings never enter the candidate set', async () => {
    const g = await makeGame();
    await makeBinding(g, { purpose: 'general-lobby' });
    await makeBinding(g, { purpose: 'game-voice-monitor' });
    expect(await rowFor(g)).toBeUndefined();
  });

  it('a quiet auto binding surfaces with zero items and decides archive', async () => {
    const g = await makeGame();
    await makeBinding(g, { auto: true });
    const row = await rowFor(g);
    expect(row?.itemCount).toBe(0);
    expect(row?.binding?.autoManaged).toBe(true);
    expect(
      row &&
        decideGame(row, { createThreshold: 2, recentActivityDays: 30 }).action,
    ).toBe('archive');
  });

  it('a manual binding wins over an auto one for the same game', async () => {
    const g = await makeGame();
    await makeBinding(g, { auto: true, channel: 'auto-ch' });
    await makeBinding(g, { auto: false, channel: 'manual-ch' });
    expect((await rowFor(g))?.binding?.channelId).toBe('manual-ch');
  });

  it('marks a suppressed game and leaves hub seams false', async () => {
    const g = await makeGame();
    await makeEvent(g, 1);
    await testApp.db
      .insert(schema.channelLifecycleSuppressions)
      .values({ guildId: GUILD, gameId: g, reason: 'deleted' });
    const row = await rowFor(g);
    expect(row).toMatchObject({
      suppressed: true,
      hubHold: false,
      hubNeedsLink: false,
    });
  });
});
