/**
 * ROK-1842 (Codex P2) — unlimited duplicate/overlapping absences grew every
 * composite read without bound.
 *
 * - POST refuses an exact-duplicate span with 409.
 * - POST refuses the (ABSENCE_MAX_PER_USER + 1)th manual absence with 409.
 * - 100 overlapping stored rows merge to one span and still render.
 */
import { eq } from 'drizzle-orm';
import { ABSENCE_MAX_PER_USER } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { createMemberAndLogin } from './game-time.integration.spec-helpers';
import { fetchAbsences } from './game-time-composite.helpers';
import { mergeWithinWindow } from './game-time-absence-merge.helpers';
import { ABSENCE_LIMIT_MESSAGES } from './game-time-absence-limit.helpers';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

function member(tag: string) {
  return createMemberAndLogin(testApp, `gtlim${tag}`, `gtlim${tag}@t.local`);
}

function postAbsence(token: string, startDate: string, endDate: string) {
  return testApp.request
    .post('/users/me/game-time/absences')
    .set('Authorization', `Bearer ${token}`)
    .send({ startDate, endDate });
}

async function absenceCount(userId: number): Promise<number> {
  const rows = await testApp.db
    .select({ id: schema.gameTimeAbsences.id })
    .from(schema.gameTimeAbsences)
    .where(eq(schema.gameTimeAbsences.userId, userId));
  return rows.length;
}

/** `n` manual one-day rows on distinct days from 2030-01-01. */
function distinctRows(userId: number, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const day = new Date(Date.UTC(2030, 0, 1 + i)).toISOString().slice(0, 10);
    return { userId, startDate: day, endDate: day };
  });
}

describe('POST /users/me/game-time/absences write limits (ROK-1842)', () => {
  it('rejects an exact-duplicate span with 409', async () => {
    const { userId, token } = await member('dup');
    expect((await postAbsence(token, '2026-05-01', '2026-05-03')).status).toBe(
      201,
    );
    const res = await postAbsence(token, '2026-05-01', '2026-05-03');
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain(
      ABSENCE_LIMIT_MESSAGES.duplicate,
    );
    expect(await absenceCount(userId)).toBe(1);
  });

  it(`rejects absence #${ABSENCE_MAX_PER_USER + 1} with 409`, async () => {
    const { userId, token } = await member('cap');
    await testApp.db
      .insert(schema.gameTimeAbsences)
      .values(distinctRows(userId, ABSENCE_MAX_PER_USER));
    const res = await postAbsence(token, '2026-05-01', '2026-05-01');
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain(ABSENCE_LIMIT_MESSAGES.overCap);
    expect(await absenceCount(userId)).toBe(ABSENCE_MAX_PER_USER);
  });

  it(`accepts absence #${ABSENCE_MAX_PER_USER} (the cap itself)`, async () => {
    const { token, userId } = await member('edge');
    await testApp.db
      .insert(schema.gameTimeAbsences)
      .values(distinctRows(userId, ABSENCE_MAX_PER_USER - 1));
    expect((await postAbsence(token, '2026-05-01', '2026-05-01')).status).toBe(
      201,
    );
  });
});

describe('composite view with 100 overlapping rows (ROK-1842)', () => {
  it('merges them to one span and renders the week', async () => {
    const { userId, token } = await member('ovl');
    await testApp.request
      .put('/users/me/game-time')
      .set('Authorization', `Bearer ${token}`)
      .send({ slots: [{ dayOfWeek: 2, hour: 14 }] });
    await testApp.db.insert(schema.gameTimeAbsences).values(
      Array.from({ length: 100 }, (_, i) => ({
        userId,
        startDate: '2026-04-01',
        endDate: i % 2 === 0 ? '2026-04-20' : '2026-04-15',
      })),
    );
    const rows = await fetchAbsences(
      testApp.db,
      userId,
      '2026-04-05',
      '2026-04-11',
    );
    expect(rows).toHaveLength(100);
    const week = { firstDate: '2026-04-05', lastDate: '2026-04-11' };
    expect(mergeWithinWindow(rows, week)).toEqual([
      { startDate: '2026-04-05', endDate: '2026-04-11' },
    ]);

    const res = await testApp.request
      .get('/users/me/game-time?week=2026-04-05T00:00:00.000Z')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const slots = (
      res.body as { data: { slots: Array<Record<string, unknown>> } }
    ).data.slots;
    const tue = slots.find((s) => s.dayOfWeek === 2 && s.hour === 14);
    expect(tue?.status).toBe('blocked');
  });
});
