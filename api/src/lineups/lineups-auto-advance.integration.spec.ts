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

  it('flips a private lineup from voting → decided when all voters use their full vote allotment', async () => {
    // Two invitees + the admin creator = 3 expected voters.
    // Default lineup.maxVotesPerPlayer = 3, so each must cast 3 votes.
    const invitee1 = await createMember('priv-voter-1');
    const invitee2 = await createMember('priv-voter-2');

    const createRes = await createPrivateLineup(adminToken, [
      invitee1.userId,
      invitee2.userId,
    ]);
    expect(createRes.status).toBe(201);
    const lineupId = createRes.body.id as number;

    // Need enough games so each voter can cast 3 distinct votes plus a
    // shared favorite that wins. Layout: g0 is the shared favorite (3 votes);
    // each voter also picks 2 personal games. Total games: 1 + 2*3 = 7.
    const games = await createGames(7);
    await nominate(adminToken, lineupId, games[0].id);
    await nominate(invitee1.token, lineupId, games[1].id);
    await nominate(invitee2.token, lineupId, games[2].id);
    await nominate(adminToken, lineupId, games[3].id);
    await nominate(invitee1.token, lineupId, games[4].id);
    await nominate(invitee2.token, lineupId, games[5].id);
    await nominate(adminToken, lineupId, games[6].id);

    // Manually advance to voting (we're testing voting→decided, not
    // building→voting; default per-voter min nominations = 3 isn't reached).
    const adv = await advanceToVoting(lineupId, adminToken);
    expect(adv.status).toBe(200);
    expect(await readStatus(lineupId)).toBe('voting');

    // Each voter casts 1/3 votes — quorum NOT met (operator's bug report).
    await vote(adminToken, lineupId, games[0].id);
    await vote(invitee1.token, lineupId, games[0].id);
    await vote(invitee2.token, lineupId, games[0].id);
    expect(await readStatus(lineupId)).toBe('voting');

    // Each voter casts 2/3 votes — still not full allotment.
    await vote(adminToken, lineupId, games[1].id);
    await vote(invitee1.token, lineupId, games[2].id);
    await vote(invitee2.token, lineupId, games[3].id);
    expect(await readStatus(lineupId)).toBe('voting');

    // Each voter casts their 3rd (final) vote — quorum closes. The shared
    // favorite g0 has 3 votes; everything else has 1, so no tie at the top.
    await vote(adminToken, lineupId, games[4].id);
    await vote(invitee1.token, lineupId, games[5].id);
    await vote(invitee2.token, lineupId, games[6].id);

    // Status should flip without any explicit PATCH /status call.
    expect(await readStatus(lineupId)).toBe('decided');
  });

  // -- AC: voting → decided does NOT advance with partial participation -----

  it('does not advance a private lineup when one invitee has not voted at all', async () => {
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

    // Two of three voters use their full allotment of 3.
    for (let i = 0; i < 3; i++) {
      await vote(adminToken, lineupId, games[i].id);
      await vote(invitee1.token, lineupId, games[i].id);
    }

    // invitee2 stays silent → quorum not met → no auto-advance.
    expect(await readStatus(lineupId)).toBe('voting');
  });

  it('does not advance a private lineup when voters have only used part of their allotment', async () => {
    // Operator's bug report: cast 1 of 3 available votes, room advances.
    const invitee = await createMember('partial-allotment');

    const createRes = await createPrivateLineup(adminToken, [invitee.userId]);
    expect(createRes.status).toBe(201);
    const lineupId = createRes.body.id as number;

    const games = await createGames(3);
    await nominate(invitee.token, lineupId, games[0].id);
    await nominate(adminToken, lineupId, games[1].id);

    await advanceToVoting(lineupId, adminToken);
    expect(await readStatus(lineupId)).toBe('voting');

    // Each voter casts only 1 of their 3 available votes.
    await vote(adminToken, lineupId, games[0].id);
    await vote(invitee.token, lineupId, games[0].id);

    // Quorum NOT met — voters still have 2 unused votes each.
    expect(await readStatus(lineupId)).toBe('voting');
  });

  // -- AC: building → voting auto-advance for a public lineup ---------------

  it('auto-advances a public lineup from building → voting once each voter hits their per-voter minimum', async () => {
    // Default per-voter min nominations = 3, default total floor = 4.
    // With 2 nominators × 3 noms = 6 noms total → both gates pass.
    const m1 = await createMember('pub-nom-1');
    const m2 = await createMember('pub-nom-2');

    const createRes = await createPublicLineup(adminToken);
    expect(createRes.status).toBe(201);
    const lineupId = createRes.body.id as number;
    expect(await readStatus(lineupId)).toBe('building');

    const games = await createGames(6);

    // m1 nominates 2 of 3 → below per-voter min, no advance.
    await nominate(m1.token, lineupId, games[0].id);
    await nominate(m1.token, lineupId, games[1].id);
    expect(await readStatus(lineupId)).toBe('building');

    // m1 hits 3, but m2 has 0 → still below.
    await nominate(m1.token, lineupId, games[2].id);
    expect(await readStatus(lineupId)).toBe('building');

    // m2 hits 2 of 3 → still below per-voter min.
    await nominate(m2.token, lineupId, games[3].id);
    await nominate(m2.token, lineupId, games[4].id);
    expect(await readStatus(lineupId)).toBe('building');

    // m2's 3rd nomination closes the quorum — total = 6, both at min 3.
    await nominate(m2.token, lineupId, games[5].id);
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
