/**
 * Community Lineup Matches Integration Tests (ROK-937)
 *
 * Verifies the decided-view match endpoints against a real PostgreSQL
 * database: tiered match grouping, bandwagon join, operator advance,
 * and auto-carryover on lineup creation.
 *
 * Endpoints under test (none exist yet — all tests should fail):
 *   GET  /lineups/:id/matches
 *   POST /lineups/:id/matches/:matchId/join
 *   POST /lineups/:id/matches/:matchId/advance
 *   POST /lineups (auto-carryover on creation)
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

// ── Shared state ──────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────

async function loginAsOperator(): Promise<string> {
  const bcrypt = await import('bcrypt');
  const hash = await bcrypt.hash('OperatorPass1!', 4);
  const [user] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: 'local:operator@test.local',
      username: 'operator',
      role: 'operator',
    })
    .returning();
  await testApp.db.insert(schema.localCredentials).values({
    email: 'operator@test.local',
    passwordHash: hash,
    userId: user.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email: 'operator@test.local', password: 'OperatorPass1!' });
  return res.body.access_token as string;
}

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

/** Create lineup, add entries, cast votes, and advance to decided. */
async function buildDecidedLineup(opts: {
  token: string;
  games: { id: number }[];
  voters: { userId: number; gameIds: number[] }[];
  matchThreshold?: number;
}): Promise<number> {
  // Create lineup
  const createRes = await testApp.request
    .post('/lineups')
    .set('Authorization', `Bearer ${opts.token}`)
    .send({ matchThreshold: opts.matchThreshold ?? 35 });
  const lineupId = createRes.body.id as number;

  // Add entries for each game
  for (const game of opts.games) {
    await testApp.db.insert(schema.communityLineupEntries).values({
      lineupId,
      gameId: game.id,
      nominatedBy: testApp.seed.adminUser.id,
    });
  }

  // Advance to voting
  await testApp.request
    .patch(`/lineups/${lineupId}/status`)
    .set('Authorization', `Bearer ${opts.token}`)
    .send({ status: 'voting' });

  // Cast votes
  for (const voter of opts.voters) {
    for (const gameId of voter.gameIds) {
      await testApp.db.insert(schema.communityLineupVotes).values({
        lineupId,
        userId: voter.userId,
        gameId,
      });
    }
  }

  // Advance to scheduling then decided
  await testApp.request
    .patch(`/lineups/${lineupId}/status`)
    .set('Authorization', `Bearer ${opts.token}`)
    .send({ status: 'scheduling' });
  await testApp.request
    .patch(`/lineups/${lineupId}/status`)
    .set('Authorization', `Bearer ${opts.token}`)
    .send({ status: 'decided' });

  return lineupId;
}

// ── GET /lineups/:id/matches ──────────────────────────────────

