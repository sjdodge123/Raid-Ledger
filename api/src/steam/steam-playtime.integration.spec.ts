/**
 * Integration test for batch playtime UPDATE ... FROM VALUES pattern.
 * Verifies the raw SQL in steam-playtime.helpers.ts works against a real DB.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { at } from '../common/testing/narrow';
import { eq } from 'drizzle-orm';
import {
  updateExistingPlaytime,
  type PlaytimeUpdateEntry,
} from './steam-playtime.helpers';

const STEAM_A = '76561198000000001';
const STEAM_B = '76561198000000002';

function describeBatchPlaytimeUpdate() {
  let testApp: TestApp;
  let userId: number;
  let gameIds: number[];

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  beforeEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    userId = testApp.seed.adminUser.id;
    await testApp.db
      .update(schema.users)
      .set({ steamId: STEAM_A })
      .where(eq(schema.users.id, userId));

    // Create 5 games with steam_app_id
    const games = await testApp.db
      .insert(schema.games)
      .values(
        Array.from({ length: 5 }, (_, i) => ({
          name: `Steam Game ${i}`,
          slug: `steam-game-${i}`,
          steamAppId: 1000 + i,
        })),
      )
      .returning({ id: schema.games.id });
    gameIds = games.map((g) => g.id);

    // Insert game_interests for each game (steam_library source)
    await testApp.db.insert(schema.gameInterests).values(
      gameIds.map((gId) => ({
        userId,
        gameId: gId,
        source: 'steam_library' as const,
        playtimeForever: 100,
        playtime2weeks: 10,
      })),
    );
  });

  it('should batch-update playtime for existing interests', async () => {
    const toUpdate: PlaytimeUpdateEntry[] = gameIds.map((gId, i) => ({
      gameId: gId,
      playtimeForever: 200 + i,
      playtime2weeks: 20 + i,
    }));

    const updated = await updateExistingPlaytime(
      testApp.db,
      userId,
      STEAM_A,
      toUpdate,
    );
    expect(updated).toBe(5);

    // Verify values persisted
    const rows = await testApp.db
      .select({
        gameId: schema.gameInterests.gameId,
        playtimeForever: schema.gameInterests.playtimeForever,
        playtime2weeks: schema.gameInterests.playtime2weeks,
        lastSyncedAt: schema.gameInterests.lastSyncedAt,
      })
      .from(schema.gameInterests);

    for (const row of rows) {
      const idx = gameIds.indexOf(row.gameId);
      expect(row.playtimeForever).toBe(200 + idx);
      expect(row.playtime2weeks).toBe(20 + idx);
      expect(row.lastSyncedAt).toBeTruthy();
    }
  });

  it('should handle null playtime_2weeks', async () => {
    const toUpdate: PlaytimeUpdateEntry[] = [
      { gameId: at(gameIds, 0), playtimeForever: 500, playtime2weeks: null },
    ];

    const updated = await updateExistingPlaytime(
      testApp.db,
      userId,
      STEAM_A,
      toUpdate,
    );
    expect(updated).toBe(1);
  });

  it('should handle empty array without error', async () => {
    const updated = await updateExistingPlaytime(
      testApp.db,
      userId,
      STEAM_A,
      [],
    );
    expect(updated).toBe(0);
  });

  it('should handle large batch exceeding BATCH_SIZE', async () => {
    // Create 250 more games + interests (total 255, exceeding BATCH_SIZE=200)
    const moreGames = await testApp.db
      .insert(schema.games)
      .values(
        Array.from({ length: 250 }, (_, i) => ({
          name: `Bulk Game ${i}`,
          slug: `bulk-game-${i}`,
          steamAppId: 5000 + i,
        })),
      )
      .returning({ id: schema.games.id });
    const allGameIds = [...gameIds, ...moreGames.map((g) => g.id)];

    await testApp.db.insert(schema.gameInterests).values(
      moreGames.map((g) => ({
        userId,
        gameId: g.id,
        source: 'steam_library' as const,
        playtimeForever: 0,
        playtime2weeks: null,
      })),
    );

    const toUpdate: PlaytimeUpdateEntry[] = allGameIds.map((gId) => ({
      gameId: gId,
      playtimeForever: 999,
      playtime2weeks: null,
    }));

    const updated = await updateExistingPlaytime(
      testApp.db,
      userId,
      STEAM_A,
      toUpdate,
    );
    expect(updated).toBe(allGameIds.length);
  });

  /** Each interest's playtime_forever, keyed by game id. */
  async function playtimes(): Promise<Map<number, number | null>> {
    const rows = await testApp.db
      .select({
        gameId: schema.gameInterests.gameId,
        playtimeForever: schema.gameInterests.playtimeForever,
      })
      .from(schema.gameInterests)
      .where(eq(schema.gameInterests.userId, userId));
    return new Map(rows.map((r) => [r.gameId, r.playtimeForever]));
  }

  const rewrite = (): PlaytimeUpdateEntry[] =>
    gameIds.map((gId) => ({
      gameId: gId,
      playtimeForever: 777,
      playtime2weeks: 7,
    }));

  it('a sync for an account the user has since unlinked writes nothing back', async () => {
    await testApp.db
      .update(schema.users)
      .set({ steamId: null })
      .where(eq(schema.users.id, userId));
    const updated = await updateExistingPlaytime(
      testApp.db,
      userId,
      STEAM_A,
      rewrite(),
    );
    expect(updated).toBe(0);
    expect([...(await playtimes()).values()]).toEqual(gameIds.map(() => 100));
  });

  it('a sync for account A after the user swapped to B writes nothing back', async () => {
    await testApp.db
      .update(schema.users)
      .set({ steamId: STEAM_B })
      .where(eq(schema.users.id, userId));
    const updated = await updateExistingPlaytime(
      testApp.db,
      userId,
      STEAM_A,
      rewrite(),
    );
    expect(updated).toBe(0);
    expect([...(await playtimes()).values()]).toEqual(gameIds.map(() => 100));
  });
}

describe(
  'Steam Playtime Batch Update (integration)',
  describeBatchPlaytimeUpdate,
);
