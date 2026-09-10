/**
 * Game activity rollup recompute (ROK-1465).
 *
 * The daily cron uses a 48h lookback. Before this fix that window was also the
 * only input to the bucket total: `aggregateRollups` summed the window and
 * hard-`SET` it, so a `week`/`month` bucket lost every contribution that had
 * closed earlier — the reported symptom was a game whose "This Week" tab had
 * playtime while "This Month" read empty.
 *
 * Dates are fixed absolute values (March 2026) rather than offsets from `now()`
 * so the "older session sits outside the lookback" premise holds on every day
 * of the calendar, not just mid-month.
 */
import { Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { aggregateRollups } from './game-activity-rollup.helpers';

/** Early-March session — well outside any lookback anchored on LOOKBACK. */
const EARLY_START = new Date('2026-03-05T10:00:00Z');
const EARLY_SECONDS = 3600;

/** Late-March session — the only one inside the lookback window. */
const LATE_START = new Date('2026-03-20T10:00:00Z');
const LATE_SECONDS = 1800;

/** Cutoff that leaves EARLY outside the window and LATE inside it. */
const LOOKBACK = new Date('2026-03-19T00:00:00Z');

const MONTH_START = '2026-03-01';

describe('aggregateRollups — full-bucket recompute (ROK-1465)', () => {
  let testApp: TestApp;
  let userId: number;
  let gameId: number;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  beforeEach(async () => {
    const [game] = await testApp.db
      .insert(schema.games)
      .values({ name: 'Rollup Recompute', slug: 'rollup-recompute' })
      .returning();
    gameId = game.id;

    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: 'd:rollup-recompute',
        username: 'rollup-recompute',
        role: 'member',
      })
      .returning();
    userId = user.id;
  });

  async function seedSession(
    startedAt: Date,
    durationSeconds: number,
  ): Promise<void> {
    await testApp.db.insert(schema.gameActivitySessions).values({
      userId,
      gameId,
      startedAt,
      endedAt: new Date(startedAt.getTime() + durationSeconds * 1000),
      durationSeconds,
      discordActivityName: 'Rollup Recompute',
    });
  }

  async function rollupTotal(period: string): Promise<number> {
    const rows = await testApp.db
      .select({ total: schema.gameActivityRollups.totalSeconds })
      .from(schema.gameActivityRollups)
      .where(
        and(
          eq(schema.gameActivityRollups.gameId, gameId),
          eq(schema.gameActivityRollups.period, period),
        ),
      );
    return rows.reduce((sum, r) => sum + r.total, 0);
  }

  async function run(): Promise<void> {
    await aggregateRollups(
      testApp.db,
      new Logger('rollup-test'),
      undefined,
      LOOKBACK,
    );
  }

  it('sums every session in the month, not just the lookback window', async () => {
    await seedSession(EARLY_START, EARLY_SECONDS);
    await seedSession(LATE_START, LATE_SECONDS);

    await run();

    expect(await rollupTotal('month')).toBe(EARLY_SECONDS + LATE_SECONDS);
  });

  it('files the recomputed month total under the calendar month start', async () => {
    await seedSession(EARLY_START, EARLY_SECONDS);
    await seedSession(LATE_START, LATE_SECONDS);

    await run();

    const [row] = await testApp.db
      .select({
        periodStart: schema.gameActivityRollups.periodStart,
        total: schema.gameActivityRollups.totalSeconds,
      })
      .from(schema.gameActivityRollups)
      .where(
        and(
          eq(schema.gameActivityRollups.gameId, gameId),
          eq(schema.gameActivityRollups.period, 'month'),
        ),
      );

    expect(row?.periodStart).toBe(MONTH_START);
    expect(row?.total).toBe(EARLY_SECONDS + LATE_SECONDS);
  });

  it('is idempotent — a second run does not double-count', async () => {
    await seedSession(EARLY_START, EARLY_SECONDS);
    await seedSession(LATE_START, LATE_SECONDS);

    await run();
    await run();

    expect(await rollupTotal('month')).toBe(EARLY_SECONDS + LATE_SECONDS);
  });

  it('recomputes only the buckets a recent session touches', async () => {
    await seedSession(EARLY_START, EARLY_SECONDS);
    await seedSession(LATE_START, LATE_SECONDS);

    await run();

    // EARLY and LATE fall in different weeks/days, and only LATE is inside the
    // lookback — so the narrower buckets carry LATE alone while `month`, which
    // both sessions share, carries the pair.
    expect(await rollupTotal('week')).toBe(LATE_SECONDS);
    expect(await rollupTotal('day')).toBe(LATE_SECONDS);
  });

  it('reports the games it touched exactly once', async () => {
    await seedSession(LATE_START, LATE_SECONDS);
    await seedSession(LATE_START, LATE_SECONDS);

    const received: number[][] = [];
    await aggregateRollups(
      testApp.db,
      new Logger('rollup-test'),
      (ids) => received.push(ids),
      LOOKBACK,
    );

    expect(received).toEqual([[gameId]]);
  });
});
