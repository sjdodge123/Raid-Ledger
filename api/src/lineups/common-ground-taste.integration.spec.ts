/**
 * Common Ground — Taste-Scoring Integration Tests (ROK-950).
 *
 * Written TDD-style BEFORE the feature is implemented — every test here
 * must FAIL on first run. The dev agent builds to make them pass.
 *
 * Covers:
 * - AC 4: Common Ground sort factors in taste/social/intensity
 * - AC 5: Common Ground tuning works WITHOUT an AI provider (pure math)
 * - AC 6: Weights configurable via SettingsService — appliedWeights reflects
 *         overrides and the taste-matching game's score rises proportionally
 * - AC 7: Graceful degradation — zero voters, voter missing a taste vector
 */
import { sql } from 'drizzle-orm';
import type { ArchetypeDto } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { TIER_DESCRIPTIONS } from '../taste-profile/archetype-copy';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';

/** Default composed archetype for test fixtures (ROK-1083 jsonb shape). */
const DEFAULT_TEST_ARCHETYPE: ArchetypeDto = {
  intensityTier: 'Regular',
  vectorTitles: [],
  descriptions: {
    tier: TIER_DESCRIPTIONS.Regular,
    titles: [],
  },
};

function describeCommonGroundTaste() {
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

  async function createMember(
    suffix: string,
  ): Promise<typeof schema.users.$inferSelect> {
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `d:${suffix}`,
        username: `user-${suffix}`,
        role: 'member',
      })
      .returning();
    return user;
  }

  async function createBuildingLineup(): Promise<number> {
    const res = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'ROK-950 Common Ground Taste Test' });
    if (res.status !== 201) {
      throw new Error(
        `createBuildingLineup failed: ${res.status} ${JSON.stringify(res.body)}`,
      );
    }
    return res.body.id as number;
  }

  async function insertGame(
    overrides: Partial<typeof schema.games.$inferInsert> = {},
  ): Promise<typeof schema.games.$inferSelect> {
    const slug =
      overrides.slug ??
      `game-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [game] = await testApp.db
      .insert(schema.games)
      .values({
        name: overrides.name ?? 'Some Game',
        slug,
        steamAppId:
          overrides.steamAppId ?? Math.floor(Math.random() * 900000) + 100000,
        ...overrides,
      })
      .returning();
    return game;
  }

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

  /**
   * Insert a real vote row so the user qualifies as an actual lineup voter
   * under the ROK-1086 narrowed `findLineupVoterIds`. The vote target
   * (`gameId`) is not meaningful for taste-scoring math — only membership
   * in the voter set matters.
   */
  async function insertVote(
    lineupId: number,
    userId: number,
    gameId: number,
  ): Promise<void> {
    await testApp.db.insert(schema.communityLineupVotes).values({
      lineupId,
      userId,
      gameId,
    });
  }

  /**
   * Insert a player taste vector directly. The first 7 values of `vector`
   * are the pgvector(7) column; `dimensions` stores the full axis pool.
   * We only fill the axes we care about for each test — others default 0.
   */
  async function insertTasteVector(
    userId: number,
    opts: {
      axisScores: Partial<Record<string, number>>;
      archetype?: ArchetypeDto | Partial<ArchetypeDto>;
      intensity?: number;
    },
  ): Promise<void> {
    // Full pool (must match TASTE_PROFILE_AXIS_POOL order expected by UI)
    const dimensions: Record<string, number> = {
      co_op: 0,
      pvp: 0,
      battle_royale: 0,
      mmo: 0,
      moba: 0,
      fighting: 0,
      shooter: 0,
      racing: 0,
      sports: 0,
      rpg: 0,
      fantasy: 0,
      sci_fi: 0,
      adventure: 0,
      strategy: 0,
      survival: 0,
      crafting: 0,
      automation: 0,
      sandbox: 0,
      horror: 0,
      social: 0,
      roguelike: 0,
      puzzle: 0,
      platformer: 0,
      stealth: 0,
      ...opts.axisScores,
    };
    // pgvector(7) uses the 7 core axes: co_op, pvp, rpg, survival, strategy, social, mmo.
    const vector = [
      dimensions.co_op,
      dimensions.pvp,
      dimensions.rpg,
      dimensions.survival,
      dimensions.strategy,
      dimensions.social,
      dimensions.mmo,
    ];
    const archetype: ArchetypeDto = {
      ...DEFAULT_TEST_ARCHETYPE,
      ...(opts.archetype ?? {}),
    } as ArchetypeDto;
    await testApp.db.insert(schema.playerTasteVectors).values({
      userId,
      vector,

      dimensions: dimensions as any,

      intensityMetrics: {
        intensity: opts.intensity ?? 50,
        focus: 50,
        breadth: 50,
        consistency: 50,
      } as any,

      // ROK-1083: jsonb column accepts the composed archetype object directly.
      archetype,
      signalHash: `test-${userId}-${Date.now()}`,
    });
  }

  // ── AC 4: Common Ground sort factors in taste/social/intensity ────

  describe('AC 4: taste-based sort', () => {
    it("sorts games so voters' shared taste axis wins over an off-axis game", async () => {
      const lineupId = await createBuildingLineup();

      // Two voters with opposing tastes. Both own both games equally so
      // ownership alone cannot decide the sort — taste must break the tie.
      const coopVoter = await createMember('coop');
      const pvpVoter = await createMember('pvp');
      await insertTasteVector(coopVoter.id, { axisScores: { co_op: 90 } });
      await insertTasteVector(pvpVoter.id, { axisScores: { pvp: 90 } });

      // The admin is also a voter to mark the lineup active; give them
      // a slight co_op bias so the combined vector leans co_op.
      await insertTasteVector(testApp.seed.adminUser.id, {
        axisScores: { co_op: 80 },
      });

      const coopGame = await insertGame({
        name: 'Coop Game',
        slug: 'coop-game',
        itadTags: ['Co-op'],
      });
      const pvpGame = await insertGame({
        name: 'PvP Game',
        slug: 'pvp-game',
        itadTags: ['PvP'],
      });

      for (const u of [coopVoter.id, pvpVoter.id, testApp.seed.adminUser.id]) {
        await addGameInterest(u, coopGame.id, 'steam_library');
        await addGameInterest(u, pvpGame.id, 'steam_library');
      }

      // Admin is already `created_by`; wire the two synthetic voters as
      // real vote casters so the narrowed voter-id query picks them up.
      await insertVote(lineupId, coopVoter.id, coopGame.id);
      await insertVote(lineupId, pvpVoter.id, pvpGame.id);

      const res = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ minOwners: 2 });

      expect(res.status).toBe(200);

      const data = res.body.data as Array<{
        gameId: number;
        scoreBreakdown?: { tasteScore?: number };
      }>;
      const coopIdx = data.findIndex((g) => g.gameId === coopGame.id);
      const pvpIdx = data.findIndex((g) => g.gameId === pvpGame.id);

      expect(coopIdx).toBeGreaterThanOrEqual(0);
      expect(pvpIdx).toBeGreaterThanOrEqual(0);
      // Co-op game should sort above the PvP game because the combined
      // voter vector leans co_op.
      expect(coopIdx).toBeLessThan(pvpIdx);

      const coopEntry = data[coopIdx];
      expect(coopEntry.scoreBreakdown).toBeDefined();
      expect(coopEntry.scoreBreakdown!.tasteScore).toBeGreaterThan(0);
    });
  });

  // ── AC: intensity scoring discriminates on playerCount (ROK-1089) ──

  describe('AC: intensity scoring discriminates', () => {
    it("scores a high-player-count game above a low-player-count game when voters' intensity is high", async () => {
      const lineupId = await createBuildingLineup();

      // Two voters whose average intensity metric lands them in the
      // 'high' bucket (≥67). Keep taste vectors empty so taste score
      // cannot confound the comparison.
      const voterA = await createMember('intA');
      const voterB = await createMember('intB');
      await insertTasteVector(voterA.id, {
        axisScores: {},
        intensity: 90,
      });
      await insertTasteVector(voterB.id, {
        axisScores: {},
        intensity: 90,
      });
      await insertTasteVector(testApp.seed.adminUser.id, {
        axisScores: {},
        intensity: 90,
      });

      // Two games that differ ONLY in playerCount so the intensity signal
      // is the sole discriminator. Same itadTags, same ownership.
      const lowGame = await insertGame({
        name: 'Solo Game',
        slug: 'solo-game-intensity',
        itadTags: [],
        playerCount: { min: 1, max: 2 },
      });
      const highGame = await insertGame({
        name: 'Raid Game',
        slug: 'raid-game-intensity',
        itadTags: [],
        playerCount: { min: 1, max: 64 },
      });

      for (const u of [voterA.id, voterB.id, testApp.seed.adminUser.id]) {
        await addGameInterest(u, lowGame.id, 'steam_library');
        await addGameInterest(u, highGame.id, 'steam_library');
      }

      // Admin is creator; add real votes for the synthetic voters.
      await insertVote(lineupId, voterA.id, highGame.id);
      await insertVote(lineupId, voterB.id, highGame.id);

      const res = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ minOwners: 2 });

      expect(res.status).toBe(200);

      const data = res.body.data as Array<{
        gameId: number;
        scoreBreakdown?: { intensityScore: number };
      }>;
      const highEntry = data.find((g) => g.gameId === highGame.id);
      const lowEntry = data.find((g) => g.gameId === lowGame.id);

      expect(highEntry).toBeDefined();
      expect(lowEntry).toBeDefined();
      expect(highEntry!.scoreBreakdown!.intensityScore).toBeGreaterThan(0);
      expect(lowEntry!.scoreBreakdown!.intensityScore).toBe(0);
    });
  });

  // ── AC 5: works without an AI provider ───────────────────────────

  describe('AC 5: pure-math tuning (no AI provider)', () => {
    it('returns scored results without crashing when no LLM provider is registered', async () => {
      // The test module boots without `LlmService` configured to resolve a
      // provider. If the code path touches the provider registry, this
      // request would throw — we require the endpoint still respond 200.
      const lineupId = await createBuildingLineup();
      const voter = await createMember('nollm');
      await insertTasteVector(voter.id, { axisScores: { rpg: 80 } });

      const game = await insertGame({
        name: 'RPG Game',
        slug: 'rpg-game-ac5',
        itadTags: ['RPG'],
      });
      await addGameInterest(voter.id, game.id, 'steam_library');
      await addGameInterest(
        testApp.seed.adminUser.id,
        game.id,
        'steam_library',
      );
      await insertVote(lineupId, voter.id, game.id);

      const res = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ minOwners: 2 });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);

      const entry = (
        res.body.data as Array<{
          gameId: number;
          score: number;
          scoreBreakdown?: { tasteScore?: number };
        }>
      ).find((g) => g.gameId === game.id);
      expect(entry).toBeDefined();
      expect(typeof entry!.score).toBe('number');
      expect(entry!.scoreBreakdown).toBeDefined();
    });
  });

  // ── AC 6: weights configurable via SettingsService ───────────────

  describe('AC 6: weights configurable via SettingsService', () => {
    it('honors overridden tasteWeight — reflected in meta.appliedWeights and in taste score', async () => {
      const lineupId = await createBuildingLineup();

      const voter = await createMember('ac6');
      await insertTasteVector(voter.id, { axisScores: { strategy: 90 } });

      const game = await insertGame({
        name: 'Strategy Game',
        slug: 'strategy-game-ac6',
        itadTags: ['Strategy'],
      });
      await addGameInterest(voter.id, game.id, 'steam_library');
      await addGameInterest(
        testApp.seed.adminUser.id,
        game.id,
        'steam_library',
      );
      await insertVote(lineupId, voter.id, game.id);

      // Baseline request with default weights
      const baseline = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ minOwners: 2 });
      expect(baseline.status).toBe(200);
      const baseEntry = (
        baseline.body.data as Array<{
          gameId: number;
          scoreBreakdown?: { tasteScore: number };
        }>
      ).find((g) => g.gameId === game.id);
      expect(baseEntry).toBeDefined();
      const baseTasteScore = baseEntry!.scoreBreakdown!.tasteScore;

      // Override the taste weight via SettingsService to a higher value
      const settings = testApp.app.get(SettingsService);
      await settings.set(SETTING_KEYS.COMMON_GROUND_TASTE_WEIGHT, '100');

      const overridden = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ minOwners: 2 });

      expect(overridden.status).toBe(200);
      expect(overridden.body.meta.appliedWeights).toEqual(
        expect.objectContaining({
          tasteWeight: 100,
        }),
      );

      const overEntry = (
        overridden.body.data as Array<{
          gameId: number;
          scoreBreakdown?: { tasteScore: number };
        }>
      ).find((g) => g.gameId === game.id);
      expect(overEntry).toBeDefined();
      expect(overEntry!.scoreBreakdown!.tasteScore).toBeGreaterThan(
        baseTasteScore,
      );
    });

    it('exposes appliedWeights including tasteWeight, socialWeight, intensityWeight', async () => {
      await createBuildingLineup();

      const res = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.meta.appliedWeights).toEqual(
        expect.objectContaining({
          ownerWeight: expect.any(Number),
          saleBonus: expect.any(Number),
          fullPricePenalty: expect.any(Number),
          tasteWeight: expect.any(Number),
          socialWeight: expect.any(Number),
          intensityWeight: expect.any(Number),
        }),
      );
    });
  });

  // ── AC 7: graceful degradation ───────────────────────────────────

  describe('AC 7: graceful degradation', () => {
    it('returns results with zeroed new score factors when there are no voters', async () => {
      await createBuildingLineup();

      // Only admin owns games; no one has cast votes. We verify that the
      // endpoint still scores games without crashing.
      const game = await insertGame({
        name: 'Zero Voter Game',
        slug: 'zero-voter-game',
        itadTags: ['RPG'],
      });
      await addGameInterest(
        testApp.seed.adminUser.id,
        game.id,
        'steam_library',
      );

      // Remove any taste vectors to ensure zero voters exist
      await testApp.db.execute(
        sql`DELETE FROM player_taste_vectors WHERE 1 = 1`,
      );

      const res = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ minOwners: 1 });

      expect(res.status).toBe(200);
      const entry = (
        res.body.data as Array<{
          gameId: number;
          score: number;
          scoreBreakdown?: {
            tasteScore: number;
            socialScore: number;
            intensityScore: number;
            baseScore: number;
          };
        }>
      ).find((g) => g.gameId === game.id);
      expect(entry).toBeDefined();
      expect(entry!.scoreBreakdown).toBeDefined();
      expect(entry!.scoreBreakdown!.tasteScore).toBe(0);
      expect(entry!.scoreBreakdown!.socialScore).toBe(0);
      expect(entry!.scoreBreakdown!.intensityScore).toBe(0);
      // Base score should still reflect ownership × owner-weight (unchanged)
      expect(entry!.scoreBreakdown!.baseScore).toBeGreaterThan(0);
    });

    it('ignores a voter missing a taste vector without crashing; other voters still contribute', async () => {
      const lineupId = await createBuildingLineup();

      const voterWithVec = await createMember('withvec');
      const voterNoVec = await createMember('novec');
      // Only one voter has a vector — the other must be silently skipped
      await insertTasteVector(voterWithVec.id, { axisScores: { co_op: 90 } });

      const game = await insertGame({
        name: 'Co-op Game',
        slug: 'coop-game-ac7',
        itadTags: ['Co-op'],
      });
      await addGameInterest(voterWithVec.id, game.id, 'steam_library');
      await addGameInterest(voterNoVec.id, game.id, 'steam_library');
      await addGameInterest(
        testApp.seed.adminUser.id,
        game.id,
        'steam_library',
      );

      // Both users must cast real votes so they land in the voter set
      // post-ROK-1086. voterNoVec must be a real voter for the
      // "missing vector → silently skipped" scenario to be exercised.
      await insertVote(lineupId, voterWithVec.id, game.id);
      await insertVote(lineupId, voterNoVec.id, game.id);

      const res = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ minOwners: 2 });

      expect(res.status).toBe(200);
      const entry = (
        res.body.data as Array<{
          gameId: number;
          scoreBreakdown?: { tasteScore: number };
        }>
      ).find((g) => g.gameId === game.id);
      expect(entry).toBeDefined();
      // The voter with a vector contributes a non-zero taste score even
      // though the other voter has no vector.
      expect(entry!.scoreBreakdown!.tasteScore).toBeGreaterThan(0);
    });
  });
}

describe(
  'Common Ground — Taste Scoring (integration)',
  describeCommonGroundTaste,
);
