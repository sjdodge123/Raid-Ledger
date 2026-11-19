/**
 * ROK-2259 migration 0307 — real database.
 *
 * Seeds Classic-family play in both prod shapes (credited to TBC Anniversary,
 * or unmatched "World of Warcraft Classic" with game_id NULL) before and after
 * Forever's launch (2026-11-04) for three players — one with a Forever
 * character, one Anniversary-only, one with no WoW characters — plus the stale
 * rollups the daily job wrote. Runs the migration's own statements read from
 * the .sql file (spec and migration share one text) and asserts the per-player
 * re-attribution and the rebuilt rollups, twice (idempotency).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asc, eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';

const MIGRATION = join(
  __dirname,
  '../../drizzle/migrations/0307_forever_activity_reattribution.sql',
);
const statements = readFileSync(MIGRATION, 'utf8')
  .split('--> statement-breakpoint')
  .filter((s) => /\b(UPDATE|DELETE|INSERT)\b/.test(s));

const FOREVER_SLUG = 'world-of-warcraft-forever';
const ANNIV_SLUG =
  'world-of-warcraft-burning-crusade-classic-anniversary-edition';
const CLASSIC = 'World of Warcraft Classic';
const H = 3600;

let testApp: TestApp;
let forever: number;
let anniv: number;

async function insertGame(slug: string): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: `ROK-2259 ${slug}`, slug })
      .returning({ id: schema.games.id }),
    slug,
  );
  return g.id;
}

async function insertUser(tag: string, charGame?: number, variant?: string) {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `d:2259-${tag}`, username: `u2259-${tag}` })
      .returning({ id: schema.users.id }),
    tag,
  );
  if (charGame !== undefined) {
    await testApp.db.insert(schema.characters).values({
      userId: u.id,
      gameId: charGame,
      name: `Char${tag}`,
      gameVariant: variant ?? null,
    });
  }
  return u.id;
}

/**
 * Closed session; `gameId` null = an unmatched presence row (raw Classic
 * name), otherwise a voice row (resolved games.name) unless `name` is given.
 */
async function session(
  userId: number,
  gameId: number | null,
  iso: string,
  seconds: number,
  name?: string,
): Promise<void> {
  const startedAt = new Date(iso);
  await testApp.db.insert(schema.gameActivitySessions).values({
    userId,
    gameId,
    discordActivityName:
      name ?? (gameId === null ? CLASSIC : 'voice-resolved name'),
    startedAt,
    endedAt: new Date(startedAt.getTime() + seconds * 1000),
    durationSeconds: seconds,
  });
}

/** "Forever" / "Anniv" by id; any other game (or null) by its raw id. */
function gameLabel(id: number | null): string {
  return id === forever ? 'Forever' : id === anniv ? 'Anniv' : String(id);
}

/** Every Classic-family play of `userId`: "Anniv|Forever|null @day". */
async function sessionsOf(userId: number): Promise<string[]> {
  const rows = await testApp.db
    .select()
    .from(schema.gameActivitySessions)
    .where(eq(schema.gameActivitySessions.userId, userId))
    .orderBy(asc(schema.gameActivitySessions.startedAt));
  return rows.map(
    (r) => `${gameLabel(r.gameId)}@${r.startedAt.toISOString().slice(0, 10)}`,
  );
}

/** Every rollup of `userId`: "Forever month 2026-11-01 = 5520". */
async function rollupsOf(userId: number): Promise<string[]> {
  const rows = await testApp.db
    .select()
    .from(schema.gameActivityRollups)
    .where(eq(schema.gameActivityRollups.userId, userId));
  return rows
    .map(
      (r) =>
        `${gameLabel(r.gameId)} ${r.period} ${r.periodStart} = ${r.totalSeconds}`,
    )
    .sort();
}

async function runMigration(): Promise<void> {
  expect(statements).toHaveLength(5);
  for (const statement of statements) {
    await testApp.db.execute(sql.raw(statement));
  }
}

