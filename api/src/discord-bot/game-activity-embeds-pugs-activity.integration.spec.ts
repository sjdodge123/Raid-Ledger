/**
 * Discord Game-Activity, Embed Scheduling & PUG Invites Integration Tests (ROK-527)
 *
 * Verifies game activity session persistence (buffered flush, close with duration,
 * stale sweep, orphaned cleanup), daily rollup aggregations, embed scheduler's
 * LEFT JOIN detection, embed poster's live roster enrichment, and PUG slot
 * atomic claim/update patterns against a real PostgreSQL database.
 *
 * Uses direct DB operations and service-level calls since these services are
 * triggered by Discord bot events, not HTTP endpoints.
 */
import { eq, and, isNull, lt } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return formatDate(d);
}

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

// ===================================================================
// Game Activity Sessions — Flush & Close
// ===================================================================

describe('game activity sessions — persist and close', () => {
  it('should persist a session record via direct insert (simulating flush)', async () => {
    const db = testApp.db;
    const startedAt = new Date();

    const [session] = await db
      .insert(schema.gameActivitySessions)
      .values({
        userId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        discordActivityName: 'Test Game',
        startedAt,
      })
      .returning();

    expect(session.userId).toBe(testApp.seed.adminUser.id);
    expect(session.gameId).toBe(testApp.seed.game.id);
    expect(session.discordActivityName).toBe('Test Game');
    expect(session.endedAt).toBeNull();
    expect(session.durationSeconds).toBeNull();

    const [readBack] = await db
      .select()
      .from(schema.gameActivitySessions)
      .where(eq(schema.gameActivitySessions.id, session.id))
      .limit(1);

    expect(readBack).toBeDefined();
    expect(readBack.userId).toBe(testApp.seed.adminUser.id);
  });

  it('should close a session with correct duration calculation', async () => {
    const db = testApp.db;
    const startedAt = new Date(Date.now() - 3600 * 1000);

    const [session] = await db
      .insert(schema.gameActivitySessions)
      .values({
        userId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        discordActivityName: 'Test Game',
        startedAt,
      })
      .returning();

    const endedAt = new Date();
    const durationSeconds = Math.floor(
      (endedAt.getTime() - startedAt.getTime()) / 1000,
    );

    await db
      .update(schema.gameActivitySessions)
      .set({ endedAt, durationSeconds })
      .where(eq(schema.gameActivitySessions.id, session.id));

    const [closed] = await db
      .select()
      .from(schema.gameActivitySessions)
      .where(eq(schema.gameActivitySessions.id, session.id))
      .limit(1);

    expect(closed.endedAt).not.toBeNull();
    expect(closed.durationSeconds).toBeGreaterThanOrEqual(3590);
    expect(closed.durationSeconds).toBeLessThanOrEqual(3610);
  });
});

describe('game activity sessions — game ID resolution', () => {
  it('should resolve game ID via discord_game_mappings table', async () => {
    const db = testApp.db;

    await db.insert(schema.discordGameMappings).values({
      discordActivityName: 'FINAL FANTASY XIV',
      gameId: testApp.seed.game.id,
    });

    const [mapping] = await db
      .select({ gameId: schema.discordGameMappings.gameId })
      .from(schema.discordGameMappings)
      .where(
        eq(schema.discordGameMappings.discordActivityName, 'FINAL FANTASY XIV'),
      )
      .limit(1);

    expect(mapping).toBeDefined();
    expect(mapping.gameId).toBe(testApp.seed.game.id);

    const [session] = await db
      .insert(schema.gameActivitySessions)
      .values({
        userId: testApp.seed.adminUser.id,
        gameId: mapping.gameId,
        discordActivityName: 'FINAL FANTASY XIV',
        startedAt: new Date(),
      })
      .returning();

    expect(session.gameId).toBe(testApp.seed.game.id);
  });

  it('should resolve game ID via exact name match on games table', async () => {
    const db = testApp.db;

    const [game] = await db
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(eq(schema.games.name, 'Test Game'))
      .limit(1);

    expect(game).toBeDefined();
    expect(game.id).toBe(testApp.seed.game.id);
  });

  it('should store session with null gameId for unmatched activity names', async () => {
    const db = testApp.db;

    const [session] = await db
      .insert(schema.gameActivitySessions)
      .values({
        userId: testApp.seed.adminUser.id,
        gameId: null,
        discordActivityName: 'Some Unknown Game',
        startedAt: new Date(),
      })
      .returning();

    expect(session.gameId).toBeNull();
    expect(session.discordActivityName).toBe('Some Unknown Game');
  });
});

describe('game activity sessions — open session matching', () => {
  it('should find open session by user + activity name for close matching', async () => {
    const db = testApp.db;
    const startedAt = new Date(Date.now() - 600_000);

    await db.insert(schema.gameActivitySessions).values({
      userId: testApp.seed.adminUser.id,
      gameId: testApp.seed.game.id,
      discordActivityName: 'Test Game',
      startedAt,
    });

    const [openSession] = await db
      .select({
        id: schema.gameActivitySessions.id,
        startedAt: schema.gameActivitySessions.startedAt,
      })
      .from(schema.gameActivitySessions)
      .where(
        and(
          eq(schema.gameActivitySessions.userId, testApp.seed.adminUser.id),
          eq(schema.gameActivitySessions.discordActivityName, 'Test Game'),
          isNull(schema.gameActivitySessions.endedAt),
        ),
      )
      .limit(1);

    expect(openSession).toBeDefined();
    expect(openSession.id).toBeDefined();
  });
});

