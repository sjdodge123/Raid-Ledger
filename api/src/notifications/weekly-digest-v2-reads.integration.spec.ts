/**
 * Weekly digest v2 — L1 reads against a real database (ROK-1771).
 *
 * - C1: the recap's prior-week window (`endOffsetDays: 7`), and the
 *   `show_activity = false` opt-out holding in BOTH weeks (AC7, AC10).
 * - D1: "Coming up" events exclude cancelled, ad-hoc, past, running and
 *   beyond-7-day events (AC9).
 * - D2: "Coming up" polls exclude private, expired, archived and
 *   all-times-passed polls (AC9).
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { nonEmpty } from '../common/testing/narrow';
import { generatePublicSlug } from '../lineups/public-lineup-slug.helpers';
import { fetchWeeklyRecap } from './weekly-digest-recap.helpers';
import {
  fetchUpcomingEventRows,
  fetchWeeklyUpcoming,
} from './weekly-digest-upcoming.helpers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PRIOR = { endOffsetDays: 7 } as const;

/** [start, end] for an event `fromNowMs` away lasting `hoursLong` hours. */
function span(fromNowMs: number, hoursLong = 3): [Date, Date] {
  const start = new Date(Date.now() + fromNowMs);
  return [start, new Date(start.getTime() + hoursLong * HOUR)];
}

/** [start, end] for an event that ENDED `daysAgo` days ago. */
function endedDaysAgo(daysAgo: number): [Date, Date] {
  return span(-daysAgo * DAY - 3 * HOUR);
}

let testApp: TestApp;
let tag = 0;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

async function seedUser(name: string, showActivity?: boolean): Promise<number> {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `d:wd2-${name}-${++tag}`,
        username: `wd2-${name}-${tag}`,
        role: 'member',
      })
      .returning(),
    'user',
  );
  if (showActivity !== undefined) {
    await testApp.db
      .insert(schema.userPreferences)
      .values({ userId: u.id, key: 'show_activity', value: showActivity });
  }
  return u.id;
}

interface EventOpts {
  title?: string;
  cancelled?: boolean;
  adHoc?: boolean;
}

async function seedEvent(
  duration: [Date, Date],
  opts: EventOpts = {},
): Promise<number> {
  const [e] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: opts.title ?? `wd2 event ${++tag}`,
        creatorId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        duration,
        cancelledAt: opts.cancelled ? new Date() : null,
        isAdHoc: opts.adHoc ?? false,
      })
      .returning(),
    'event',
  );
  return e.id;
}

async function attend(eventId: number, userId: number): Promise<void> {
  await testApp.db
    .insert(schema.eventSignups)
    .values({ eventId, userId, attendanceStatus: 'attended' });
}

describe('Weekly digest v2 — recap prior-week window (ROK-1771 C1, integration)', () => {
  it('counts an event that ended 8–14 days ago in the prior week only', async () => {
    const alice = await seedUser('alice');
    await attend(await seedEvent(endedDaysAgo(10)), alice);

    const current = await fetchWeeklyRecap(testApp.db);
    const prior = await fetchWeeklyRecap(testApp.db, PRIOR);

    expect(current).toEqual({
      eventsRun: 0,
      playersAttended: 0,
      attendances: 0,
    });
    expect(prior).toEqual({ eventsRun: 1, playersAttended: 1, attendances: 1 });
  });

  it('keeps this week out of the prior week, and 15+ days out of both', async () => {
    const bob = await seedUser('bob');
    await attend(await seedEvent(endedDaysAgo(1)), bob);
    await attend(await seedEvent(endedDaysAgo(15)), bob);

    expect((await fetchWeeklyRecap(testApp.db)).eventsRun).toBe(1);
    expect((await fetchWeeklyRecap(testApp.db, PRIOR)).eventsRun).toBe(0);
  });

  it('drops an opted-out attendee from BOTH weeks (AC10)', async () => {
    const visible = await seedUser('visible');
    const hidden = await seedUser('hidden', false);
    for (const daysAgo of [2, 10]) {
      const shared = await seedEvent(endedDaysAgo(daysAgo));
      await attend(shared, visible);
      await attend(shared, hidden);
      await attend(await seedEvent(endedDaysAgo(daysAgo)), hidden);
    }

    const expected = { eventsRun: 1, playersAttended: 1, attendances: 1 };
    expect(await fetchWeeklyRecap(testApp.db)).toEqual(expected);
    expect(await fetchWeeklyRecap(testApp.db, PRIOR)).toEqual(expected);
  });
});

