/**
 * injectVoiceSessionForTest against a real DB (ROK-943 smoke flake).
 *
 * The minute classify cron can reach the smoke's just-ended event between its
 * signups and the session inject, and write a 0-second `no_show` row for each
 * signup. The inject must replace that row, not be swallowed by it.
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { injectVoiceSessionForTest } from './demo-test-voice.helpers';

const DISCORD_ID = '1494000000000000943';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

async function seedEndedEvent(): Promise<{ id: number; start: Date }> {
  const end = new Date(Date.now() - 5 * 60_000);
  const start = new Date(end.getTime() - 60 * 60_000);
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'ROK-943 inject upsert',
        gameId: testApp.seed.game.id,
        duration: [start, end],
        maxAttendees: 10,
        creatorId: testApp.seed.adminUser.id,
      })
      .returning(),
    'event',
  );
  return { id: event.id, start };
}

async function readSession(eventId: number) {
  return testApp.db
    .select()
    .from(schema.eventVoiceSessions)
    .where(
      and(
        eq(schema.eventVoiceSessions.eventId, eventId),
        eq(schema.eventVoiceSessions.discordUserId, DISCORD_ID),
      ),
    );
}

describe('injectVoiceSessionForTest', () => {
  it('replaces a cron-written no_show row with the injected session', async () => {
    const event = await seedEndedEvent();
    await testApp.db.insert(schema.eventVoiceSessions).values({
      eventId: event.id,
      userId: testApp.seed.adminUser.id,
      discordUserId: DISCORD_ID,
      discordUsername: 'Unknown',
      firstJoinAt: event.start,
      lastLeaveAt: event.start,
      totalDurationSec: 0,
      classification: 'no_show',
    });

    await injectVoiceSessionForTest(testApp.db, {
      eventId: event.id,
      discordUserId: DISCORD_ID,
      userId: testApp.seed.adminUser.id,
      durationSec: 3000,
    });

    const rows = await readSession(event.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.totalDurationSec).toBe(3000);
    expect(rows[0]?.classification).toBeNull();
    expect(rows[0]?.discordUsername).toBe('smoke-test');
    expect(rows[0]?.segments).toHaveLength(1);
  });

  it('inserts a session when none exists', async () => {
    const event = await seedEndedEvent();

    await injectVoiceSessionForTest(testApp.db, {
      eventId: event.id,
      discordUserId: DISCORD_ID,
      userId: testApp.seed.adminUser.id,
      durationSec: 1200,
    });

    const rows = await readSession(event.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.totalDurationSec).toBe(1200);
  });
});
