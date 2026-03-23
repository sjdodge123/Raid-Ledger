/**
 * earlyAccess Persistence Integration Tests (ROK-934)
 *
 * Validates that the `early_access` boolean column is preserved or updated
 * correctly across all four write paths:
 *   1. ITAD bulk early-access sync  (executeBulkEarlyAccessUpdate)
 *   2. IGDB upsert                  (upsertSingleGameRow / buildUpsertSet)
 *   3. ITAD upsert                  (upsertItadGame / buildItadUpdateSet)
 *   4. IGDB sync ITAD enrichment    (enrichSyncedGamesWithItad)
 *
 * Tests use direct DB operations because the bug lives at the SQL level
 * (ON CONFLICT DO UPDATE column inclusion), not at the HTTP layer.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { executeBulkEarlyAccessUpdate } from '../itad/itad-early-access-sync.helpers';
import { upsertSingleGameRow } from './igdb-upsert.helpers';
import { upsertItadGame } from './igdb-itad-upsert.helpers';
import { enrichSyncedGamesWithItad } from './igdb-sync.helpers';
import { mapApiGameToDbRow } from './igdb.mappers';
import type { GameDetailDto } from '@raid-ledger/contract';
import type { IgdbApiGame } from './igdb.constants';

// ── helpers ──────────────────────────────────────────────────

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

/** Insert a game and return its row. */
async function insertGame(
  overrides: Partial<typeof schema.games.$inferInsert> = {},
): Promise<typeof schema.games.$inferSelect> {
  const slug = overrides.slug ?? `ea-test-${Date.now()}-${Math.random()}`;
  const [game] = await testApp.db
    .insert(schema.games)
    .values({
      name: 'Test EA Game',
      slug,
      ...overrides,
    })
    .returning();
  return game;
}

/** Read the current earlyAccess value for a game by id. */
async function fetchEarlyAccess(gameId: number): Promise<boolean> {
  const rows = await testApp.db
    .select({ earlyAccess: schema.games.earlyAccess })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  return rows[0].earlyAccess;
}

/** Build a minimal IgdbApiGame for upsert testing. */
function buildIgdbApiGame(igdbId: number, slug: string): IgdbApiGame {
  return {
    id: igdbId,
    name: `IGDB Game ${igdbId}`,
    slug,
  };
}

/** Build a minimal GameDetailDto for ITAD upsert testing. */
function buildGameDetailDto(
  slug: string,
  overrides: Partial<GameDetailDto> = {},
): GameDetailDto {
  return {
    id: 0,
    igdbId: null,
    name: 'ITAD Game',
    slug,
    coverUrl: null,
    genres: [],
    summary: null,
    rating: null,
    aggregatedRating: null,
    popularity: null,
    gameModes: [],
    themes: [],
    platforms: [],
    screenshots: [],
    videos: [],
    firstReleaseDate: null,
    playerCount: null,
    twitchGameId: null,
    crossplay: null,
    itadGameId: `itad-${slug}`,
    itadBoxartUrl: null,
    itadTags: [],
    itadCurrentPrice: null,
    itadCurrentCut: null,
    itadCurrentShop: null,
    itadCurrentUrl: null,
    itadLowestPrice: null,
    itadLowestCut: null,
    itadPriceUpdatedAt: null,
    ...overrides,
  };
}

// ── Test suite ───────────────────────────────────────────────

