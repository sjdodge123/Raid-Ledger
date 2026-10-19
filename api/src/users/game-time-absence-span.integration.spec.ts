/**
 * ROK-1842 — an unbounded game-time absence (0001-01-01..9999-12-31) made
 * every `/users/me/game-time` read walk 3.64M days (~4s CPU, ~270MB).
 *
 * - POST rejects an oversized or out-of-window range with 400.
 * - A row stored before the cap (seeded straight into the DB) still renders,
 *   clamped to the week, without the multi-second stall.
 * - Migration 0228 trims such rows in place.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asc, eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { createMemberAndLogin } from './game-time.integration.spec-helpers';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

function member(tag: string) {
  return createMemberAndLogin(testApp, `gtspan${tag}`, `gtspan${tag}@t.local`);
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

describe('POST /users/me/game-time/absences span cap (ROK-1842)', () => {
  it.each([
    ['the year-1 to year-9999 attack range', '0001-01-01', '9999-12-31'],
    ['a 367-day span', '2026-01-01', '2027-01-02'],
    ['a start before 2000', '1999-12-31', '2000-01-05'],
    ['an end after 2100', '2100-12-31', '2101-01-01'],
  ])('rejects %s with 400 and stores nothing', async (_l, start, end) => {
    const { userId, token } = await member('post');
    const res = await postAbsence(token, start, end);
    expect(res.status).toBe(400);
    expect(await absenceCount(userId)).toBe(0);
  });

  it('accepts a 366-day span', async () => {
    const { token } = await member('ok');
    const res = await postAbsence(token, '2028-01-01', '2028-12-31');
    expect(res.status).toBe(201);
  });
});

describe('composite view with a pre-cap oversized row (ROK-1842)', () => {
  it('renders clamped to the week and does not stall', async () => {
    const { userId, token } = await member('old');
    await testApp.request
      .put('/users/me/game-time')
      .set('Authorization', `Bearer ${token}`)
      .send({ slots: [{ dayOfWeek: 2, hour: 14 }] });
    // Old-shape row: the pre-ROK-1842 contract accepted it.
    await testApp.db.insert(schema.gameTimeAbsences).values({
      userId,
      startDate: '0001-01-01',
      endDate: '9999-12-31',
    });

    const started = Date.now();
    const res = await testApp.request
      .get('/users/me/game-time?week=2026-04-05T00:00:00.000Z')
      .set('Authorization', `Bearer ${token}`);
    const elapsedMs = Date.now() - started;

    expect(res.status).toBe(200);
    const slots = (
      res.body as { data: { slots: Array<Record<string, unknown>> } }
    ).data.slots;
    const tue = slots.find((s) => s.dayOfWeek === 2 && s.hour === 14);
    expect(tue?.status).toBe('blocked');
    // Unclamped, this read took ~4.3s of synchronous CPU.
    expect(elapsedMs).toBeLessThan(2000);
  });
});

/** Run migration 0226's statements against the current test DB. */
async function runCapMigration(): Promise<void> {
  const file = join(
    __dirname,
    '../drizzle/migrations/0228_cap_game_time_absence_span.sql',
  );
  const statements = readFileSync(file, 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) {
    await testApp.db.execute(sql.raw(statement));
  }
}

describe('migration 0228 trims oversized absences (ROK-1842)', () => {
  it('clamps, caps and drops rows the old contract let through', async () => {
    const { userId } = await member('mig');
    const a = schema.gameTimeAbsences;
    await testApp.db.insert(a).values([
      { userId, startDate: '0001-01-01', endDate: '9999-12-31' },
      { userId, startDate: '1990-01-01', endDate: '1995-01-01' },
      { userId, startDate: '2026-01-01', endDate: '2027-06-01' },
      { userId, startDate: '2026-04-06', endDate: '2026-04-08' },
    ]);

    await runCapMigration();

    const rows = await testApp.db
      .select({ startDate: a.startDate, endDate: a.endDate })
      .from(a)
      .where(eq(a.userId, userId))
      .orderBy(asc(a.startDate));
    expect(rows).toEqual([
      { startDate: '2000-01-01', endDate: '2000-12-31' },
      { startDate: '2026-01-01', endDate: '2027-01-01' },
      { startDate: '2026-04-06', endDate: '2026-04-08' },
    ]);
  });
});
