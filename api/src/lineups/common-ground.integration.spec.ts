/**
 * Common Ground Integration Tests (ROK-934)
 *
 * Verifies GET /lineups/common-ground (ownership overlap query) and
 * POST /lineups/:id/nominate (game nomination) against a real PostgreSQL
 * database via HTTP endpoints.
 *
 * These tests are INTENTIONALLY FAILING — written TDD-style before the
 * feature is implemented. The dev agent builds to make them pass.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

function describeCommonGround() {
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

  // ── Helpers ──────────────────────────────────────────────────

  async function loginAsMember(): Promise<{ token: string; userId: number }> {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('MemberPass1!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: 'local:member@test.local',
        username: 'member',
        role: 'member',
      })
      .returning();
    await testApp.db.insert(schema.localCredentials).values({
      email: 'member@test.local',
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email: 'member@test.local', password: 'MemberPass1!' });
    return { token: res.body.access_token as string, userId: user.id };
  }

  /** Create a building lineup via HTTP and return its id. */
  async function createBuildingLineup(): Promise<number> {
    const res = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    if (res.status !== 201) {
      throw new Error(
        `createBuildingLineup failed: ${res.status} ${JSON.stringify(res.body)}`,
      );
    }
    return res.body.id as number;
  }

  /**
   * Insert a game directly in the DB with optional ITAD/pricing metadata.
   * Returns the inserted game row.
   */
  async function insertGame(
    overrides: Partial<typeof schema.games.$inferInsert> = {},
  ): Promise<typeof schema.games.$inferSelect> {
    const slug = overrides.slug ?? `game-${Date.now()}-${Math.random()}`;
    const [game] = await testApp.db
      .insert(schema.games)
      .values({
        name: 'Some Game',
        slug,
        ...overrides,
      })
      .returning();
    return game;
  }

  /**
   * Record a game interest (ownership or wishlist) for a user.
   * source: 'steam_library' | 'steam_wishlist' | 'manual'
   */
  async function addGameInterest(
    userId: number,
    gameId: number,
    source: string,
  ): Promise<void> {
    await testApp.db.insert(schema.gameInterests).values({
      userId,
      gameId,
      source,
    });
  }

  // ── GET /lineups/common-ground ────────────────────────────────

  function describeGetCommonGround() {
    it('returns 401 when not authenticated', async () => {
      const res = await testApp.request.get('/lineups/common-ground');
      expect(res.status).toBe(401);
    });

    it('returns 404 when no lineup exists in building status', async () => {
      const res = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('returns 404 when active lineup is in voting status (not building)', async () => {
      const lineupId = await createBuildingLineup();

      // Transition to voting
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });

      const res = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('returns games with ownerCount and wishlistCount when building lineup exists', async () => {
      await createBuildingLineup();

      const game = await insertGame({
        name: 'Shared Game',
        slug: 'shared-game',
      });
      await addGameInterest(
        testApp.seed.adminUser.id,
        game.id,
        'steam_library',
      );

      // Add a second user who also owns the game
      const { userId: memberId } = await loginAsMember();
      await addGameInterest(memberId, game.id, 'steam_library');

      const res = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ minOwners: 2 });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            gameId: game.id,
            gameName: 'Shared Game',
            ownerCount: 2,
            wishlistCount: expect.any(Number),
            score: expect.any(Number),
          }),
        ]),
      );
    });

    it('returns separate wishlistCount for steam_wishlist source', async () => {
      await createBuildingLineup();

      const game = await insertGame({
        name: 'Wishlist Game',
        slug: 'wishlist-game',
      });
      const { userId: memberId } = await loginAsMember();

      // Admin owns it, member has it wishlisted
      await addGameInterest(
        testApp.seed.adminUser.id,
        game.id,
        'steam_library',
      );
      await addGameInterest(memberId, game.id, 'steam_wishlist');

      const res = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ minOwners: 1 });

      expect(res.status).toBe(200);
      const found = (
        res.body.data as Array<{
          gameId: number;
          ownerCount: number;
          wishlistCount: number;
        }>
      ).find((g) => g.gameId === game.id);

      expect(found).toBeDefined();
      expect(found!.ownerCount).toBe(1);
      expect(found!.wishlistCount).toBe(1);
    });

    it('applies minOwners filter and excludes games below threshold', async () => {
      await createBuildingLineup();

      // Game with 1 owner — should be excluded with minOwners=2
      const singleOwnerGame = await insertGame({
        name: 'Solo Owned',
        slug: 'solo-owned',
      });
      await addGameInterest(
        testApp.seed.adminUser.id,
        singleOwnerGame.id,
        'steam_library',
      );

      // Game with 2 owners — should be included
      const { userId: memberId } = await loginAsMember();
      const multiOwnerGame = await insertGame({
        name: 'Multi Owned',
        slug: 'multi-owned',
      });
      await addGameInterest(
        testApp.seed.adminUser.id,
        multiOwnerGame.id,
        'steam_library',
      );
      await addGameInterest(memberId, multiOwnerGame.id, 'steam_library');

      const res = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ minOwners: 2 });

      expect(res.status).toBe(200);

      const gameIds = (res.body.data as Array<{ gameId: number }>).map(
        (g) => g.gameId,
      );
      expect(gameIds).toContain(multiOwnerGame.id);
      expect(gameIds).not.toContain(singleOwnerGame.id);
    });

    it('applies maxPlayers filter — excludes games where player_count max exceeds limit', async () => {
      await createBuildingLineup();
      const { userId: memberId } = await loginAsMember();

      // 2-player game — should be included with maxPlayers=4
      const twoPlayerGame = await insertGame({
        name: 'Two Player',
        slug: 'two-player',
        playerCount: { min: 1, max: 2 },
      });
      await addGameInterest(
        testApp.seed.adminUser.id,
        twoPlayerGame.id,
        'steam_library',
      );
      await addGameInterest(memberId, twoPlayerGame.id, 'steam_library');

      // 20-player game — should be excluded with maxPlayers=4
      const largeGame = await insertGame({
        name: 'Large MMO',
        slug: 'large-mmo',
        playerCount: { min: 1, max: 20 },
      });
      await addGameInterest(
        testApp.seed.adminUser.id,
        largeGame.id,
        'steam_library',
      );
      await addGameInterest(memberId, largeGame.id, 'steam_library');

      const res = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ minOwners: 2, maxPlayers: 4 });

      expect(res.status).toBe(200);
      const gameIds = (res.body.data as Array<{ gameId: number }>).map(
        (g) => g.gameId,
      );
      expect(gameIds).toContain(twoPlayerGame.id);
      expect(gameIds).not.toContain(largeGame.id);
    });

    it('does NOT exclude games with null player_count when maxPlayers filter is applied', async () => {
      await createBuildingLineup();
      const { userId: memberId } = await loginAsMember();

      // Game with no player_count metadata — must NOT be excluded
      const unknownSizeGame = await insertGame({
        name: 'Unknown Size',
        slug: 'unknown-size',
        playerCount: null,
      });
      await addGameInterest(
        testApp.seed.adminUser.id,
        unknownSizeGame.id,
        'steam_library',
      );
      await addGameInterest(memberId, unknownSizeGame.id, 'steam_library');

      const res = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ minOwners: 2, maxPlayers: 4 });

      expect(res.status).toBe(200);
      const gameIds = (res.body.data as Array<{ gameId: number }>).map(
        (g) => g.gameId,
      );
      expect(gameIds).toContain(unknownSizeGame.id);
    });

    it('applies genre filter — matches ITAD tags', async () => {
      await createBuildingLineup();
      const { userId: memberId } = await loginAsMember();

      // RPG game — should be included when genre=RPG
      const rpgGame = await insertGame({
        name: 'RPG Game',
        slug: 'rpg-game',
        itadTags: ['RPG', 'Fantasy'],
      });
      await addGameInterest(
        testApp.seed.adminUser.id,
        rpgGame.id,
        'steam_library',
      );
      await addGameInterest(memberId, rpgGame.id, 'steam_library');

      // Shooter game — should be excluded when genre=RPG
      const shooterGame = await insertGame({
        name: 'Shooter Game',
        slug: 'shooter-game',
        itadTags: ['Action', 'Shooter'],
      });
      await addGameInterest(
        testApp.seed.adminUser.id,
        shooterGame.id,
        'steam_library',
      );
      await addGameInterest(memberId, shooterGame.id, 'steam_library');

      const res = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ minOwners: 2, genre: 'RPG' });

      expect(res.status).toBe(200);
      const gameIds = (res.body.data as Array<{ gameId: number }>).map(
        (g) => g.gameId,
      );
      expect(gameIds).toContain(rpgGame.id);
      expect(gameIds).not.toContain(shooterGame.id);
    });

    it('excludes games already nominated in the active lineup', async () => {
      const lineupId = await createBuildingLineup();
      const { userId: memberId } = await loginAsMember();

      const game = await insertGame({
        name: 'Already Nominated',
        slug: 'already-nominated',
      });
      await addGameInterest(
        testApp.seed.adminUser.id,
        game.id,
        'steam_library',
      );
      await addGameInterest(memberId, game.id, 'steam_library');

      // Nominate the game directly in the DB
      await testApp.db.insert(schema.communityLineupEntries).values({
        lineupId,
        gameId: game.id,
        nominatedBy: testApp.seed.adminUser.id,
      });

      const res = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ minOwners: 2 });

      expect(res.status).toBe(200);
      const gameIds = (res.body.data as Array<{ gameId: number }>).map(
        (g) => g.gameId,
      );
      expect(gameIds).not.toContain(game.id);
    });

    it('returns results sorted by score DESC', async () => {
      await createBuildingLineup();

      // Create 3 users to build ownership spread
      const [user2] = await testApp.db
        .insert(schema.users)
        .values({ discordId: 'u2', username: 'user2', role: 'member' })
        .returning();
      const [user3] = await testApp.db
        .insert(schema.users)
        .values({ discordId: 'u3', username: 'user3', role: 'member' })
        .returning();

      // High score: 3 owners, no sale → (3*10) - 2 = 28
      const highScoreGame = await insertGame({
        name: 'High Score',
        slug: 'high-score',
      });
      await addGameInterest(
        testApp.seed.adminUser.id,
        highScoreGame.id,
        'steam_library',
      );
      await addGameInterest(user2.id, highScoreGame.id, 'steam_library');
      await addGameInterest(user3.id, highScoreGame.id, 'steam_library');

      // Low score: 2 owners, no sale → (2*10) - 2 = 18
      const lowScoreGame = await insertGame({
        name: 'Low Score',
        slug: 'low-score',
      });
      await addGameInterest(
        testApp.seed.adminUser.id,
        lowScoreGame.id,
        'steam_library',
      );
      await addGameInterest(user2.id, lowScoreGame.id, 'steam_library');

      const res = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ minOwners: 2 });

      expect(res.status).toBe(200);
      const data = res.body.data as Array<{ gameId: number; score: number }>;

      const highIdx = data.findIndex((g) => g.gameId === highScoreGame.id);
      const lowIdx = data.findIndex((g) => g.gameId === lowScoreGame.id);

      expect(highIdx).toBeGreaterThanOrEqual(0);
      expect(lowIdx).toBeGreaterThanOrEqual(0);
      expect(highIdx).toBeLessThan(lowIdx);
    });

    it('sale bonus increases score relative to full-price game with same owner count', async () => {
      await createBuildingLineup();
      const { userId: memberId } = await loginAsMember();

      // Game on sale (itadCurrentCut > 0) → ownerScore + SALE_BONUS
      const saleGame = await insertGame({
        name: 'On Sale',
        slug: 'on-sale',
        itadCurrentCut: 50,
        itadCurrentPrice: '4.99',
      });
      await addGameInterest(
        testApp.seed.adminUser.id,
        saleGame.id,
        'steam_library',
      );
      await addGameInterest(memberId, saleGame.id, 'steam_library');

      // Game at full price → ownerScore - FULL_PRICE_PENALTY
      const fullPriceGame = await insertGame({
        name: 'Full Price',
        slug: 'full-price',
        itadCurrentCut: 0,
      });
      await addGameInterest(
        testApp.seed.adminUser.id,
        fullPriceGame.id,
        'steam_library',
      );
      await addGameInterest(memberId, fullPriceGame.id, 'steam_library');

      const res = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ minOwners: 2 });

      expect(res.status).toBe(200);
      const data = res.body.data as Array<{ gameId: number; score: number }>;
      const sale = data.find((g) => g.gameId === saleGame.id);
      const full = data.find((g) => g.gameId === fullPriceGame.id);

      expect(sale).toBeDefined();
      expect(full).toBeDefined();
      expect(sale!.score).toBeGreaterThan(full!.score);
    });

    it('response includes meta.appliedWeights', async () => {
      await createBuildingLineup();

      const res = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.meta).toMatchObject({
        appliedWeights: {
          ownerWeight: expect.any(Number),
          saleBonus: expect.any(Number),
          fullPricePenalty: expect.any(Number),
        },
        activeLineupId: expect.any(Number),
        nominatedCount: expect.any(Number),
        maxNominations: 20,
        total: expect.any(Number),
      });
    });

    it('is accessible to member role', async () => {
      await createBuildingLineup();
      const { token: memberToken } = await loginAsMember();

      const res = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(200);
    });
  }
  describe('GET /lineups/common-ground', describeGetCommonGround);

  // ── POST /lineups/:id/nominate ────────────────────────────────

  function describeNominate() {
    it('returns 401 when not authenticated', async () => {
      const res = await testApp.request
        .post('/lineups/1/nominate')
        .send({ gameId: 1 });
      expect(res.status).toBe(401);
    });

    it('member can nominate a game to a building lineup', async () => {
      const lineupId = await createBuildingLineup();
      const { token: memberToken } = await loginAsMember();

      const res = await testApp.request
        .post(`/lineups/${lineupId}/nominate`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ gameId: testApp.seed.game.id });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: lineupId,
        status: 'building',
        entries: expect.arrayContaining([
          expect.objectContaining({ gameId: testApp.seed.game.id }),
        ]),
      });
    });

    it('persists nomination in the database', async () => {
      const lineupId = await createBuildingLineup();

      await testApp.request
        .post(`/lineups/${lineupId}/nominate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gameId: testApp.seed.game.id });

      // Verify persistence via GET endpoint
      const getRes = await testApp.request
        .get(`/lineups/${lineupId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(getRes.body.entries).toHaveLength(1);
      expect(getRes.body.entries[0].gameId).toBe(testApp.seed.game.id);
    });

    it('stores the requesting user as the nominator', async () => {
      const lineupId = await createBuildingLineup();
      const { token: memberToken, userId: memberId } = await loginAsMember();

      await testApp.request
        .post(`/lineups/${lineupId}/nominate`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ gameId: testApp.seed.game.id });

      const getRes = await testApp.request
        .get(`/lineups/${lineupId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      const entry = (
        getRes.body.entries as Array<{
          gameId: number;
          nominatedBy: { id: number };
        }>
      ).find((e) => e.gameId === testApp.seed.game.id);

      expect(entry).toBeDefined();
      expect(entry!.nominatedBy.id).toBe(memberId);
    });

    it('persists optional note when provided', async () => {
      const lineupId = await createBuildingLineup();

      const res = await testApp.request
        .post(`/lineups/${lineupId}/nominate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gameId: testApp.seed.game.id, note: 'Great party game!' });

      expect(res.status).toBe(201);
      const entry = (
        res.body.entries as Array<{ gameId: number; note: string | null }>
      ).find((e) => e.gameId === testApp.seed.game.id);
      expect(entry!.note).toBe('Great party game!');
    });

    it('returns 400 when lineup is not in building status', async () => {
      const lineupId = await createBuildingLineup();

      // Transition to voting
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });

      const res = await testApp.request
        .post(`/lineups/${lineupId}/nominate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gameId: testApp.seed.game.id });

      expect(res.status).toBe(400);
    });

    it('returns 400 when lineup has reached the 20-entry cap', async () => {
      const lineupId = await createBuildingLineup();

      // Insert 20 distinct games and nominate them directly
      for (let i = 0; i < 20; i++) {
        const [g] = await testApp.db
          .insert(schema.games)
          .values({ name: `Cap Game ${i}`, slug: `cap-game-${i}` })
          .returning();
        await testApp.db.insert(schema.communityLineupEntries).values({
          lineupId,
          gameId: g.id,
          nominatedBy: testApp.seed.adminUser.id,
        });
      }

      // 21st nomination should be rejected
      const res = await testApp.request
        .post(`/lineups/${lineupId}/nominate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gameId: testApp.seed.game.id });

      expect(res.status).toBe(400);
    });

    it('returns 409 when game is already nominated in the lineup', async () => {
      const lineupId = await createBuildingLineup();

      // First nomination succeeds
      await testApp.request
        .post(`/lineups/${lineupId}/nominate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gameId: testApp.seed.game.id });

      // Duplicate nomination returns 409
      const res = await testApp.request
        .post(`/lineups/${lineupId}/nominate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gameId: testApp.seed.game.id });

      expect(res.status).toBe(409);
    });

    it('returns 404 for nonexistent lineup', async () => {
      const res = await testApp.request
        .post('/lineups/99999/nominate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gameId: testApp.seed.game.id });

      expect(res.status).toBe(404);
    });

    it('returns 404 when gameId does not exist', async () => {
      const lineupId = await createBuildingLineup();

      const res = await testApp.request
        .post(`/lineups/${lineupId}/nominate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gameId: 999999 });

      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid request body (missing gameId)', async () => {
      const lineupId = await createBuildingLineup();

      const res = await testApp.request
        .post(`/lineups/${lineupId}/nominate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 400 for note exceeding 200 characters', async () => {
      const lineupId = await createBuildingLineup();

      const res = await testApp.request
        .post(`/lineups/${lineupId}/nominate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          gameId: testApp.seed.game.id,
          note: 'x'.repeat(201),
        });

      expect(res.status).toBe(400);
    });

    it('returned LineupDetailResponseDto contains the new entry', async () => {
      const lineupId = await createBuildingLineup();

      const res = await testApp.request
        .post(`/lineups/${lineupId}/nominate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gameId: testApp.seed.game.id });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: lineupId,
        status: 'building',
        entries: [
          expect.objectContaining({
            gameId: testApp.seed.game.id,
            gameName: 'Test Game',
            voteCount: 0,
            carriedOver: false,
          }),
        ],
      });
    });
  }
  describe('POST /lineups/:id/nominate', describeNominate);
}

describe('Common Ground (integration)', describeCommonGround);