/** The four shapes: before/after launch x credited-to-Anniversary/unmatched. */
async function seedPlay(userId: number): Promise<void> {
  await session(userId, anniv, '2026-10-20T10:00:00Z', 600);
  await session(userId, null, '2026-10-21T10:00:00Z', 900);
  await session(userId, anniv, '2026-11-10T10:00:00Z', H);
  await session(userId, null, '2026-11-12T10:00:00Z', H / 2);
  // Stale rollups as the daily job wrote them before the fix.
  await testApp.db.insert(schema.gameActivityRollups).values([
    {
      userId,
      gameId: anniv,
      period: 'month',
      periodStart: '2026-10-01',
      totalSeconds: 600,
    },
    {
      userId,
      gameId: anniv,
      period: 'month',
      periodStart: '2026-11-01',
      totalSeconds: H,
    },
    {
      userId,
      gameId: anniv,
      period: 'day',
      periodStart: '2026-11-10',
      totalSeconds: H,
    },
  ]);
}

/** November buckets of 1h (Tue 11-10) + 30m (Thu 11-12), week of Mon 11-09. */
const NOVEMBER = (game: string, extraMonth = 0): string[] => [
  `${game} day 2026-11-10 = ${H}`,
  `${game} day 2026-11-12 = ${H / 2}`,
  `${game} month 2026-11-01 = ${H * 1.5 + extraMonth}`,
  `${game} week 2026-11-09 = ${H * 1.5 + extraMonth}`,
];

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  forever = await insertGame(FOREVER_SLUG);
  anniv = await insertGame(ANNIV_SLUG);
});

// No afterAll truncate: the shared integration setup closes the pool.

describe('ROK-2259 0307 — per-player re-attribution since 2026-11-04', () => {
  it.each([1, 2])(
    'Forever-character player: post-launch play -> Forever, rollups rebuilt (run x%i)',
    async (runs) => {
      const id = await insertUser('fc', anniv, 'wow_forever');
      await seedPlay(id);
      await session(id, forever, '2026-11-12T20:00:00Z', 120);
      for (let i = 0; i < runs; i++) await runMigration();
      expect(await sessionsOf(id)).toEqual([
        'Anniv@2026-10-20',
        'null@2026-10-21',
        'Forever@2026-11-10',
        'Forever@2026-11-12',
        'Forever@2026-11-12',
      ]);
      expect(await rollupsOf(id)).toEqual(
        [
          'Anniv month 2026-10-01 = 600',
          `Forever day 2026-11-10 = ${H}`,
          `Forever day 2026-11-12 = ${H / 2 + 120}`,
          `Forever month 2026-11-01 = ${H * 1.5 + 120}`,
          `Forever week 2026-11-09 = ${H * 1.5 + 120}`,
        ].sort(),
      );
    },
  );
});

describe('ROK-2259 0307 — Anniversary-only player', () => {
  it.each([1, 2])(
    'Anniversary-only player: post-launch play stays/becomes Anniversary (run x%i)',
    async (runs) => {
      const id = await insertUser('ao', anniv);
      await seedPlay(id);
      for (let i = 0; i < runs; i++) await runMigration();
      expect(await sessionsOf(id)).toEqual([
        'Anniv@2026-10-20',
        'null@2026-10-21',
        'Anniv@2026-11-10',
        'Anniv@2026-11-12',
      ]);
      expect(await rollupsOf(id)).toEqual(
        ['Anniv month 2026-10-01 = 600', ...NOVEMBER('Anniv')].sort(),
      );
    },
  );
});

describe('ROK-2259 0307 — no WoW characters', () => {
  it.each([1, 2])(
    'player with no WoW characters: post-launch play -> Forever (run x%i)',
    async (runs) => {
      const id = await insertUser('nc');
      await seedPlay(id);
      for (let i = 0; i < runs; i++) await runMigration();
      expect(await sessionsOf(id)).toEqual([
        'Anniv@2026-10-20',
        'null@2026-10-21',
        'Forever@2026-11-10',
        'Forever@2026-11-12',
      ]);
      expect(await rollupsOf(id)).toEqual(
        ['Anniv month 2026-10-01 = 600', ...NOVEMBER('Forever')].sort(),
      );
    },
  );
});