describe('Weekly digest v2 — Coming up events (ROK-1771 D1, integration)', () => {
  it('lists only non-cancelled, non-ad-hoc events starting in the next 7 days', async () => {
    const wanted = await seedEvent(span(DAY), { title: 'wd2 wanted' });
    const later = await seedEvent(span(6 * DAY), { title: 'wd2 later' });
    const excluded = {
      cancelled: await seedEvent(span(DAY), { cancelled: true }),
      adHoc: await seedEvent(span(DAY), { adHoc: true }),
      past: await seedEvent(endedDaysAgo(1)),
      running: await seedEvent(span(-HOUR)),
      tooFar: await seedEvent(span(8 * DAY)),
    };

    const ids = (await fetchUpcomingEventRows(testApp.db, new Date())).map(
      (r) => r.id,
    );

    expect(ids).toEqual([wanted, later]);
    for (const [why, id] of Object.entries(excluded)) {
      expect({ why, listed: ids.includes(id) }).toEqual({ why, listed: false });
    }
  });

  it('returns the start as a UTC instant plus game name and active sign-up count', async () => {
    const duration = span(2 * DAY);
    const id = await seedEvent(duration, { title: 'wd2 shaped' });
    await attend(id, await seedUser('signed'));

    const out = await fetchWeeklyUpcoming(testApp.db);

    expect(out?.events).toEqual([
      {
        eventId: id,
        title: 'wd2 shaped',
        gameName: testApp.seed.game.name,
        startsAt: duration[0],
        signupCount: 1,
      },
    ]);
  });

  it('returns null when nothing is coming up', async () => {
    await seedEvent(endedDaysAgo(1));
    expect(await fetchWeeklyUpcoming(testApp.db)).toBeNull();
  });
});

interface PollOpts {
  visibility?: 'public' | 'private';
  deadlineHours?: number | null;
  lineupStatus?: 'decided' | 'archived';
  slotHours?: number[];
}

async function seedPoll(opts: PollOpts = {}): Promise<number> {
  const deadline = opts.deadlineHours === undefined ? 48 : opts.deadlineHours;
  const [lineup] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: `wd2 poll ${++tag}`,
        status: opts.lineupStatus ?? 'decided',
        visibility: opts.visibility ?? 'public',
        createdBy: testApp.seed.adminUser.id,
        includeSchedulingPhase: true,
        phaseDeadline:
          deadline === null ? null : new Date(Date.now() + deadline * HOUR),
        phaseDurationOverride: { standalone: true },
        publicSlug: generatePublicSlug(),
        publicShareEnabled: false,
      })
      .returning(),
    'lineup',
  );
  const [match] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineupMatches)
      .values({
        lineupId: lineup.id,
        gameId: testApp.seed.game.id,
        status: 'scheduling',
        thresholdMet: true,
        voteCount: 1,
      })
      .returning(),
    'match',
  );
  for (const hours of opts.slotHours ?? [5]) {
    await testApp.db.insert(schema.communityLineupScheduleSlots).values({
      matchId: match.id,
      proposedTime: new Date(Date.now() + hours * HOUR),
      suggestedBy: 'user',
    });
  }
  return match.id;
}

describe('Weekly digest v2 — Coming up polls (ROK-1771 D2, integration)', () => {
  it('lists public votable polls and excludes private, expired, archived and dead ones', async () => {
    const live = await seedPoll({ slotHours: [-2, 5] });
    const noTimesYet = await seedPoll({ slotHours: [], deadlineHours: null });
    const excluded = {
      private: await seedPoll({ visibility: 'private' }),
      expired: await seedPoll({ deadlineHours: -1 }),
      archived: await seedPoll({ lineupStatus: 'archived' }),
      allTimesPassed: await seedPoll({ slotHours: [-3, -2] }),
    };

    const out = await fetchWeeklyUpcoming(testApp.db);
    const ids = (out?.polls ?? []).map((p) => p.matchId);

    expect(ids).toEqual([live, noTimesYet]);
    for (const [why, id] of Object.entries(excluded)) {
      expect({ why, listed: ids.includes(id) }).toEqual({ why, listed: false });
    }
    expect(out?.polls[0]).toMatchObject({ openSlotCount: 1, memberCount: 0 });
    expect(out?.polls[0]?.deadline).toBeInstanceOf(Date);
    expect(out?.polls[1]?.deadline).toBeNull();
    expect(out?.events).toEqual([]);
  });
});
