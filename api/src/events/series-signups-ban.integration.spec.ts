/**
 * ROK-1728 (Codex P2): a ban WITHOUT a data wipe keeps the users row, so the
 * membership-ending hook that deactivation runs (AC5) must run on ban too —
 * otherwise the membership is still `active` after an unban and keeps
 * materialising nights for the user.
 */
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { SeriesSignupsService } from './series-signups.service';
import { UsersModerationService } from '../users/users-moderation.service';

const HOUR = 60 * 60 * 1000;

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

// No afterAll truncate: the shared app's pool must stay open (memory
// reference_integration_specs_no_aftersall_truncate).
afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

function must<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined)
    throw new Error(`Expected ${label}, got ${String(value)}`);
  return value;
}

async function insertNight(groupId: string, offsetHours: number) {
  const start = new Date(Date.now() + offsetHours * HOUR);
  const end = new Date(start.getTime() + 3 * HOUR);
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: `Ban series night ${offsetHours}h`,
        creatorId: testApp.seed.adminUser.id,
        duration: [start, end] as [Date, Date],
        recurrenceGroupId: groupId,
      })
      .returning(),
    'series night',
  );
  return event.id;
}

async function createMember(): Promise<number> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: '172899000000000001',
        username: 'series_ban_member',
        role: 'member',
      })
      .returning(),
    'member',
  );
  return user.id;
}

async function signupRow(eventId: number, userId: number) {
  const [row] = await testApp.db
    .select()
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.userId, userId),
      ),
    );
  return must(row, `signup on ${eventId}`);
}

describe('ban without wipe ends series memberships (ROK-1728 Codex P2)', () => {
  it('ends the membership as deactivated and untags the future nights', async () => {
    const groupId = randomUUID();
    const n1 = await insertNight(groupId, 48);
    const n2 = await insertNight(groupId, 96);
    const userId = await createMember();
    await testApp.app.get(SeriesSignupsService).join(n1, userId, {});

    await testApp.app
      .get(UsersModerationService)
      .banUser(testApp.seed.adminUser.id, userId, {
        wipeData: false,
        kickFromDiscord: false,
      });

    const [m] = await testApp.db
      .select()
      .from(schema.seriesSignups)
      .where(eq(schema.seriesSignups.userId, userId));
    const membership = must(m, 'membership (ban without wipe keeps it)');
    // mutation: remove the membership-end call from runBan's data changes
    expect({
      status: membership.status,
      endedReason: membership.endedReason,
    }).toEqual({ status: 'ended', endedReason: 'deactivated' });
    for (const night of [n1, n2]) {
      expect((await signupRow(night, userId)).seriesSignupId).toBeNull();
    }
  });
});