function describeGETMatches() {
  it('returns grouped response with all four tier arrays', async () => {
    const game1 = await createGame('Game High', 'game-high');
    const game2 = await createGame('Game Mid', 'game-mid');
    const game3 = await createGame('Game Low', 'game-low');

    // Create 10 voters; every voter must cast at least one vote so
    // countDistinctVoters = 10 (the denominator for votePercentage).
    const game4 = await createGame('Filler Game', 'filler-game');
    const voters: { userId: number; gameIds: number[] }[] = [];
    for (let i = 0; i < 10; i++) {
      const m = await loginAsMember(`voter-${i}`);
      voters.push({ userId: m.userId, gameIds: [] });
    }

    // threshold = 35%
    // game1: 5/10 = 50% -> scheduling (thresholdMet=true)
    // game2: 3/10 = 30% -> almostThere (>= 35*0.7 = 24.5%)
    // game3: 1/10 = 10% -> rallyYourCrew (< 24.5%)
    for (let i = 0; i < 5; i++) voters[i].gameIds.push(game1.id);
    for (let i = 0; i < 3; i++) voters[i].gameIds.push(game2.id);
    voters[0].gameIds.push(game3.id);
    // Voters 5-9 need at least one vote; give them game4
    for (let i = 5; i < 10; i++) voters[i].gameIds.push(game4.id);

    const lineupId = await buildDecidedLineup({
      token: adminToken,
      games: [game1, game2, game3, game4],
      voters,
      matchThreshold: 35,
    });

    const res = await testApp.request
      .get(`/lineups/${lineupId}/matches`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('scheduling');
    expect(res.body).toHaveProperty('almostThere');
    expect(res.body).toHaveProperty('rallyYourCrew');
    expect(res.body).toHaveProperty('carriedForward');
    expect(res.body).toHaveProperty('matchThreshold');
    expect(res.body).toHaveProperty('totalVoters');
  });

  it('places thresholdMet=true matches in scheduling tier', async () => {
    const game1 = await createGame('Popular Game', 'popular-game');
    const voters: { userId: number; gameIds: number[] }[] = [];
    for (let i = 0; i < 5; i++) {
      const m = await loginAsMember(`pop-voter-${i}`);
      // All 5 vote for game1 -> 100% >= 35% -> scheduling
      voters.push({ userId: m.userId, gameIds: [game1.id] });
    }

    const lineupId = await buildDecidedLineup({
      token: adminToken,
      games: [game1],
      voters,
      matchThreshold: 35,
    });

    const res = await testApp.request
      .get(`/lineups/${lineupId}/matches`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.scheduling).toHaveLength(1);
    expect(res.body.scheduling[0].gameId).toBe(game1.id);
  });

  it('places almostThere matches (>= threshold*0.7)', async () => {
    const gameAlmost = await createGame('Almost Game', 'almost-game');
    const gameAbove = await createGame('Above Game', 'above-game');
    const voters: { userId: number; gameIds: number[] }[] = [];

    // 10 voters, threshold=50 — all must vote so countDistinctVoters = 10
    // gameAlmost: 4/10 = 40% — almostThere (>= 50*0.7=35%)
    // gameAbove: 10/10 = 100% — scheduling (>= 50%)
    for (let i = 0; i < 10; i++) {
      const m = await loginAsMember(`almost-voter-${i}`);
      const gameIds: number[] = [gameAbove.id];
      if (i < 4) gameIds.push(gameAlmost.id);
      voters.push({ userId: m.userId, gameIds });
    }

    const lineupId = await buildDecidedLineup({
      token: adminToken,
      games: [gameAlmost, gameAbove],
      voters,
      matchThreshold: 50,
    });

    const res = await testApp.request
      .get(`/lineups/${lineupId}/matches`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.almostThere).toHaveLength(1);
    expect(res.body.almostThere[0].gameId).toBe(gameAlmost.id);
  });

  it('places rallyYourCrew matches (< threshold*0.7)', async () => {
    const gameRally = await createGame('Rally Game', 'rally-game');
    const gameAbove = await createGame('Above2 Game', 'above2-game');
    const voters: { userId: number; gameIds: number[] }[] = [];

    // 10 voters, threshold=50 — all must vote so countDistinctVoters = 10
    // gameRally: 2/10 = 20% — rallyYourCrew (< 50*0.7=35%)
    // gameAbove: 10/10 = 100% — scheduling (>= 50%)
    for (let i = 0; i < 10; i++) {
      const m = await loginAsMember(`rally-voter-${i}`);
      const gameIds: number[] = [gameAbove.id];
      if (i < 2) gameIds.push(gameRally.id);
      voters.push({ userId: m.userId, gameIds });
    }

    const lineupId = await buildDecidedLineup({
      token: adminToken,
      games: [gameRally, gameAbove],
      voters,
      matchThreshold: 50,
    });

    const res = await testApp.request
      .get(`/lineups/${lineupId}/matches`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.rallyYourCrew).toHaveLength(1);
    expect(res.body.rallyYourCrew[0].gameId).toBe(gameRally.id);
  });

  it('returns 404 when lineup not found', async () => {
    const res = await testApp.request
      .get('/lineups/99999/matches')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
    // Must be a domain-level 404, not a route-not-found 404
    expect(res.body.message).toMatch(/lineup|not found/i);
    expect(res.body.message).not.toMatch(/Cannot GET/i);
  });

  it('requires authentication', async () => {
    const res = await testApp.request.get('/lineups/1/matches');
    expect(res.status).toBe(401);
  });
}
describe('GET /lineups/:id/matches', describeGETMatches);

// ── POST /lineups/:id/matches/:matchId/join ──────────────────

function describeJoin() {
  it('creates match_member with source=bandwagon', async () => {
    const game1 = await createGame('Join Game', 'join-game');
    const voters: { userId: number; gameIds: number[] }[] = [];
    for (let i = 0; i < 5; i++) {
      const m = await loginAsMember(`join-voter-${i}`);
      voters.push({ userId: m.userId, gameIds: [game1.id] });
    }

    const lineupId = await buildDecidedLineup({
      token: adminToken,
      games: [game1],
      voters,
      matchThreshold: 35,
    });

    // Get the match ID
    const matches = await testApp.db
      .select()
      .from(schema.communityLineupMatches);
    const matchId = matches[0].id;

    // New member joins via bandwagon
    const newMember = await loginAsMember('bandwagon-joiner');
    const res = await testApp.request
      .post(`/lineups/${lineupId}/matches/${matchId}/join`)
      .set('Authorization', `Bearer ${newMember.token}`);

    expect(res.status).toBe(200);

    // Verify the member row was created with source=bandwagon
    const members = await testApp.db
      .select()
      .from(schema.communityLineupMatchMembers);
    const bandwagonMember = members.find((m) => m.userId === newMember.userId);
    expect(bandwagonMember).toBeDefined();
    expect(bandwagonMember!.source).toBe('bandwagon');
  });

  it('auto-promotes match when bandwagon reaches threshold', async () => {
    const game1 = await createGame('Promote Game', 'promote-game');
    const game2 = await createGame('Filler Game', 'filler-game');
    const voters: { userId: number; gameIds: number[] }[] = [];

    // 10 voters, threshold=50
    // game1: 4/10 = 40% -> suggested (below 50%)
    // game2: 10/10 = 100% -> scheduling (above 50%)
    // All voters must vote for at least one game so countDistinctVoters = 10
    for (let i = 0; i < 10; i++) {
      const m = await loginAsMember(`promote-voter-${i}`);
      const gameIds: number[] = [game2.id];
      if (i < 4) gameIds.push(game1.id);
      voters.push({ userId: m.userId, gameIds });
    }

    const lineupId = await buildDecidedLineup({
      token: adminToken,
      games: [game1, game2],
      voters,
      matchThreshold: 50,
    });

    // Find the suggested match for game1
    const matches = await testApp.db
      .select()
      .from(schema.communityLineupMatches);
    const suggestedMatch = matches.find(
      (m) => m.gameId === game1.id && m.status === 'suggested',
    );

    // Guard: ensure the matching algorithm created the suggested match.
    // If this fails, the matching algorithm needs fixing before this test
    // can exercise the bandwagon promotion path.
    if (!suggestedMatch) {
      // Force a failing assertion against the join endpoint
      const newMember = await loginAsMember('promote-joiner');
      const fallbackRes = await testApp.request
        .post(`/lineups/${lineupId}/matches/1/join`)
        .set('Authorization', `Bearer ${newMember.token}`);
      // This will fail with 404 since the endpoint doesn't exist
      expect(fallbackRes.status).toBe(200);
      return;
    }

    // Bandwagon join — need 1 more to reach 5/10 = 50%
    const newMember = await loginAsMember('promote-joiner');
    const res = await testApp.request
      .post(`/lineups/${lineupId}/matches/${suggestedMatch.id}/join`)
      .set('Authorization', `Bearer ${newMember.token}`);

    expect(res.status).toBe(200);

    // Verify the match was promoted to scheduling
    const promotedMatch = (
      await testApp.db.select().from(schema.communityLineupMatches)
    ).find((m) => m.id === suggestedMatch.id);
    expect(promotedMatch!.status).toBe('scheduling');
    expect(promotedMatch!.thresholdMet).toBe(true);
  });

  it('returns 409 when user is already a member', async () => {
    const game1 = await createGame('Dup Game', 'dup-game');
    const member = await loginAsMember('dup-member');
    const voters = [{ userId: member.userId, gameIds: [game1.id] }];

    const lineupId = await buildDecidedLineup({
      token: adminToken,
      games: [game1],
      voters,
      matchThreshold: 35,
    });

    const matches = await testApp.db
      .select()
      .from(schema.communityLineupMatches);
    const matchId = matches[0].id;

    // member already voted, so they're already a member
    const res = await testApp.request
      .post(`/lineups/${lineupId}/matches/${matchId}/join`)
      .set('Authorization', `Bearer ${member.token}`);

    expect(res.status).toBe(409);
  });

  it('returns 400 if lineup not in decided status', async () => {
    // Create a lineup in building status
    const createRes = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    const lineupId = createRes.body.id as number;

    const member = await loginAsMember('early-joiner');
    const res = await testApp.request
      .post(`/lineups/${lineupId}/matches/1/join`)
      .set('Authorization', `Bearer ${member.token}`);

    expect(res.status).toBe(400);
  });

  it('returns 404 when match not found', async () => {
    const game1 = await createGame('404 Game', '404-game');
    const voters: { userId: number; gameIds: number[] }[] = [];
    for (let i = 0; i < 3; i++) {
      const m = await loginAsMember(`404-voter-${i}`);
      voters.push({ userId: m.userId, gameIds: [game1.id] });
    }

    const lineupId = await buildDecidedLineup({
      token: adminToken,
      games: [game1],
      voters,
    });

    const member = await loginAsMember('lost-joiner');
    const res = await testApp.request
      .post(`/lineups/${lineupId}/matches/99999/join`)
      .set('Authorization', `Bearer ${member.token}`);

    expect(res.status).toBe(404);
    // Must be a domain-level 404, not a route-not-found 404
    expect(res.body.message).toMatch(/match|not found/i);
    expect(res.body.message).not.toMatch(/Cannot POST/i);
  });
}
describe('POST /lineups/:id/matches/:matchId/join', describeJoin);

// ── POST /lineups/:id/matches/:matchId/advance ───────────────

function describeAdvance() {
  it('changes suggested match to scheduling (operator)', async () => {
    const opToken = await loginAsOperator();
    const game1 = await createGame('Advance Game', 'advance-game');
    const game2 = await createGame('Filler2 Game', 'filler2-game');
    const voters: { userId: number; gameIds: number[] }[] = [];

    // 10 voters, threshold=80 — all must vote so countDistinctVoters = 10
    // game1: 5/10 = 50% -> suggested (below 80%)
    // game2: 10/10 = 100% -> scheduling (above 80%)
    for (let i = 0; i < 10; i++) {
      const m = await loginAsMember(`adv-voter-${i}`);
      const gameIds: number[] = [game2.id];
      if (i < 5) gameIds.push(game1.id);
      voters.push({ userId: m.userId, gameIds });
    }

    const lineupId = await buildDecidedLineup({
      token: opToken,
      games: [game1, game2],
      voters,
      matchThreshold: 80,
    });

    const matches = await testApp.db
      .select()
      .from(schema.communityLineupMatches);
    const suggestedMatch = matches.find(
      (m) => m.gameId === game1.id && m.status === 'suggested',
    );
    expect(suggestedMatch).toBeDefined();

    const res = await testApp.request
      .post(`/lineups/${lineupId}/matches/${suggestedMatch!.id}/advance`)
      .set('Authorization', `Bearer ${opToken}`);

    expect(res.status).toBe(200);

    // Verify match was updated
    const advancedMatch = (
      await testApp.db.select().from(schema.communityLineupMatches)
    ).find((m) => m.id === suggestedMatch!.id);
    expect(advancedMatch!.status).toBe('scheduling');
    expect(advancedMatch!.thresholdMet).toBe(true);
  });

  it('returns 403 for non-operator', async () => {
    const game1 = await createGame('Forbid Game', 'forbid-game');
    const voters: { userId: number; gameIds: number[] }[] = [];
    for (let i = 0; i < 3; i++) {
      const m = await loginAsMember(`forbid-voter-${i}`);
      voters.push({ userId: m.userId, gameIds: [game1.id] });
    }

    const lineupId = await buildDecidedLineup({
      token: adminToken,
      games: [game1],
      voters,
    });

    const matches = await testApp.db
      .select()
      .from(schema.communityLineupMatches);
    const matchId = matches[0].id;

    const member = await loginAsMember('non-op');
    const res = await testApp.request
      .post(`/lineups/${lineupId}/matches/${matchId}/advance`)
      .set('Authorization', `Bearer ${member.token}`);

    expect(res.status).toBe(403);
  });

  it('returns 400 if match not in suggested status', async () => {
    const opToken = await loginAsOperator();
    const game1 = await createGame('Already Game', 'already-game');
    const voters: { userId: number; gameIds: number[] }[] = [];
    // All voters vote for game1 -> scheduling (above threshold)
    for (let i = 0; i < 5; i++) {
      const m = await loginAsMember(`already-voter-${i}`);
      voters.push({ userId: m.userId, gameIds: [game1.id] });
    }

    const lineupId = await buildDecidedLineup({
      token: opToken,
      games: [game1],
      voters,
      matchThreshold: 35,
    });

    const matches = await testApp.db
      .select()
      .from(schema.communityLineupMatches);
    // game1 should already be 'scheduling'
    const schedulingMatch = matches.find(
      (m) => m.gameId === game1.id && m.status === 'scheduling',
    );
    expect(schedulingMatch).toBeDefined();

    const res = await testApp.request
      .post(`/lineups/${lineupId}/matches/${schedulingMatch!.id}/advance`)
      .set('Authorization', `Bearer ${opToken}`);

    expect(res.status).toBe(400);
  });

  it('returns 404 if match not found', async () => {
    const opToken = await loginAsOperator();
    const game1 = await createGame('Missing Game', 'missing-game');
    const voters: { userId: number; gameIds: number[] }[] = [];
    for (let i = 0; i < 3; i++) {
      const m = await loginAsMember(`miss-voter-${i}`);
      voters.push({ userId: m.userId, gameIds: [game1.id] });
    }

    const lineupId = await buildDecidedLineup({
      token: opToken,
      games: [game1],
      voters,
    });

    const res = await testApp.request
      .post(`/lineups/${lineupId}/matches/99999/advance`)
      .set('Authorization', `Bearer ${opToken}`);

    expect(res.status).toBe(404);
    // Must be a domain-level 404, not a route-not-found 404
    expect(res.body.message).toMatch(/match|not found/i);
    expect(res.body.message).not.toMatch(/Cannot POST/i);
  });
}
describe('POST /lineups/:id/matches/:matchId/advance', describeAdvance);

// ── Auto-Carryover on Lineup Creation ────────────────────────

function describeCarryover() {
  it('copies entries from previous decided lineup suggested matches', async () => {
    const game1 = await createGame('Carry Game', 'carry-game');
    const game2 = await createGame('Strong Game', 'strong-game');
    const voters: { userId: number; gameIds: number[] }[] = [];

    // 10 voters, threshold=50 — all must vote so countDistinctVoters = 10
    // game1: 3/10 = 30% -> suggested (below 50%)
    // game2: 10/10 = 100% -> scheduling (above 50%)
    for (let i = 0; i < 10; i++) {
      const m = await loginAsMember(`carry-voter-${i}`);
      const gameIds: number[] = [game2.id];
      if (i < 3) gameIds.push(game1.id);
      voters.push({ userId: m.userId, gameIds });
    }

    const oldLineupId = await buildDecidedLineup({
      token: adminToken,
      games: [game1, game2],
      voters,
      matchThreshold: 50,
    });

    // Archive the old lineup so a new one can be created
    await testApp.request
      .patch(`/lineups/${oldLineupId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'archived' });

    // Create a new lineup — should auto-carry entries from suggested matches
    const newRes = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(newRes.status).toBe(201);
    const newLineupId = newRes.body.id as number;

    // Check that the new lineup has a carried-over entry for game1
    const entries = await testApp.db
      .select()
      .from(schema.communityLineupEntries);
    const carriedEntries = entries.filter(
      (e) => e.lineupId === newLineupId && e.carriedOverFrom !== null,
    );

    expect(carriedEntries).toHaveLength(1);
    expect(carriedEntries[0].gameId).toBe(game1.id);
    expect(carriedEntries[0].carriedOverFrom).toBe(oldLineupId);
  });
}
describe('Auto-Carryover on Lineup Creation', describeCarryover);
