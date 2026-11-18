/**
 * All-time Game Activity counts each session once (ROK-2262).
 *
 * `game_activity_rollups` holds a `day`, a `week` AND a `month` row covering
 * the same session. The all-time readers used to sum every row of the game
 * (or user), so one 90-minute session read as 270 minutes. Each reader must
 * restrict `period='all'` to a single granularity.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { nonEmpty } from '../common/testing/narrow';
import { queryGameActivity } from './igdb-status.helpers';
import { fetchGameActivity } from '../users/users-query.helpers';

/** One 90-minute session, rolled up into all three buckets. */
const SESSION_SECONDS = 5400;

/** The day/week/month buckets the rollup cron writes for that session. */
const BUCKETS = [
  { period: 'day', periodStart: '2026-03-05' },
  { period: 'week', periodStart: '2026-03-02' },
  { period: 'month', periodStart: '2026-03-01' },
] as const;

describe('all-time Game Activity totals (ROK-2262)', () => {
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
    const [game] = nonEmpty(
      await testApp.db
        .insert(schema.games)
        .values({ name: 'All Time Rollup', slug: 'all-time-rollup' })
        .returning(),
      'game',
    );
    gameId = game.id;
    const [user] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({
          discordId: 'd:all-time-rollup',
          username: 'all-time-rollup',
          role: 'member',
        })
        .returning(),
      'user',
    );
    userId = user.id;
    await testApp.db.insert(schema.gameActivityRollups).values(
      BUCKETS.map((b) => ({
        userId,
        gameId,
        period: b.period,
        periodStart: b.periodStart,
        totalSeconds: SESSION_SECONDS,
      })),
    );
  });

  it('game page: all-time total equals the session, not day+week+month', async () => {
    const result = await queryGameActivity(testApp.db, gameId, 'all');

    expect(result.totalSeconds).toBe(SESSION_SECONDS);
    expect(result.topPlayers.map((p) => p.totalSeconds)).toEqual([
      SESSION_SECONDS,
    ]);
  });

  it('user profile: all-time total equals the session, not day+week+month', async () => {
    const entries = await fetchGameActivity(testApp.db, userId, 'all', userId);

    expect(entries.map((e) => [e.gameId, e.totalSeconds])).toEqual([
      [gameId, SESSION_SECONDS],
    ]);
  });
});
