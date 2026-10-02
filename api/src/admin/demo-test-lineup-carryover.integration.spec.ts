/**
 * `recarryLineupFromForTest` + `carryOverFromLastDecided({ previousLineupId })`
 * (TDB:975).
 *
 * Automatic carryover copies from the newest PUBLIC decided/archived lineup
 * on the whole instance. When another smoke run archives a lineup after the
 * carryover smoke archives its own, the newer lineup (with no suggested
 * matches) becomes the source and nothing the spec expects is carried. The
 * DEMO_MODE `carryover-from` seam pins the source explicitly.
 *
 * Fixture shape:
 *   - A: public, archived, OLDER — one entry + one below-threshold
 *     `suggested` match for the seed game.
 *   - Z: public, archived, NEWER — no matches (the "sibling" lineup).
 *   - B: building — holds a stray entry auto-carried from Z.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { carryOverFromLastDecided } from '../lineups/lineups-carryover.helpers';
import { recarryLineupFromForTest } from './demo-test-lineup-edge.helpers';

const HOUR_MS = 60 * 60 * 1000;

let testApp: TestApp;

async function insertLineup(
  title: string,
  status: 'building' | 'archived',
  createdAt: Date,
): Promise<number> {
  const [row] = await testApp.db
    .insert(schema.communityLineups)
    .values({
      title,
      status,
      visibility: 'public',
      createdBy: testApp.seed.adminUser.id,
      publicSlug: `co-${Math.random().toString(36).slice(2, 10)}`,
      createdAt,
    })
    .returning({ id: schema.communityLineups.id });
  return row.id;
}

/** Seed A (source with a suggested match), Z (newer, empty) and stray game. */
async function seedSourceAndSibling(): Promise<{
  sourceId: number;
  siblingId: number;
  strayGameId: number;
}> {
  const adminId = testApp.seed.adminUser.id;
  const gameId = testApp.seed.game.id;
  const now = Date.now();
  const sourceId = await insertLineup(
    'co-A',
    'archived',
    new Date(now - 2 * HOUR_MS),
  );
  await testApp.db
    .insert(schema.communityLineupEntries)
    .values({ lineupId: sourceId, gameId, nominatedBy: adminId });
  await testApp.db.insert(schema.communityLineupMatches).values({
    lineupId: sourceId,
    gameId,
    status: 'suggested',
    thresholdMet: false,
  });
  const siblingId = await insertLineup(
    'co-Z',
    'archived',
    new Date(now - HOUR_MS),
  );
  const [stray] = await testApp.db
    .insert(schema.games)
    .values({ name: 'Carryover Stray Game', slug: 'carryover-stray-game' })
    .returning({ id: schema.games.id });
  return { sourceId, siblingId, strayGameId: stray.id };
}

async function carriedEntries(lineupId: number) {
  return testApp.db
    .select({
      gameId: schema.communityLineupEntries.gameId,
      carriedOverFrom: schema.communityLineupEntries.carriedOverFrom,
    })
    .from(schema.communityLineupEntries)
    .where(
      and(
        eq(schema.communityLineupEntries.lineupId, lineupId),
        isNotNull(schema.communityLineupEntries.carriedOverFrom),
      ),
    );
}

describe('carryover from an explicit source lineup (TDB:975)', () => {
  beforeAll(async () => {
    testApp = await getTestApp();
    testApp.seed = await truncateAllTables(testApp.db);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  it('re-carries from the pinned source and drops the stray auto-carried row', async () => {
    const { sourceId, siblingId, strayGameId } = await seedSourceAndSibling();
    const lineupId = await insertLineup('co-B', 'building', new Date());
    await testApp.db.insert(schema.communityLineupEntries).values({
      lineupId,
      gameId: strayGameId,
      nominatedBy: testApp.seed.adminUser.id,
      carriedOverFrom: siblingId,
    });

    await recarryLineupFromForTest(testApp.db, lineupId, sourceId);

    expect(await carriedEntries(lineupId)).toEqual([
      { gameId: testApp.seed.game.id, carriedOverFrom: sourceId },
    ]);
  });

  it('without a pinned source, the newer empty sibling wins and nothing is carried', async () => {
    await seedSourceAndSibling();
    const lineupId = await insertLineup('co-B2', 'building', new Date());

    await carryOverFromLastDecided(testApp.db, lineupId);

    expect(await carriedEntries(lineupId)).toEqual([]);
  });
});
