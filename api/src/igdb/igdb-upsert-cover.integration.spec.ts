/**
 * ROK-1715 — an IGDB upsert whose game has no cover must keep the stored
 * cover (COALESCE), on both write paths, real DB. A game WITH a cover still
 * overwrites it, so the COALESCE cannot freeze covers. Each case asserts a
 * column the write must have changed, so a skipped write can't pass as a
 * kept cover. The seeded name differs from IGDB's, so the ON CONFLICT
 * (igdb_id) branch is the one exercised, not the name-merge.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { upsertGamesFromApi, upsertSingleGameRow } from './igdb-upsert.helpers';
import { mapApiGameToDbRow } from './igdb.mappers';
import type { IgdbApiGame } from './igdb.constants';

const IGDB_ID = 9_715_001;
const STORED_COVER = 'https://example.test/stored-cover.jpg';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

const PATHS: Array<[string, (game: IgdbApiGame) => Promise<unknown>]> = [
  [
    'single path (upsertSingleGameRow)',
    (game) => upsertSingleGameRow(testApp.db, mapApiGameToDbRow(game)),
  ],
  [
    'batch path (upsertGamesFromApi)',
    (game) => upsertGamesFromApi(testApp.db, [game]),
  ],
];

async function seedCoveredRow() {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({
        slug: 'rok-1715-local-title',
        name: 'ROK-1715 Local Title',
        igdbId: IGDB_ID,
        coverUrl: STORED_COVER,
      })
      .returning(),
    'seeded covered row',
  );
  return row;
}

async function readRow(id: number) {
  const [row] = nonEmpty(
    await testApp.db.select().from(schema.games).where(eq(schema.games.id, id)),
    `game row ${id}`,
  );
  return row;
}

function igdbGame(imageId: string | null): IgdbApiGame {
  return {
    id: IGDB_ID,
    name: 'ROK-1715 Igdb Title',
    slug: 'rok-1715-igdb-title',
    summary: 'written by IGDB (ROK-1715)',
    ...(imageId ? { cover: { image_id: imageId } } : {}),
  };
}

describe.each(PATHS)('ROK-1715 cover COALESCE — %s', (_label, write) => {
  it('keeps the stored cover when the IGDB game has none', async () => {
    const seeded = await seedCoveredRow();
    await write(igdbGame(null));
    const row = await readRow(seeded.id);
    expect(row.summary).toBe('written by IGDB (ROK-1715)');
    expect(row.coverUrl).toBe(STORED_COVER);
  });

  it('overwrites the stored cover when the IGDB game has one', async () => {
    const seeded = await seedCoveredRow();
    await write(igdbGame('rok1715y'));
    const row = await readRow(seeded.id);
    expect(row.summary).toBe('written by IGDB (ROK-1715)');
    expect(row.coverUrl).toContain('/rok1715y.jpg');
  });
});
