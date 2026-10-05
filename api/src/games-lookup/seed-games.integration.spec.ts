/**
 * ROK-1715 — WoW: Forever's seed pins IGDB id 417650 on the existing slug row,
 * and the IGDB sync then owns its cover, real DB.
 *
 * Covers spec AC3 (pin on the slug row; a row already holding the id must not
 * abort the boot seed) and AC5 (an IGDB refresh of the pinned row keeps the
 * seed-owned name + slug while still writing the cover).
 */
import { eq, or } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { GAMES_SEED } from './seed-games.data';
import { upsertSeedGame, type GameSeedEntry } from './seed-games.helpers';
import {
  backfillMissingCovers,
  upsertSingleGameRow,
} from '../igdb/igdb-upsert.helpers';
import { mapApiGameToDbRow } from '../igdb/igdb.mappers';

const SLUG = 'world-of-warcraft-forever';
const NAME = 'World of Warcraft: Forever';
const IGDB_ID = 417650;

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

/** The Forever seed entry exactly as api/scripts/seed-games.ts passes it. */
function foreverEntry(): GameSeedEntry {
  const raw = nonEmpty(
    GAMES_SEED.filter((g) => g.slug === SLUG),
    'Forever seed entry',
  )[0];
  const { eventTypes, iconUrl, ...game } = raw;
  void eventTypes;
  void iconUrl;
  return game;
}

async function insertRow(slug: string, name: string, igdbId: number | null) {
  await testApp.db
    .delete(schema.games)
    .where(or(eq(schema.games.slug, slug), eq(schema.games.igdbId, IGDB_ID)));
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ slug, name, igdbId })
      .returning(),
    `seeded ${slug}`,
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

describe('ROK-1715 — Forever seed pins its IGDB id', () => {
  it('pins 417650 on an existing Forever row whose igdb_id is NULL', async () => {
    const seeded = await insertRow(SLUG, NAME, null);
    await expect(upsertSeedGame(testApp.db, foreverEntry())).resolves.toEqual({
      id: seeded.id,
      action: 'updated',
    });
    expect((await readRow(seeded.id)).igdbId).toBe(IGDB_ID);
  });

  it('does not abort the seed when another row already holds 417650', async () => {
    const holder = await insertRow(
      'wow-forever-igdb-dup',
      'WoW Forever dup',
      IGDB_ID,
    );
    await testApp.db.delete(schema.games).where(eq(schema.games.slug, SLUG));
    const [forever] = nonEmpty(
      await testApp.db
        .insert(schema.games)
        .values({ slug: SLUG, name: NAME, igdbId: null })
        .returning(),
      'Forever row',
    );
    await expect(upsertSeedGame(testApp.db, foreverEntry())).resolves.toEqual({
      id: forever.id,
      action: 'updated',
    });
    const after = await readRow(forever.id);
    expect(after.igdbId).toBeNull();
    expect(after.shortName).toBe('WoW Forever');
    expect((await readRow(holder.id)).igdbId).toBe(IGDB_ID);
  });
});

describe('ROK-1715 — the IGDB sync owns the pinned row cover', () => {
  it('cover backfill fills the pinned row', async () => {
    const seeded = await insertRow(SLUG, NAME, IGDB_ID);
    const queryIgdb = jest
      .fn()
      .mockResolvedValue([{ id: IGDB_ID, cover: { image_id: 'cocw4w' } }]);
    await expect(backfillMissingCovers(testApp.db, queryIgdb)).resolves.toBe(1);
    expect((await readRow(seeded.id)).coverUrl).toContain('/cocw4w.jpg');
  });

  it('an IGDB refresh writes the cover but keeps the seed-owned name and slug', async () => {
    const seeded = await insertRow(SLUG, NAME, IGDB_ID);
    await upsertSingleGameRow(
      testApp.db,
      mapApiGameToDbRow({
        id: IGDB_ID,
        name: 'World of Warcraft Forever',
        slug: 'world-of-warcraft-forever--1',
        summary: 'refreshed by IGDB',
        cover: { image_id: 'cocw4w' },
      }),
    );
    const row = await readRow(seeded.id);
    expect(row.summary).toBe('refreshed by IGDB');
    expect(row.coverUrl).toContain('/cocw4w.jpg');
    expect(row.name).toBe(NAME);
    expect(row.slug).toBe(SLUG);
  });
});
