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

interface PlaytimeCtx {
  testApp: TestApp;
  userId: number;
  gameIds: number[];
}

type GetCtx = () => PlaytimeCtx;

/** Insert `count` steam games; returns their ids. */
async function seedGames(
  testApp: TestApp,
  count: number,
  prefix: string,
  firstAppId: number,
): Promise<number[]> {
  const games = await testApp.db
    .insert(schema.games)
    .values(
      Array.from({ length: count }, (_, i) => ({
        name: `${prefix} Game ${i}`,
        slug: `${prefix.toLowerCase()}-game-${i}`,
        steamAppId: firstAppId + i,
      })),
    )
    .returning({ id: schema.games.id });
  return games.map((g) => g.id);
}

/** Fresh DB: the admin linked to STEAM_A with 5 steam_library interests. */
async function seedSteamUser(testApp: TestApp): Promise<PlaytimeCtx> {
  testApp.seed = await truncateAllTables(testApp.db);
  const userId = testApp.seed.adminUser.id;
  await setSteamId(testApp, userId, STEAM_A);
  const gameIds = await seedGames(testApp, 5, 'Steam', 1000);
  await testApp.db.insert(schema.gameInterests).values(
    gameIds.map((gId) => ({
      userId,
      gameId: gId,
      source: 'steam_library' as const,
      playtimeForever: 100,
      playtime2weeks: 10,
    })),
  );
  return { testApp, userId, gameIds };
}

async function setSteamId(
  testApp: TestApp,
  userId: number,
  steamId: string | null,
): Promise<void> {
  await testApp.db
    .update(schema.users)
    .set({ steamId })
    .where(eq(schema.users.id, userId));
}

/** Each interest's playtime_forever, keyed by game id. */
async function playtimes({
  testApp,
  userId,
}: PlaytimeCtx): Promise<Map<number, number | null>> {
  const rows = await testApp.db
    .select({
      gameId: schema.gameInterests.gameId,
      playtimeForever: schema.gameInterests.playtimeForever,
    })
    .from(schema.gameInterests)
    .where(eq(schema.gameInterests.userId, userId));
  return new Map(rows.map((r) => [r.gameId, r.playtimeForever]));
}

function describeBatchUpdates(get: GetCtx): void {
  it('should batch-update playtime for existing interests', async () => {
    const { testApp, userId, gameIds } = get();
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
    const { testApp, userId, gameIds } = get();
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
}

function describeBatchEdgeCases(get: GetCtx): void {
  it('should handle empty array without error', async () => {
    const { testApp, userId } = get();
    const updated = await updateExistingPlaytime(
      testApp.db,
      userId,
      STEAM_A,
      [],
    );
    expect(updated).toBe(0);
  });

  it('should handle large batch exceeding BATCH_SIZE', async () => {
    const { testApp, userId, gameIds } = get();
    // Create 250 more games + interests (total 255, exceeding BATCH_SIZE=200)
    const moreIds = await seedGames(testApp, 250, 'Bulk', 5000);
    const allGameIds = [...gameIds, ...moreIds];

    await testApp.db.insert(schema.gameInterests).values(
      moreIds.map((gameId) => ({
        userId,
        gameId,
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
}

/** A STEAM_A sync applied after the user's link changed to `steamId`. */
async function syncAfterRelink(
  ctx: PlaytimeCtx,
  steamId: string | null,
): Promise<number> {
  await setSteamId(ctx.testApp, ctx.userId, steamId);
  const rewrite: PlaytimeUpdateEntry[] = ctx.gameIds.map((gId) => ({
    gameId: gId,
    playtimeForever: 777,
    playtime2weeks: 7,
  }));
  return updateExistingPlaytime(ctx.testApp.db, ctx.userId, STEAM_A, rewrite);
}

function describeAccountGuard(get: GetCtx): void {
  it('a sync for an account the user has since unlinked writes nothing back', async () => {
    const ctx = get();
    const updated = await syncAfterRelink(ctx, null);
    expect(updated).toBe(0);
    expect([...(await playtimes(ctx)).values()]).toEqual(
      ctx.gameIds.map(() => 100),
    );
  });

  it('a sync for account A after the user swapped to B writes nothing back', async () => {
    const ctx = get();
    const updated = await syncAfterRelink(ctx, STEAM_B);
    expect(updated).toBe(0);
    expect([...(await playtimes(ctx)).values()]).toEqual(
      ctx.gameIds.map(() => 100),
    );
  });
}

describe('Steam Playtime Batch Update (integration)', () => {
  let app: TestApp | undefined;
  let ctx: PlaytimeCtx | undefined;

  beforeAll(async () => {
    app = await getTestApp();
  });

  beforeEach(async () => {
    if (!app) throw new Error('test app not started');
    ctx = await seedSteamUser(app);
  });

  const get: GetCtx = () => {
    if (!ctx) throw new Error('playtime fixture not seeded');
    return ctx;
  };

  describe('batch UPDATE ... FROM VALUES', () => describeBatchUpdates(get));
  describe('edge cases', () => describeBatchEdgeCases(get));
  describe('linked-account guard', () => describeAccountGuard(get));
});
