/**
 * ROK-2120: integration spec for the one-off IGDB/ITAD duplicate-pair merge
 * migration (`*_games_igdb_itad_pair_merge.sql`).
 *
 * The migration is a single self-contained DO block, so the spec seeds the
 * duplicate shapes found in prod plus FK children, executes the migration file
 * verbatim, and asserts keepers kept, dups gone, children repointed (keeper
 * wins on unique collisions), identity keys moved, look-alikes untouched, and
 * that a second run is a no-op.
 *
 * The file is resolved by SUFFIX, never by number — a renumber orphaned a
 * hardcoded-path spec on 2026-11-07.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { at } from '../common/testing/narrow';

const MIGRATIONS_DIR = path.join(__dirname, '../drizzle/migrations');
const SUFFIX = '_games_igdb_itad_pair_merge.sql';

/** Absolute path of the single migration file ending in SUFFIX. */
function migrationPath(): string {
  const matches = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(SUFFIX));
  if (matches.length !== 1) {
    throw new Error(`expected one *${SUFFIX}, found ${matches.length}`);
  }
  return path.join(MIGRATIONS_DIR, at(matches, 0));
}

/** Execute the migration file as the deploy migrator would (one DO block). */
async function runMigration(testApp: TestApp): Promise<void> {
  const raw = readFileSync(migrationPath(), 'utf8');
  await testApp.db.transaction(async (tx) => {
    for (const stmt of raw.split('--> statement-breakpoint')) {
      if (stmt.trim()) await tx.execute(sql.raw(stmt));
    }
  });
}

type GameSeed = typeof schema.games.$inferInsert;

/** Insert rows one at a time so ids follow array order. */
async function seedGames(
  testApp: TestApp,
  rows: GameSeed[],
): Promise<number[]> {
  const ids: number[] = [];
  for (const row of rows) {
    const [inserted] = await testApp.db
      .insert(schema.games)
      .values(row)
      .returning({ id: schema.games.id });
    if (!inserted) throw new Error(`insert failed for ${row.slug}`);
    ids.push(inserted.id);
  }
  return ids;
}

/** The duplicate shapes + look-alikes that must NOT merge. */
const GAME_ROWS: GameSeed[] = [
  // 0 D1 — ITAD/Steam-first twin inserted FIRST (lower id than its keeper).
  {
    name: 'Rok2120 Hollow Quest™',
    slug: 'rok2120-hollow-quest-itad',
    steamAppId: 99120001,
    steamAppIdSource: 'itad',
    itadGameId: 'itad-rok2120-a',
    itadBoxartUrl: 'https://example.test/boxart-a.png',
  },
  // 1 K1 — IGDB owner.
  {
    name: 'Rok2120 Hollow Quest',
    slug: 'rok2120-hollow-quest',
    igdbId: 99120001,
  },
  // 2 K2 / 3 D2 — subtitle-separator variant, dup carries only steam.
  { name: 'Rok2120 Iron: Tide', slug: 'rok2120-iron-tide', igdbId: 99120002 },
  {
    name: 'Rok2120 Iron - Tide',
    slug: 'rok2120-iron-tide-2',
    steamAppId: 99120002,
  },
  // 4 C1 / 5 C2 — ITAD pair, no igdb on either: keeper = lower id.
  {
    name: 'Rok2120 Echo Vale',
    slug: 'rok2120-echo-vale',
    itadGameId: 'itad-rok2120-c',
  },
  {
    name: 'Rok2120 Echo Vale',
    slug: 'rok2120-echo-vale-2',
    steamAppId: 99120003,
  },
  // 6 / 7 — both own an igdb id: distinct games, must stay.
  { name: 'Rok2120 Twin', slug: 'rok2120-twin-a', igdbId: 99120010 },
  { name: 'Rok2120 Twin', slug: 'rok2120-twin-b', igdbId: 99120011 },
  // 8 / 9 — both Steam-linked (different products): must stay.
  {
    name: 'Rok2120 Steamy',
    slug: 'rok2120-steamy-a',
    igdbId: 99120020,
    steamAppId: 99120020,
  },
  { name: 'Rok2120 Steamy', slug: 'rok2120-steamy-b', steamAppId: 99120021 },
];

interface Seeded {
  d1: number;
  k1: number;
  k2: number;
  d2: number;
  c1: number;
  c2: number;
  untouched: number[];
}

/** Seed games + FK children on both sides of the pairs. */
async function seedScenario(testApp: TestApp): Promise<Seeded> {
  const ids = await seedGames(testApp, GAME_ROWS);
  const s: Seeded = {
    d1: at(ids, 0),
    k1: at(ids, 1),
    k2: at(ids, 2),
    d2: at(ids, 3),
    c1: at(ids, 4),
    c2: at(ids, 5),
    untouched: ids.slice(6),
  };
  await seedChildren(testApp, s);
  return s;
}

