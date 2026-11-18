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

/** Closed session; `gameId` null = an unmatched presence row. */
async function session(
  userId: number,
  gameId: number | null,
  iso: string,
  seconds: number,
): Promise<void> {
  const startedAt = new Date(iso);
  await testApp.db.insert(schema.gameActivitySessions).values({
    userId,
    gameId,
    discordActivityName: gameId === null ? CLASSIC : 'voice-resolved name',
    startedAt,
    endedAt: new Date(startedAt.getTime() + seconds * 1000),
    durationSeconds: seconds,
  });
}

/** Every Classic-family play of `userId`: "Anniv|Forever|null @day". */
async function sessionsOf(userId: number): Promise<string[]> {
  const rows = await testApp.db
    .select()
    .from(schema.gameActivitySessions)
    .where(eq(schema.gameActivitySessions.userId, userId))
    .orderBy(asc(schema.gameActivitySessions.startedAt));
  const label = (id: number | null): string =>
    id === forever ? 'Forever' : id === anniv ? 'Anniv' : String(id);
  return rows.map(
    (r) => `${label(r.gameId)}@${r.startedAt.toISOString().slice(0, 10)}`,
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
        `${r.gameId === forever ? 'Forever' : 'Anniv'} ${r.period} ${r.periodStart} = ${r.totalSeconds}`,
    )
    .sort();
}

async function runMigration(): Promise<void> {
  expect(statements).toHaveLength(4);
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
