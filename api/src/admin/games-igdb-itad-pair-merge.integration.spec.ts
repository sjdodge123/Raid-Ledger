/**
 * ROK-2120: integration spec for the one-off IGDB/ITAD duplicate-pair merge
 * migration (`*_games_igdb_itad_pair_merge.sql`).
 *
 * The migration is a single self-contained DO block, so the spec seeds the
 * duplicate shapes found in prod plus FK children, executes the migration file
 * verbatim, and asserts keepers kept, dups gone, children repointed (keeper
 * wins on unique collisions), identity keys moved, look-alikes untouched, and
 * that a second run is a no-op. A collision on any table outside the
 * migration's delete allowlist (characters, discord_game_roles,
 * channel_lifecycle_suppressions, ...) skips the whole pair; an allowlisted
 * leaf link table (game_interests) loses its colliding row (Steam playtime folded
 * onto the keeper first). Registry config is copied onto a default keeper; a
 * two-sided config conflict skips the pair. Template
 * `config.gameId` is rewritten too. Q2 re-ruling (2026-11-09): an IGDB row +
 * a Steam-first twin with a DIFFERENT Steam id merge, the twin's Steam id
 * (tagged 'manual') and ITAD id win; name groups of 3+ stay untouched.
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
  // 8 / 9 — neither row is IGDB and both are Steam-linked (different
  // products): must stay. (An IGDB row + Steam-first twin merges — Q2.)
  {
    name: 'Rok2120 Steamy',
    slug: 'rok2120-steamy-a',
    steamAppId: 99120020,
    itadGameId: 'itad-rok2120-s',
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

  it('deletes a colliding LEAF child (game_interests) and still merges the pair', async () => {
    const s = await seedScenario(testApp);
    const gi = schema.gameInterests;
    const [keeperManual] = await testApp.db
      .select({ id: gi.id })
      .from(gi)
      .where(and(eq(gi.gameId, s.k1), eq(gi.source, 'manual')));
    if (!keeperManual) throw new Error('keeper manual interest not seeded');
    await runMigration(testApp);

    const onKeeper = await testApp.db
      .select({ id: gi.id, source: gi.source })
      .from(gi)
      .where(eq(gi.gameId, s.k1));
    const manual = onKeeper.filter((i) => i.source === 'manual');
    expect(manual).toEqual([{ id: keeperManual.id, source: 'manual' }]);
    expect((await identities(testApp, [s.d1])).size).toBe(0);
  }, 60_000);

  it('skips the WHOLE pair when a NON-leaf child (characters) collides', async () => {
    const s = await seedScenario(testApp);
    const [keep, dup] = await seedGames(testApp, NON_LEAF_PAIR);
    if (keep == null || dup == null)
      throw new Error('non-leaf pair not seeded');
    const userId = testApp.seed.adminUser.id;
    const twin = { userId, name: 'Twin Alt', realm: 'R1', isMain: false };
    await testApp.db.insert(schema.characters).values([
      { ...twin, gameId: keep },
      { ...twin, gameId: dup },
    ]);
    await runMigration(testApp);

    const rows = await identities(testApp, [keep, dup, s.d1]);
    expect(rows.has(s.d1)).toBe(false); // other pairs still merged
    expect(rows.get(keep)).toMatchObject({
      igdbId: 99120030,
      steamAppId: null,
    });
    expect(rows.get(dup)).toMatchObject({ igdbId: null, steamAppId: 99120030 });
    const chars = await testApp.db
      .select({ gameId: schema.characters.gameId })
      .from(schema.characters)
      .where(eq(schema.characters.name, 'Twin Alt'));
    expect(chars.map((c) => c.gameId).sort((a, b) => a - b)).toEqual(
      [keep, dup].sort((a, b) => a - b),
    );
  }, 60_000);

  it('rewrites jsonb game-id arrays dup -> keeper, deduped, order kept', async () => {
    const s = await seedScenario(testApp);
    await seedSuggestion(testApp, 'Rok2120 has dup', [s.d1, s.k1, 424242]);
    await seedSuggestion(testApp, 'Rok2120 no dup', [s.k2, 424242]);
    await runMigration(testApp);

    expect(await suggestionIds(testApp, 'Rok2120 has dup')).toEqual([
      s.k1,
      424242,
    ]);
    expect(await suggestionIds(testApp, 'Rok2120 no dup')).toEqual([
      s.k2,
      424242,
    ]);
  }, 60_000);

  it('rewrites event_templates.config gameId dup -> keeper (number and string forms)', async () => {
    const s = await seedScenario(testApp);
    await seedTemplate(testApp, 'Rok2120 tpl num', { gameId: s.d1 });
    await seedTemplate(testApp, 'Rok2120 tpl str', { gameId: String(s.d1) });
    await seedTemplate(testApp, 'Rok2120 tpl other', { gameId: s.k2 });
    await runMigration(testApp);

    expect(await templateGameId(testApp, 'Rok2120 tpl num')).toBe(s.k1);
    expect(await templateGameId(testApp, 'Rok2120 tpl str')).toBe(String(s.k1));
    expect(await templateGameId(testApp, 'Rok2120 tpl other')).toBe(s.k2);
  }, 60_000);

  it('skips the WHOLE pair on a discord_game_roles collision and rolls back steps 1-2', async () => {
    const s = await seedScenario(testApp);
    const [keep, dup] = await seedTwinPair(
      testApp,
      'Rok2120 Rune Gate',
      99120040,
    );
    await testApp.db.insert(schema.discordGameRoles).values([
      { gameId: keep, roleId: 'rok2120-role-keep' },
      { gameId: dup, roleId: 'rok2120-role-dup' },
    ]);
    const userId = testApp.seed.adminUser.id;
    await testApp.db.insert(schema.characters).values([
      { userId, gameId: keep, name: 'Rune Keep', realm: 'R1', isMain: true },
      { userId, gameId: dup, name: 'Rune Dup', realm: 'R1', isMain: true },
    ]);
    const week = { userId, period: 'week', periodStart: '2026-06-01' };
    await testApp.db.insert(schema.gameActivityRollups).values([
      { ...week, gameId: keep, totalSeconds: 100 },
      { ...week, gameId: dup, totalSeconds: 50 },
    ]);
    await runMigration(testApp);

    const rows = await identities(testApp, [keep, dup, s.d1]);
    expect(rows.has(s.d1)).toBe(false); // other pairs still merged
    expect(rows.get(dup)).toMatchObject({ steamAppId: 99120040 });
    const roles = await testApp.db
      .select({ gameId: schema.discordGameRoles.gameId })
      .from(schema.discordGameRoles)
      .where(inArray(schema.discordGameRoles.gameId, [keep, dup]));
    expect(roles.map((r) => r.gameId).sort((a, b) => a - b)).toEqual(
      [keep, dup].sort((a, b) => a - b),
    );
    const r = schema.gameActivityRollups;
    const totals = await testApp.db
      .select({ gameId: r.gameId, totalSeconds: r.totalSeconds })
      .from(r)
      .where(inArray(r.gameId, [keep, dup]));
    expect(totals.sort((a, b) => a.gameId - b.gameId)).toEqual(
      [
        { gameId: keep, totalSeconds: 100 },
        { gameId: dup, totalSeconds: 50 },
      ].sort((a, b) => a.gameId - b.gameId),
    );
    const mains = await testApp.db
      .select({
        name: schema.characters.name,
        isMain: schema.characters.isMain,
      })
      .from(schema.characters)
      .where(inArray(schema.characters.gameId, [keep, dup]));
    expect(mains.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'Rune Dup', isMain: true },
      { name: 'Rune Keep', isMain: true },
    ]);
  }, 60_000);

  it('skips the pair on a LEAF but non-allowlisted collision (channel_lifecycle_suppressions)', async () => {
    await seedScenario(testApp);
    const [keep, dup] = await seedTwinPair(
      testApp,
      'Rok2120 Ash Hold',
      99120050,
    );
    await testApp.db.insert(schema.channelLifecycleSuppressions).values([
      { guildId: 'rok2120-guild', gameId: keep, reason: 'deleted' },
      { guildId: 'rok2120-guild', gameId: dup, reason: 'unbound' },
    ]);
    await runMigration(testApp);

    expect(
      [...(await identities(testApp, [keep, dup])).keys()].sort(
        (a, b) => a - b,
      ),
    ).toEqual([keep, dup].sort((a, b) => a - b));
    const sup = schema.channelLifecycleSuppressions;
    const kept = await testApp.db
      .select({ gameId: sup.gameId, reason: sup.reason })
      .from(sup)
      .where(eq(sup.guildId, 'rok2120-guild'));
    expect(kept.sort((a, b) => a.gameId - b.gameId)).toEqual(
      [
        { gameId: keep, reason: 'deleted' },
        { gameId: dup, reason: 'unbound' },
      ].sort((a, b) => a.gameId - b.gameId),
    );
  }, 60_000);

  it('copies the dup’s non-default registry config onto a default keeper', async () => {
    const [keep, dup] = await seedTwinPair(
      testApp,
      'Rok2120 Rune Gate',
      99120060,
    );
    await testApp.db
      .update(schema.games)
      .set({
        hasRoles: true,
        maxCharactersPerUser: 3,
        colorHex: '#123456',
      })
      .where(eq(schema.games.id, dup));
    await runMigration(testApp);

    const left = await identities(testApp, [keep, dup]);
    expect([...left.keys()]).toEqual([keep]);
    const k = left.get(keep);
    expect({
      hasRoles: k?.hasRoles,
      enabled: k?.enabled,
      maxCharactersPerUser: k?.maxCharactersPerUser,
      colorHex: k?.colorHex,
    }).toEqual({
      hasRoles: true,
      enabled: true,
      maxCharactersPerUser: 3,
      colorHex: '#123456',
    });
  }, 60_000);

  it('skips the pair when both rows hold different non-default config', async () => {
    const [keep, dup] = await seedTwinPair(
      testApp,
      'Rok2120 Moss Fen',
      99120070,
    );
    const g = schema.games;
    await testApp.db
      .update(g)
      .set({ colorHex: '#111111' })
      .where(eq(g.id, keep));
    await testApp.db
      .update(g)
      .set({ colorHex: '#222222' })
      .where(eq(g.id, dup));
    await runMigration(testApp);

    const left = await identities(testApp, [keep, dup]);
    expect([...left.keys()].sort((a, b) => a - b)).toEqual(
      [keep, dup].sort((a, b) => a - b),
    );
    expect(left.get(keep)?.colorHex).toBe('#111111');
    expect(left.get(dup)?.colorHex).toBe('#222222');
  }, 60_000);

  it('skips the pair when only `enabled` differs (disabled twin)', async () => {
    const [keep, dup] = await seedTwinPair(
      testApp,
      'Rok2120 Ash Ford',
      99120075,
    );
    const g = schema.games;
    await testApp.db.update(g).set({ enabled: false }).where(eq(g.id, dup));
    await runMigration(testApp);

    const left = await identities(testApp, [keep, dup]);
    expect([...left.keys()].sort((a, b) => a - b)).toEqual(
      [keep, dup].sort((a, b) => a - b),
    );
    expect(left.get(keep)?.enabled).toBe(true);
    expect(left.get(dup)?.enabled).toBe(false);
  }, 60_000);

  it('keeps the dup’s Steam playtime on the keeper’s colliding interest', async () => {
    const [keep, dup] = await seedTwinPair(
      testApp,
      'Rok2120 Glass Mere',
      99120080,
    );
    const userId = testApp.seed.adminUser.id;
    const synced = new Date('2026-11-01T00:00:00Z');
    const gi = schema.gameInterests;
    await testApp.db.insert(gi).values([
      { userId, gameId: keep, source: 'steam_library' },
      {
        userId,
        gameId: dup,
        source: 'steam_library',
        playtimeForever: 500,
        playtime2weeks: 20,
        lastSyncedAt: synced,
      },
    ]);
    await runMigration(testApp);

    const rows = await testApp.db
      .select({
        gameId: gi.gameId,
        forever: gi.playtimeForever,
        twoWeeks: gi.playtime2weeks,
        synced: gi.lastSyncedAt,
      })
      .from(gi)
      .where(and(eq(gi.userId, userId), inArray(gi.gameId, [keep, dup])));
    expect(rows).toEqual([
      { gameId: keep, forever: 500, twoWeeks: 20, synced },
    ]);
  }, 60_000);

  it('Q2: merges an IGDB row + Steam-first twin with DIFFERENT Steam ids into the IGDB row, adopting the twin’s ids', async () => {
    const ids = await seedGames(testApp, BL2_PAIR);
    const keep = at(ids, 0);
    const dup = at(ids, 1);
    const userId = testApp.seed.adminUser.id;
    const gi = schema.gameInterests;
    await testApp.db
      .insert(gi)
      .values({ userId, gameId: dup, source: 'steam_library' });
    await runMigration(testApp);

    const rows = await identities(testApp, [keep, dup]);
    expect(rows.has(dup)).toBe(false);
    expect(rows.get(keep)).toMatchObject({
      igdbId: 99120040,
      steamAppId: 99120042,
      steamAppIdSource: 'manual',
      itadGameId: 'itad-rok2120-bl-y',
      itadBoxartUrl: 'https://example.test/bl-y.png',
    });
    const links = await testApp.db
      .select({ gameId: gi.gameId })
      .from(gi)
      .where(inArray(gi.gameId, [keep, dup]));
    expect(links).toEqual([{ gameId: keep }]);
  }, 60_000);

  it('Q2: leaves a name group of three rows untouched (ambiguous)', async () => {
    const ids = await seedGames(testApp, TRIPLE);
    await runMigration(testApp);

    const rows = await identities(testApp, ids);
    expect(rows.size).toBe(3);
    expect(rows.get(at(ids, 0))?.steamAppId).toBe(99120050);
    expect(rows.get(at(ids, 1))?.steamAppId).toBe(99120051);
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

/** Borderlands-2 shape (Q2): IGDB row on an edition Steam id + real Steam-first row. */
const BL2_PAIR: GameSeed[] = [
  {
    name: 'Rok2120 Border Lands',
    slug: 'rok2120-border-lands',
    igdbId: 99120040,
    steamAppId: 99120041,
    steamAppIdSource: 'igdb',
    itadGameId: 'itad-rok2120-bl-x',
  },
  {
    name: 'Rok2120 Border Lands',
    slug: 'rok2120-border-lands-2',
    steamAppId: 99120042,
    steamAppIdSource: 'steam',
    itadGameId: 'itad-rok2120-bl-y',
    itadBoxartUrl: 'https://example.test/bl-y.png',
  },
];

