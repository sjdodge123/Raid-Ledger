/**
 * ROK-1283: integration spec for the seed-igdb-games name-dedup guard.
 *
 * Reproduces the witnessed BG3 incident (2026-05-14): a pre-existing
 * row with `igdb_id IS NULL` but matching name does NOT conflict on
 * `ON CONFLICT (igdb_id)` because PG UNIQUE treats NULL as distinct,
 * so the seeder re-inserts a duplicate the migration just merged.
 *
 * The fix routes each seed row through `findGameByNormalizedName`
 * before inserting; this spec asserts the merge replaces the INSERT.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { upsertSeedGames, type GameSeed } from '../../scripts/seed-igdb-games';

const BG3_SEED: GameSeed = {
  igdbId: 119171,
  name: "Baldur's Gate 3",
  slug: 'baldurs-gate-iii',
  coverUrl: 'https://example.invalid/bg3.jpg',
};

describe('Regression: ROK-1283 — seed-igdb-games name-dedup', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  it('merges seed into existing row when igdb_id is NULL but name matches (BG3 prod reproduction)', async () => {
    // Pre-existing row: discovered via steam, never enriched by IGDB.
    const [existing] = await testApp.db
      .insert(schema.games)
      .values({
        name: "Baldur's Gate 3",
        slug: 'baldurs-gate-3',
        steamAppId: 1086940,
        igdbId: null,
      })
      .returning();

    const touched = await upsertSeedGames(testApp.db, [BG3_SEED]);
    expect(touched).toBe(1);

    const rows = await testApp.db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, existing.id));
    const survivors = await testApp.db.select().from(schema.games);

    // Exactly one BG3 row — the existing one — now carries the seed's igdb_id
    // AND retains the steam_app_id from upstream discovery.
    expect(survivors).toHaveLength(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(existing.id);
    expect(rows[0].igdbId).toBe(119171);
    expect(rows[0].steamAppId).toBe(1086940);
    expect(rows[0].name).toBe("Baldur's Gate 3");
  });

  it('falls through to INSERT when no name match exists', async () => {
    const touched = await upsertSeedGames(testApp.db, [BG3_SEED]);
    expect(touched).toBe(1);

    const rows = await testApp.db.select().from(schema.games);
    expect(rows).toHaveLength(1);
    expect(rows[0].igdbId).toBe(119171);
    expect(rows[0].slug).toBe('baldurs-gate-iii');
  });

  it('is idempotent: re-running the seed against its own output does not duplicate', async () => {
    await upsertSeedGames(testApp.db, [BG3_SEED]);
    await upsertSeedGames(testApp.db, [BG3_SEED]);
    const rows = await testApp.db.select().from(schema.games);
    expect(rows).toHaveLength(1);
    expect(rows[0].igdbId).toBe(119171);
  });

  it('does NOT collapse sequels: existing row with different non-null igdb_id is left alone', async () => {
    // A row that legitimately represents a different IGDB entity. A
    // normalize() collision (e.g. unusual title) must not overwrite it.
    const seedSequel: GameSeed = {
      igdbId: 200001,
      name: 'TestSequel Alpha',
      slug: 'testsequel-alpha-v2',
      coverUrl: null,
    };
    await testApp.db.insert(schema.games).values({
      name: 'TestSequel Alpha',
      slug: 'testsequel-alpha-v1',
      igdbId: 100001,
    });

    await upsertSeedGames(testApp.db, [seedSequel]);

    const rows = await testApp.db
      .select()
      .from(schema.games)
      .orderBy(schema.games.igdbId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.igdbId).sort()).toEqual([100001, 200001]);
  });
});