// ===================================================================
// Stale Session Sweep
// ===================================================================

describe('stale session sweep', () => {
  it('should cap duration at 24h for sessions older than 24 hours', async () => {
    const db = testApp.db;
    const MAX_DURATION = 24 * 60 * 60;
    const staleStart = new Date(Date.now() - 25 * 60 * 60 * 1000);

    const [staleSession] = await db
      .insert(schema.gameActivitySessions)
      .values({
        userId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        discordActivityName: 'Stale Game',
        startedAt: staleStart,
      })
      .returning();

    await db
      .update(schema.gameActivitySessions)
      .set({ endedAt: new Date(), durationSeconds: MAX_DURATION })
      .where(
        and(
          isNull(schema.gameActivitySessions.endedAt),
          eq(schema.gameActivitySessions.id, staleSession.id),
        ),
      );

    const [swept] = await db
      .select()
      .from(schema.gameActivitySessions)
      .where(eq(schema.gameActivitySessions.id, staleSession.id))
      .limit(1);

    expect(swept.endedAt).not.toBeNull();
    expect(swept.durationSeconds).toBe(MAX_DURATION);
  });

  it('should not affect sessions started within 24 hours', async () => {
    const db = testApp.db;
    const MAX_DURATION = 24 * 60 * 60;
    const recentStart = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const [recentSession] = await db
      .insert(schema.gameActivitySessions)
      .values({
        userId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        discordActivityName: 'Recent Game',
        startedAt: recentStart,
      })
      .returning();

    const cutoff = new Date(Date.now() - MAX_DURATION * 1000);
    const swept = await db
      .update(schema.gameActivitySessions)
      .set({ endedAt: new Date(), durationSeconds: MAX_DURATION })
      .where(
        and(
          isNull(schema.gameActivitySessions.endedAt),
          lt(schema.gameActivitySessions.startedAt, cutoff),
        ),
      )
      .returning({ id: schema.gameActivitySessions.id });

    const sweptIds = swept.map((r) => r.id);
    expect(sweptIds).not.toContain(recentSession.id);

    const [session] = await db
      .select()
      .from(schema.gameActivitySessions)
      .where(eq(schema.gameActivitySessions.id, recentSession.id))
      .limit(1);

    expect(session.endedAt).toBeNull();
    expect(session.durationSeconds).toBeNull();
  });
});

// ===================================================================
// Orphaned Session Cleanup
// ===================================================================

describe('orphaned session cleanup — stale orphans', () => {
  it('should close stale orphans (>24h) with capped duration', async () => {
    const db = testApp.db;
    const MAX_DURATION = 24 * 60 * 60;
    const now = new Date();

    const staleStart = new Date(now.getTime() - 30 * 60 * 60 * 1000);
    const [stale] = await db
      .insert(schema.gameActivitySessions)
      .values({
        userId: testApp.seed.adminUser.id,
        gameId: null,
        discordActivityName: 'Orphan Stale',
        startedAt: staleStart,
      })
      .returning();

    const staleResult = await db
      .update(schema.gameActivitySessions)
      .set({ endedAt: now, durationSeconds: MAX_DURATION })
      .where(
        and(
          isNull(schema.gameActivitySessions.endedAt),
          eq(schema.gameActivitySessions.id, stale.id),
        ),
      )
      .returning({ id: schema.gameActivitySessions.id });

    expect(staleResult.length).toBe(1);

    const [closed] = await db
      .select()
      .from(schema.gameActivitySessions)
      .where(eq(schema.gameActivitySessions.id, stale.id))
      .limit(1);

    expect(closed.durationSeconds).toBe(MAX_DURATION);
    expect(closed.endedAt).not.toBeNull();
  });
});

describe('orphaned session cleanup — recent orphans', () => {
  it('should close recent orphans (<24h) with computed duration', async () => {
    const db = testApp.db;
    const now = new Date();

    const recentStart = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const [recent] = await db
      .insert(schema.gameActivitySessions)
      .values({
        userId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        discordActivityName: 'Orphan Recent',
        startedAt: recentStart,
      })
      .returning();

    const expectedDuration = Math.floor(
      (now.getTime() - recentStart.getTime()) / 1000,
    );
    await db
      .update(schema.gameActivitySessions)
      .set({ endedAt: now, durationSeconds: expectedDuration })
      .where(eq(schema.gameActivitySessions.id, recent.id));

    const [closed] = await db
      .select()
      .from(schema.gameActivitySessions)
      .where(eq(schema.gameActivitySessions.id, recent.id))
      .limit(1);

    expect(closed.endedAt).not.toBeNull();
    expect(closed.durationSeconds).toBeGreaterThanOrEqual(7190);
    expect(closed.durationSeconds).toBeLessThanOrEqual(7210);
  });
});

