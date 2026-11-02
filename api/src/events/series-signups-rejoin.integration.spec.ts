/**
 * ROK-1728 Q6 — re-join after leave, review follow-ups (MAJOR 1/2, MINOR 5).
 * Series of 4 nights relative to "now": night 1 past, night 2 in 6h (late
 * cancel window), nights 3 and 5 days away. Each case names the mutation it
 * must catch.
 */
import { randomUUID } from 'crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { SeriesSignupsService } from './series-signups.service';
import { SignupsService } from './signups.service';

const HOUR = 60 * 60 * 1000;

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

// No afterAll truncate: the shared app's pool must stay open.
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
        title: `Rejoin night ${offsetHours}h`,
        creatorId: testApp.seed.adminUser.id,
        duration: [start, end] as [Date, Date],
        recurrenceGroupId: groupId,
      })
      .returning(),
    'series night',
  );
  return event.id;
}

async function seedSeries() {
  const groupId = randomUUID();
  return {
    n1: await insertNight(groupId, -48),
    n2: await insertNight(groupId, 6),
    n3: await insertNight(groupId, 48),
    n5: await insertNight(groupId, 96),
  };
}

let userSeq = 0;
async function createMember(): Promise<number> {
  userSeq += 1;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `17281000000000${String(userSeq).padStart(4, '0')}`,
        username: `rejoin_member_${userSeq}`,
        role: 'member',
      })
      .returning(),
    'member',
  );
  return user.id;
}

async function statusOf(eventId: number, userId: number): Promise<string> {
  const [row] = await testApp.db
    .select({ status: schema.eventSignups.status })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.userId, userId),
      ),
    );
  return must(row, `signup on ${eventId}`).status;
}

/** The user's activity rows of the given actions, id ascending. */
async function auditRows(userId: number, actions: string[]) {
  return testApp.db
    .select({ id: schema.activityLog.id, action: schema.activityLog.action })
    .from(schema.activityLog)
    .where(
      and(
        eq(schema.activityLog.actorId, userId),
        inArray(schema.activityLog.action, actions),
      ),
    )
    .orderBy(schema.activityLog.id);
}

const series = () => testApp.app.get(SeriesSignupsService);
const signups = () => testApp.app.get(SignupsService);
const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b);

describe('re-join after leave — review follow-ups (Q6)', () => {
  it('a night whose status the user changed via updateStatus after the leave stays declined', async () => {
    const s = await seedSeries();
    const userId = await createMember();
    await series().join(s.n2, userId, {});
    await series().leave(s.n2, userId);
    await signups().updateStatus(s.n3, { userId }, { status: 'tentative' });
    await signups().updateStatus(s.n3, { userId }, { status: 'declined' });

    const rejoin = await series().join(s.n2, userId, {});
    // mutation: updateStatus writes no audit row (night 3 would be re-signed)
    expect(sorted(rejoin.createdEventIds)).toEqual(sorted([s.n2, s.n5]));
    expect(rejoin.keptEventIds).toEqual([s.n3]);
    expect(await statusOf(s.n3, userId)).toBe('declined');
  });

  it('revives the last-cancelled night even when its cancel shares the series_left millisecond', async () => {
    const s = await seedSeries();
    const userId = await createMember();
    await series().join(s.n2, userId, {});
    await series().leave(s.n2, userId);
    const rows = await auditRows(userId, ['signup_cancelled', 'series_left']);
    // Pins the write order the id comparison relies on: cancels, then the leave.
    expect(rows.map((r) => r.action)).toEqual([
      'signup_cancelled',
      'signup_cancelled',
      'signup_cancelled',
      'series_left',
    ]);
    // Same millisecond, the cancels 100µs BEFORE the leave (µs precision).
    await testApp.db.execute(sql`
      UPDATE activity_log SET created_at = CASE action
        WHEN 'series_left' THEN '2030-01-01 00:00:00.000500'::timestamp
        ELSE '2030-01-01 00:00:00.000400'::timestamp END
      WHERE actor_id = ${userId}
        AND action IN ('signup_cancelled', 'series_left')`);

    const rejoin = await series().join(s.n2, userId, {});
    // mutation: compare ms-truncated created_at (every cancel counts as touched)
    expect(sorted(rejoin.createdEventIds)).toEqual(sorted([s.n2, s.n3, s.n5]));
    expect(rejoin.keptEventIds).toEqual([]);
  });

  it('a membership the system ended (not user_left) revives nothing', async () => {
    const s = await seedSeries();
    const userId = await createMember();
    await series().join(s.n2, userId, {});
    await series().leave(s.n2, userId);
    await testApp.db
      .update(schema.seriesSignups)
      .set({ endedReason: 'deactivated' })
      .where(eq(schema.seriesSignups.userId, userId));

    const state = await series().getState(s.n2, userId);
    // mutation: drop the `endedReason !== 'user_left'` guard
    expect(state.joinableCount).toBe(0);
    expect(state.nights.map((n) => [n.eventId, n.state])).toEqual([
      [s.n2, 'stays_inactive'],
      [s.n3, 'stays_inactive'],
      [s.n5, 'stays_inactive'],
    ]);
  });
});
