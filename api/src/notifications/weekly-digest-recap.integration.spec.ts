/**
 * Weekly digest "Last 7 days" — only events played together count (ROK-2063).
 *
 * An event counts toward the recap only when it has 2+ attended signups from
 * active members. The rule applies to the event count, the player count and
 * the prior-week window (`endOffsetDays: 7`) that the week-over-week deltas
 * compare against. Qualification is decided before the `show_activity`
 * opt-out: an opted-out attendee still makes the event a group event, but is
 * not counted as a player.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { nonEmpty } from '../common/testing/narrow';
import { fetchWeeklyRecap } from './weekly-digest-recap.helpers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PRIOR = { endOffsetDays: 7 } as const;
const ZERO = { eventsRun: 0, playersAttended: 0, attendances: 0 };

/** [start, end] for a 3-hour event that ENDED `daysAgo` days ago. */
function endedDaysAgo(daysAgo: number): [Date, Date] {
  const end = new Date(Date.now() - daysAgo * DAY);
  return [new Date(end.getTime() - 3 * HOUR), end];
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
        discordId: `d:wdr-${name}-${++tag}`,
        username: `wdr-${name}-${tag}`,
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

async function seedEvent(daysAgo: number): Promise<number> {
  const [e] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: `wdr event ${++tag}`,
        creatorId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        duration: endedDaysAgo(daysAgo),
      })
      .returning(),
    'event',
  );
  return e.id;
}

async function signup(
  eventId: number,
  userId: number,
  attendanceStatus = 'attended',
): Promise<void> {
  await testApp.db
    .insert(schema.eventSignups)
    .values({ eventId, userId, attendanceStatus });
}

describe('Weekly digest recap — 2+ attendees only (ROK-2063, integration)', () => {
  it('excludes a 1-attendee event from the event and player counts', async () => {
    const solo = await seedUser('solo');
    await signup(await seedEvent(1), solo);

    expect(await fetchWeeklyRecap(testApp.db)).toEqual(ZERO);
  });

  it('includes a 2-attendee event and drops the solo event beside it', async () => {
    const [alice, bob, carol] = [
      await seedUser('alice'),
      await seedUser('bob'),
      await seedUser('carol'),
    ];
    const group = await seedEvent(2);
    await signup(group, alice);
    await signup(group, bob);
    await signup(await seedEvent(3), carol);

    expect(await fetchWeeklyRecap(testApp.db)).toEqual({
      eventsRun: 1,
      playersAttended: 2,
      attendances: 2,
    });
  });

  it('needs 2 ATTENDED signups — a no-show second signup does not qualify', async () => {
    const event = await seedEvent(1);
    await signup(event, await seedUser('here'));
    await signup(event, await seedUser('absent'), 'no_show');

    expect(await fetchWeeklyRecap(testApp.db)).toEqual(ZERO);
  });

  it('applies the same rule to the prior week used by the deltas', async () => {
    const [dave, erin, frank] = [
      await seedUser('dave'),
      await seedUser('erin'),
      await seedUser('frank'),
    ];
    const group = await seedEvent(10);
    await signup(group, dave);
    await signup(group, erin);
    await signup(await seedEvent(11), frank);

    expect(await fetchWeeklyRecap(testApp.db, PRIOR)).toEqual({
      eventsRun: 1,
      playersAttended: 2,
      attendances: 2,
    });
    expect(await fetchWeeklyRecap(testApp.db)).toEqual(ZERO);
  });

  it('excludes a 1-attendee prior-week event', async () => {
    await signup(await seedEvent(10), await seedUser('lonely'));

    expect(await fetchWeeklyRecap(testApp.db, PRIOR)).toEqual(ZERO);
  });

  it('qualifies on attendance before the opt-out, then hides the opted-out player', async () => {
    const visible = await seedUser('visible');
    const hidden = await seedUser('hidden', false);
    const shared = await seedEvent(2);
    await signup(shared, visible);
    await signup(shared, hidden);

    expect(await fetchWeeklyRecap(testApp.db)).toEqual({
      eventsRun: 1,
      playersAttended: 1,
      attendances: 1,
    });
  });
});
