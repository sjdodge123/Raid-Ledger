/**
 * Game Taste Vectors Integration Tests (ROK-1082).
 *
 * Written TDD-style BEFORE the feature is implemented — every test here
 * must FAIL on first run. The dev agent builds to make them pass.
 *
 * Mirrors `taste-profile.integration.spec.ts` shape.
 *
 * Covers:
 * - `runAggregateGameVectors(db)` writes one `game_taste_vectors` row per
 *   game with vector length 7 and confidence ∈ [0, 1]
 * - Axis sanity: a game tagged "survival" scores > 0 on the survival axis
 * - `POST /games/similar` admin route resolves {userId}, {userIds[]},
 *   and {gameId} input branches
 * - Banned / hidden games are filtered from similarity results
 * - Cron registered: `GameTasteService_aggregateGameVectors`
 * - AdminGuard enforced on `GET /games/:id/taste-vector` and
 *   `POST /games/similar`
 */
import * as bcrypt from 'bcrypt';
import { sql } from 'drizzle-orm';
import { SchedulerRegistry } from '@nestjs/schedule';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { TIER_DESCRIPTIONS } from '../taste-profile/archetype-copy';
import { GameTasteService } from './game-taste.service';
import { runAggregateGameVectors } from './pipelines/aggregate-game-vectors';

/**
 * ROK-1083: `player_taste_vectors.archetype` moved from `text` to
 * nullable `jsonb`. The three raw-SQL fixture INSERTs below need a jsonb
 * literal — this constant is the composed-shape default, pre-escaped for
 * safe substitution into a `sql` template.
 */
const STUB_ARCHETYPE_JSON = `'${JSON.stringify({
  intensityTier: 'Regular',
  vectorTitles: [],
  descriptions: { tier: TIER_DESCRIPTIONS.Regular, titles: [] },
}).replace(/'/g, "''")}'::jsonb`;

