/**
 * ROK-1593 — migration 0209 integrity.
 *
 * `game_time_absences.source` / `calendar_connection_id` CHECKs, the
 * connection → calendar-absence cascade, and `calendar_ignored_days` being
 * wiped with its user (epic ROK-669 §6.4.5). Rows are seeded straight into the
 * DB: these are schema guarantees, not route behaviour.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { createMemberAndLogin } from './game-time.integration.spec-helpers';
import { nonEmpty } from '../common/testing/narrow';
import { wipeUserData } from './users-delete.helpers';

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

const CHECK_VIOLATION = '23514';

/** The PG error drizzle wraps (SQLSTATE + constraint live on `.cause`). */
function pgError(code: string, constraint: string) {
  return {
    cause: expect.objectContaining({ code, constraint_name: constraint }),
  };
}

function member(tag: string) {
  return createMemberAndLogin(testApp, `gtas${tag}`, `gtas${tag}@test.local`);
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

function insertAbsence(
  userId: number,
  extra: Partial<typeof schema.gameTimeAbsences.$inferInsert>,
) {
  return testApp.db
    .insert(schema.gameTimeAbsences)
    .values({
      userId,
      startDate: '2026-11-02',
      endDate: '2026-11-03',
      ...extra,
    })
    .returning({ id: schema.gameTimeAbsences.id });
}

function absencesOf(userId: number) {
  return testApp.db
    .select()
    .from(schema.gameTimeAbsences)
    .where(eq(schema.gameTimeAbsences.userId, userId));
}

function ignoredDaysOf(userId: number) {
  return testApp.db
    .select()
    .from(schema.calendarIgnoredDays)
    .where(eq(schema.calendarIgnoredDays.userId, userId));
}

describe('game_time_absences.source CHECKs (ROK-1593 0209)', () => {
  it('defaults an absence without a source to manual, no connection', async () => {
    const { userId } = await member('dflt');
    await insertAbsence(userId, { reason: 'Trip' });
    const [row] = nonEmpty(await absencesOf(userId), 'absence');
    expect(row.source).toBe('manual');
    expect(row.calendarConnectionId).toBeNull();
  });

  it("rejects source='calendar' without a connection", async () => {
    const { userId } = await member('calnoconn');
    await expect(
      insertAbsence(userId, { source: 'calendar' }),
    ).rejects.toMatchObject(
      pgError(CHECK_VIOLATION, 'game_time_absences_source_conn_chk'),
    );
  });

  it("rejects source='manual' with a connection", async () => {
    const { userId } = await member('manconn');
    const connId = await seedConnection(userId, 'sub-gtas-manconn');
    await expect(
      insertAbsence(userId, { source: 'manual', calendarConnectionId: connId }),
    ).rejects.toMatchObject(
      pgError(CHECK_VIOLATION, 'game_time_absences_source_conn_chk'),
    );
  });

  it('rejects an unknown source', async () => {
    const { userId } = await member('unknown');
    await expect(
      insertAbsence(userId, { source: 'import' }),
    ).rejects.toMatchObject(
      pgError(CHECK_VIOLATION, 'game_time_absences_source_chk'),
    );
  });

  it("accepts source='calendar' with a connection", async () => {
    const { userId } = await member('calok');
    const connId = await seedConnection(userId, 'sub-gtas-calok');
    await insertAbsence(userId, {
      source: 'calendar',
      calendarConnectionId: connId,
    });
    const [row] = nonEmpty(await absencesOf(userId), 'absence');
    expect(row).toMatchObject({
      source: 'calendar',
      calendarConnectionId: connId,
    });
  });
});

describe('calendar_connection_id cascade (ROK-1593 0209)', () => {
  it("deleting a connection removes only that connection's absences", async () => {
    const { userId } = await member('cascade');
    const gone = await seedConnection(userId, 'sub-gtas-gone');
    const kept = await seedConnection(userId, 'sub-gtas-kept');
    await insertAbsence(userId, { reason: 'Trip' });
    await insertAbsence(userId, {
      source: 'calendar',
      calendarConnectionId: gone,
    });
    await insertAbsence(userId, {
      source: 'calendar',
      calendarConnectionId: kept,
    });

    await testApp.db
      .delete(schema.calendarConnections)
      .where(eq(schema.calendarConnections.id, gone));

    const left = (await absencesOf(userId)).map((a) => ({
      source: a.source,
      calendarConnectionId: a.calendarConnectionId,
    }));
    expect(left).toHaveLength(2);
    expect(left).toEqual(
      expect.arrayContaining([
        { source: 'manual', calendarConnectionId: null },
        { source: 'calendar', calendarConnectionId: kept },
      ]),
    );
  });
});

describe('calendar_ignored_days wiped with the user (ROK-669 §6.4.5)', () => {
  async function seedIgnored(userId: number, dates: string[]) {
    await testApp.db
      .insert(schema.calendarIgnoredDays)
      .values(dates.map((date) => ({ userId, date })));
  }

  it('rejects a duplicate (user, date)', async () => {
    const { userId } = await member('dup');
    await seedIgnored(userId, ['2026-11-02']);
    await expect(seedIgnored(userId, ['2026-11-02'])).rejects.toMatchObject({
      cause: expect.objectContaining({ code: '23505' }),
    });
  });

  it('DELETE /users/:id removes the ignored days, not another user’s', async () => {
    const { userId } = await member('del');
    const other = await member('delother');
    await seedIgnored(userId, ['2026-11-02', '2026-11-03']);
    await seedIgnored(other.userId, ['2026-11-02']);

    await testApp.request
      .delete(`/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    expect(await ignoredDaysOf(userId)).toEqual([]);
    expect(await ignoredDaysOf(other.userId)).toHaveLength(1);
  });

  it('ban+wipe (users row kept, no cascade) still removes them', async () => {
    const { userId } = await member('wipe');
    await seedIgnored(userId, ['2026-11-02']);

    await testApp.db.transaction((tx) =>
      wipeUserData(tx, userId, testApp.seed.adminUser.id),
    );

    expect(await ignoredDaysOf(userId)).toEqual([]);
    const users = await testApp.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    expect(users).toHaveLength(1);
  });
});
