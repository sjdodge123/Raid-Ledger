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
import { eq, ne } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { upsertSeedGames, type GameSeed } from '../../scripts/seed-igdb-games';

const FIXTURE_GAME_SLUG = 'test-game';

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
    const survivors = await testApp.db
      .select()
      .from(schema.games)
      .where(ne(schema.games.slug, FIXTURE_GAME_SLUG));

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

    const rows = await testApp.db
      .select()
      .from(schema.games)
      .where(ne(schema.games.slug, FIXTURE_GAME_SLUG));
    expect(rows).toHaveLength(1);
    expect(rows[0].igdbId).toBe(119171);
    expect(rows[0].slug).toBe('baldurs-gate-iii');
  });

  it('is idempotent: re-running the seed against its own output does not duplicate', async () => {
    await upsertSeedGames(testApp.db, [BG3_SEED]);
    await upsertSeedGames(testApp.db, [BG3_SEED]);
    const rows = await testApp.db
      .select()
      .from(schema.games)
      .where(ne(schema.games.slug, FIXTURE_GAME_SLUG));
    expect(rows).toHaveLength(1);
    expect(rows[0].igdbId).toBe(119171);
  });

  // Codex P1 (2026-05-14): when BOTH a canonical row (igdb_id=X) AND a leftover
  // orphan (igdb_id=NULL) exist for the same name, findGameByNormalizedName may
  // return either. Returning the orphan and trying to UPDATE its igdb_id to X
  // would crash on the UNIQUE index — aborting boot. The guard must detect this
  // and fall through to ON CONFLICT (igdb_id) so the canonical row is updated.
  it('does NOT crash when a canonical row already owns the seed igdb_id alongside a null-igdb_id orphan', async () => {
    // Canonical row: already enriched by IGDB.
    const [canonical] = await testApp.db
      .insert(schema.games)
      .values({
        name: "Baldur's Gate 3",
        slug: 'baldurs-gate-iii-canonical',
        igdbId: 119171,
        steamAppId: null,
      })
      .returning();
    // Leftover orphan: same name, null igdb_id, different slug.
    const [orphan] = await testApp.db
      .insert(schema.games)
      .values({
        name: "Baldur's Gate 3",
        slug: 'baldurs-gate-3-orphan',
        igdbId: null,
        steamAppId: 1086940,
      })
      .returning();

    // Must not throw — would crash the entire deploy at container boot.
    const touched = await upsertSeedGames(testApp.db, [BG3_SEED]);
    expect(touched).toBe(1);

    // Both rows still exist; canonical retains its igdb_id, orphan untouched.
    const survivors = await testApp.db
      .select()
      .from(schema.games)
      .where(ne(schema.games.slug, FIXTURE_GAME_SLUG));
    expect(survivors).toHaveLength(2);
    const canonicalRow = survivors.find((r) => r.id === canonical.id);
    const orphanRow = survivors.find((r) => r.id === orphan.id);
    expect(canonicalRow?.igdbId).toBe(119171);
    expect(orphanRow?.igdbId).toBeNull();
    expect(orphanRow?.steamAppId).toBe(1086940);
  });

  // ROK-1334: the per-row loop was replaced with a batched path (one name
  // lookup + chunked multi-row INSERT ... ON CONFLICT + batched merges). These
  // cases assert the batch handles a mixed insert/merge call in one shot.
  it('batches a mixed call: inserts new rows and merges a null-igdb_id orphan in one pass', async () => {
    // One pre-existing orphan that should MERGE; two fresh names that INSERT.
    const [orphan] = await testApp.db
      .insert(schema.games)
      .values({
        name: 'Hades',
        slug: 'hades-orphan',
        steamAppId: 1145360,
        igdbId: null,
      })
      .returning();

    const seeds: GameSeed[] = [
      { igdbId: 113112, name: 'Hades', slug: 'hades', coverUrl: null },
      {
        igdbId: 300001,
        name: 'Stardew Valley',
        slug: 'stardew',
        coverUrl: null,
      },
      { igdbId: 300002, name: 'Celeste', slug: 'celeste', coverUrl: null },
    ];
    const touched = await upsertSeedGames(testApp.db, seeds);
    expect(touched).toBe(3);

    const rows = await testApp.db
      .select()
      .from(schema.games)
      .where(ne(schema.games.slug, FIXTURE_GAME_SLUG))
      .orderBy(schema.games.igdbId);
    // Three rows total — the orphan was back-filled (merge), not duplicated.
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.igdbId)).toEqual([113112, 300001, 300002]);
    // The merged row is the original orphan (same id), now carrying the seed
    // igdb_id while retaining its upstream steam_app_id.
    const hades = rows.find((r) => r.igdbId === 113112);
    expect(hades?.id).toBe(orphan.id);
    expect(hades?.steamAppId).toBe(1145360);
  });

  it('seeds a fresh (empty) table fully via the batch INSERT path', async () => {
    const seeds: GameSeed[] = [
      {
        igdbId: 400001,
        name: 'Hollow Knight',
        slug: 'hollow-knight',
        coverUrl: null,
      },
      {
        igdbId: 400002,
        name: 'Dead Cells',
        slug: 'dead-cells',
        coverUrl: null,
      },
    ];
    const touched = await upsertSeedGames(testApp.db, seeds);
    expect(touched).toBe(2);

    const rows = await testApp.db
      .select()
      .from(schema.games)
      .where(ne(schema.games.slug, FIXTURE_GAME_SLUG))
      .orderBy(schema.games.igdbId);
    expect(rows.map((r) => r.igdbId)).toEqual([400001, 400002]);
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
      .where(ne(schema.games.slug, FIXTURE_GAME_SLUG))
      .orderBy(schema.games.igdbId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.igdbId).sort()).toEqual([100001, 200001]);
  });
});
