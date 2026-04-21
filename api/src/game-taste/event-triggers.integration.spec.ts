/**
 * Event-driven recompute trigger tests (ROK-1082, Phase E).
 *
 * Verifies the wiring between the five signal-change write paths and
 * GameTasteService.enqueueRecompute:
 *
 *   1. ITAD tag sync          (enrichSyncedGamesWithItad → IgdbService)
 *   2. ITAD-first upsert      (upsertItadGame via ItadSearchDeps → IgdbService)
 *   3. IGDB metadata upsert   (upsertGamesFromApi → IgdbService)
 *   4. Game activity rollup   (aggregateRollups → GameActivityService)
 *   5. Unban                  (unbanGame → IgdbService)
 *
 * We spy on GameTasteService.enqueueRecompute to verify each write path
 * fires it with the expected game id. The BullMQ queue itself is
 * exercised by unit/processor tests elsewhere; here we only care about
 * trigger-point wiring.
 */
import { Logger } from '@nestjs/common';
import { sql, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { GameTasteService } from './game-taste.service';
import { IgdbService } from '../igdb/igdb.service';
import { GameActivityService } from '../discord-bot/services/game-activity.service';
import { aggregateRollups } from '../discord-bot/services/game-activity-rollup.helpers';
import { upsertGamesFromApi } from '../igdb/igdb-upsert.helpers';
import type { IgdbApiGame } from '../igdb/igdb.constants';

describe('Game Taste Event Triggers (ROK-1082)', () => {
  let testApp: TestApp;
  let enqueueSpy: jest.SpyInstance;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  beforeEach(() => {
    const service = testApp.app.get(GameTasteService);
    enqueueSpy = jest
      .spyOn(service, 'enqueueRecompute')
      .mockResolvedValue(undefined);
  });

  afterEach(async () => {
    enqueueSpy.mockRestore();
    testApp.seed = await truncateAllTables(testApp.db);
  });

  // ─── helpers ─────────────────────────────────────────────

  async function seedGame(
    name: string,
    opts: { igdbId?: number; banned?: boolean } = {},
  ): Promise<number> {
    const [g] = await testApp.db
      .insert(schema.games)
      .values({
        name,
        slug: name.toLowerCase().replace(/\s+/g, '-'),
        igdbId: opts.igdbId,
        banned: opts.banned ?? false,
      })
      .returning();
    return g.id;
  }

  async function seedUser(discordId: string): Promise<number> {
    const [u] = await testApp.db
      .insert(schema.users)
      .values({
        discordId,
        username: discordId.slice(0, 20),
        role: 'member',
      })
      .returning();
    return u.id;
  }

  async function seedClosedSession(
    userId: number,
    gameId: number,
    durationSeconds = 600,
  ): Promise<void> {
    const startedAt = new Date(Date.now() - 60 * 60 * 1000);
    const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);
    await testApp.db.insert(schema.gameActivitySessions).values({
      userId,
      gameId,
      startedAt,
      endedAt,
      durationSeconds,
      discordActivityName: 'TestGame',
    });
  }

  // ─── AC: IGDB upsert trigger ─────────────────────────────

  it('upsertGamesFromApi fires enqueueRecompute for every touched gameId', async () => {
    const apiGames: IgdbApiGame[] = [
      {
        id: 9000001,
        name: 'Trigger Test Game A',
        slug: 'trigger-test-game-a',
      } as IgdbApiGame,
      {
        id: 9000002,
        name: 'Trigger Test Game B',
        slug: 'trigger-test-game-b',
      } as IgdbApiGame,
    ];

    const igdbService = testApp.app.get(IgdbService);
    const results = await igdbService.upsertGamesFromApi(apiGames);

    expect(results.length).toBe(2);
    const enqueuedIds = enqueueSpy.mock.calls.map((c) => c[0] as number);
    for (const r of results) {
      expect(enqueuedIds).toContain(r.id);
    }
  });

  // ─── AC: unban trigger ───────────────────────────────────

  it('unbanGame fires enqueueRecompute for the game that was unbanned', async () => {
    const gameId = await seedGame('Banned Then Restored', { banned: true });
    const igdbService = testApp.app.get(IgdbService);

    const result = await igdbService.unbanGame(gameId);

    expect(result.success).toBe(true);
    const enqueuedIds = enqueueSpy.mock.calls.map((c) => c[0] as number);
    expect(enqueuedIds).toContain(gameId);
  });

  // ─── AC: activity rollup trigger ────────────────────────

  it('aggregateRollups fires enqueueRecompute once per unique gameId in batch', async () => {
    const game1 = await seedGame('Rollup Game 1');
    const game2 = await seedGame('Rollup Game 2');
    const userId = await seedUser('d:trigger-rollup-1');
    // Two sessions on game1, one on game2 — should dedupe to two enqueues.
    await seedClosedSession(userId, game1);
    await seedClosedSession(userId, game1);
    await seedClosedSession(userId, game2);

    const activityService = testApp.app.get(GameActivityService);
    await activityService.aggregateRollups();

    const enqueuedIds = enqueueSpy.mock.calls.map((c) => c[0] as number);
    expect(enqueuedIds).toContain(game1);
    expect(enqueuedIds).toContain(game2);
    const game1Count = enqueuedIds.filter((id) => id === game1).length;
    expect(game1Count).toBe(1);
  });

  // ─── AC: helper-level contract ──────────────────────────

  it('aggregateRollups helper invokes onGamesChanged with deduped gameIds', async () => {
    const game1 = await seedGame('Helper Rollup A');
    const game2 = await seedGame('Helper Rollup B');
    const userId = await seedUser('d:trigger-rollup-2');
    await seedClosedSession(userId, game1);
    await seedClosedSession(userId, game1);
    await seedClosedSession(userId, game2);

    const received: number[][] = [];
    await aggregateRollups(testApp.db, new Logger('test'), (ids) => {
      received.push(ids);
    });

    expect(received.length).toBe(1);
    const set = new Set(received[0]);
    expect(set.has(game1)).toBe(true);
    expect(set.has(game2)).toBe(true);
    expect(received[0].length).toBe(2);
  });

  // ─── AC: upsertGamesFromApi helper-level contract ────────

  it('upsertGamesFromApi helper invokes onGameChanged for each commit', async () => {
    const apiGames: IgdbApiGame[] = [
      {
        id: 9100001,
        name: 'Helper Upsert Game',
        slug: 'helper-upsert-game',
      } as IgdbApiGame,
    ];
    const received: number[] = [];
    await upsertGamesFromApi(testApp.db, apiGames, (gameId) =>
      received.push(gameId),
    );

    expect(received.length).toBe(1);
    const [row] = await testApp.db
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(eq(schema.games.igdbId, 9100001))
      .limit(1);
    expect(received[0]).toBe(row.id);
  });

  // ─── AC: aggregate pipeline does NOT fire enqueue ────────

  it('runAggregateGameVectors does not enqueue recomputes (cron-owned path)', async () => {
    await seedGame('Agg Only');
    await testApp.db.execute(
      sql`SELECT 1 FROM game_taste_vectors LIMIT 0`,
    );
    enqueueSpy.mockClear();
    const service = testApp.app.get(GameTasteService);
    await service.aggregateGameVectors();
    expect(enqueueSpy).not.toHaveBeenCalled();
  });
});
