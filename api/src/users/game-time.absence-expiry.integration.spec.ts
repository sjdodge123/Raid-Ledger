/**
 * Game-Time absence-expiry integration tests (ROK-1427).
 *
 * Split out of game-time.integration.spec.ts for file size. Expired
 * absences leave the list endpoint (filtered in the caller's timezone,
 * never deleted) while a past-week composite view still sees them.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import {
  createMemberAndLogin,
  utcDateOffset,
  localDateOffset,
} from './game-time.integration.spec-helpers';
import { nonEmpty } from '../common/testing/narrow';

let testApp: TestApp;

function describeRok1427() {
  /** Seed an absence row directly so past-dated rows can be created. */
  async function seedAbsence(
    userId: number,
    startDate: string,
    endDate: string,
    reason: string,
  ): Promise<number> {
    const [row] = nonEmpty(
      await testApp.db
        .insert(schema.gameTimeAbsences)
        .values({ userId, startDate, endDate, reason })
        .returning(),
      'row',
    );
    return row.id;
  }

  async function testExpiredAbsencesLeaveTheList() {
    const { userId, token } = await createMemberAndLogin(
      testApp,
      'rok1427_list',
      'rok1427_list@test.local',
    );

    const seed = (s: number, e: number, reason: string) =>
      seedAbsence(userId, utcDateOffset(s), utcDateOffset(e), reason);
    const longPast = await seed(-10, -5, 'Tennis Travel');
    const endedYesterday = await seed(-3, -1, 'Ended yesterday');
    const endsToday = await seed(-2, 0, 'Ends today');
    const active = await seed(-1, 3, 'Currently away');
    const future = await seed(10, 12, 'Upcoming trip');

    const res = await testApp.request
      .get('/users/me/game-time/absences')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = (res.body.data as Array<{ id: number }>).map((a) => a.id);

    // Expired absences are gone — including the inclusive-boundary case
    // that ended yesterday, which must NOT survive into today.
    expect(ids).not.toContain(longPast);
    expect(ids).not.toContain(endedYesterday);

    // end_date is inclusive: an absence ending TODAY is still active today.
    expect(ids).toContain(endsToday);
    expect(ids).toContain(active);
    expect(ids).toContain(future);
    expect(ids).toHaveLength(3);
  }
  it('hides expired absences and keeps today/active/future ones', () =>
    testExpiredAbsencesLeaveTheList());

  async function testPastAbsencesStayInTheDatabase() {
    const { userId, token } = await createMemberAndLogin(
      testApp,
      'rok1427_keep',
      'rok1427_keep@test.local',
    );
    await seedAbsence(
      userId,
      utcDateOffset(-10),
      utcDateOffset(-5),
      'Tennis Travel',
    );

    const res = await testApp.request
      .get('/users/me/game-time/absences')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.data).toHaveLength(0);

    // Filtered at query time, never deleted — the history row is intact.
    const rows = await testApp.db
      .select()
      .from(schema.gameTimeAbsences)
      .where(eq(schema.gameTimeAbsences.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe('Tennis Travel');
  }
  it('keeps expired absences in the database as history', () =>
    testPastAbsencesStayInTheDatabase());

  async function testFiltersInTheCallersTimezone() {
    // Pick the offset from the current UTC hour so the caller's local date is
    // ALWAYS a different calendar day from the UTC date. With a fixed offset
    // this assertion is vacuous for part of every day: a raw-UTC (unfixed)
    // server returns the identical rows whenever local-date === utc-date, so
    // the test would pass against the very bug it exists to catch.
    //   UTC hour < 12 -> +720 (UTC-12) puts the caller on YESTERDAY.
    //   UTC hour >= 12 -> -720 (UTC+12) puts the caller on TOMORROW.
    const tzOffset = new Date().getUTCHours() < 12 ? 720 : -720;
    const { userId, token } = await createMemberAndLogin(
      testApp,
      'rok1427_tz',
      'rok1427_tz@test.local',
    );
    const goneId = await seedAbsence(
      userId,
      localDateOffset(tzOffset, -4),
      localDateOffset(tzOffset, -1),
      'Ended yesterday there',
    );
    const keptId = await seedAbsence(
      userId,
      localDateOffset(tzOffset, -2),
      localDateOffset(tzOffset, 0),
      'Ends today there',
    );

    const res = await testApp.request
      .get(`/users/me/game-time/absences?tzOffset=${tzOffset}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = (res.body.data as Array<{ id: number }>).map((a) => a.id);
    expect(ids).not.toContain(goneId);
    expect(ids).toEqual([keptId]);
  }
  it('resolves "today" in the caller timezone, not raw UTC', () =>
    testFiltersInTheCallersTimezone());

  async function testPastWeekCompositeViewStillSeesAbsences() {
    const { userId, token } = await createMemberAndLogin(
      testApp,
      'rok1427_week',
      'rok1427_week@test.local',
    );
    // The Sunday four weeks back — a fully elapsed week.
    const weekStart = new Date();
    weekStart.setUTCHours(0, 0, 0, 0);
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay() - 28);
    const dayIn = (n: number) => {
      const d = new Date(weekStart);
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().split('T')[0];
    };
    const pastId = await seedAbsence(
      userId,
      dayIn(1),
      dayIn(3),
      'Past week trip',
    );

    const viewRes = await testApp.request
      .get(`/users/me/game-time?week=${weekStart.toISOString()}`)
      .set('Authorization', `Bearer ${token}`);

    expect(viewRes.status).toBe(200);
    const viewAbsences = viewRes.body.data.absences as Array<{ id: number }>;
    expect(viewAbsences.map((a) => a.id)).toContain(pastId);

    // ...while the same absence is correctly absent from the list endpoint.
    const listRes = await testApp.request
      .get('/users/me/game-time/absences')
      .set('Authorization', `Bearer ${token}`);
    const listIds = (listRes.body.data as Array<{ id: number }>).map(
      (a) => a.id,
    );
    expect(listIds).not.toContain(pastId);
  }
  it('still renders past absences in a past-week composite view', () =>
    testPastWeekCompositeViewStillSeesAbsences());
}

describe('Game-Time (integration)', () => {
  // Same setup/teardown as game-time.integration.spec.ts. The admin token
  // is not needed here, but the login still runs so the lifecycle matches.
  beforeAll(async () => {
    testApp = await getTestApp();
    await loginAsAdmin(testApp.request, testApp.seed);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    await loginAsAdmin(testApp.request, testApp.seed);
  });

  // ===================================================================
  // Regression: ROK-1427 — expired absences must leave the list
  // ===================================================================

  describe('Regression: ROK-1427', () => describeRok1427());
});
