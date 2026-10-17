/**
 * ROK-1593 — Ignore vs delete for synced absences, and the
 * `source` / `provider` read model.
 *
 * - `POST /users/me/game-time/absences/:id/ignore`: calendar row → 204, the
 *   row is gone and every date of its range is in `calendar_ignored_days`;
 *   manual row → 409 `not_calendar`; missing / another user's → 404.
 * - `DELETE /users/me/game-time/absences/:id`: calendar row → 409
 *   `use_ignore`; manual delete unchanged.
 * - The list and composite endpoints return `source` and, for calendar rows,
 *   the connection's `provider`.
 *
 * Calendar rows are seeded straight into the DB (the derive that writes them
 * is covered elsewhere); the routes are driven over HTTP.
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { asc, eq } from 'drizzle-orm';
import { createMemberAndLogin } from '../../users/game-time.integration.spec-helpers';
import { nonEmpty } from '../../common/testing/narrow';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

// Far-future dates: the list endpoint only returns absences ending today+.
const START = '2030-03-04';
const END = '2030-03-06';
const RANGE_DATES = ['2030-03-04', '2030-03-05', '2030-03-06'];
/** Sunday of the week holding the range, for the composite endpoint. */
const WEEK = '2030-03-03T00:00:00.000Z';

function member(tag: string) {
  return createMemberAndLogin(testApp, `gtai${tag}`, `gtai${tag}@test.local`);
}

async function seedConnection(userId: number, subject: string) {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.calendarConnections)
      .values({
        userId,
        provider: 'google',
        accountSubject: subject,
        credentialsEncrypted: 'not-a-real-credential',
        status: 'active',
      })
      .returning({ id: schema.calendarConnections.id }),
    'connection',
  );
  return row.id;
}

async function seedAbsence(
  userId: number,
  extra: Partial<typeof schema.gameTimeAbsences.$inferInsert> = {},
) {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.gameTimeAbsences)
      .values({ userId, startDate: START, endDate: END, ...extra })
      .returning({ id: schema.gameTimeAbsences.id }),
    'absence',
  );
  return row.id;
}

async function seedCalendarAbsence(userId: number, subject: string) {
  const connId = await seedConnection(userId, subject);
  return seedAbsence(userId, {
    source: 'calendar',
    calendarConnectionId: connId,
  });
}

function absenceIdsOf(userId: number) {
  return testApp.db
    .select({ id: schema.gameTimeAbsences.id })
    .from(schema.gameTimeAbsences)
    .where(eq(schema.gameTimeAbsences.userId, userId));
}

async function ignoredDatesOf(userId: number) {
  const rows = await testApp.db
    .select({ date: schema.calendarIgnoredDays.date })
    .from(schema.calendarIgnoredDays)
    .where(eq(schema.calendarIgnoredDays.userId, userId))
    .orderBy(asc(schema.calendarIgnoredDays.date));
  return rows.map((r) => r.date);
}

function ignore(token: string, id: number) {
  return testApp.request
    .post(`/users/me/game-time/absences/${id}/ignore`)
    .set('Authorization', `Bearer ${token}`);
}

function del(token: string, id: number) {
  return testApp.request
    .delete(`/users/me/game-time/absences/${id}`)
    .set('Authorization', `Bearer ${token}`);
}