/** FK children: events, interests (colliding), mains (colliding), rollups. */
async function seedChildren(testApp: TestApp, s: Seeded): Promise<void> {
  const userId = testApp.seed.adminUser.id;
  const start = new Date('2026-12-01T20:00:00Z');
  const end = new Date('2026-12-01T22:00:00Z');
  await testApp.db.insert(schema.events).values({
    title: 'Rok2120 dup event',
    gameId: s.d1,
    creatorId: userId,
    duration: [start, end] as [Date, Date],
  });
  await testApp.db.insert(schema.gameInterests).values([
    { userId, gameId: s.k1, source: 'manual' },
    { userId, gameId: s.d1, source: 'manual' }, // collides -> keeper wins
    { userId, gameId: s.d1, source: 'steam_library' }, // repointed
  ]);
  await testApp.db.insert(schema.characters).values([
    { userId, gameId: s.k1, name: 'Keeper Main', realm: 'R1', isMain: true },
    { userId, gameId: s.d1, name: 'Dup Main', realm: 'R1', isMain: true },
  ]);
  const week = { userId, period: 'week', periodStart: '2026-05-01' };
  await testApp.db.insert(schema.gameActivityRollups).values([
    { ...week, gameId: s.k1, totalSeconds: 3600 },
    { ...week, gameId: s.d1, totalSeconds: 1800 }, // additive
    { ...week, gameId: s.d2, totalSeconds: 900 }, // repointed
  ]);
}

/** Identity columns of the given games, keyed by id. */
async function identities(
  testApp: TestApp,
  ids: number[],
): Promise<Map<number, typeof schema.games.$inferSelect>> {
  const rows = await testApp.db
    .select()
    .from(schema.games)
    .where(inArray(schema.games.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

describe('ROK-2120 games IGDB/ITAD pair merge migration', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  it('deletes the dups and keeps the keepers and every look-alike', async () => {
    const s = await seedScenario(testApp);
    await runMigration(testApp);

    const all = [s.d1, s.k1, s.k2, s.d2, s.c1, s.c2, ...s.untouched];
    const left = await identities(testApp, all);
    expect([...left.keys()].sort((a, b) => a - b)).toEqual(
      [s.k1, s.k2, s.c1, ...s.untouched].sort((a, b) => a - b),
    );
  }, 60_000);

  it('moves steam/itad identity onto the keeper without breaking uniques', async () => {
    const s = await seedScenario(testApp);
    await runMigration(testApp);

    const rows = await identities(testApp, [s.k1, s.k2, s.c1]);
    expect(rows.get(s.k1)).toMatchObject({
      igdbId: 99120001,
      steamAppId: 99120001,
      steamAppIdSource: 'itad',
      itadGameId: 'itad-rok2120-a',
      itadBoxartUrl: 'https://example.test/boxart-a.png',
    });
    expect(rows.get(s.k2)).toMatchObject({
      igdbId: 99120002,
      steamAppId: 99120002,
    });
    expect(rows.get(s.c1)).toMatchObject({
      steamAppId: 99120003,
      itadGameId: 'itad-rok2120-c',
    });
  }, 60_000);

  it('repoints FK children to the keeper; keeper wins on unique collisions', async () => {
    const s = await seedScenario(testApp);
    await runMigration(testApp);
    const db = testApp.db;

    const events = await db
      .select({ gameId: schema.events.gameId })
      .from(schema.events)
      .where(eq(schema.events.title, 'Rok2120 dup event'));
    expect(events).toEqual([{ gameId: s.k1 }]);

    const interests = await db
      .select({ source: schema.gameInterests.source })
      .from(schema.gameInterests)
      .where(eq(schema.gameInterests.gameId, s.k1));
    expect(interests.map((i) => i.source).sort()).toEqual([
      'manual',
      'steam_library',
    ]);

    const chars = await db
      .select({
        name: schema.characters.name,
        isMain: schema.characters.isMain,
      })
      .from(schema.characters)
      .where(eq(schema.characters.gameId, s.k1));
    expect(chars.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'Dup Main', isMain: false },
      { name: 'Keeper Main', isMain: true },
    ]);
  }, 60_000);

  it('sums colliding activity rollups and repoints the rest', async () => {
    const s = await seedScenario(testApp);
    await runMigration(testApp);
    const r = schema.gameActivityRollups;

    const k1 = await testApp.db
      .select({ totalSeconds: r.totalSeconds })
      .from(r)
      .where(and(eq(r.gameId, s.k1), eq(r.periodStart, '2026-05-01')));
    expect(k1).toEqual([{ totalSeconds: 3600 + 1800 }]);

    const k2 = await testApp.db
      .select({ totalSeconds: r.totalSeconds })
      .from(r)
      .where(eq(r.gameId, s.k2));
    expect(k2).toEqual([{ totalSeconds: 900 }]);
  }, 60_000);

  it('is a no-op on a second run (zero pairs left)', async () => {
    const s = await seedScenario(testApp);
    await runMigration(testApp);
    const keep = [s.k1, s.k2, s.c1, ...s.untouched];
    const before = await identities(testApp, keep);
    const countBefore = await gameCount(testApp);

    await runMigration(testApp);
    const after = await identities(testApp, keep);
    expect(await gameCount(testApp)).toBe(countBefore);
    expect(after.size).toBe(keep.length);
    for (const id of keep) {
      expect(after.get(id)).toEqual(before.get(id));
    }
  }, 60_000);
});

/** Total rows in games. */
async function gameCount(testApp: TestApp): Promise<number> {
  const [row] = await testApp.db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.games);
  return row?.n ?? -1;
}
