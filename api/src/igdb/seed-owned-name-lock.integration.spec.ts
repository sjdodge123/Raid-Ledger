/**
 * ROK-1643 — IGDB/ITAD enrichment must not rename a seed-owned game.
 *
 * Reproduces the fleet evidence: the seed names slug
 * `world-of-warcraft-classic` (IGDB 75379) "World of Warcraft Classic Era",
 * IGDB calls it "World of Warcraft Classic", and the upsert's ON CONFLICT
 * (igdb_id) branch used to overwrite the curated name. Each case drives a
 * real write path against a seeded WoW variant; the other enrichment columns
 * must still update, so a skipped write can't pass as a kept name.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { upsertGamesFromApi, upsertSingleGameRow } from './igdb-upsert.helpers';
import { upsertItadGame } from './igdb-itad-upsert.helpers';
import { mapApiGameToDbRow, mapDbRowToDetail } from './igdb.mappers';
import type { IgdbApiGame } from './igdb.constants';

const SLUG = 'world-of-warcraft-classic';
const CURATED = 'World of Warcraft Classic Era';
const IGDB_ID = 75379;
const IGDB_NAME = 'World of Warcraft Classic';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

async function seedRow(
  slug: string,
  name: string,
  igdbId: number | null,
  shortName: string | null = 'WoW Classic Era',
) {
  await testApp.db.delete(schema.games).where(eq(schema.games.slug, slug));
  const [row] = await testApp.db
    .insert(schema.games)
    .values({ slug, name, igdbId, shortName })
    .returning();
  return row;
}

async function readRow(id: number) {
  const [row] = await testApp.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.id, id));
  return row;
}

function igdbGame(id: number, name: string, slug: string): IgdbApiGame {
  return { id, name, slug, summary: 'enriched by IGDB' };
}

describe('ROK-1643 — enrichment keeps a seed-owned name', () => {
  it('single-row IGDB upsert (ON CONFLICT igdb_id) keeps the curated name', async () => {
    const seeded = await seedRow(SLUG, CURATED, IGDB_ID);
    await upsertSingleGameRow(
      testApp.db,
      mapApiGameToDbRow(igdbGame(IGDB_ID, IGDB_NAME, SLUG)),
    );
    const row = await readRow(seeded.id);
    expect(row.summary).toBe('enriched by IGDB');
    expect(row.name).toBe(CURATED);
    expect(row.shortName).toBe('WoW Classic Era');
    expect(row.slug).toBe(SLUG);
  });

  it('batch IGDB upsert keeps the curated name and slug', async () => {
    const seeded = await seedRow(SLUG, CURATED, IGDB_ID);
    await upsertGamesFromApi(testApp.db, [
      igdbGame(IGDB_ID, IGDB_NAME, 'igdb-renamed-slug'),
    ]);
    const row = await readRow(seeded.id);
    expect(row.summary).toBe('enriched by IGDB');
    expect(row.name).toBe(CURATED);
    expect(row.slug).toBe(SLUG);
  });

  it('ITAD upsert matching the seeded row by igdbId keeps the curated name', async () => {
    const seeded = await seedRow(SLUG, CURATED, IGDB_ID);
    await upsertItadGame(testApp.db, {
      ...mapDbRowToDetail(seeded),
      name: IGDB_NAME,
      slug: 'itad-wow-classic',
      summary: 'enriched by ITAD',
    });
    const row = await readRow(seeded.id);
    expect(row.summary).toBe('enriched by ITAD');
    expect(row.name).toBe(CURATED);
  });

  // The pre-fix slug-drift path: a null-igdb_id seed row matched by
  // normalized name used to take IGDB's slug, which the WoW plugin keys on.
  it('normalized-name merge keeps the seed slug and curated name', async () => {
    const seeded = await seedRow(
      'world-of-warcraft-forever',
      'World of Warcraft: Forever',
      null,
    );
    await upsertSingleGameRow(
      testApp.db,
      mapApiGameToDbRow(
        igdbGame(990002, 'World of Warcraft Forever', 'igdb-wow-forever'),
      ),
    );
    const row = await readRow(seeded.id);
    expect(row.igdbId).toBe(990002);
    expect(row.slug).toBe('world-of-warcraft-forever');
    expect(row.name).toBe('World of Warcraft: Forever');
  });

  it('a game the seed does not define still takes the IGDB name', async () => {
    const seeded = await seedRow(
      'some-unseeded-game',
      'Old Name',
      990001,
      null,
    );
    await upsertSingleGameRow(
      testApp.db,
      mapApiGameToDbRow(igdbGame(990001, 'New Name', 'some-unseeded-game')),
    );
    expect((await readRow(seeded.id)).name).toBe('New Name');
  });
});
