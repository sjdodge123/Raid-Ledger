/**
 * Taste Profile Integration Tests (ROK-948, PR 2)
 *
 * Written TDD-style BEFORE the feature is implemented — every test here
 * must FAIL on first run. The dev agent builds to make them pass.
 *
 * Covers Linear ACs:
 * - AC 2: migration 0121 creates all 3 tables with correct types/constraints
 * - AC 3: daily cron aggregates signals → player_taste_vectors
 * - AC 4: weekly cron rolls up intensity → player_intensity_snapshots
 * - AC 5: daily cron builds co-play graph from voice overlaps / signups
 * - AC 9: GET /users/:id/taste-profile
 * - AC 10: GET /users/:id/similar-players
 */
import { sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { TasteProfileService } from './taste-profile.service';

describe('Taste Profile (ROK-948)', () => {
  let testApp: TestApp;
  let adminToken: string;
  let service: TasteProfileService;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    service = testApp.app.get(TasteProfileService);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  // ─── Seed helpers ───────────────────────────────────────────────

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
    igdbGenres: number[],
    igdbGameModes: number[],
    igdbThemes: number[] = [],
  ): Promise<number> {
    const [g] = await testApp.db
      .insert(schema.games)
      .values({
        name,
        slug: name.toLowerCase().replace(/\s+/g, '-'),
        genres: igdbGenres,
        gameModes: igdbGameModes,
        themes: igdbThemes,
      })
      .returning();
    return g.id;
  }

  async function seedInterest(
    userId: number,
    gameId: number,
    source: string,
    playtimeForever?: number,
  ): Promise<void> {
    await testApp.db.insert(schema.gameInterests).values({
      userId,
      gameId,
      source,
      playtimeForever: playtimeForever ?? null,
    });
  }

  // ─── AC 2: schema ───────────────────────────────────────────────

  describe('AC 2: migration 0121 creates required tables', () => {
    it('player_taste_vectors has vector(7) column + required fields', async () => {
      const cols = await testApp.db.execute<{
        column_name: string;
        data_type: string;
      }>(sql`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'player_taste_vectors'
      `);
      const names = cols.map((c) => c.column_name);
      expect(names).toEqual(
        expect.arrayContaining([
          'id',
          'user_id',
          'vector',
          'dimensions',
          'intensity_metrics',
          'archetype',
          'computed_at',
          'signal_hash',
        ]),
      );
      const vectorCol = cols.find((c) => c.column_name === 'vector');
      expect(vectorCol?.data_type.toLowerCase()).toMatch(/vector|user-defined/);
    });

    it('player_intensity_snapshots has (user_id, week_start) unique constraint', async () => {
      const unique = await testApp.db.execute<{ constraint_name: string }>(sql`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_name = 'player_intensity_snapshots'
          AND constraint_type = 'UNIQUE'
      `);
      expect(unique.length).toBeGreaterThanOrEqual(1);
    });

    it('player_co_play has CHECK constraint enforcing user_id_a < user_id_b', async () => {
      const checks = await testApp.db.execute<{ check_clause: string }>(sql`
        SELECT check_clause
        FROM information_schema.check_constraints cc
        JOIN information_schema.constraint_column_usage ccu
          ON cc.constraint_name = ccu.constraint_name
        WHERE ccu.table_name = 'player_co_play'
      `);
      const clauses = checks.map((c) => c.check_clause).join(' ');
      expect(clauses).toMatch(/user_id_a.*<.*user_id_b/);
    });
  });

  // ─── AC 3: signal aggregation ───────────────────────────────────

  describe('AC 3: signal aggregation builds taste vectors', () => {
    it('upserts a row with non-zero dimensions for a user with signals', async () => {
      const userId = await seedUser('d:agg1', 'agg1');
      // A co-op game (gameModes: 3 = Coop) with playtime should push co_op > 0
      const coopGame = await seedGame('Coop Ally', [], [3], []);
      await seedInterest(userId, coopGame, 'steam_library', 4000);

      await service.aggregateVectors();

      const [row] = await testApp.db
        .select()
        .from(schema.playerTasteVectors)
        .where(sql`user_id = ${userId}`);
      expect(row).toBeDefined();
      expect(row.dimensions).toEqual(
        expect.objectContaining({
          co_op: expect.any(Number),
        }),
      );
      expect(row.dimensions.co_op).toBeGreaterThan(0);
      expect(Array.isArray(row.vector)).toBe(true);
      expect(row.vector).toHaveLength(7);
      expect(typeof row.signalHash).toBe('string');
      expect(row.signalHash.length).toBeGreaterThan(0);
    });

    it('skips recomputation when signal_hash is unchanged', async () => {
      const userId = await seedUser('d:agg2', 'agg2');
      const game = await seedGame('RPG One', [12], [], [17]);
      await seedInterest(userId, game, 'steam_library', 5000);

      await service.aggregateVectors();
      const [first] = await testApp.db
        .select()
        .from(schema.playerTasteVectors)
        .where(sql`user_id = ${userId}`);

      await service.aggregateVectors(); // second run — no new signals
      const [second] = await testApp.db
        .select()
        .from(schema.playerTasteVectors)
        .where(sql`user_id = ${userId}`);

      expect(second.computedAt.getTime()).toBe(first.computedAt.getTime());
      expect(second.signalHash).toBe(first.signalHash);
    });
  });

  // ─── AC 4: weekly intensity rollup ──────────────────────────────

  describe('AC 4: weekly intensity rollup', () => {
    it('writes a snapshot with totalHours + gameBreakdown + uniqueGames', async () => {
      const userId = await seedUser('d:int1', 'int1');
      const gameA = await seedGame('Game A', [12], [1]);
      const gameB = await seedGame('Game B', [5], [2]);

      const weekStart = new Date();
      weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
      weekStart.setUTCHours(0, 0, 0, 0);

      // Two games, 30000s (8.33h) and 12000s (3.33h) — total 11.66h
      await testApp.db.insert(schema.gameActivityRollups).values([
        {
          userId,
          gameId: gameA,
          period: 'week',
          periodStart: weekStart.toISOString().slice(0, 10),
          totalSeconds: 30000,
        },
        {
          userId,
          gameId: gameB,
          period: 'week',
          periodStart: weekStart.toISOString().slice(0, 10),
          totalSeconds: 12000,
        },
      ]);

      await service.weeklyIntensityRollup();

      const [snap] = await testApp.db
        .select()
        .from(schema.playerIntensitySnapshots)
        .where(sql`user_id = ${userId}`);
      expect(snap).toBeDefined();
      expect(Number(snap.totalHours)).toBeCloseTo(11.67, 1);
      expect(snap.uniqueGames).toBe(2);
      expect(Number(snap.longestSessionHours)).toBeCloseTo(8.33, 1);
      expect(snap.longestSessionGameId).toBe(gameA);
      expect(Array.isArray(snap.gameBreakdown)).toBe(true);
      expect(snap.gameBreakdown).toHaveLength(2);
    });
  });

  // ─── AC 5: co-play graph ────────────────────────────────────────

  describe('AC 5: co-play graph builder', () => {
    it('creates a pair from overlapping voice sessions with canonical ordering', async () => {
      const aliceId = await seedUser('d:alice', 'alice');
      const bobId = await seedUser('d:bob', 'bob');
      const game = await seedGame('Raid Night', [12], [3]);

      const [event] = await testApp.db
        .insert(schema.events)
        .values({
          title: 'Raid',
          gameId: game,
          duration: [
            new Date('2026-04-10T18:00:00Z'),
            new Date('2026-04-10T21:00:00Z'),
          ] as unknown as [Date, Date],
          creatorId: aliceId,
        })
        .returning();

      await testApp.db.insert(schema.eventVoiceSessions).values([
        {
          eventId: event.id,
          userId: aliceId,
          discordUserId: 'd:alice',
          discordUsername: 'alice',
          firstJoinAt: new Date('2026-04-10T18:05:00Z'),
          lastLeaveAt: new Date('2026-04-10T20:55:00Z'),
          totalDurationSec: 10200,
          segments: [
            {
              joinAt: '2026-04-10T18:05:00Z',
              leaveAt: '2026-04-10T20:55:00Z',
              durationSec: 10200,
            },
          ],
        },
        {
          eventId: event.id,
          userId: bobId,
          discordUserId: 'd:bob',
          discordUsername: 'bob',
          firstJoinAt: new Date('2026-04-10T18:10:00Z'),
          lastLeaveAt: new Date('2026-04-10T20:50:00Z'),
          totalDurationSec: 9600,
          segments: [
            {
              joinAt: '2026-04-10T18:10:00Z',
              leaveAt: '2026-04-10T20:50:00Z',
              durationSec: 9600,
            },
          ],
        },
      ]);

      await service.buildCoPlayGraph();

      const rows = await testApp.db.select().from(schema.playerCoPlay);
      expect(rows).toHaveLength(1);
      const [pair] = rows;
      const [lo, hi] = [aliceId, bobId].sort((a, b) => a - b);
      expect(pair.userIdA).toBe(lo);
      expect(pair.userIdB).toBe(hi);
      expect(pair.sessionCount).toBeGreaterThan(0);
      expect(pair.totalMinutes).toBeGreaterThan(0);
      expect(Array.isArray(pair.gamesPlayed)).toBe(true);
      expect(pair.gamesPlayed).toContain(game);
    });
  });

  // ─── AC 9: GET /users/:id/taste-profile ─────────────────────────

  describe('AC 9: GET /users/:id/taste-profile', () => {
    it('returns 200 + dimensions/metrics/archetype for a user with a vector', async () => {
      const userId = await seedUser('d:prof1', 'prof1');
      const game = await seedGame('Strat One', [15], [1], []);
      await seedInterest(userId, game, 'steam_library', 4000);
      await service.aggregateVectors();

      const res = await testApp.request
        .get(`/users/${userId}/taste-profile`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          userId,
          dimensions: expect.objectContaining({
            co_op: expect.any(Number),
            pvp: expect.any(Number),
            rpg: expect.any(Number),
            survival: expect.any(Number),
            strategy: expect.any(Number),
            social: expect.any(Number),
            mmo: expect.any(Number),
          }),
          intensityMetrics: expect.objectContaining({
            intensity: expect.any(Number),
            focus: expect.any(Number),
            breadth: expect.any(Number),
            consistency: expect.any(Number),
          }),
          archetype: expect.stringMatching(
            /^(Dedicated|Specialist|Explorer|Social Drifter|Casual)$/,
          ),
          coPlayPartners: expect.any(Array),
          computedAt: expect.any(String),
        }),
      );
      expect(res.body.coPlayPartners.length).toBeLessThanOrEqual(10);
    });

    it('returns zeroed dimensions + Casual for a user with no vector', async () => {
      const userId = await seedUser('d:prof2', 'prof2');
      const res = await testApp.request
        .get(`/users/${userId}/taste-profile`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.archetype).toBe('Casual');
      for (const axis of Object.values(
        res.body.dimensions as Record<string, number>,
      )) {
        expect(axis).toBe(0);
      }
    });

    it('returns 404 for a nonexistent user', async () => {
      const res = await testApp.request
        .get('/users/999999/taste-profile')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await testApp.request.get('/users/1/taste-profile');
      expect(res.status).toBe(401);
    });
  });

  // ─── AC 10: GET /users/:id/similar-players ──────────────────────

  describe('AC 10: GET /users/:id/similar-players', () => {
    it('returns cosine-ranked list excluding self', async () => {
      const anchor = await seedUser('d:sim0', 'sim0');
      const rpg = await seedGame('RPG Anchor', [12], [1]);
      await seedInterest(anchor, rpg, 'steam_library', 8000);

      // Seed 4 more users with different profiles
      for (let i = 1; i <= 4; i++) {
        const uid = await seedUser(`d:sim${i}`, `sim${i}`);
        const g = await seedGame(
          `G${i}`,
          i % 2 === 0 ? [12] : [5],
          i % 2 === 0 ? [1] : [2],
        );
        await seedInterest(uid, g, 'steam_library', 3000 + i * 500);
      }

      await service.aggregateVectors();

      const res = await testApp.request
        .get(`/users/${anchor}/similar-players?limit=3`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.similar).toBeDefined();
      expect(res.body.similar.length).toBeLessThanOrEqual(3);
      // Self must not appear in results
      for (const s of res.body.similar) {
        expect(s.userId).not.toBe(anchor);
        expect(typeof s.similarity).toBe('number');
      }
      // Sorted by similarity — higher first (or distance lower first)
      for (let i = 1; i < res.body.similar.length; i++) {
        expect(res.body.similar[i - 1].similarity).toBeGreaterThanOrEqual(
          res.body.similar[i].similarity,
        );
      }
    });

    it('returns empty array + 200 for a user with no vector', async () => {
      const uid = await seedUser('d:noneu', 'noneu');
      const res = await testApp.request
        .get(`/users/${uid}/similar-players`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.similar).toEqual([]);
    });

    it('honors default limit of 10 and caps at 50', async () => {
      const uid = await seedUser('d:lim', 'lim');
      const noLimit = await testApp.request
        .get(`/users/${uid}/similar-players`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(noLimit.status).toBe(200);

      const overLimit = await testApp.request
        .get(`/users/${uid}/similar-players?limit=1000`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(overLimit.status).toBe(200);
      expect(overLimit.body.similar.length).toBeLessThanOrEqual(50);
    });
  });
});
