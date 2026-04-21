/**
 * Community Lineup Voting Integration Tests (ROK-936)
 *
 * TDD gate: these tests define the expected behavior for the voting feature.
 * They MUST fail until the dev agent implements the feature.
 *
 * Covers:
 * - POST /lineups/:id/vote — toggle, limit, status guard
 * - GET /lineups/:id — myVotes array and matchThreshold
 * - Matching algorithm on voting -> decided transition
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import { sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

function describeVoting() {
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
    const email = `${tag}@test.local`.toLowerCase();
    await testApp.db.insert(schema.localCredentials).values({
      email,
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email, password: 'MemberPass1!' });
    return { token: res.body.access_token as string, userId: user.id };
  }

  async function createLineup(token: string, extra = {}) {
    return testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Voting Test', ...extra });
  }

  async function addEntry(lineupId: number, gameId: number, userId: number) {
    await testApp.db.insert(schema.communityLineupEntries).values({
      lineupId,
      gameId,
      nominatedBy: userId,
    });
  }

  async function advanceToVoting(lineupId: number, token: string) {
    await testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'voting' });
  }

  async function createAdditionalGames(count: number) {
    const games: (typeof schema.games.$inferSelect)[] = [];
    for (let i = 0; i < count; i++) {
      const [game] = await testApp.db
        .insert(schema.games)
        .values({
          name: `Game ${i + 1}`,
          slug: `game-${i + 1}-${Date.now()}`,
        })
        .returning();
      games.push(game);
    }
    return games;
  }

  /** Build a lineup in voting status with nominated games. */
  async function setupVotingLineup(gameCount = 4) {
    const createRes = await createLineup(adminToken);
    const lineupId = createRes.body.id as number;
    const extraGames = await createAdditionalGames(gameCount);
    const allGames = [testApp.seed.game, ...extraGames];
    for (const game of allGames) {
      await addEntry(lineupId, game.id, testApp.seed.adminUser.id);
    }
    await advanceToVoting(lineupId, adminToken);
    return { lineupId, games: allGames };
  }

  /** Advance a lineup from voting → decided (single-step transition). */
  async function advanceToDecided(lineupId: number, token: string) {
    await testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'decided' });
  }

  // -- POST /lineups/:id/vote — toggle behavior -----------------------------

  function describeVoteToggle() {
    it('should add a vote and return updated lineup with incremented voteCount', async () => {
      const { lineupId, games } = await setupVotingLineup();
      const { token } = await loginAsMember();

      const res = await testApp.request
        .post(`/lineups/${lineupId}/vote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ gameId: games[0].id });

      expect(res.status).toBe(200);
      const body = res.body as {
        entries: { gameId: number; voteCount: number }[];
      };
      const entry = body.entries.find((e) => e.gameId === games[0].id);
      expect(entry!.voteCount).toBe(1);
    });

    it('should remove the vote when voting for the same game twice (toggle)', async () => {
      const { lineupId, games } = await setupVotingLineup();
      const { token } = await loginAsMember();

      // Vote once
      await testApp.request
        .post(`/lineups/${lineupId}/vote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ gameId: games[0].id });

      // Vote again (toggle off)
      const res = await testApp.request
        .post(`/lineups/${lineupId}/vote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ gameId: games[0].id });

      expect(res.status).toBe(200);
      const body = res.body as {
        entries: { gameId: number; voteCount: number }[];
      };
      const entry = body.entries.find((e) => e.gameId === games[0].id);
      expect(entry!.voteCount).toBe(0);
    });

    it('should allow voting for up to 3 different games', async () => {
      const { lineupId, games } = await setupVotingLineup();
      const { token } = await loginAsMember();

      // Vote for 3 games
      for (let i = 0; i < 3; i++) {
        const res = await testApp.request
          .post(`/lineups/${lineupId}/vote`)
          .set('Authorization', `Bearer ${token}`)
          .send({ gameId: games[i].id });
        expect(res.status).toBe(200);
      }
    });
  }
  describe('POST /lineups/:id/vote — toggle', describeVoteToggle);

  // -- POST /lineups/:id/vote — limit enforcement ---------------------------

  function describeVoteLimit() {
    it('should return 400 when user already has 3 votes and tries a 4th', async () => {
      const { lineupId, games } = await setupVotingLineup();
      const { token } = await loginAsMember();

      // Cast 3 votes
      for (let i = 0; i < 3; i++) {
        await testApp.request
          .post(`/lineups/${lineupId}/vote`)
          .set('Authorization', `Bearer ${token}`)
          .send({ gameId: games[i].id });
      }

      // Attempt a 4th vote
      const res = await testApp.request
        .post(`/lineups/${lineupId}/vote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ gameId: games[3].id });

      expect(res.status).toBe(400);
    });

    it('should allow voting again after toggling off one of 3 votes', async () => {
      const { lineupId, games } = await setupVotingLineup();
      const { token } = await loginAsMember();

      // Cast 3 votes
      for (let i = 0; i < 3; i++) {
        await testApp.request
          .post(`/lineups/${lineupId}/vote`)
          .set('Authorization', `Bearer ${token}`)
          .send({ gameId: games[i].id });
      }

      // Toggle off the first vote
      await testApp.request
        .post(`/lineups/${lineupId}/vote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ gameId: games[0].id });

      // Now a 4th game should be allowed (only 2 votes remain)
      const res = await testApp.request
        .post(`/lineups/${lineupId}/vote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ gameId: games[3].id });

      expect(res.status).toBe(200);
    });
  }
  describe('POST /lineups/:id/vote — limit', describeVoteLimit);

  // -- POST /lineups/:id/vote — status guard --------------------------------

  function describeVoteStatusGuard() {
    it('should return 400 when lineup status is building', async () => {
      const createRes = await createLineup(adminToken);
      const lineupId = createRes.body.id as number;
      const gameId = testApp.seed.game.id;
      const userId = testApp.seed.adminUser.id;
      await addEntry(lineupId, gameId, userId);
      const { token } = await loginAsMember();

      const res = await testApp.request
        .post(`/lineups/${lineupId}/vote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ gameId: testApp.seed.game.id });

      expect(res.status).toBe(400);
    });

    it('should return 400 when lineup status is decided', async () => {
      const { lineupId, games } = await setupVotingLineup();
      const { token } = await loginAsMember();

      // Advance to decided (voting → scheduling → decided)
      await advanceToDecided(lineupId, adminToken);

      const res = await testApp.request
        .post(`/lineups/${lineupId}/vote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ gameId: games[0].id });

      expect(res.status).toBe(400);
    });

    it('should require authentication', async () => {
      const { lineupId, games } = await setupVotingLineup();

      const res = await testApp.request
        .post(`/lineups/${lineupId}/vote`)
        .send({ gameId: games[0].id });

      expect(res.status).toBe(401);
    });
  }
  describe('POST /lineups/:id/vote — status guard', describeVoteStatusGuard);

  // -- GET /lineups/:id — myVotes array -------------------------------------

  function describeMyVotes() {
    it('should include myVotes array with voted gameIds for authenticated user', async () => {
      const { lineupId, games } = await setupVotingLineup();
      const { token } = await loginAsMember();

      // Cast 2 votes
      await testApp.request
        .post(`/lineups/${lineupId}/vote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ gameId: games[0].id });
      await testApp.request
        .post(`/lineups/${lineupId}/vote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ gameId: games[2].id });

      // Fetch lineup detail as the same member
      const res = await testApp.request
        .get(`/lineups/${lineupId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.myVotes).toBeDefined();
      expect(res.body.myVotes).toHaveLength(2);
      expect(res.body.myVotes).toContain(games[0].id);
      expect(res.body.myVotes).toContain(games[2].id);
    });

    it('should return empty myVotes when user has not voted', async () => {
      const { lineupId } = await setupVotingLineup();
      const { token } = await loginAsMember();

      const res = await testApp.request
        .get(`/lineups/${lineupId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.myVotes).toBeDefined();
      expect(res.body.myVotes).toHaveLength(0);
    });

    it('GET /lineups/active returns summary rows (no myVotes, ROK-1065)', async () => {
      // ROK-1065: /lineups/active now returns an array of summaries; myVotes
      // is a detail-only field. This test keeps the vote pre-condition but
      // asserts on the summary shape to prevent a regression to the old
      // single-detail response.
      const { lineupId, games } = await setupVotingLineup();
      const { token } = await loginAsMember();

      await testApp.request
        .post(`/lineups/${lineupId}/vote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ gameId: games[1].id });

      const res = await testApp.request
        .get('/lineups/active')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const summaries = res.body as { id: number }[];
      const summary = summaries.find((r) => r.id === lineupId);
      expect(summary).toBeDefined();
      expect(summary.myVotes).toBeUndefined();
      expect(summary).toMatchObject({
        id: lineupId,
        status: expect.any(String),
        visibility: expect.any(String),
        entryCount: expect.any(Number),
        totalVoters: expect.any(Number),
      });
    });
  }
  describe('GET /lineups/:id — myVotes', describeMyVotes);

  // -- GET /lineups/:id — response includes both myVotes and matchThreshold --

  function describeResponseShape() {
    it('should include both myVotes array and matchThreshold in response', async () => {
      const { lineupId, games } = await setupVotingLineup();
      const { token } = await loginAsMember('shapeCheck');

      // Cast a vote so myVotes is non-empty
      await testApp.request
        .post(`/lineups/${lineupId}/vote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ gameId: games[0].id });

      const res = await testApp.request
        .get(`/lineups/${lineupId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      // myVotes is the new field that does not exist yet
      expect(res.body).toHaveProperty('myVotes');
      expect(Array.isArray(res.body.myVotes)).toBe(true);
      expect(res.body.myVotes).toContain(games[0].id);
      // matchThreshold should also be present
      expect(res.body).toHaveProperty('matchThreshold');
      expect(typeof res.body.matchThreshold).toBe('number');
    });

    it('should include myVotes as empty array when user has not voted', async () => {
      const { lineupId } = await setupVotingLineup();
      const { token } = await loginAsMember('noVotes');

      const res = await testApp.request
        .get(`/lineups/${lineupId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.myVotes).toBeDefined();
      expect(res.body.myVotes).toEqual([]);
    });
  }
  describe('GET /lineups/:id — response shape', describeResponseShape);

  // -- Matching algorithm on voting -> decided transition --------------------
  // NOTE: The community_lineup_matches and community_lineup_match_members
  // tables do not exist in schema yet (ROK-936 migration pending).
  // We use raw SQL to query these tables. The queries will fail until the
  // migration and matching algorithm are implemented.

  interface MatchRow extends Record<string, unknown> {
    id: number;
    lineup_id: number;
    game_id: number;
    status: string;
    vote_count: number;
    vote_percentage: string;
    fit_type: string;
  }
  interface MatchMemberRow extends Record<string, unknown> {
    id: number;
    match_id: number;
    user_id: number;
    source: string;
  }

  async function queryMatches(lid: number): Promise<MatchRow[]> {
    return testApp.db.execute<MatchRow>(
      sql`SELECT * FROM community_lineup_matches WHERE lineup_id = ${lid}`,
    );
  }

  async function queryMatchMembers(matchId: number): Promise<MatchMemberRow[]> {
    return testApp.db.execute<MatchMemberRow>(
      sql`SELECT * FROM community_lineup_match_members WHERE match_id = ${matchId}`,
    );
  }

  function describeMatchingAlgorithm() {
    it('should create community_lineup_matches rows on decided transition', async () => {
      const { lineupId, games } = await setupVotingLineup(3);
      const { token: m1 } = await loginAsMember('voter1');
      const { token: m2 } = await loginAsMember('voter2');

      // Both members vote for game 0
      await testApp.request
        .post(`/lineups/${lineupId}/vote`)
        .set('Authorization', `Bearer ${m1}`)
        .send({ gameId: games[0].id });
      await testApp.request
        .post(`/lineups/${lineupId}/vote`)
        .set('Authorization', `Bearer ${m2}`)
        .send({ gameId: games[0].id });

      // Transition to decided (voting → scheduling → decided)
      await advanceToDecided(lineupId, adminToken);

      const matches = await queryMatches(lineupId);
      expect(matches.length).toBeGreaterThan(0);

      const topMatch = matches.find((m) => m.game_id === games[0].id);
      expect(topMatch).toBeDefined();
      expect(topMatch!.vote_count).toBe(2);
    });

    it('should set status "scheduling" for above-threshold matches', async () => {
      const createRes = await createLineup(adminToken, {
        matchThreshold: 10,
      });
      expect(createRes.status).toBe(201);
      const lid = createRes.body.id as number;
      const extraGames = await createAdditionalGames(2);
      const allGames = [testApp.seed.game, ...extraGames];
      for (const g of allGames) {
        await addEntry(lid, g.id, testApp.seed.adminUser.id);
      }
      await advanceToVoting(lid, adminToken);

      const { token: v1 } = await loginAsMember('aboveVoter1');
      const { token: v2 } = await loginAsMember('aboveVoter2');

      // 2/2 = 100% > 10% threshold
      await testApp.request
        .post(`/lineups/${lid}/vote`)
        .set('Authorization', `Bearer ${v1}`)
        .send({ gameId: testApp.seed.game.id });
      await testApp.request
        .post(`/lineups/${lid}/vote`)
        .set('Authorization', `Bearer ${v2}`)
        .send({ gameId: testApp.seed.game.id });
      await advanceToDecided(lid, adminToken);

      const matches = await queryMatches(lid);
      const above = matches.find((m) => m.game_id === testApp.seed.game.id);
      expect(above).toBeDefined();
      expect(above!.status).toBe('scheduling');
    });

    it('should set status "suggested" for below-threshold matches', async () => {
      const createRes = await createLineup(adminToken, {
        matchThreshold: 75,
      });
      const lid = createRes.body.id as number;
      const extraGames = await createAdditionalGames(3);
      const allGames = [testApp.seed.game, ...extraGames];
      for (const g of allGames) {
        await addEntry(lid, g.id, testApp.seed.adminUser.id);
      }
      await advanceToVoting(lid, adminToken);

      // 4 voters, each votes for a different game (25% < 75%)
      const voters: string[] = [];
      for (let i = 0; i < 4; i++) {
        const { token } = await loginAsMember(`belowVoter${i}`);
        voters.push(token);
      }
      for (let i = 0; i < 4; i++) {
        await testApp.request
          .post(`/lineups/${lid}/vote`)
          .set('Authorization', `Bearer ${voters[i]}`)
          .send({ gameId: allGames[i].id });
      }

      await advanceToDecided(lid, adminToken);

      const matches = await queryMatches(lid);
      for (const match of matches) {
        expect(match.status).toBe('suggested');
      }
    });

    it('should categorize fit based on game maxPlayers vs voter count', async () => {
      const [smallGame] = await testApp.db
        .insert(schema.games)
        .values({
          name: 'Small Game',
          slug: `small-game-${Date.now()}`,
          playerCount: { min: 1, max: 2 },
        })
        .returning();

      const createRes = await createLineup(adminToken, {
        matchThreshold: 10,
      });
      const lid = createRes.body.id as number;
      await addEntry(lid, smallGame.id, testApp.seed.adminUser.id);
      await advanceToVoting(lid, adminToken);

      // 4 voters for a 2-max game -> oversubscribed
      const voterTokens: string[] = [];
      for (let i = 0; i < 4; i++) {
        const { token } = await loginAsMember(`fitVoter${i}`);
        voterTokens.push(token);
      }
      for (const tk of voterTokens) {
        await testApp.request
          .post(`/lineups/${lid}/vote`)
          .set('Authorization', `Bearer ${tk}`)
          .send({ gameId: smallGame.id });
      }

      await advanceToDecided(lid, adminToken);

      const matches = await queryMatches(lid);
      const sm = matches.find((m) => m.game_id === smallGame.id);
      expect(sm).toBeDefined();
      expect(sm!.fit_type).toBe('oversubscribed');
    });

    it('should create match_members for voters of each matched game', async () => {
      const { lineupId, games } = await setupVotingLineup(2);
      const { token: v1, userId: uid1 } = await loginAsMember('matchMem1');
      const { token: v2, userId: uid2 } = await loginAsMember('matchMem2');

      await testApp.request
        .post(`/lineups/${lineupId}/vote`)
        .set('Authorization', `Bearer ${v1}`)
        .send({ gameId: games[0].id });
      await testApp.request
        .post(`/lineups/${lineupId}/vote`)
        .set('Authorization', `Bearer ${v2}`)
        .send({ gameId: games[0].id });

      await advanceToDecided(lineupId, adminToken);

      const matches = await queryMatches(lineupId);
      const match = matches.find((m) => m.game_id === games[0].id);
      expect(match).toBeDefined();

      const members = await queryMatchMembers(match!.id);
      expect(members).toHaveLength(2);
      const uids = members.map((m) => m.user_id);
      expect(uids).toContain(uid1);
      expect(uids).toContain(uid2);
    });

    it('should handle zero voters gracefully (no matches)', async () => {
      const { lineupId } = await setupVotingLineup(2);

      await advanceToDecided(lineupId, adminToken);

      const matches = await queryMatches(lineupId);
      expect(matches).toHaveLength(0);
    });
  }
  describe('Matching algorithm (voting -> decided)', describeMatchingAlgorithm);

  // -- POST /lineups — votesPerPlayer creation (ROK-976) --------------------

  function describeVotesPerPlayerCreation() {
    it('should persist votesPerPlayer when creating a lineup with votesPerPlayer: 5', async () => {
      const res = await createLineup(adminToken, { votesPerPlayer: 5 });
      expect(res.status).toBe(201);

      const lineupId = res.body.id as number;
      const detail = await testApp.request
        .get(`/lineups/${lineupId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(detail.status).toBe(200);
      expect(detail.body.maxVotesPerPlayer).toBe(5);
    });

    it('should default maxVotesPerPlayer to 3 when votesPerPlayer is omitted', async () => {
      const res = await createLineup(adminToken);
      expect(res.status).toBe(201);

      const lineupId = res.body.id as number;
      const detail = await testApp.request
        .get(`/lineups/${lineupId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(detail.status).toBe(200);
      expect(detail.body.maxVotesPerPlayer).toBe(3);
    });

    it('should include maxVotesPerPlayer in GET /lineups/:id response', async () => {
      const res = await createLineup(adminToken, { votesPerPlayer: 8 });
      expect(res.status).toBe(201);

      const lineupId = res.body.id as number;
      const detail = await testApp.request
        .get(`/lineups/${lineupId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(detail.status).toBe(200);
      expect(detail.body).toHaveProperty('maxVotesPerPlayer');
      expect(detail.body.maxVotesPerPlayer).toBe(8);
    });
  }
  describe(
    'POST /lineups — votesPerPlayer creation (ROK-976)',
    describeVotesPerPlayerCreation,
  );

  // -- POST /lineups/:id/vote — configurable limit (ROK-976) ---------------

  function describeConfigurableVoteLimit() {
    it('should allow up to 5 votes when lineup has votesPerPlayer: 5', async () => {
      const createRes = await createLineup(adminToken, { votesPerPlayer: 5 });
      expect(createRes.status).toBe(201);
      const lineupId = createRes.body.id as number;

      const extraGames = await createAdditionalGames(6);
      const allGames = [testApp.seed.game, ...extraGames];
      for (const game of allGames) {
        await addEntry(lineupId, game.id, testApp.seed.adminUser.id);
      }
      await advanceToVoting(lineupId, adminToken);

      const { token } = await loginAsMember('voter5limit');

      // Cast 5 votes — all should succeed
      for (let i = 0; i < 5; i++) {
        const voteRes = await testApp.request
          .post(`/lineups/${lineupId}/vote`)
          .set('Authorization', `Bearer ${token}`)
          .send({ gameId: allGames[i].id });
        expect(voteRes.status).toBe(200);
      }
    });

    it('should reject the 6th vote when lineup has votesPerPlayer: 5', async () => {
      const createRes = await createLineup(adminToken, { votesPerPlayer: 5 });
      expect(createRes.status).toBe(201);
      const lineupId = createRes.body.id as number;

      const extraGames = await createAdditionalGames(6);
      const allGames = [testApp.seed.game, ...extraGames];
      for (const game of allGames) {
        await addEntry(lineupId, game.id, testApp.seed.adminUser.id);
      }
      await advanceToVoting(lineupId, adminToken);

      const { token } = await loginAsMember('voter5reject');

      // Cast 5 votes — all must succeed
      for (let i = 0; i < 5; i++) {
        const voteRes = await testApp.request
          .post(`/lineups/${lineupId}/vote`)
          .set('Authorization', `Bearer ${token}`)
          .send({ gameId: allGames[i].id });
        expect(voteRes.status).toBe(200);
      }

      // 6th vote should be rejected with 400
      const res = await testApp.request
        .post(`/lineups/${lineupId}/vote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ gameId: allGames[5].id });

      expect(res.status).toBe(400);
    });

    it('should include dynamic limit number in error message ("Maximum 5 votes per lineup reached")', async () => {
      const createRes = await createLineup(adminToken, { votesPerPlayer: 5 });
      expect(createRes.status).toBe(201);
      const lineupId = createRes.body.id as number;

      const extraGames = await createAdditionalGames(6);
      const allGames = [testApp.seed.game, ...extraGames];
      for (const game of allGames) {
        await addEntry(lineupId, game.id, testApp.seed.adminUser.id);
      }
      await advanceToVoting(lineupId, adminToken);

      const { token } = await loginAsMember('voter5msg');

      // Cast 5 votes — all must succeed
      for (let i = 0; i < 5; i++) {
        const voteRes = await testApp.request
          .post(`/lineups/${lineupId}/vote`)
          .set('Authorization', `Bearer ${token}`)
          .send({ gameId: allGames[i].id });
        expect(voteRes.status).toBe(200);
      }

      // 6th vote should return the dynamic error message
      const res = await testApp.request
        .post(`/lineups/${lineupId}/vote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ gameId: allGames[5].id });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Maximum 5 votes per lineup reached');
    });

    it('should allow only 1 vote when lineup has votesPerPlayer: 1', async () => {
      const createRes = await createLineup(adminToken, { votesPerPlayer: 1 });
      expect(createRes.status).toBe(201);
      const lineupId = createRes.body.id as number;

      const extraGames = await createAdditionalGames(2);
      const allGames = [testApp.seed.game, ...extraGames];
      for (const game of allGames) {
        await addEntry(lineupId, game.id, testApp.seed.adminUser.id);
      }
      await advanceToVoting(lineupId, adminToken);

      const { token } = await loginAsMember('voter1only');

      // First vote should succeed
      const vote1 = await testApp.request
        .post(`/lineups/${lineupId}/vote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ gameId: allGames[0].id });
      expect(vote1.status).toBe(200);

      // Second vote should fail
      const vote2 = await testApp.request
        .post(`/lineups/${lineupId}/vote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ gameId: allGames[1].id });
      expect(vote2.status).toBe(400);
      expect(vote2.body.message).toContain(
        'Maximum 1 votes per lineup reached',
      );
    });

    it('should use the per-lineup limit, not the hardcoded 3', async () => {
      // Create a lineup with votesPerPlayer: 10
      const createRes = await createLineup(adminToken, { votesPerPlayer: 10 });
      expect(createRes.status).toBe(201);
      const lineupId = createRes.body.id as number;

      const extraGames = await createAdditionalGames(4);
      const allGames = [testApp.seed.game, ...extraGames];
      for (const game of allGames) {
        await addEntry(lineupId, game.id, testApp.seed.adminUser.id);
      }
      await advanceToVoting(lineupId, adminToken);

      const { token } = await loginAsMember('voter10');

      // Vote for 4 games — should all succeed (would fail if hardcoded to 3)
      for (let i = 0; i < 4; i++) {
        const voteRes = await testApp.request
          .post(`/lineups/${lineupId}/vote`)
          .set('Authorization', `Bearer ${token}`)
          .send({ gameId: allGames[i].id });
        expect(voteRes.status).toBe(200);
      }
    });
  }
  describe(
    'POST /lineups/:id/vote — configurable limit (ROK-976)',
    describeConfigurableVoteLimit,
  );
}
describe('Lineup Voting (integration)', describeVoting);
