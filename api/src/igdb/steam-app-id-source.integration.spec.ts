/**
 * ROK-1680 (RH-7a): games.steam_app_id_source — the BEFORE UPDATE reset
 * trigger and the 0156 'manual' backfill, both from migration 0192.
 *
 * The harness has already applied 0192 (trigger live). The backfill is
 * replayed on its own: the file is split on drizzle's statement-breakpoint
 * marker (NOT the 0140 `;\n` splitter, which would cut the plpgsql $$ body).
 */
import { readFileSync } from 'fs';
import path from 'path';
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

const MIGRATION_SQL_PATH = path.join(
  __dirname,
  '../drizzle/migrations/0192_steam_app_id_source.sql',
);

/** The four rows 0156 corrected by hand, at their corrected ids. */
const MANUAL_ROWS: ReadonlyArray<[string, number]> = [
  ['7 Days to Die', 251570],
  ['Risk of Rain 2', 632360],
  ['Divinity: Original Sin II - Definitive Edition', 435150],
  ['Black Desert Online', 582660],
];

function loadBackfillStatement(): string {
  const chunks = readFileSync(MIGRATION_SQL_PATH, 'utf8')
    .split('--> statement-breakpoint')
    .map((chunk) =>
      chunk
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((chunk) => chunk.includes("'manual'"));
  if (chunks.length !== 1) {
    throw new Error(
      `expected exactly one 'manual' backfill statement in 0192, found ${chunks.length}`,
    );
  }
  return chunks[0];
}

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

let slugSeq = 0;
async function insertGame(
  values: Partial<typeof schema.games.$inferInsert>,
): Promise<typeof schema.games.$inferSelect> {
  slugSeq += 1;
  const [row] = await testApp.db
    .insert(schema.games)
    .values({ name: 'Source Test', slug: `rok-1680-${slugSeq}`, ...values })
    .returning();
  return row;
}

async function updateGame(
  id: number,
  set: Partial<typeof schema.games.$inferInsert>,
): Promise<typeof schema.games.$inferSelect> {
  const [row] = await testApp.db
    .update(schema.games)
    .set(set)
    .where(eq(schema.games.id, id))
    .returning();
  return row;
}

describe('ROK-1680 steam_app_id_source reset trigger', () => {
  it('(a) id changes, source untouched: the stale source falls to NULL', async () => {
    const g = await insertGame({
      steamAppId: 910001,
      steamAppIdSource: 'steam',
    });
    const row = await updateGame(g.id, { steamAppId: 910002 });
    expect(row.steamAppId).toBe(910002);
    expect(row.steamAppIdSource).toBeNull();
  });

  it('(b) id and source both change: the new source is kept', async () => {
    const g = await insertGame({
      steamAppId: 910011,
      steamAppIdSource: 'steam',
    });
    const row = await updateGame(g.id, {
      steamAppId: 910012,
      steamAppIdSource: 'igdb',
    });
    expect(row.steamAppId).toBe(910012);
    expect(row.steamAppIdSource).toBe('igdb');
  });

  it('(c) a non-id column changes: the source is left alone', async () => {
    const g = await insertGame({
      steamAppId: 910021,
      steamAppIdSource: 'steam',
    });
    const row = await updateGame(g.id, { name: 'Renamed Source Test' });
    expect(row.steamAppId).toBe(910021);
    expect(row.steamAppIdSource).toBe('steam');
  });

  it('(d) id changes and the SAME tag is re-written: falls to NULL (documented semantics)', async () => {
    const g = await insertGame({
      steamAppId: 910031,
      steamAppIdSource: 'steam',
    });
    const row = await updateGame(g.id, {
      steamAppId: 910032,
      steamAppIdSource: 'steam',
    });
    expect(row.steamAppId).toBe(910032);
    expect(row.steamAppIdSource).toBeNull();
  });

  it('(e) source-only change (id untouched) sticks — the backfill relies on this', async () => {
    const g = await insertGame({ steamAppId: 910041 });
    const row = await updateGame(g.id, { steamAppIdSource: 'manual' });
    expect(row.steamAppIdSource).toBe('manual');
  });
});

describe('ROK-1680 0192 backfill', () => {
  async function seedBackfillFixtures(): Promise<void> {
    for (const [name, steamAppId] of MANUAL_ROWS) {
      await insertGame({
        name,
        steamAppId,
        igdbId: 800000 + (steamAppId % 1000),
      });
    }
    // Same name as a 0156 row, different id: must NOT be tagged.
    await insertGame({ name: '7 Days to Die', steamAppId: 910101 });
    // ITAD-created row (no igdb id) that a later library sync matched.
    const itadRow = await insertGame({
      name: 'ITAD Matched',
      steamAppId: 910102,
    });
    await testApp.db.insert(schema.gameInterests).values([
      {
        userId: testApp.seed.adminUser.id,
        gameId: itadRow.id,
        source: 'steam_library',
      },
      {
        userId: testApp.seed.adminUser.id,
        gameId: itadRow.id,
        source: 'steam_wishlist',
      },
    ]);
    await testApp.db.update(schema.games).set({ steamAppIdSource: null });
  }

  it("tags exactly the four 0156 rows 'manual'; every other row stays NULL", async () => {
    await seedBackfillFixtures();

    await testApp.db.execute(sql.raw(loadBackfillStatement()));

    const rows = await testApp.db
      .select({
        name: schema.games.name,
        steamAppId: schema.games.steamAppId,
        igdbId: schema.games.igdbId,
        source: schema.games.steamAppIdSource,
      })
      .from(schema.games);
    const manual = rows
      .filter((r) => r.source === 'manual')
      .map((r) => [r.name, r.steamAppId])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(manual).toEqual(
      [...MANUAL_ROWS].sort((a, b) => a[0].localeCompare(b[0])),
    );
    const others = rows.filter((r) => r.source !== 'manual');
    expect(others.map((r) => r.source)).toEqual(others.map(() => null));
    expect(others.map((r) => r.steamAppId)).toEqual(
      expect.arrayContaining([910101, 910102]),
    );
  });
});
