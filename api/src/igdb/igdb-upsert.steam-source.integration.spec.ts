/**
 * ROK-1680 (RH-7a) AC3a — IGDB's steam_app_id_source writes, real DB.
 *
 * IGDB tags 'igdb' only when the Steam id it brings DIFFERS from the stored
 * one; an agreeing id keeps whatever source the row already had. Every case
 * runs through both write paths: the single-row upsert (buildUpsertSet, ON
 * CONFLICT igdb_id) and the batch upsert (buildBatchUpsertSet, excluded.*).
 * The ITAD merge-by-steamAppId case goes through applyIgdbMergeToRow, which
 * both paths share.
 *
 * Seeded rows carry a different name from IGDB's, so the normalized-name merge
 * misses and the ON CONFLICT branch is the one exercised. Each case also
 * asserts a column the write must have changed, so a skipped write cannot
 * pass as a kept source.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { upsertGamesFromApi, upsertSingleGameRow } from './igdb-upsert.helpers';
import { mapApiGameToDbRow } from './igdb.mappers';
import type { IgdbApiGame } from './igdb.constants';

const IGDB_ID = 9_680_101;
const STEAM_X = 9_680_001;
const STEAM_Y = 9_680_002;
const IGDB_SUMMARY = 'written by IGDB (ROK-1680)';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

type WritePath = (game: IgdbApiGame) => Promise<unknown>;

const PATHS: Array<[string, WritePath]> = [
  [
    'single path (upsertSingleGameRow)',
    (game) => upsertSingleGameRow(testApp.db, mapApiGameToDbRow(game)),
  ],
  [
    'batch path (upsertGamesFromApi)',
    (game) => upsertGamesFromApi(testApp.db, [game]),
  ],
];

function igdbGame(steamAppId: number | null): IgdbApiGame {
  return {
    id: IGDB_ID,
    name: 'ROK-1680 Igdb Title',
    slug: 'rok-1680-igdb-title',
    summary: IGDB_SUMMARY,
    external_games:
      steamAppId == null ? [] : [{ category: 1, uid: String(steamAppId) }],
  };
}

async function seedGame(
  values: Partial<typeof schema.games.$inferInsert>,
): Promise<number> {
  const [row] = await testApp.db
    .insert(schema.games)
    .values({
      name: 'ROK-1680 Stored Title',
      slug: 'rok-1680-stored-title',
      ...values,
    })
    .returning({ id: schema.games.id });
  return row.id;
}

/** A row that already has IGDB_ID's Steam id X, tagged `source`. */
function seedStored(
  source: 'steam' | 'itad',
  igdbId: number | null = IGDB_ID,
): Promise<number> {
  return seedGame({ igdbId, steamAppId: STEAM_X, steamAppIdSource: source });
}

async function readGame(where: { id: number } | { igdbId: number }) {
  const cond =
    'id' in where
      ? eq(schema.games.id, where.id)
      : eq(schema.games.igdbId, where.igdbId);
  const rows = await testApp.db.select().from(schema.games).where(cond);
  expect(rows).toHaveLength(1);
  return rows[0];
}

describe.each(PATHS)('ROK-1680 IGDB steam_app_id_source — %s', (_, write) => {
  it("(a) keeps 'steam' when IGDB agrees with the stored Steam id", async () => {
    const id = await seedStored('steam');

    await write(igdbGame(STEAM_X));

    const row = await readGame({ id });
    expect(row.summary).toBe(IGDB_SUMMARY);
    expect(row.steamAppId).toBe(STEAM_X);
    expect(row.steamAppIdSource).toBe('steam');
  });

  it("(b) tags 'igdb' when IGDB replaces the stored Steam id (AC5 value unchanged)", async () => {
    const id = await seedStored('steam');

    await write(igdbGame(STEAM_Y));

    const row = await readGame({ id });
    expect(row.steamAppId).toBe(STEAM_Y);
    expect(row.steamAppIdSource).toBe('igdb');
  });

  it("(c) tags a fresh insert 'igdb'", async () => {
    await write(igdbGame(STEAM_X));

    const row = await readGame({ igdbId: IGDB_ID });
    expect(row.steamAppId).toBe(STEAM_X);
    expect(row.steamAppIdSource).toBe('igdb');
  });

  it('(c2) leaves a fresh insert without a Steam id untagged', async () => {
    await write(igdbGame(null));

    const row = await readGame({ igdbId: IGDB_ID });
    expect(row.steamAppId).toBeNull();
    expect(row.steamAppIdSource).toBeNull();
  });

  it("(e) keeps 'itad' when IGDB merges into an ITAD row by the same Steam id", async () => {
    const id = await seedStored('itad', null);

    await write(igdbGame(STEAM_X));

    const row = await readGame({ id });
    expect(row.igdbId).toBe(IGDB_ID);
    expect(row.steamAppId).toBe(STEAM_X);
    expect(row.steamAppIdSource).toBe('itad');
  });

  it('(f) keeps id and source when IGDB carries no Steam id', async () => {
    const id = await seedStored('steam');

    await write(igdbGame(null));

    const row = await readGame({ id });
    expect(row.summary).toBe(IGDB_SUMMARY);
    expect(row.steamAppId).toBe(STEAM_X);
    expect(row.steamAppIdSource).toBe('steam');
  });
});
