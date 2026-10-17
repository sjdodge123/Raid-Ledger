/**
 * ROK-1525 — the Library player-count fixtures reach `/games/discover`.
 *
 * The regression this guards is environmental, so it is asserted against a
 * real DB rather than a mock: `library-filters.smoke.spec.ts` went red on
 * GitHub CI (and green on the fleet) because the seeded CI corpus carries
 * `player_count IS NULL` on every row, so no preset chip could both keep and
 * drop a card. The fix is for the spec to seed its own evidence — which is
 * only worth anything if the seeded games are actually (a) stored with the
 * ranges asked for and (b) visible in the discover payload the page reads.
 * Both are asserted here; the smoke spec assumes them.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { loadApprovedDynamicRows } from '../discovery-categories/discovery-categories.discover.helpers';
import * as schema from '../drizzle/schema';
import { seedPlayerCountFixtures } from './demo-test-player-count.helpers';

describe('seedPlayerCountFixtures (ROK-1525)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  beforeEach(async () => {
    await truncateAllTables(testApp.db);
  });

  async function rangeOf(id: number) {
    const [row] = await testApp.db
      .select({ playerCount: schema.games.playerCount })
      .from(schema.games)
      .where(eq(schema.games.id, id));
    return row?.playerCount ?? null;
  }

  it('stores the two fixtures with the exact ranges the presets need', async () => {
    const seeded = await seedPlayerCountFixtures(testApp.db);

    // 1-1 is dropped by every preset (2/3/4/5+), 2-5 is kept by every one of
    // them — so ANY preset the spec picks discriminates the pair.
    expect(await rangeOf(seeded.soloGameId)).toEqual({ min: 1, max: 1 });
    expect(await rangeOf(seeded.partyGameId)).toEqual({ min: 2, max: 5 });
    expect(seeded.soloGameId).not.toBe(seeded.partyGameId);
  });

  it('surfaces both fixtures in the discover rows the page renders', async () => {
    const seeded = await seedPlayerCountFixtures(testApp.db);

    const rows = await loadApprovedDynamicRows(testApp.db);
    const fixtureRow = rows.find(
      (row) => row.suggestionId === seeded.categoryId,
    );
    // The seeded category must render as a discover row at all.
    expect(fixtureRow).toBeDefined();

    const byId = new Map(fixtureRow!.games.map((game) => [game.id, game]));
    expect([...byId.keys()].sort()).toEqual(
      [seeded.soloGameId, seeded.partyGameId].sort(),
    );
    // The payload the smoke spec derives kept/dropped from is the DTO, not the
    // row — a range that survived the insert but not the mapper is the same
    // outage.
    expect(byId.get(seeded.soloGameId)?.playerCount).toEqual({
      min: 1,
      max: 1,
    });
    expect(byId.get(seeded.partyGameId)?.playerCount).toEqual({
      min: 2,
      max: 5,
    });
  });

  it('is idempotent — the desktop and mobile projects both seed it', async () => {
    const first = await seedPlayerCountFixtures(testApp.db);
    const second = await seedPlayerCountFixtures(testApp.db);

    expect(second.soloGameId).toBe(first.soloGameId);
    expect(second.partyGameId).toBe(first.partyGameId);
    expect(second.categoryId).toBe(first.categoryId);

    const rows = await loadApprovedDynamicRows(testApp.db);
    expect(
      rows.filter((row) => row.suggestionId === first.categoryId),
    ).toHaveLength(1);
    const games = await testApp.db
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(eq(schema.games.name, first.partyName));
    expect(games).toHaveLength(1);
  });
});