describe('earlyAccess persistence (integration)', () => {
  // ── 1. ITAD bulk early-access sync sets earlyAccess to true ──

  it('executeBulkEarlyAccessUpdate sets earlyAccess to true', async () => {
    const game = await insertGame({
      slug: 'ea-bulk-set-true',
      earlyAccess: false,
      itadGameId: 'itad-ea-bulk-set-true',
    });

    await executeBulkEarlyAccessUpdate(testApp.db, [
      { id: game.id, earlyAccess: true },
    ]);

    const result = await fetchEarlyAccess(game.id);
    expect(result).toBe(true);
  });

  it('executeBulkEarlyAccessUpdate can set earlyAccess to false', async () => {
    const game = await insertGame({
      slug: 'ea-bulk-set-false',
      earlyAccess: true,
      itadGameId: 'itad-ea-bulk-set-false',
    });

    await executeBulkEarlyAccessUpdate(testApp.db, [
      { id: game.id, earlyAccess: false },
    ]);

    const result = await fetchEarlyAccess(game.id);
    expect(result).toBe(false);
  });

  it('executeBulkEarlyAccessUpdate handles multiple games in one batch', async () => {
    const gameA = await insertGame({
      slug: 'ea-batch-game-a',
      earlyAccess: false,
    });
    const gameB = await insertGame({
      slug: 'ea-batch-game-b',
      earlyAccess: false,
    });

    await executeBulkEarlyAccessUpdate(testApp.db, [
      { id: gameA.id, earlyAccess: true },
      { id: gameB.id, earlyAccess: false },
    ]);

    expect(await fetchEarlyAccess(gameA.id)).toBe(true);
    expect(await fetchEarlyAccess(gameB.id)).toBe(false);
  });

  // ── 2. IGDB upsert does NOT overwrite earlyAccess ────────────

  it('upsertSingleGameRow does not overwrite earlyAccess=true', async () => {
    const igdbId = 900001;
    await insertGame({
      slug: 'ea-igdb-no-overwrite',
      igdbId,
      earlyAccess: true,
    });

    const apiGame = buildIgdbApiGame(igdbId, 'ea-igdb-no-overwrite');
    const dbRow = mapApiGameToDbRow(apiGame);
    await upsertSingleGameRow(testApp.db, dbRow);

    const rows = await testApp.db
      .select({ earlyAccess: schema.games.earlyAccess })
      .from(schema.games)
      .where(eq(schema.games.igdbId, igdbId))
      .limit(1);

    expect(rows[0].earlyAccess).toBe(true);
  });

  it('upsertSingleGameRow does not overwrite earlyAccess=false', async () => {
    const igdbId = 900002;
    await insertGame({
      slug: 'ea-igdb-no-overwrite-false',
      igdbId,
      earlyAccess: false,
    });

    const apiGame = buildIgdbApiGame(igdbId, 'ea-igdb-no-overwrite-false');
    const dbRow = mapApiGameToDbRow(apiGame);
    await upsertSingleGameRow(testApp.db, dbRow);

    const rows = await testApp.db
      .select({ earlyAccess: schema.games.earlyAccess })
      .from(schema.games)
      .where(eq(schema.games.igdbId, igdbId))
      .limit(1);

    expect(rows[0].earlyAccess).toBe(false);
  });

  // ── 3. ITAD upsert preserves earlyAccess when undefined ──────

  it('upsertItadGame preserves earlyAccess when dto.earlyAccess is undefined', async () => {
    const slug = 'ea-itad-preserve-undefined';
    await insertGame({ slug, earlyAccess: true });

    const dto = buildGameDetailDto(slug, { earlyAccess: undefined });
    await upsertItadGame(testApp.db, dto);

    const rows = await testApp.db
      .select({ earlyAccess: schema.games.earlyAccess })
      .from(schema.games)
      .where(eq(schema.games.slug, slug))
      .limit(1);

    expect(rows[0].earlyAccess).toBe(true);
  });

  it('upsertItadGame updates earlyAccess when explicitly set to true', async () => {
    const slug = 'ea-itad-explicit-true';
    await insertGame({ slug, earlyAccess: false });

    const dto = buildGameDetailDto(slug, { earlyAccess: true });
    await upsertItadGame(testApp.db, dto);

    const rows = await testApp.db
      .select({ earlyAccess: schema.games.earlyAccess })
      .from(schema.games)
      .where(eq(schema.games.slug, slug))
      .limit(1);

    expect(rows[0].earlyAccess).toBe(true);
  });

  it('upsertItadGame updates earlyAccess when explicitly set to false', async () => {
    const slug = 'ea-itad-explicit-false';
    await insertGame({ slug, earlyAccess: true });

    const dto = buildGameDetailDto(slug, { earlyAccess: false });
    await upsertItadGame(testApp.db, dto);

    const rows = await testApp.db
      .select({ earlyAccess: schema.games.earlyAccess })
      .from(schema.games)
      .where(eq(schema.games.slug, slug))
      .limit(1);

    expect(rows[0].earlyAccess).toBe(false);
  });

  // ── 4. enrichSyncedGamesWithItad sets earlyAccess from ITAD ──

  it('enrichSyncedGamesWithItad sets earlyAccess from ITAD game info', async () => {
    const game = await insertGame({
      slug: 'ea-enrich-set-true',
      steamAppId: 777001,
      earlyAccess: false,
    });

    const mockItadGame = {
      id: 'itad-777001',
      slug: 'enriched-game',
      title: 'Enriched Game',
      type: 'game',
      mature: false,
      assets: { boxart: undefined },
    };

    await enrichSyncedGamesWithItad(
      testApp.db,
      () => Promise.resolve(mockItadGame),
      () =>
        Promise.resolve({
          id: 'itad-777001',
          slug: 'enriched-game',
          title: 'Enriched Game',
          type: 'game',
          mature: false,
          earlyAccess: true,
          tags: ['RPG'] as string[],
        }),
    );

    expect(await fetchEarlyAccess(game.id)).toBe(true);
  });

  it('enrichSyncedGamesWithItad sets earlyAccess=false when ITAD says false', async () => {
    const game = await insertGame({
      slug: 'ea-enrich-set-false',
      steamAppId: 777002,
      earlyAccess: true,
    });

    const mockItadGame = {
      id: 'itad-777002',
      slug: 'enriched-game-2',
      title: 'Enriched Game 2',
      type: 'game',
      mature: false,
      assets: { boxart: undefined },
    };

    await enrichSyncedGamesWithItad(
      testApp.db,
      () => Promise.resolve(mockItadGame),
      () =>
        Promise.resolve({
          id: 'itad-777002',
          slug: 'enriched-game-2',
          title: 'Enriched Game 2',
          type: 'game',
          mature: false,
          earlyAccess: false,
          tags: [] as string[],
        }),
    );

    expect(await fetchEarlyAccess(game.id)).toBe(false);
  });

  it('enrichSyncedGamesWithItad leaves earlyAccess unchanged when ITAD lookup returns null', async () => {
    const game = await insertGame({
      slug: 'ea-enrich-null-lookup',
      steamAppId: 777003,
      earlyAccess: true,
    });

    await enrichSyncedGamesWithItad(
      testApp.db,
      () => Promise.resolve(null),
      () => Promise.resolve(null),
    );

    expect(await fetchEarlyAccess(game.id)).toBe(true);
  });

  // ── 5. Full round-trip: earlyAccess survives IGDB upsert ─────

  it('earlyAccess set via bulk update survives subsequent IGDB upsert', async () => {
    const igdbId = 900010;
    const slug = 'ea-roundtrip-igdb';

    // Step 1: Insert game with earlyAccess=false
    const game = await insertGame({ slug, igdbId, earlyAccess: false });

    // Step 2: Set earlyAccess to true via ITAD bulk sync
    await executeBulkEarlyAccessUpdate(testApp.db, [
      { id: game.id, earlyAccess: true },
    ]);
    expect(await fetchEarlyAccess(game.id)).toBe(true);

    // Step 3: Re-upsert via IGDB path (simulating background sync)
    const apiGame = buildIgdbApiGame(igdbId, slug);
    const dbRow = mapApiGameToDbRow(apiGame);
    await upsertSingleGameRow(testApp.db, dbRow);

    // earlyAccess must still be true after IGDB overwrites other fields
    const rows = await testApp.db
      .select({ earlyAccess: schema.games.earlyAccess })
      .from(schema.games)
      .where(eq(schema.games.igdbId, igdbId))
      .limit(1);

    expect(rows[0].earlyAccess).toBe(true);
  });

  it('earlyAccess set via ITAD upsert survives subsequent IGDB upsert', async () => {
    const igdbId = 900011;
    const slug = 'ea-roundtrip-itad-then-igdb';

    // Step 1: Insert the game via ITAD path with earlyAccess=true
    const dto = buildGameDetailDto(slug, {
      igdbId,
      earlyAccess: true,
      itadGameId: `itad-${slug}`,
    });
    await upsertItadGame(testApp.db, dto);

    const rows1 = await testApp.db
      .select({ earlyAccess: schema.games.earlyAccess })
      .from(schema.games)
      .where(eq(schema.games.slug, slug))
      .limit(1);
    expect(rows1[0].earlyAccess).toBe(true);

    // Step 2: IGDB sync upserts the same game (by igdbId conflict)
    const apiGame = buildIgdbApiGame(igdbId, slug);
    const dbRow = mapApiGameToDbRow(apiGame);
    await upsertSingleGameRow(testApp.db, dbRow);

    const rows2 = await testApp.db
      .select({ earlyAccess: schema.games.earlyAccess })
      .from(schema.games)
      .where(eq(schema.games.igdbId, igdbId))
      .limit(1);

    expect(rows2[0].earlyAccess).toBe(true);
  });
});