describe('ROK-2259 0307 — raw activity name', () => {
  it('keeps the raw Discord activity name on re-attributed rows', async () => {
    const id = await insertUser('nm');
    await session(id, null, '2026-11-12T10:00:00Z', 60);
    await runMigration();
    const [row] = nonEmpty(
      await testApp.db
        .select()
        .from(schema.gameActivitySessions)
        .where(eq(schema.gameActivitySessions.userId, id)),
      'session',
    );
    expect([row.gameId, row.discordActivityName]).toEqual([forever, CLASSIC]);
  });
});

describe('ROK-2259 0307 — presence overlapping a voice row (no double credit)', () => {
  it.each([
    ['no WoW characters', undefined, 'Forever'],
    ['Anniversary-only', 'anniv', 'Anniv'],
  ] as const)(
    '%s: an ambiguous presence row overlapping a WoW voice row stays uncredited',
    async (tag, charGame, game) => {
      const id = await insertUser(`ov-${tag}`, charGame && anniv);
      // Voice 10:00-12:00 credited to Anniversary (resolved games.name) ...
      await session(id, anniv, '2026-11-15T10:00:00Z', 2 * H);
      // ... the same play's unmatched presence row 09:30-12:30 overlaps it,
      await session(id, null, '2026-11-15T09:30:00Z', 3 * H);
      // a mapped presence row (raw name, Anniversary) 11:00-11:30 too,
      await session(id, anniv, '2026-11-15T11:00:00Z', H / 2, CLASSIC);
      // while a presence row on its own (lower-case name) is credited.
      const lower = CLASSIC.toLowerCase();
      await session(id, null, '2026-11-16T10:00:00Z', H, lower);
      for (let i = 0; i < 2; i++) await runMigration();
      expect(await sessionsOf(id)).toEqual([
        'null@2026-11-15',
        `${game}@2026-11-15`,
        'null@2026-11-15',
        `${game}@2026-11-16`,
      ]);
      expect(await rollupsOf(id)).toEqual(
        [
          `${game} day 2026-11-15 = ${2 * H}`,
          `${game} day 2026-11-16 = ${H}`,
          `${game} month 2026-11-01 = ${3 * H}`,
          `${game} week 2026-11-09 = ${2 * H}`,
          `${game} week 2026-11-16 = ${H}`,
        ].sort(),
      );
    },
  );
});

describe('ROK-2259 0307 — edge cases', () => {
  it('a ruleset-only Forever character (no variant) counts as Forever', async () => {
    const id = await insertUser('rs');
    await testApp.db.insert(schema.characters).values({
      userId: id,
      gameId: anniv,
      name: 'CharRs',
      gameVariant: null,
      ruleset: 'pvp',
    });
    await session(id, anniv, '2026-11-10T10:00:00Z', H);
    await runMigration();
    expect(await sessionsOf(id)).toEqual(['Forever@2026-11-10']);
  });

  it('without the Forever game row the migration changes nothing', async () => {
    const id = await insertUser('mg');
    await seedPlay(id);
    await testApp.db.delete(schema.games).where(eq(schema.games.id, forever));
    const before = [await sessionsOf(id), await rollupsOf(id)];
    await runMigration();
    expect([await sessionsOf(id), await rollupsOf(id)]).toEqual(before);
  });

  it('re-sums the week and month buckets that straddle 2026-11-04', async () => {
    const id = await insertUser('bd', anniv);
    await session(id, anniv, '2026-11-02T10:00:00Z', 600);
    await session(id, anniv, '2026-11-05T10:00:00Z', 1200);
    await testApp.db.insert(schema.gameActivityRollups).values(
      (['day', 'week', 'month'] as const).map((period) => ({
        userId: id,
        gameId: anniv,
        period,
        periodStart: period === 'month' ? '2026-11-01' : '2026-11-02',
        totalSeconds: 600,
      })),
    );
    await runMigration();
    expect(await rollupsOf(id)).toEqual(
      [
        'Anniv day 2026-11-02 = 600',
        'Anniv day 2026-11-05 = 1200',
        'Anniv month 2026-11-01 = 1800',
        'Anniv week 2026-11-02 = 1800',
      ].sort(),
    );
  });
});