/** Three rows share a name: ambiguous, never merged. */
const TRIPLE: GameSeed[] = [
  {
    name: 'Rok2120 Tri Peak',
    slug: 'rok2120-tri-peak',
    igdbId: 99120050,
    steamAppId: 99120050,
  },
  {
    name: 'Rok2120 Tri Peak',
    slug: 'rok2120-tri-peak-2',
    steamAppId: 99120051,
  },
  {
    name: 'Rok2120 Tri Peak',
    slug: 'rok2120-tri-peak-3',
    itadGameId: 'itad-rok2120-tri',
  },
];

/** IGDB keeper + Steam-first dup whose characters collide (non-leaf table). */
const NON_LEAF_PAIR: GameSeed[] = [
  { name: 'Rok2120 Stone Keep', slug: 'rok2120-stone-keep', igdbId: 99120030 },
  {
    name: 'Rok2120 Stone Keep',
    slug: 'rok2120-stone-keep-2',
    steamAppId: 99120030,
  },
];

/** A discovery suggestion holding `ids` in candidate_game_ids. */
async function seedSuggestion(
  testApp: TestApp,
  name: string,
  ids: number[],
): Promise<void> {
  await testApp.db.execute(sql`
    INSERT INTO discovery_category_suggestions
      (name, description, category_type, theme_vector, status,
       population_strategy, candidate_game_ids)
    VALUES (${name}, 'rok2120', 'trend', '[0,0,0,0,0,0,0]', 'pending',
            'fixed', ${JSON.stringify(ids)}::jsonb)`);
}