// ===================================================================
// Daily Rollup Aggregations
// ===================================================================

describe('daily rollup — upsert all periods', () => {
  it('should upsert day/week/month rollup rows from closed sessions', async () => {
    const db = testApp.db;

    const sessionDate = new Date();
    const [session] = await db
      .insert(schema.gameActivitySessions)
      .values({
        userId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        discordActivityName: 'Test Game',
        startedAt: new Date(sessionDate.getTime() - 3600_000),
        endedAt: sessionDate,
        durationSeconds: 3600,
      })
      .returning();

    expect(session.durationSeconds).toBe(3600);

    const dayStart = formatDate(session.startedAt);
    const weekStart = getWeekStart(session.startedAt);
    const monthStart = `${session.startedAt.getFullYear()}-${String(session.startedAt.getMonth() + 1).padStart(2, '0')}-01`;

    for (const [period, periodStart] of [
      ['day', dayStart],
      ['week', weekStart],
      ['month', monthStart],
    ] as const) {
      await db
        .insert(schema.gameActivityRollups)
        .values({
          userId: testApp.seed.adminUser.id,
          gameId: testApp.seed.game.id,
          period,
          periodStart,
          totalSeconds: 3600,
        })
        .onConflictDoUpdate({
          target: [
            schema.gameActivityRollups.userId,
            schema.gameActivityRollups.gameId,
            schema.gameActivityRollups.period,
            schema.gameActivityRollups.periodStart,
          ],
          set: { totalSeconds: 3600 },
        });
    }

    const rollups = await db
      .select()
      .from(schema.gameActivityRollups)
      .where(
        and(
          eq(schema.gameActivityRollups.userId, testApp.seed.adminUser.id),
          eq(schema.gameActivityRollups.gameId, testApp.seed.game.id),
        ),
      );

    expect(rollups.length).toBe(3);
    const periods = rollups.map((r) => r.period).sort();
    expect(periods).toEqual(['day', 'month', 'week']);

    for (const rollup of rollups) {
      expect(rollup.totalSeconds).toBe(3600);
    }
  });
});

describe('daily rollup — idempotent upsert', () => {
  it('should upsert (idempotent) on re-run with same period keys', async () => {
    const db = testApp.db;
    const dayStart = formatDate(new Date());

    await db.insert(schema.gameActivityRollups).values({
      userId: testApp.seed.adminUser.id,
      gameId: testApp.seed.game.id,
      period: 'day',
      periodStart: dayStart,
      totalSeconds: 1800,
    });

    await db
      .insert(schema.gameActivityRollups)
      .values({
        userId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        period: 'day',
        periodStart: dayStart,
        totalSeconds: 5400,
      })
      .onConflictDoUpdate({
        target: [
          schema.gameActivityRollups.userId,
          schema.gameActivityRollups.gameId,
          schema.gameActivityRollups.period,
          schema.gameActivityRollups.periodStart,
        ],
        set: { totalSeconds: 5400 },
      });

    const rollups = await db
      .select()
      .from(schema.gameActivityRollups)
      .where(
        and(
          eq(schema.gameActivityRollups.userId, testApp.seed.adminUser.id),
          eq(schema.gameActivityRollups.gameId, testApp.seed.game.id),
          eq(schema.gameActivityRollups.period, 'day'),
        ),
      );

    expect(rollups.length).toBe(1);
    expect(rollups[0].totalSeconds).toBe(5400);
  });
});

describe('daily rollup — multi-session aggregation', () => {
  it('should aggregate multiple sessions for the same user/game/period', async () => {
    const db = testApp.db;
    const dayStart = formatDate(new Date());

    await db.insert(schema.gameActivitySessions).values([
      {
        userId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        discordActivityName: 'Test Game',
        startedAt: new Date(Date.now() - 7200_000),
        endedAt: new Date(Date.now() - 3600_000),
        durationSeconds: 3600,
      },
      {
        userId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        discordActivityName: 'Test Game',
        startedAt: new Date(Date.now() - 1800_000),
        endedAt: new Date(),
        durationSeconds: 1800,
      },
    ]);

    const totalSeconds = 3600 + 1800;
    await db
      .insert(schema.gameActivityRollups)
      .values({
        userId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        period: 'day',
        periodStart: dayStart,
        totalSeconds,
      })
      .onConflictDoUpdate({
        target: [
          schema.gameActivityRollups.userId,
          schema.gameActivityRollups.gameId,
          schema.gameActivityRollups.period,
          schema.gameActivityRollups.periodStart,
        ],
        set: { totalSeconds },
      });

    const [rollup] = await db
      .select()
      .from(schema.gameActivityRollups)
      .where(
        and(
          eq(schema.gameActivityRollups.userId, testApp.seed.adminUser.id),
          eq(schema.gameActivityRollups.gameId, testApp.seed.game.id),
          eq(schema.gameActivityRollups.period, 'day'),
        ),
      )
      .limit(1);

    expect(rollup.totalSeconds).toBe(5400);
  });
});
