/**
 * ROK-1602 — web game search relevance for "wow", against a real Postgres.
 *
 * Prod (2026-09-15): typing "Wow" on the Games page / lineup nominate search
 * showed "Wow Dance" / "Wowo Island" at the top and World of Warcraft titles
 * lower or missing. Two causes, both covered here:
 *   1. The DB read took 20 rows with no ORDER BY, so a query matching 20+
 *      titles dropped arbitrary rows — the filler corpus below is inserted
 *      BEFORE the WoW titles to make that bite.
 *   2. "World of Warcraft" never contains "wow", so only an acronym match
 *      admits it, and the re-sort ranked plain `startsWith` hits above it.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

/** Infix "wow" hits — enough to overflow the 20-row search limit alone. */
const FILLERS = Array.from({ length: 22 }, (_, i) => ({
  name: `Snowowl Saga ${i + 1}`,
  popularity: null,
}));

/** Seeded AFTER the fillers so insertion order cannot rescue them. */
const CORPUS = [
  { name: 'Wowo Island', popularity: 5 },
  { name: 'Wow Dance', popularity: 4 },
  { name: 'WoW: Forever', popularity: 40 },
  { name: 'World of Warcraft Classic', popularity: 80 },
  { name: 'World of Warcraft', popularity: 95 },
];

let testApp: TestApp;

async function seedGames(): Promise<void> {
  // Sequential so `games.id` follows array order (fillers first).
  for (const [i, row] of [...FILLERS, ...CORPUS].entries()) {
    await testApp.db.insert(schema.games).values({
      name: row.name,
      slug: `rok-1602-seed-${i}`,
      popularity: row.popularity,
      hidden: false,
      banned: false,
    });
  }
}

async function searchNames(q: string): Promise<string[]> {
  const res = await testApp.request.get(
    `/games/search?q=${encodeURIComponent(q)}`,
  );
  expect(res.status).toBe(200);
  return (res.body as { data: Array<{ name: string }> }).data.map(
    (g) => g.name,
  );
}

beforeAll(async () => {
  testApp = await getTestApp();
});

// Seed per test and truncate in afterEach, like every sibling spec. A
// top-level afterAll truncate runs AFTER integration-setup.ts's global
// afterAll(closeTestApp) (hooks fire in registration order), i.e. against
// an ended postgres client -> CONNECTION_ENDED.
beforeEach(async () => {
  await seedGames();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('GET /games/search relevance (ROK-1602)', () => {
  it('ranks the World of Warcraft titles above Wow Dance / Wowo Island', async () => {
    const names = await searchNames('wow');

    expect(names.slice(0, 5)).toEqual([
      'World of Warcraft',
      'World of Warcraft Classic',
      'WoW: Forever',
      'Wow Dance',
      'Wowo Island',
    ]);
  });

  it('keeps infix-only hits below every prefix / acronym hit', async () => {
    const names = await searchNames('wow');

    const firstFiller = names.findIndex((n) => n.startsWith('Snowowl'));
    expect(firstFiller).toBeGreaterThan(names.indexOf('Wowo Island'));
  });

  it('does not acronym-match a multi-word query', async () => {
    const names = await searchNames('world of');

    expect(names).toEqual(
      expect.arrayContaining([
        'World of Warcraft',
        'World of Warcraft Classic',
      ]),
    );
    expect(names).not.toContain('Wow Dance');
  });
});
