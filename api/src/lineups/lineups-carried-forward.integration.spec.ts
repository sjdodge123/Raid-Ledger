/**
 * Decided-view carriedForward payload integration tests (ROK-1274).
 *
 * Regression coverage for the bug where `buildGroupedMatchesResponse`
 * returned `carriedForward: []` unconditionally despite
 * `community_lineup_entries.carried_over_from` having real rows. The
 * `CarriedForwardSection` chip strip in `DecidedMatchesView` silently
 * never rendered.
 *
 * Endpoint under test: `GET /lineups/:id/matches`.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

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

async function loginAsMember(
  tag = 'member',
): Promise<{ token: string; userId: number }> {
  const bcrypt = await import('bcrypt');
  const hash = await bcrypt.hash('MemberPass1!', 4);
  const [user] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: `local:${tag}@test.local`,
      username: tag,
      role: 'member',
    })
    .returning();
  await testApp.db.insert(schema.localCredentials).values({
    email: `${tag}@test.local`,
    passwordHash: hash,
    userId: user.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email: `${tag}@test.local`, password: 'MemberPass1!' });
  return { token: res.body.access_token as string, userId: user.id };
}

async function createGame(name: string, slug: string) {
  const [game] = await testApp.db
    .insert(schema.games)
    .values({ name, slug })
    .returning();
  return game;
}

/** Bring a lineup to decided with seeded entries (one carried over) + votes. */
async function seedDecidedLineupWithMixedEntries(): Promise<{
  lineupId: number;
  carriedGameId: number;
  freshGameId: number;
  stubLineupId: number;
}> {
  const carriedGame = await createGame('Carried Forward', 'carried-fwd');
  const freshGame = await createGame('Fresh Pick', 'fresh-pick');

  // Real lineup row to satisfy the FK on entries.carried_over_from.
  const stubRes = await testApp.request
    .post('/lineups')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ title: 'Carryover Source Stub' });
  const stubLineupId = stubRes.body.id as number;

  const createRes = await testApp.request
    .post('/lineups')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ title: 'Carryfwd Inspect', matchThreshold: 35 });
  const lineupId = createRes.body.id as number;

  await testApp.db.insert(schema.communityLineupEntries).values({
    lineupId,
    gameId: carriedGame.id,
    nominatedBy: testApp.seed.adminUser.id,
    carriedOverFrom: stubLineupId,
  });
  await testApp.db.insert(schema.communityLineupEntries).values({
    lineupId,
    gameId: freshGame.id,
    nominatedBy: testApp.seed.adminUser.id,
  });

  await testApp.request
    .patch(`/lineups/${lineupId}/status`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status: 'voting' });

  // 10 voters; carriedGame: 4/10 = 40%, freshGame: 10/10 = 100%.
  for (let i = 0; i < 10; i++) {
    const m = await loginAsMember(`carryfwd-voter-${i}`);
    await testApp.db.insert(schema.communityLineupVotes).values({
      lineupId,
      userId: m.userId,
      gameId: freshGame.id,
    });
    if (i < 4) {
      await testApp.db.insert(schema.communityLineupVotes).values({
        lineupId,
        userId: m.userId,
        gameId: carriedGame.id,
      });
    }
  }

  await testApp.request
    .patch(`/lineups/${lineupId}/status`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status: 'decided' });

  return {
    lineupId,
    carriedGameId: carriedGame.id,
    freshGameId: freshGame.id,
    stubLineupId,
  };
}

describe('ROK-1274: GET /lineups/:id/matches carriedForward payload', () => {
  it('exposes carried-over entries on the decided-view response', async () => {
    const { lineupId, carriedGameId, freshGameId } =
      await seedDecidedLineupWithMixedEntries();
    void freshGameId;

    const res = await testApp.request
      .get(`/lineups/${lineupId}/matches`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.carriedForward)).toBe(true);
    expect(res.body.carriedForward).toHaveLength(1);

    const [chip] = res.body.carriedForward;
    expect(chip).toMatchObject({
      gameId: carriedGameId,
      gameName: 'Carried Forward',
      voteCount: 4,
      nominatedBy: { id: testApp.seed.adminUser.id },
    });
    expect(typeof chip.nominatedBy.displayName).toBe('string');
    expect(chip.nominatedBy.displayName.length).toBeGreaterThan(0);
  });

  it('returns carriedForward=[] when the lineup has no carried-over entries', async () => {
    const game = await createGame('No Carry', 'no-carry');

    const createRes = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'No Carry Inspect', matchThreshold: 35 });
    const lineupId = createRes.body.id as number;

    await testApp.db.insert(schema.communityLineupEntries).values({
      lineupId,
      gameId: game.id,
      nominatedBy: testApp.seed.adminUser.id,
    });

    await testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'voting' });

    for (let i = 0; i < 3; i++) {
      const m = await loginAsMember(`no-carry-voter-${i}`);
      await testApp.db.insert(schema.communityLineupVotes).values({
        lineupId,
        userId: m.userId,
        gameId: game.id,
      });
    }

    await testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'decided' });

    const res = await testApp.request
      .get(`/lineups/${lineupId}/matches`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.carriedForward).toEqual([]);
  });
});
