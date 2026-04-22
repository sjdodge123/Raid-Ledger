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
import {
  refreshExistingGames,
  discoverPopularGames,
  enrichSyncedGamesWithItad,
} from '../igdb/igdb-sync.helpers';
import { executeItadSearch } from '../igdb/igdb-itad-search.helpers';
import { upsertItadGame } from '../igdb/igdb-itad-upsert.helpers';
import type { IgdbApiGame } from '../igdb/igdb.constants';
import type { ItadSearchDeps } from '../igdb/igdb-itad-search.helpers';
import type { ItadSearchGame } from '../igdb/igdb-itad-merge.helpers';
import type { ItadGame, ItadGameInfo } from '../itad/itad.constants';
import type { GameDetailDto } from '@raid-ledger/contract';

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
    await testApp.db.execute(sql`SELECT 1 FROM game_taste_vectors LIMIT 0`);
    enqueueSpy.mockClear();
    const service = testApp.app.get(GameTasteService);
    await service.aggregateGameVectors();
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  // ─── AC: ITAD tag sync trigger ───────────────────────────
  // enrichSyncedGamesWithItad threads onGameChanged through to the caller
  // for every successfully enriched game. The IgdbService binds this to
  // enqueueRecompute in production — here we verify at the helper level.

  it('enrichSyncedGamesWithItad fires onGameChanged once per successfully enriched game', async () => {
    // Seed two games with steamAppId so the helper's query picks them up.
    const [gameA] = await testApp.db
      .insert(schema.games)
      .values({
        name: 'ITAD Enrich A',
        slug: 'itad-enrich-a',
        steamAppId: 501,
      })
      .returning();
    const [gameB] = await testApp.db
      .insert(schema.games)
      .values({
        name: 'ITAD Enrich B',
        slug: 'itad-enrich-b',
        steamAppId: 502,
      })
      .returning();

    const lookupBySteamAppId = jest
      .fn<Promise<ItadGame | null>, [number]>()
      .mockImplementation((appId) =>
        Promise.resolve({
          id: `itad-uuid-${appId}`,
          slug: `itad-${appId}`,
          title: `Itad ${appId}`,
          type: 'game',
          mature: false,
          assets: { boxart: `https://cdn.itad.com/${appId}.jpg` },
        }),
      );
    const getGameInfo = jest
      .fn<Promise<ItadGameInfo | null>, [string]>()
      .mockResolvedValue({
        id: 'any',
        slug: 'any',
        title: 'any',
        type: 'game',
        mature: false,
        tags: ['rpg', 'indie'],
      });

    const received: number[] = [];
    const enriched = await enrichSyncedGamesWithItad(
      testApp.db,
      lookupBySteamAppId,
      getGameInfo,
      (gameId) => received.push(gameId),
    );

    expect(enriched).toBe(2);
    // Callback fires for each game id written.
    expect(received).toContain(gameA.id);
    expect(received).toContain(gameB.id);
    expect(received.length).toBe(2);
  });

  // ─── AC: ITAD-first upsert trigger (executeItadSearch path) ───

  it('executeItadSearch upsertAll path fires onGameUpserted for every persisted row', async () => {
    const itadSearchGame: ItadSearchGame = {
      id: 'uuid-itad-first',
      slug: 'itad-first-upsert-test',
      title: 'ITAD First Upsert Test',
      type: 'game',
      mature: false,
      assets: { boxart: 'https://cdn.itad.com/x.jpg' },
      tags: ['survival'],
    };

    const received: number[] = [];
    const deps: ItadSearchDeps = {
      searchItad: jest.fn().mockResolvedValue([itadSearchGame]),
      lookupSteamAppIds: jest.fn().mockResolvedValue(new Map()),
      enrichFromIgdb: jest.fn().mockResolvedValue(null),
      getAdultFilter: jest.fn().mockResolvedValue(false),
      isBannedOrHidden: jest.fn().mockResolvedValue(false),
      // Real upsert against the live test DB — this is the production path.
      upsertGame: (game: GameDetailDto) => upsertItadGame(testApp.db, game),
      onGameUpserted: (gameId) => received.push(gameId),
    };

    const result = await executeItadSearch(deps, 'itad first upsert test');
    expect(result.games.length).toBe(1);

    const [row] = await testApp.db
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(eq(schema.games.slug, 'itad-first-upsert-test'))
      .limit(1);
    expect(row).toBeDefined();
    expect(received).toEqual([row.id]);
  });

  // ─── AC: refreshExistingGames fires onGameChanged per upserted row ───

  it('refreshExistingGames fires onGameChanged for each refreshed game', async () => {
    // Seed two existing games with igdbId so the helper's select picks them up.
    const [gameA] = await testApp.db
      .insert(schema.games)
      .values({
        name: 'Refresh A',
        slug: 'refresh-a',
        igdbId: 8100001,
      })
      .returning();
    const [gameB] = await testApp.db
      .insert(schema.games)
      .values({
        name: 'Refresh B',
        slug: 'refresh-b',
        igdbId: 8100002,
      })
      .returning();

    const queryIgdb = jest
      .fn<Promise<IgdbApiGame[]>, [string]>()
      .mockResolvedValue([
        {
          id: 8100001,
          name: 'Refresh A',
          slug: 'refresh-a',
        } as IgdbApiGame,
        {
          id: 8100002,
          name: 'Refresh B',
          slug: 'refresh-b',
        } as IgdbApiGame,
      ]);

    const received: number[] = [];
    const refreshed = await refreshExistingGames(
      testApp.db,
      queryIgdb,
      '',
      (gameId) => received.push(gameId),
    );

    expect(refreshed).toBe(2);
    expect(received).toContain(gameA.id);
    expect(received).toContain(gameB.id);
  });

  // ─── AC: discoverPopularGames fires onGameChanged per upserted row ───

  it('discoverPopularGames fires onGameChanged for each discovered game', async () => {
    const queryIgdb = jest
      .fn<Promise<IgdbApiGame[]>, [string]>()
      .mockResolvedValue([
        {
          id: 8200001,
          name: 'Discover A',
          slug: 'discover-a',
        } as IgdbApiGame,
        {
          id: 8200002,
          name: 'Discover B',
          slug: 'discover-b',
        } as IgdbApiGame,
      ]);

    const received: number[] = [];
    const discovered = await discoverPopularGames(
      testApp.db,
      queryIgdb,
      '',
      (gameId) => received.push(gameId),
    );

    expect(discovered).toBe(2);
    expect(received.length).toBe(2);
    // Verify the ids match the newly inserted rows by igdbId.
    const rows = await testApp.db
      .select({ id: schema.games.id, igdbId: schema.games.igdbId })
      .from(schema.games)
      .where(sql`${schema.games.igdbId} IN (8200001, 8200002)`);
    const insertedIds = rows.map((r) => r.id);
    for (const id of insertedIds) {
      expect(received).toContain(id);
    }
  });
});
