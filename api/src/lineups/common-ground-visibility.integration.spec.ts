/**
 * Common Ground + nominate must not surface or accept moderated games
 * (TECH-DEBT-BACKLOG 2842). A game an admin hid or banned stays out of the
 * Common Ground pool, and POST /lineups/:id/nominate refuses it with the same
 * 404 as a missing game, so the filter cannot be bypassed by id.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { nonEmpty } from '../common/testing/narrow';

function describeCommonGroundVisibility() {
  let testApp: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  async function createBuildingLineup(): Promise<number> {
    const res = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Visibility Test' });
    if (res.status !== 201) {
      throw new Error(`createBuildingLineup failed: ${res.status}`);
    }
    return res.body.id as number;
  }

  /** Insert a game the admin owns, so it qualifies for the pool. */
  async function insertOwnedGame(
    name: string,
    flags: { hidden?: boolean; banned?: boolean } = {},
  ): Promise<number> {
    const [game] = nonEmpty(
      await testApp.db
        .insert(schema.games)
        .values({
          name,
          slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
          steamAppId: Math.floor(Math.random() * 900000) + 100000,
          ...flags,
        })
        .returning(),
      'game',
    );
    await testApp.db.insert(schema.gameInterests).values({
      userId: testApp.seed.adminUser.id,
      gameId: game.id,
      source: 'steam_library',
    });
    return game.id;
  }

  it('omits hidden and banned games from the Common Ground pool', async () => {
    await createBuildingLineup();
    const visibleId = await insertOwnedGame('Visible Game');
    const hiddenId = await insertOwnedGame('Hidden Game', { hidden: true });
    const bannedId = await insertOwnedGame('Banned Game', { banned: true });

    const res = await testApp.request
      .get('/lineups/common-ground')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ minOwners: 1 });

    expect(res.status).toBe(200);
    const ids = (res.body.data as Array<{ gameId: number }>).map(
      (row) => row.gameId,
    );
    expect(ids).toContain(visibleId);
    expect(ids).not.toContain(hiddenId);
    expect(ids).not.toContain(bannedId);
  });

  it.each([
    ['hidden', { hidden: true }],
    ['banned', { banned: true }],
  ] as const)(
    'refuses to nominate a %s game with 404',
    async (label, flags) => {
      const lineupId = await createBuildingLineup();
      const gameId = await insertOwnedGame(`Moderated ${label}`, flags);

      const res = await testApp.request
        .post(`/lineups/${lineupId}/nominate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gameId });

      expect(res.status).toBe(404);
      const entries = await testApp.db
        .select({ gameId: schema.communityLineupEntries.gameId })
        .from(schema.communityLineupEntries);
      expect(entries.map((e) => e.gameId)).not.toContain(gameId);
    },
  );
}

describe(
  'Common Ground visibility (integration)',
  describeCommonGroundVisibility,
);
