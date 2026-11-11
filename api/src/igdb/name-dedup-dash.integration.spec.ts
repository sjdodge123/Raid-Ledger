/**
 * ROK-2164 — an ingest of "X — Y" (em dash) must find an existing "X: Y" row
 * through the name-dedup guard instead of inserting a twin. Prod kept the pair
 * "Asgard's Fall: Viking Survivors" / "Asgard's Fall — Viking Survivors".
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { upsertItadGame } from './igdb-itad-upsert.helpers';
import { findGameByNormalizedName } from './igdb-name-dedup.helpers';
import { withGameNameLock } from './games-name-lock.helpers';
import { nonEmpty } from '../common/testing/narrow';
import type { GameDetailDto } from '@raid-ledger/contract';

const COLON_NAME = "Asgard's Fall: Viking Survivors";
const EM_DASH_NAME = "Asgard's Fall — Viking Survivors";

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

async function insertColonRow(): Promise<number> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({
        name: COLON_NAME,
        slug: 'asgards-fall-viking-survivors',
        itadGameId: 'itad-asgard-colon',
      })
      .returning({ id: schema.games.id }),
    'inserted colon row',
  );
  return row.id;
}

function itadDto(name: string, itadGameId: string): GameDetailDto {
  return {
    id: 0,
    igdbId: null,
    name,
    slug: 'asgards-fall-viking-survivors-em',
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
    itadGameId,
    itadBoxartUrl: null,
    itadTags: [],
    itadCurrentPrice: null,
    itadCurrentCut: null,
    itadCurrentShop: null,
    itadCurrentUrl: null,
    itadLowestPrice: null,
    itadLowestCut: null,
    itadPriceUpdatedAt: null,
  };
}

async function asgardRowCount(): Promise<number> {
  const rows = await testApp.db
    .select({ name: schema.games.name })
    .from(schema.games);
  return rows.filter((r) => r.name.startsWith("Asgard's Fall")).length;
}

describe('ROK-2164 — em-dash name finds the colon row', () => {
  it('the guard, under the name lock, returns the existing colon row', async () => {
    const existingId = await insertColonRow();
    const found = await withGameNameLock(testApp.db, EM_DASH_NAME, (tx) =>
      findGameByNormalizedName(tx, EM_DASH_NAME),
    );
    expect(found?.id).toBe(existingId);
  });

  it('an ITAD ingest of the em-dash name does not insert a twin', async () => {
    const existingId = await insertColonRow();
    const result = await upsertItadGame(
      testApp.db,
      itadDto(EM_DASH_NAME, 'itad-asgard-em'),
    );
    expect(result.id).toBe(existingId);
    expect(await asgardRowCount()).toBe(1);
  });
});