/** candidate_game_ids of the suggestion named `name`. */
async function suggestionIds(
  testApp: TestApp,
  name: string,
): Promise<number[]> {
  const d = schema.discoveryCategorySuggestions;
  const [row] = await testApp.db
    .select({ ids: d.candidateGameIds })
    .from(d)
    .where(eq(d.name, name));
  if (!row) throw new Error(`suggestion ${name} missing`);
  return row.ids;
}

/** IGDB keeper + Steam-first dup sharing `name`; returns [keeper, dup]. */
async function seedTwinPair(
  testApp: TestApp,
  name: string,
  extId: number,
): Promise<[number, number]> {
  const slug = name.toLowerCase().replace(/\s+/g, '-');
  const ids = await seedGames(testApp, [
    { name, slug, igdbId: extId },
    { name, slug: `${slug}-2`, steamAppId: extId },
  ]);
  return [at(ids, 0), at(ids, 1)];
}

/** An event template owned by the admin with the given config. */
async function seedTemplate(
  testApp: TestApp,
  name: string,
  config: Record<string, unknown>,
): Promise<void> {
  await testApp.db.insert(schema.eventTemplates).values({
    userId: testApp.seed.adminUser.id,
    name,
    config,
  });
}

/** config->'gameId' of the template named `name`, as stored (number or string). */
async function templateGameId(
  testApp: TestApp,
  name: string,
): Promise<unknown> {
  const t = schema.eventTemplates;
  const [row] = await testApp.db
    .select({ config: t.config })
    .from(t)
    .where(eq(t.name, name));
  if (!row) throw new Error(`template ${name} missing`);
  const cfg: unknown = row.config;
  if (typeof cfg !== 'object' || cfg === null) throw new Error('bad config');
  return 'gameId' in cfg ? cfg.gameId : undefined;
}