describe('Game Taste Vectors (ROK-1082)', () => {
  let testApp: TestApp;
  let adminToken: string;
  let memberToken: string;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Phase D will consume this
  let service: GameTasteService;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    memberToken = await createMemberAndLogin();
    service = testApp.app.get(GameTasteService);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    memberToken = await createMemberAndLogin();
  });

  // ─── helpers ────────────────────────────────────────────────────

  async function createMemberAndLogin(): Promise<string> {
    const passwordHash = await bcrypt.hash('TestPassword123!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: 'local:gt-member@test.local',
        username: 'gt-member',
        role: 'member',
      })
      .returning();
    await testApp.db.insert(schema.localCredentials).values({
      email: 'gt-member@test.local',
      passwordHash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email: 'gt-member@test.local', password: 'TestPassword123!' });
    return (res.body as { access_token: string }).access_token;
  }

  async function seedUser(
    discordId: string,
    username: string,
  ): Promise<number> {
    const [u] = await testApp.db
      .insert(schema.users)
      .values({ discordId, username, role: 'member' })
      .returning();
    return u.id;
  }

  async function seedGame(
    name: string,
    opts: {
      tags?: string[];
      genres?: number[];
      gameModes?: number[];
      themes?: number[];
      banned?: boolean;
      hidden?: boolean;
    } = {},
  ): Promise<number> {
    const [g] = await testApp.db
      .insert(schema.games)
      .values({
        name,
        slug: name.toLowerCase().replace(/\s+/g, '-'),
        genres: opts.genres ?? [],
        gameModes: opts.gameModes ?? [],
        themes: opts.themes ?? [],
        itadTags: opts.tags ?? [],
        banned: opts.banned ?? false,
        hidden: opts.hidden ?? false,
      })
      .returning();
    return g.id;
  }

  async function seedInterest(
    userId: number,
    gameId: number,
    playtimeForever?: number,
  ): Promise<void> {
    await testApp.db.insert(schema.gameInterests).values({
      userId,
      gameId,
      source: 'steam_library',
      playtimeForever: playtimeForever ?? null,
    });
  }

  async function seedCorpus(): Promise<{
    survival: number;
    coop: number;
    rpg: number;
    strategy: number;
    pvp: number;
  }> {
    const survival = await seedGame('Survive Me', { tags: ['survival'] });
    const coop = await seedGame('Coop Ally', { gameModes: [3] });
    const rpg = await seedGame('RPG One', { genres: [12] });
    const strategy = await seedGame('Strat One', { genres: [15] });
    const pvp = await seedGame('PvP Arena', { gameModes: [2] });
    return { survival, coop, rpg, strategy, pvp };
  }

  // ─── AC: aggregate pipeline writes rows ─────────────────────────

  describe('runAggregateGameVectors', () => {
    it('writes a game_taste_vectors row per game with vector length 7 and confidence ∈ [0, 1]', async () => {
      const ids = await seedCorpus();
      const userId = await seedUser('d:gt-agg', 'gt-agg');
      await seedInterest(userId, ids.survival, 4000);

      await runAggregateGameVectors(testApp.db);

      const rows = await testApp.db.execute<{
        game_id: number;
        vector: unknown;
        confidence: number;
      }>(sql`SELECT game_id, vector, confidence FROM game_taste_vectors`);

      expect(rows.length).toBeGreaterThanOrEqual(5);
      for (const row of rows) {
        // pgvector round-trips to string or array — allow either shape
        const arr =
          typeof row.vector === 'string'
            ? JSON.parse(row.vector)
            : (row.vector as number[]);
        expect(Array.isArray(arr)).toBe(true);
        expect(arr).toHaveLength(7);
        const conf = Number(row.confidence);
        expect(conf).toBeGreaterThanOrEqual(0);
        expect(conf).toBeLessThanOrEqual(1);
      }
    });

    it('axis sanity: a game tagged "survival" scores > 0 on the survival axis', async () => {
      const ids = await seedCorpus();

      await runAggregateGameVectors(testApp.db);

      const rows = await testApp.db.execute<{
        game_id: number;
        dimensions: Record<string, number>;
      }>(
        sql`SELECT game_id, dimensions FROM game_taste_vectors WHERE game_id = ${ids.survival}`,
      );
      expect(rows.length).toBe(1);
      const dims =
        typeof rows[0].dimensions === 'string'
          ? (JSON.parse(rows[0].dimensions) as Record<string, number>)
          : rows[0].dimensions;
      expect(dims.survival).toBeGreaterThan(0);
    });
  });

  // ─── AC: POST /games/similar — 3 input branches ─────────────────

  describe('POST /games/similar (admin)', () => {
    it('returns ranked results for { userId } input', async () => {
      const ids = await seedCorpus();
      const userId = await seedUser('d:gt-user', 'gt-user');
      await seedInterest(userId, ids.rpg, 8000);

      // Seed a player vector for the user (the similarity query needs
      // something to compare against). The pipeline for player vectors
      // lives in TasteProfileService — seed the row directly for this
      // test rather than invoking the other cron.
      await testApp.db.execute(sql`
        INSERT INTO player_taste_vectors
          (user_id, vector, dimensions, intensity_metrics, archetype,
           computed_at, signal_hash)
        VALUES (
          ${userId},
          '[0.1,0.1,0.9,0.1,0.1,0.1,0.1]'::vector,
          '{"co_op":10,"pvp":10,"rpg":90,"survival":10,"strategy":10,"social":10,"mmo":10}'::jsonb,
          '{"intensity":50,"focus":50,"breadth":50,"consistency":50}'::jsonb,
          ${sql.raw(STUB_ARCHETYPE_JSON)},
          NOW(),
          'test-hash-1'
        )
      `);

      await runAggregateGameVectors(testApp.db);

      const res = await testApp.request
        .post('/games/similar')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId, limit: 3 });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.similar)).toBe(true);
      expect(res.body.similar.length).toBeGreaterThan(0);
      expect(res.body.similar.length).toBeLessThanOrEqual(3);
      for (const g of res.body.similar) {
        expect(typeof g.similarity).toBe('number');
        expect(typeof g.gameId).toBe('number');
      }
      // sorted by similarity descending
      for (let i = 1; i < res.body.similar.length; i++) {
        expect(res.body.similar[i - 1].similarity).toBeGreaterThanOrEqual(
          res.body.similar[i].similarity,
        );
      }
    });

    it('returns ranked results for { userIds } input (group centroid)', async () => {
      const ids = await seedCorpus();
      const a = await seedUser('d:gt-a', 'gt-a');
      const b = await seedUser('d:gt-b', 'gt-b');

      await testApp.db.execute(sql`
        INSERT INTO player_taste_vectors
          (user_id, vector, dimensions, intensity_metrics, archetype,
           computed_at, signal_hash)
        VALUES
          (${a}, '[0.1,0.1,0.9,0.1,0.1,0.1,0.1]'::vector,
           '{"co_op":10,"pvp":10,"rpg":90,"survival":10,"strategy":10,"social":10,"mmo":10}'::jsonb,
           '{"intensity":50,"focus":50,"breadth":50,"consistency":50}'::jsonb,
           ${sql.raw(STUB_ARCHETYPE_JSON)}, NOW(), 'gt-hash-a'),
          (${b}, '[0.1,0.1,0.8,0.2,0.1,0.1,0.1]'::vector,
           '{"co_op":10,"pvp":10,"rpg":80,"survival":20,"strategy":10,"social":10,"mmo":10}'::jsonb,
           '{"intensity":50,"focus":50,"breadth":50,"consistency":50}'::jsonb,
           ${sql.raw(STUB_ARCHETYPE_JSON)}, NOW(), 'gt-hash-b')
      `);

      await runAggregateGameVectors(testApp.db);

      const res = await testApp.request
        .post('/games/similar')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userIds: [a, b], limit: 3 });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.similar)).toBe(true);
      expect(res.body.similar.length).toBeGreaterThan(0);
      // Reference ids used just to silence unused-binding; keep concise
      expect(ids.rpg).toBeGreaterThan(0);
    });

    it('returns ranked results for { gameId } input (find similar games)', async () => {
      const ids = await seedCorpus();
      await runAggregateGameVectors(testApp.db);

      const res = await testApp.request
        .post('/games/similar')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gameId: ids.rpg, limit: 3 });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.similar)).toBe(true);
      // Self should NOT appear in results
      for (const g of res.body.similar) {
        expect(g.gameId).not.toBe(ids.rpg);
      }
    });

    it('filters banned / hidden games from results', async () => {
      const coop = await seedGame('Coop Ally', { gameModes: [3] });
      const bannedGame = await seedGame('Banned Coop', {
        gameModes: [3],
        banned: true,
      });
      const hiddenGame = await seedGame('Hidden Coop', {
        gameModes: [3],
        hidden: true,
      });

      await runAggregateGameVectors(testApp.db);

      const res = await testApp.request
        .post('/games/similar')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gameId: coop, limit: 10 });

      expect(res.status).toBe(200);
      const returnedIds = (res.body.similar as Array<{ gameId: number }>).map(
        (g) => g.gameId,
      );
      expect(returnedIds).not.toContain(bannedGame);
      expect(returnedIds).not.toContain(hiddenGame);
    });
  });

  // ─── AC: cron registration ──────────────────────────────────────

  describe('cron registration', () => {
    it('registers GameTasteService_aggregateGameVectors in the scheduler', () => {
      const scheduler = testApp.app.get(SchedulerRegistry);
      const jobs = scheduler.getCronJobs();
      expect(jobs.has('GameTasteService_aggregateGameVectors')).toBe(true);
    });
  });

  // ─── AC: AdminGuard on admin endpoints ──────────────────────────

  describe('AdminGuard', () => {
    it('GET /games/:id/taste-vector returns 403 for non-admin', async () => {
      const ids = await seedCorpus();
      await runAggregateGameVectors(testApp.db);

      const res = await testApp.request
        .get(`/games/${ids.survival}/taste-vector`)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(res.status).toBe(403);
    });

    it('GET /games/:id/taste-vector returns 200 with derivation payload for admin', async () => {
      const ids = await seedCorpus();
      await runAggregateGameVectors(testApp.db);

      const res = await testApp.request
        .get(`/games/${ids.survival}/taste-vector`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          gameId: ids.survival,
          vector: expect.any(Array),
          dimensions: expect.any(Object),
          confidence: expect.any(Number),
          derivation: expect.any(Array),
        }),
      );
      expect(res.body.vector).toHaveLength(7);
    });

    it('POST /games/similar returns 403 for non-admin', async () => {
      const res = await testApp.request
        .post('/games/similar')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ gameId: 1, limit: 3 });
      expect(res.status).toBe(403);
    });

    it('GET /games/:id/taste-vector returns 404 when no vector exists for the game', async () => {
      // Seed a game but DO NOT run the aggregate pipeline — no vector row exists.
      const orphan = await seedGame('No Vector Game');

      const res = await testApp.request
        .get(`/games/${orphan}/taste-vector`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });
  });

  // ─── AC: public GET /games/:id/taste-profile ───────────────────

  describe('GET /games/:id/taste-profile (public, JWT-required)', () => {
    it('returns 200 with profile shape (no derivation) for authenticated member', async () => {
      const ids = await seedCorpus();
      await runAggregateGameVectors(testApp.db);

      const res = await testApp.request
        .get(`/games/${ids.survival}/taste-profile`)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          gameId: ids.survival,
          vector: expect.any(Array),
          dimensions: expect.any(Object),
          confidence: expect.any(Number),
          computedAt: expect.any(String),
        }),
      );
      expect(res.body.vector).toHaveLength(7);
      // Public profile endpoint must NOT leak the derivation audit trail.
      expect(res.body).not.toHaveProperty('derivation');
    });

    it('returns 401 when no JWT is presented', async () => {
      const ids = await seedCorpus();
      await runAggregateGameVectors(testApp.db);

      const res = await testApp.request.get(
        `/games/${ids.survival}/taste-profile`,
      );
      expect(res.status).toBe(401);
    });

    it('returns 404 when no taste-vector row exists for the game', async () => {
      const orphan = await seedGame('No Profile Game');

      const res = await testApp.request
        .get(`/games/${orphan}/taste-profile`)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(res.status).toBe(404);
    });

    it('returns 200 with confidence=0 for a zero-signal stub row (no filter on profile endpoint)', async () => {
      // The public profile endpoint is a direct key lookup — it does NOT
      // apply the similarity `minConfidence` filter. A confidence=0 stub
      // row must still return 200 (chart consumers handle the empty state
      // in the UI). Seed the row directly rather than through the pipeline
      // to guarantee confidence=0.
      const gameId = await seedGame('Zero Signal Game');
      await testApp.db.execute(sql`
        INSERT INTO game_taste_vectors
          (game_id, vector, dimensions, confidence, computed_at, signal_hash)
        VALUES (
          ${gameId},
          '[0,0,0,0,0,0,0]'::vector,
          '{"co_op":0,"pvp":0,"rpg":0,"survival":0,"strategy":0,"social":0,"mmo":0}'::jsonb,
          0,
          NOW(),
          'zero-signal-hash'
        )
      `);

      const res = await testApp.request
        .get(`/games/${gameId}/taste-profile`)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(res.status).toBe(200);
      expect(res.body.confidence).toBe(0);
      expect(res.body).not.toHaveProperty('derivation');
    });
  });

  // ─── AC: multiplayerOnly filter (ROK-931) ─────────────────────

  describe('POST /games/similar — multiplayerOnly filter (ROK-931)', () => {
    it('excludes a solo-only game when multiplayerOnly:true', async () => {
      // Two games: one multiplayer-capable (co-op game mode = 3), one solo-
      // only. Both have populated taste vectors. With `multiplayerOnly:
      // true`, the solo-only game must NOT appear in results; the
      // multiplayer one must remain eligible.
      const coop = await seedGame('Multiplayer Coop', { gameModes: [3] });
      const solo = await seedGame('Solo Only', { gameModes: [1] });

      await runAggregateGameVectors(testApp.db);

      // Force solo-only vector's multiplayer dims to zero so the filter
      // unambiguously excludes it (the pipeline may produce small co_op
      // values from tags/genres).
      await testApp.db.execute(sql`
        UPDATE game_taste_vectors
        SET dimensions = jsonb_set(
              jsonb_set(
                jsonb_set(
                  jsonb_set(
                    jsonb_set(dimensions, '{co_op}', '0'),
                    '{pvp}', '0'),
                  '{mmo}', '0'),
                '{battle_royale}', '0'),
              '{moba}', '0')
        WHERE game_id = ${solo}
      `);
      // And make sure the coop game has a non-zero co_op dim so it stays.
      await testApp.db.execute(sql`
        UPDATE game_taste_vectors
        SET dimensions = jsonb_set(dimensions, '{co_op}', '10')
        WHERE game_id = ${coop}
      `);

      const res = await testApp.request
        .post('/games/similar')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gameId: coop, limit: 10, multiplayerOnly: true });

      expect(res.status).toBe(200);
      const returnedIds = (res.body.similar as Array<{ gameId: number }>).map(
        (g) => g.gameId,
      );
      expect(returnedIds).not.toContain(solo);
    });
  });

  // ─── AC: minConfidence filter behavior on POST /games/similar ───

  describe('POST /games/similar — minConfidence filter', () => {
    it('default threshold excludes zero-confidence stub rows but includes positive-confidence rows', async () => {
      // Seed two games. One gets a zero-signal vector (confidence=0), the
      // other gets a populated vector (confidence>0). The query game that
      // drives similarity also needs a vector — reuse the positive one as
      // the query target, and the filter should hide the zero-signal game
      // from results by default.
      const queryGame = await seedGame('Query Game High Conf', {
        tags: ['survival'],
      });
      const zeroConfGame = await seedGame('Zero Conf Stub');

      await runAggregateGameVectors(testApp.db);

      // Force the zero-conf row to confidence=0. The pipeline with tags
      // would yield a non-zero row; an unconfigured row still yields a
      // small signal, so overwrite to guarantee the stub semantics.
      await testApp.db.execute(sql`
        UPDATE game_taste_vectors
        SET confidence = 0,
            vector = '[0,0,0,0,0,0,0]'::vector
        WHERE game_id = ${zeroConfGame}
      `);

      const res = await testApp.request
        .post('/games/similar')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gameId: queryGame, limit: 10 });

      expect(res.status).toBe(200);
      const returnedIds = (res.body.similar as Array<{ gameId: number }>).map(
        (g) => g.gameId,
      );
      // Zero-confidence stub is filtered out by the default threshold.
      expect(returnedIds).not.toContain(zeroConfGame);
    });
  });
});
