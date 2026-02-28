/* eslint-disable @typescript-eslint/no-unsafe-call */
/**
 * IGDB / Games Integration Tests (ROK-528)
 *
 * Verifies game CRUD, search, discovery, want-to-play, and game detail
 * endpoints against a real PostgreSQL database. External IGDB/Twitch APIs
 * are NOT tested here — only the local DB-backed paths.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';

/** Insert a test game directly and return its ID. */
async function insertTestGame(
  testApp: TestApp,
  name: string,
  overrides: Partial<typeof schema.games.$inferInsert> = {},
): Promise<typeof schema.games.$inferSelect> {
  const [game] = await testApp.db
    .insert(schema.games)
    .values({
      name,
      slug: name.toLowerCase().replace(/\s+/g, '-'),
      coverUrl: null,
      igdbId: null,
      hidden: false,
      banned: false,
      ...overrides,
    })
    .returning();
  return game;
}

describe('Games / IGDB (integration)', () => {
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

  // ===================================================================
  // GET /games/search
  // ===================================================================

  describe('GET /games/search', () => {
    it('should return matching games from the database', async () => {
      await insertTestGame(testApp, 'Halo Infinite', { igdbId: 1001 });
      await insertTestGame(testApp, 'Halo Reach', { igdbId: 1002 });
      await insertTestGame(testApp, 'Destiny 2', { igdbId: 1003 });

      const res = await testApp.request.get('/games/search?q=Halo');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
      expect(res.body.meta.total).toBeGreaterThanOrEqual(2);

      const names = res.body.data.map((g: { name: string }) => g.name);
      expect(names).toContain('Halo Infinite');
      expect(names).toContain('Halo Reach');
    });

    it('should exclude hidden games from search results', async () => {
      await insertTestGame(testApp, 'Visible Game', { igdbId: 2001 });
      await insertTestGame(testApp, 'Hidden Game', {
        igdbId: 2002,
        hidden: true,
      });

      const res = await testApp.request.get('/games/search?q=Game');

      expect(res.status).toBe(200);
      const names = res.body.data.map((g: { name: string }) => g.name);
      expect(names).toContain('Visible Game');
      expect(names).not.toContain('Hidden Game');
    });

    it('should exclude banned games from search results', async () => {
      await insertTestGame(testApp, 'Normal Game', { igdbId: 3001 });
      await insertTestGame(testApp, 'Banned Game', {
        igdbId: 3002,
        banned: true,
      });

      const res = await testApp.request.get('/games/search?q=Game');

      expect(res.status).toBe(200);
      const names = res.body.data.map((g: { name: string }) => g.name);
      expect(names).toContain('Normal Game');
      expect(names).not.toContain('Banned Game');
    });

    it('should return 400 for empty query', async () => {
      const res = await testApp.request.get('/games/search?q=');

      expect(res.status).toBe(400);
    });
  });

  // ===================================================================
  // GET /games/:id (game detail)
  // ===================================================================

  describe('GET /games/:id', () => {
    it('should return game detail by ID', async () => {
      const game = await insertTestGame(testApp, 'World of Warcraft', {
        igdbId: 4001,
        summary: 'An MMO by Blizzard',
        rating: 85.5,
        gameModes: [2, 5],
      });

      const res = await testApp.request.get(`/games/${game.id}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: game.id,
        name: 'World of Warcraft',
        slug: 'world-of-warcraft',
        summary: 'An MMO by Blizzard',
        gameModes: [2, 5],
      });
      expect(res.body.rating).toBeCloseTo(85.5, 0);
    });

    it('should return 404 for non-existent game', async () => {
      const res = await testApp.request.get('/games/999999');

      expect(res.status).toBe(404);
    });
  });

  // ===================================================================
  // GET /games/configured
  // ===================================================================

  describe('GET /games/configured', () => {
    it('should return only enabled games with config columns', async () => {
      await insertTestGame(testApp, 'Enabled Game', {
        igdbId: 5001,
        enabled: true,
        hasRoles: true,
        colorHex: '#FF0000',
      });
      await insertTestGame(testApp, 'Disabled Game', {
        igdbId: 5002,
        enabled: false,
      });

      const res = await testApp.request.get('/games/configured');

      expect(res.status).toBe(200);

      const names = res.body.data.map((g: { name: string }) => g.name);
      expect(names).toContain('Enabled Game');
      expect(names).not.toContain('Disabled Game');

      // The seeded 'Test Game' is also enabled by default
      expect(res.body.meta.total).toBeGreaterThanOrEqual(1);

      const enabledGame = res.body.data.find(
        (g: { name: string }) => g.name === 'Enabled Game',
      );
      expect(enabledGame).toMatchObject({
        hasRoles: true,
        colorHex: '#FF0000',
        enabled: true,
      });
    });
  });

  // ===================================================================
  // GET /games/:id/event-types
  // ===================================================================

  describe('GET /games/:id/event-types', () => {
    it('should return event types for a game', async () => {
      const game = await insertTestGame(testApp, 'Event Type Game', {
        igdbId: 6001,
      });

      await testApp.db.insert(schema.eventTypes).values([
        {
          gameId: game.id,
          slug: 'mythic-raid',
          name: 'Mythic Raid',
          defaultPlayerCap: 20,
          defaultDurationMinutes: 180,
          requiresComposition: true,
        },
        {
          gameId: game.id,
          slug: 'heroic-raid',
          name: 'Heroic Raid',
          defaultPlayerCap: 30,
          requiresComposition: false,
        },
      ]);

      const res = await testApp.request.get(`/games/${game.id}/event-types`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.meta.gameName).toBe('Event Type Game');

      const mythic = res.body.data.find(
        (t: { slug: string }) => t.slug === 'mythic-raid',
      );
      expect(mythic).toMatchObject({
        name: 'Mythic Raid',
        defaultPlayerCap: 20,
        defaultDurationMinutes: 180,
        requiresComposition: true,
      });
    });

    it('should return 404 for non-existent game', async () => {
      const res = await testApp.request.get('/games/999999/event-types');

      expect(res.status).toBe(404);
    });
  });

  // ===================================================================
  // Want-to-Play (interest) lifecycle
  // ===================================================================

  describe('want-to-play lifecycle', () => {
    it('should toggle want-to-play on and persist', async () => {
      const game = await insertTestGame(testApp, 'Interest Game', {
        igdbId: 7001,
      });

      // Add interest
      const addRes = await testApp.request
        .post(`/games/${game.id}/want-to-play`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(addRes.status).toBe(200);
      expect(addRes.body.wantToPlay).toBe(true);
      expect(addRes.body.count).toBe(1);
      expect(addRes.body.source).toBe('manual');

      // Verify in DB
      const interests = await testApp.db
        .select()
        .from(schema.gameInterests)
        .where(eq(schema.gameInterests.gameId, game.id));

      expect(interests.length).toBe(1);
      expect(interests[0].source).toBe('manual');
    });

    it('should be idempotent when adding interest twice', async () => {
      const game = await insertTestGame(testApp, 'Idempotent Game', {
        igdbId: 7002,
      });

      await testApp.request
        .post(`/games/${game.id}/want-to-play`)
        .set('Authorization', `Bearer ${adminToken}`);

      const secondRes = await testApp.request
        .post(`/games/${game.id}/want-to-play`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(secondRes.status).toBe(200);
      expect(secondRes.body.count).toBe(1);
    });

    it('should remove want-to-play and update count', async () => {
      const game = await insertTestGame(testApp, 'Remove Interest Game', {
        igdbId: 7003,
      });

      // Add then remove
      await testApp.request
        .post(`/games/${game.id}/want-to-play`)
        .set('Authorization', `Bearer ${adminToken}`);

      const deleteRes = await testApp.request
        .delete(`/games/${game.id}/want-to-play`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.wantToPlay).toBe(false);
      expect(deleteRes.body.count).toBe(0);
    });

    it('should return 404 when adding interest for non-existent game', async () => {
      const res = await testApp.request
        .post('/games/999999/want-to-play')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('should require auth for want-to-play endpoints', async () => {
      const game = await insertTestGame(testApp, 'Auth Game', {
        igdbId: 7004,
      });

      const addRes = await testApp.request.post(
        `/games/${game.id}/want-to-play`,
      );
      expect(addRes.status).toBe(401);

      const deleteRes = await testApp.request.delete(
        `/games/${game.id}/want-to-play`,
      );
      expect(deleteRes.status).toBe(401);
    });
  });

  // ===================================================================
  // GET /games/:id/interest
  // ===================================================================

  describe('GET /games/:id/interest', () => {
    it('should return interest status with player previews', async () => {
      const game = await insertTestGame(testApp, 'Interest Status Game', {
        igdbId: 8001,
      });

      // Admin adds interest
      await testApp.request
        .post(`/games/${game.id}/want-to-play`)
        .set('Authorization', `Bearer ${adminToken}`);

      const res = await testApp.request
        .get(`/games/${game.id}/interest`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.wantToPlay).toBe(true);
      expect(res.body.count).toBe(1);
      expect(res.body.source).toBe('manual');
      expect(res.body.players).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(Number),
            username: expect.any(String),
          }),
        ]),
      );
    });

    it('should return wantToPlay=false when user has no interest', async () => {
      const game = await insertTestGame(testApp, 'No Interest Game', {
        igdbId: 8002,
      });

      const res = await testApp.request
        .get(`/games/${game.id}/interest`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.wantToPlay).toBe(false);
      expect(res.body.count).toBe(0);
    });
  });

  // ===================================================================
  // GET /games/interest/batch
  // ===================================================================

  describe('GET /games/interest/batch', () => {
    it('should return batch interest status for multiple games', async () => {
      const game1 = await insertTestGame(testApp, 'Batch Game 1', {
        igdbId: 9001,
      });
      const game2 = await insertTestGame(testApp, 'Batch Game 2', {
        igdbId: 9002,
      });

      // Add interest for game1 only
      await testApp.request
        .post(`/games/${game1.id}/want-to-play`)
        .set('Authorization', `Bearer ${adminToken}`);

      const res = await testApp.request
        .get(`/games/interest/batch?ids=${game1.id},${game2.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data[String(game1.id)]).toMatchObject({
        wantToPlay: true,
        count: 1,
      });
      expect(res.body.data[String(game2.id)]).toMatchObject({
        wantToPlay: false,
        count: 0,
      });
    });

    it('should return empty data for empty ids param', async () => {
      const res = await testApp.request
        .get('/games/interest/batch')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({});
    });
  });

  // ===================================================================
  // GET /games/:id/activity
  // ===================================================================

  describe('GET /games/:id/activity', () => {
    it('should return empty activity for a game with no sessions', async () => {
      const game = await insertTestGame(testApp, 'Activity Game', {
        igdbId: 10001,
      });

      const res = await testApp.request.get(
        `/games/${game.id}/activity?period=week`,
      );

      expect(res.status).toBe(200);
      expect(res.body.topPlayers).toEqual([]);
      expect(res.body.totalSeconds).toBe(0);
    });

    it('should return 404 for non-existent game', async () => {
      const res = await testApp.request.get(
        '/games/999999/activity?period=week',
      );

      expect(res.status).toBe(404);
    });

    it('should reject invalid period parameter', async () => {
      const game = await insertTestGame(testApp, 'Bad Period Game', {
        igdbId: 10002,
      });

      const res = await testApp.request.get(
        `/games/${game.id}/activity?period=invalid`,
      );

      expect(res.status).toBe(400);
    });
  });

  // ===================================================================
  // GET /games/:id/now-playing
  // ===================================================================

  describe('GET /games/:id/now-playing', () => {
    it('should return empty list when no one is playing', async () => {
      const game = await insertTestGame(testApp, 'Now Playing Game', {
        igdbId: 11001,
      });

      const res = await testApp.request.get(`/games/${game.id}/now-playing`);

      expect(res.status).toBe(200);
      expect(res.body.players).toEqual([]);
      expect(res.body.count).toBe(0);
    });
  });

  // ===================================================================
  // GET /games/discover
  // ===================================================================

  describe('GET /games/discover', () => {
    it('should return discovery rows (may be empty with no data)', async () => {
      const res = await testApp.request.get('/games/discover');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('rows');
      expect(Array.isArray(res.body.rows)).toBe(true);
    });

    it('should include games in discovery rows when data exists', async () => {
      // Insert games with attributes that match discovery categories
      await insertTestGame(testApp, 'Highly Rated Game', {
        igdbId: 12001,
        aggregatedRating: 99.0,
        hidden: false,
        banned: false,
      });

      const res = await testApp.request.get('/games/discover');

      expect(res.status).toBe(200);
      // Verify at least one row has games (seed + our new game)
      const nonEmptyRows = res.body.rows.filter(
        (r: { games: unknown[] }) => r.games.length > 0,
      );
      expect(nonEmptyRows.length).toBeGreaterThanOrEqual(1);

      // Each row should have category and slug
      for (const row of res.body.rows) {
        expect(row).toMatchObject({
          category: expect.any(String),
          slug: expect.any(String),
          games: expect.any(Array),
        });
      }
    });
  });

  // ===================================================================
  // POST /games/sync-popular (admin-only)
  // ===================================================================

  describe('POST /games/sync-popular', () => {
    it('should require admin authentication', async () => {
      const res = await testApp.request.post('/games/sync-popular');

      expect(res.status).toBe(401);
    });
  });

  // ===================================================================
  // Discord auto-heart suppression (ROK-444)
  // ===================================================================

  describe('discord auto-heart suppression', () => {
    it('should create suppression when removing discord-sourced interest', async () => {
      const game = await insertTestGame(testApp, 'Suppression Game', {
        igdbId: 13001,
      });

      // Insert a discord-sourced interest directly
      await testApp.db.insert(schema.gameInterests).values({
        userId: testApp.seed.adminUser.id,
        gameId: game.id,
        source: 'discord',
      });

      // Remove interest via API
      const deleteRes = await testApp.request
        .delete(`/games/${game.id}/want-to-play`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.wantToPlay).toBe(false);

      // Verify suppression was created
      const suppressions = await testApp.db
        .select()
        .from(schema.gameInterestSuppressions)
        .where(
          and(
            eq(
              schema.gameInterestSuppressions.userId,
              testApp.seed.adminUser.id,
            ),
            eq(schema.gameInterestSuppressions.gameId, game.id),
          ),
        );

      expect(suppressions.length).toBe(1);
    });

    it('should NOT create suppression when removing manual interest', async () => {
      const game = await insertTestGame(testApp, 'No Suppression Game', {
        igdbId: 13002,
      });

      // Add manual interest via API
      await testApp.request
        .post(`/games/${game.id}/want-to-play`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Remove interest
      await testApp.request
        .delete(`/games/${game.id}/want-to-play`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Verify no suppression was created
      const suppressions = await testApp.db
        .select()
        .from(schema.gameInterestSuppressions)
        .where(
          and(
            eq(
              schema.gameInterestSuppressions.userId,
              testApp.seed.adminUser.id,
            ),
            eq(schema.gameInterestSuppressions.gameId, game.id),
          ),
        );

      expect(suppressions.length).toBe(0);
    });
  });
});
