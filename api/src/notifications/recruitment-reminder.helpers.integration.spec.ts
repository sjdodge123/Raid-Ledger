/**
 * The recruitment-reminder and game-affinity raw readers stay UTC-correct
 * whatever the DB session TimeZone is (real Postgres).
 *
 * `events.duration` and `events.created_at` are zone-less and hold the UTC
 * wall clock. A reader that renders them with `::text`, or compares them to a
 * `timestamptz` literal or `NOW()::timestamp`, drifts by the session zone's
 * offset. The reads below run inside one transaction pinned to
 * America/New_York, so they fail on any host if a reader regresses.
 */
import { sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import {
  findEligibleEvents,
  findRecipients,
} from './recruitment-reminder.helpers';
import { findGameAffinityRecipients } from './game-affinity-recipients.helpers';

const HOUR_MS = 60 * 60 * 1000;
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type Db = TestApp['db'];

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

/** Run `read` on a connection whose session TimeZone is America/New_York. */
async function inNewYork<T>(read: (db: Db) => Promise<T>): Promise<T> {
  return testApp.db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL TIME ZONE 'America/New_York'`);
    return read(tx);
  });
}

interface SeededEvent {
  id: number;
  start: Date;
  createdAt: Date;
}

/**
 * Seed a 3h event of the seeded game starting `startOffsetHours` from now.
 * With `embed`, it also gets a non-full Discord embed row, which is what
 * makes it a recruitment-reminder candidate (no signups, 20 seats).
 */
async function seedEvent(
  startOffsetHours: number,
  embed: boolean,
): Promise<SeededEvent> {
  const start = new Date(Date.now() + startOffsetHours * HOUR_MS);
  const end = new Date(start.getTime() + 3 * HOUR_MS);
  const createdAt = new Date(Date.now() - 72 * HOUR_MS);
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Timezone raid',
        creatorId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        duration: [start, end] as [Date, Date],
        maxAttendees: 20,
        createdAt,
      })
      .returning(),
    'event',
  );
  if (embed) {
    await testApp.db.insert(schema.discordEventMessages).values({
      eventId: event.id,
      guildId: 'guild-tz',
      channelId: 'channel-tz',
      messageId: `msg-tz-${event.id}`,
      embedState: 'posted',
    });
  }
  return { id: event.id, start, createdAt };
}

/** Seed a member whose only tie to the game is a signup on `eventId`. */
async function seedPastPlayer(eventId: number): Promise<number> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: 'tz-past-player', username: 'tz-past-player' })
      .returning(),
    'user',
  );
  await testApp.db
    .insert(schema.eventSignups)
    .values({ eventId, userId: user.id, status: 'signed_up' });
  return user.id;
}

describe('recruitment-reminder readers under a non-UTC DB session', () => {
  it('findEligibleEvents renders start_time and created_at as ISO-8601 Z of the stored instant', async () => {
    const seeded = await seedEvent(36, true);

    const rows = await inNewYork((db) => findEligibleEvents(db));

    expect(rows.map((r) => r.id)).toEqual([seeded.id]);
    const [row] = nonEmpty(rows, 'eligible event');
    expect(row.startTime).toMatch(ISO_Z);
    expect(row.createdAt).toMatch(ISO_Z);
    expect(new Date(row.startTime).toISOString()).toBe(
      seeded.start.toISOString(),
    );
    expect(new Date(row.createdAt).toISOString()).toBe(
      seeded.createdAt.toISOString(),
    );
  });

  it('findEligibleEvents does not return an event that started 2h ago', async () => {
    await seedEvent(-2, true);
    const upcoming = await seedEvent(36, true);

    const rows = await inNewYork((db) => findEligibleEvents(db));

    // A session-zone read shifts the 2h-ago start 4-5h later, into the window.
    expect(rows.map((r) => r.id)).toEqual([upcoming.id]);
  });

  it('counts a signup on an event that ended 2h ago as game affinity', async () => {
    const ended = await seedEvent(-5, false);
    const upcoming = await seedEvent(36, true);
    const playerId = await seedPastPlayer(ended.id);
    const gameId = testApp.seed.game.id;

    const found = await inNewYork(async (db) => ({
      recipients: await findRecipients(
        db,
        gameId,
        testApp.seed.adminUser.id,
        upcoming.id,
      ),
      affinity: await findGameAffinityRecipients(db, gameId, {
        interestsOnly: false,
      }),
    }));

    // NOW()::timestamp is New York's wall clock, 4-5h behind UTC, so a
    // session-zone read still sees the event as running and drops the player.
    expect(found.recipients).toEqual([playerId]);
    expect(found.affinity).toEqual([playerId]);
  });
});
