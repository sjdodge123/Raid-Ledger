/**
 * ROK-1531 — game autocomplete relevance ranking, against a real Postgres.
 *
 * The defect: `autocompleteGames` / `autocompleteGameIds` selected with
 * `buildWordMatchFilters` + `.limit(25)` and NO `ORDER BY`, so a short query
 * matching more than 25 titles filled every slot with whatever the plan
 * yielded first (effectively insertion order) — the exact match `PEAK` was
 * pushed out of the list entirely.
 *
 * Ordering can only be proven against real SQL (the unit spec's mocked db can
 * assert the fragments, not the row order), so this seeds the operator's exact
 * corpus and asserts the ranking end to end.
 */
import { sql } from 'drizzle-orm';
import { autocompleteGameIds, autocompleteGames } from './bind.autocomplete';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import * as schema from '../../drizzle/schema';

let testApp: TestApp;

/** Insertion order IS the pre-fix result order — `PEAK` goes in last. */
const FILLERS = Array.from(
  { length: 25 },
  (_, i) => `Mountain Peak Filler ${i + 1}`,
);

beforeAll(async () => {
  testApp = await getTestApp();
  await testApp.db.execute(sql`DELETE FROM games WHERE name ILIKE '%peak%'`);
  const rows = [
    { name: 'Souten no Shiroki Kami no Kura: Great Peak', popularity: null },
    { name: "Puck's Peak", popularity: 90 },
    { name: 'Dodo Peak', popularity: null },
    { name: 'Moonlight Peaks', popularity: null },
    ...FILLERS.map((name) => ({ name, popularity: null })),
    { name: 'Peak Expedition', popularity: null },
    // `&` between spaces normalizes to a DOUBLE space unless the SQL collapses.
    { name: 'Peak & Valley Chronicles', popularity: null },
    { name: 'PEAK', popularity: null },
  ];
  // Sequential so `games.id` follows the array order exactly.
  for (const [i, row] of rows.entries()) {
    await testApp.db.insert(schema.games).values({
      name: row.name,
      slug: `rok-1531-seed-${i}`,
      popularity: row.popularity,
    });
  }
});

describe('game autocomplete relevance ranking (ROK-1531)', () => {
  it('puts the exact match PEAK first even though it was inserted last', async () => {
    const options = await autocompleteGameIds(testApp.db, 'peak');

    expect(options).toHaveLength(25);
    expect(options[0].name).toBe('PEAK');
  });

  it('ranks a prefix match above an infix match', async () => {
    const names = (await autocompleteGameIds(testApp.db, 'peak')).map(
      (o) => o.name,
    );

    expect(names.indexOf('Peak Expedition')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('Peak Expedition')).toBeLessThan(
      names.indexOf("Puck's Peak"),
    );
  });

  it('breaks infix ties by popularity before name length', async () => {
    const names = (await autocompleteGameIds(testApp.db, 'peak')).map(
      (o) => o.name,
    );

    // "Puck's Peak" (popularity 90) outranks the shorter, unrated "Dodo Peak".
    expect(names.indexOf("Puck's Peak")).toBeLessThan(
      names.indexOf('Dodo Peak'),
    );
  });

  it('applies the same ranking to the shared name-valued helper', async () => {
    const options = await autocompleteGames(testApp.db, 'peak');

    expect(options[0]).toEqual({ name: 'PEAK', value: 'PEAK' });
  });

  // Codex review: the query side collapses whitespace, so the column side must
  // too — otherwise a title whose punctuation was surrounded by spaces keeps a
  // double space, never equals the typed query, and misses the exact tier.
  it('matches exactly across punctuation that leaves a double space', async () => {
    const options = await autocompleteGames(
      testApp.db,
      'Peak & Valley Chronicles',
    );

    expect(options[0].name).toBe('Peak & Valley Chronicles');
  });
});