describe('POST /users/me/game-time/absences/:id/ignore (ROK-1593)', () => {
  it('removes a calendar absence and ignores every date of its range', async () => {
    const { userId, token } = await member('ign');
    const id = await seedCalendarAbsence(userId, 'sub-gtai-ign');

    const res = await ignore(token, id);

    expect(res.status).toBe(204);
    expect(await absenceIdsOf(userId)).toEqual([]);
    expect(await ignoredDatesOf(userId)).toEqual(RANGE_DATES);
  });

  it('tolerates a date that is already ignored (no PK conflict)', async () => {
    const { userId, token } = await member('dup');
    const id = await seedCalendarAbsence(userId, 'sub-gtai-dup');
    await testApp.db
      .insert(schema.calendarIgnoredDays)
      .values({ userId, date: '2030-03-05' });

    const res = await ignore(token, id);

    expect(res.status).toBe(204);
    expect(await ignoredDatesOf(userId)).toEqual(RANGE_DATES);
  });

  it('rejects a manual absence with 409 not_calendar and keeps it', async () => {
    const { userId, token } = await member('man');
    const id = await seedAbsence(userId, { reason: 'Trip' });

    const res = await ignore(token, id);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('not_calendar');
    expect(await absenceIdsOf(userId)).toEqual([{ id }]);
    expect(await ignoredDatesOf(userId)).toEqual([]);
  });

  it("404s on another user's calendar absence and leaves it intact", async () => {
    const owner = await member('own');
    const other = await member('oth');
    const id = await seedCalendarAbsence(owner.userId, 'sub-gtai-own');

    const res = await ignore(other.token, id);

    expect(res.status).toBe(404);
    expect(await absenceIdsOf(owner.userId)).toEqual([{ id }]);
    expect(await ignoredDatesOf(owner.userId)).toEqual([]);
    expect(await ignoredDatesOf(other.userId)).toEqual([]);
  });

  it('404s on an id that does not exist', async () => {
    const { token } = await member('miss');
    const res = await ignore(token, 999_999);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /users/me/game-time/absences/:id (ROK-1593)', () => {
  it('rejects a calendar absence with 409 use_ignore and keeps it', async () => {
    const { userId, token } = await member('delcal');
    const id = await seedCalendarAbsence(userId, 'sub-gtai-delcal');

    const res = await del(token, id);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('use_ignore');
    expect(await absenceIdsOf(userId)).toEqual([{ id }]);
    expect(await ignoredDatesOf(userId)).toEqual([]);
  });

  it('still deletes a manual absence (204)', async () => {
    const { userId, token } = await member('delman');
    const id = await seedAbsence(userId);

    const res = await del(token, id);

    expect(res.status).toBe(204);
    expect(await absenceIdsOf(userId)).toEqual([]);
  });

  it("does not delete another user's calendar absence", async () => {
    const owner = await member('delown');
    const other = await member('deloth');
    const id = await seedCalendarAbsence(owner.userId, 'sub-gtai-delown');

    const res = await del(other.token, id);

    expect(res.status).toBe(204);
    expect(await absenceIdsOf(owner.userId)).toEqual([{ id }]);
  });
});

describe('absence read model carries source + provider (ROK-1593)', () => {
  async function seedBoth(tag: string) {
    const { userId, token } = await member(tag);
    const manualId = await seedAbsence(userId, { reason: 'Trip' });
    const calendarId = await seedCalendarAbsence(userId, `sub-gtai-${tag}`);
    const expected = [
      {
        id: manualId,
        startDate: START,
        endDate: END,
        reason: 'Trip',
        source: 'manual',
      },
      {
        id: calendarId,
        startDate: START,
        endDate: END,
        reason: null,
        source: 'calendar',
        provider: 'google',
      },
    ];
    return { token, expected };
  }

  const byId = (rows: Array<{ id: number }>) =>
    [...rows].sort((x, y) => x.id - y.id);

  it('list endpoint returns source, and provider for calendar rows only', async () => {
    const { token, expected } = await seedBoth('list');

    const res = await testApp.request
      .get('/users/me/game-time/absences')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(byId(res.body.data as Array<{ id: number }>)).toEqual(expected);
  });

  it('composite view returns source, and provider for calendar rows only', async () => {
    const { token, expected } = await seedBoth('comp');

    const res = await testApp.request
      .get(`/users/me/game-time?week=${WEEK}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const data = res.body.data as { absences: Array<{ id: number }> };
    expect(byId(data.absences)).toEqual(expected);
  });
});
