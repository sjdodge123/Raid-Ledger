/**
 * Lineup auto-advance integration tests (ROK-1118).
 *
 * TDD gate: these tests define the behavior of the auto-advance feature.
 * They MUST fail until the implementation in `maybeAutoAdvance` ships.
 *
 * Behaviors covered (one per AC):
 *
 *   1. Voting → decided auto-advances for a private lineup once every
 *      expected voter (creator + invitees) has cast at least one vote.
 *   2. Voting → decided does NOT advance when one invitee has not yet voted.
 *   3. Building → voting auto-advances for a public lineup when every
 *      distinct nominator has nominated and total nominations meet the floor.
 *   4. Operator manual transition via PATCH /lineups/:id/status still works
 *      (regression guard against the auto-advance feature breaking the
 *      existing override path).
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { eq } from 'drizzle-orm';

function describeAutoAdvance() {
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

  // -- Helpers ---------------------------------------------------------------

  async function createMember(
    tag: string,
  ): Promise<{ token: string; userId: number }> {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('AutoAdvance1!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${tag}@auto.local`,
        username: tag,
        role: 'member',
      })
      .returning();
    const email = `${tag}@auto.local`.toLowerCase();
    await testApp.db.insert(schema.localCredentials).values({
      email,
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email, password: 'AutoAdvance1!' });
    return { token: res.body.access_token as string, userId: user.id };
  }

  async function createPublicLineup(token: string) {
    return testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Auto Advance Public' });
  }

  async function createPrivateLineup(token: string, inviteeUserIds: number[]) {
    return testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Auto Advance Private',
        visibility: 'private',
        inviteeUserIds,
      });
  }

  async function createGames(count: number) {
    const games: (typeof schema.games.$inferSelect)[] = [];
    for (let i = 0; i < count; i++) {
      const [game] = await testApp.db
        .insert(schema.games)
        .values({
          name: `AutoAdvance Game ${i + 1}`,
          slug: `auto-game-${i + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        })
        .returning();
      games.push(game);
    }
    return games;
  }

  async function nominate(token: string, lineupId: number, gameId: number) {
    return testApp.request
      .post(`/lineups/${lineupId}/nominate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ gameId });
  }

  async function vote(token: string, lineupId: number, gameId: number) {
    return testApp.request
      .post(`/lineups/${lineupId}/vote`)
      .set('Authorization', `Bearer ${token}`)
      .send({ gameId });
  }

  async function advanceToVoting(lineupId: number, token: string) {
    return testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'voting' });
  }

  /** Read the current persisted status from the DB (bypasses cache). */
  async function readStatus(lineupId: number): Promise<string> {
    const [row] = await testApp.db
      .select({ status: schema.communityLineups.status })
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineupId));
    return row?.status ?? 'missing';
  }

  // -- AC: voting → decided auto-advance for a private lineup ---------------

  it('flips a private lineup from voting → decided when all invitees + creator vote', async () => {
    // Two invitees + the admin creator = 3 expected voters.
    const invitee1 = await createMember('priv-voter-1');
    const invitee2 = await createMember('priv-voter-2');

    const createRes = await createPrivateLineup(adminToken, [
      invitee1.userId,
      invitee2.userId,
    ]);
    expect(createRes.status).toBe(201);
    const lineupId = createRes.body.id as number;

    // Each invitee nominates a game (so there's something to vote on).
    const games = await createGames(3);
    await nominate(invitee1.token, lineupId, games[0].id);
    await nominate(invitee2.token, lineupId, games[1].id);
    await nominate(adminToken, lineupId, games[2].id);

    // Operator advances to voting.
    const adv = await advanceToVoting(lineupId, adminToken);
    expect(adv.status).toBe(200);
    expect(await readStatus(lineupId)).toBe('voting');

    // First vote — creator. Status should remain 'voting'.
    const v1 = await vote(adminToken, lineupId, games[0].id);
    expect(v1.status).toBe(200);
    expect(await readStatus(lineupId)).toBe('voting');

    // Second vote — invitee1. Still missing invitee2.
    const v2 = await vote(invitee1.token, lineupId, games[1].id);
    expect(v2.status).toBe(200);
    expect(await readStatus(lineupId)).toBe('voting');

    // Third (final) vote — invitee2 closes the quorum.
    // After this call the auto-advance hook should fire.
    const v3 = await vote(invitee2.token, lineupId, games[2].id);
    expect(v3.status).toBe(200);

    // Status should now be 'decided' WITHOUT any explicit PATCH /status call.
    expect(await readStatus(lineupId)).toBe('decided');
  });

  // -- AC: voting → decided does NOT advance with one invitee missing -------

  it('does not advance a private lineup when one invitee has not voted', async () => {
    const invitee1 = await createMember('partial-1');
    const invitee2 = await createMember('partial-2');

    const createRes = await createPrivateLineup(adminToken, [
      invitee1.userId,
      invitee2.userId,
    ]);
    expect(createRes.status).toBe(201);
    const lineupId = createRes.body.id as number;

    const games = await createGames(3);
    await nominate(invitee1.token, lineupId, games[0].id);
    await nominate(invitee2.token, lineupId, games[1].id);
    await nominate(adminToken, lineupId, games[2].id);

    await advanceToVoting(lineupId, adminToken);
    expect(await readStatus(lineupId)).toBe('voting');

    // Only 2 of the 3 expected voters cast a vote.
    await vote(adminToken, lineupId, games[0].id);
    await vote(invitee1.token, lineupId, games[0].id);

    // invitee2 stays silent → quorum not met → no auto-advance.
    expect(await readStatus(lineupId)).toBe('voting');
  });

  // -- AC: building → voting auto-advance for a public lineup ---------------

  it('auto-advances a public lineup from building → voting once the floor is met', async () => {
    // Default floor is 4 distinct nominations. Use 4 distinct nominators so
    // both AC conditions (every expected nominator has nominated AND total
    // nominations ≥ floor) line up.
    const m1 = await createMember('pub-nom-1');
    const m2 = await createMember('pub-nom-2');
    const m3 = await createMember('pub-nom-3');
    const m4 = await createMember('pub-nom-4');

    const createRes = await createPublicLineup(adminToken);
    expect(createRes.status).toBe(201);
    const lineupId = createRes.body.id as number;
    expect(await readStatus(lineupId)).toBe('building');

    const games = await createGames(4);

    // 3 distinct nominators — below the floor of 4. Status must NOT change.
    const n1 = await nominate(m1.token, lineupId, games[0].id);
    expect(n1.status).toBe(201);
    const n2 = await nominate(m2.token, lineupId, games[1].id);
    expect(n2.status).toBe(201);
    const n3 = await nominate(m3.token, lineupId, games[2].id);
    expect(n3.status).toBe(201);
    expect(await readStatus(lineupId)).toBe('building');

    // 4th distinct nominator hits the floor — auto-advance should fire.
    const n4 = await nominate(m4.token, lineupId, games[3].id);
    expect(n4.status).toBe(201);
    expect(await readStatus(lineupId)).toBe('voting');
  });

  // -- AC: operator manual advance still works (regression guard) -----------

  it('still honors a manual PATCH /lineups/:id/status from an operator', async () => {
    const invitee = await createMember('manual-1');
    const createRes = await createPrivateLineup(adminToken, [invitee.userId]);
    expect(createRes.status).toBe(201);
    const lineupId = createRes.body.id as number;

    const games = await createGames(1);
    await nominate(invitee.token, lineupId, games[0].id);

    // Operator forces voting even though the auto-advance heuristic might not
    // fire (single invitee, no floor). The manual override path must keep
    // working unchanged.
    const adv = await advanceToVoting(lineupId, adminToken);
    expect(adv.status).toBe(200);
    expect(await readStatus(lineupId)).toBe('voting');

    // Operator can also force decided directly.
    const dec = await testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'decided', decidedGameId: games[0].id });
    expect(dec.status).toBe(200);
    expect(await readStatus(lineupId)).toBe('decided');
  });
}

describe('Lineup auto-advance (ROK-1118, integration)', describeAutoAdvance);
