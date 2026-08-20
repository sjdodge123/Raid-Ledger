/**
 * Common Ground — co-op group-size filter integration tests (ROK-1400).
 *
 * Written TDD-style BEFORE the feature exists — every test in the
 * `minOnlineCoop` blocks must FAIL on first run (the contract param does
 * not exist yet, so `CommonGroundQuerySchema` strips it and the query is
 * unfiltered). The dev agent builds to make them pass.
 *
 * Precedence rule under test (mirrors `resolvePlayerCap`, ROK-1411):
 *   effective online max = cooptimus_online_max when > 0,
 *                          else player_count->>'max',
 *                          else NULL (row excluded while the filter is on).
 *
 * A ZERO `cooptimus_online_max` is a co-op-capability claim ("no online
 * co-op recorded"), NOT a capacity of zero — it falls THROUGH to the IGDB
 * player count rather than excluding the row.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

function describeCommonGroundCoop() {
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

  /** Create a building lineup via HTTP so the endpoint has one to score. */
  async function createBuildingLineup(): Promise<number> {
    const res = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'ROK-1400 Co-op Filter Test' });
    if (res.status !== 201) {
      throw new Error(
        `createBuildingLineup failed: ${res.status} ${JSON.stringify(res.body)}`,
      );
    }
    return res.body.id as number;
  }

  /**
   * Insert a game owned by the admin (so it clears `minOwners: 1`) with the
   * given co-op / player-count metadata. Co-op columns are set directly on
   * the insert — no Co-Optimus HTTP call, no user-agent involved.
   */
  async function insertOwnedGame(
    name: string,
    overrides: Partial<typeof schema.games.$inferInsert> = {},
  ): Promise<number> {
    const [game] = await testApp.db
      .insert(schema.games)
      .values({
        name,
        slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        steamAppId: Math.floor(Math.random() * 900000) + 100000,
        ...overrides,
      })
      .returning();
    await testApp.db.insert(schema.gameInterests).values({
      userId: testApp.seed.adminUser.id,
      gameId: game.id,
      source: 'steam_library',
    });
    return game.id;
  }

  /** Add a second library owner so a game can clear `minOwners: 2`. */
  async function addSecondOwner(gameId: number, suffix: string): Promise<void> {
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `rok1400:${suffix}`,
        username: `rok1400-${suffix}`,
        role: 'member',
      })
      .returning();
    await testApp.db.insert(schema.gameInterests).values({
      userId: user.id,
      gameId,
      source: 'steam_library',
    });
  }

  /** GET /lineups/common-ground and return the returned game ids. */
  async function fetchGameIds(
    query: Record<string, number | string>,
  ): Promise<{ status: number; ids: number[] }> {
    const res = await testApp.request
      .get('/lineups/common-ground')
      .set('Authorization', `Bearer ${adminToken}`)
      .query(query);
    const ids =
      res.status === 200
        ? (res.body.data as Array<{ gameId: number }>).map((g) => g.gameId)
        : [];
    return { status: res.status, ids };
  }

  // ── Precedence semantics ─────────────────────────────────────

  function describePrecedence() {
    it('includes a game whose positive cooptimus_online_max >= N', async () => {
      await createBuildingLineup();
      const sixPlayerCoop = await insertOwnedGame('Six Player Coop', {
        cooptimusOnlineMax: 6,
        playerCount: null,
      });
      // Control: proves the filter actually ran rather than passing inertly.
      const threePlayerCoop = await insertOwnedGame('Three Player Coop', {
        cooptimusOnlineMax: 3,
        playerCount: null,
      });

      const { status, ids } = await fetchGameIds({
        minOwners: 1,
        minOnlineCoop: 4,
      });

      expect(status).toBe(200);
      expect(ids).toContain(sixPlayerCoop);
      expect(ids).not.toContain(threePlayerCoop);
    });

    it('excludes a game whose positive cooptimus_online_max < N', async () => {
      await createBuildingLineup();
      const twoPlayerCoop = await insertOwnedGame('Two Player Coop', {
        cooptimusOnlineMax: 2,
        playerCount: null,
      });

      const { status, ids } = await fetchGameIds({
        minOwners: 1,
        minOnlineCoop: 4,
      });

      expect(status).toBe(200);
      expect(ids).not.toContain(twoPlayerCoop);
    });

    it('includes a game at the exact boundary (effective max === N)', async () => {
      await createBuildingLineup();
      const exactlyFour = await insertOwnedGame('Exactly Four', {
        cooptimusOnlineMax: 4,
        playerCount: null,
      });
      // One below the boundary must fall out — pins `>=` (not `>`).
      const exactlyThree = await insertOwnedGame('Exactly Three', {
        cooptimusOnlineMax: 3,
        playerCount: null,
      });

      const { status, ids } = await fetchGameIds({
        minOwners: 1,
        minOnlineCoop: 4,
      });

      expect(status).toBe(200);
      expect(ids).toContain(exactlyFour);
      expect(ids).not.toContain(exactlyThree);
    });

    it('lets a positive cooptimus value WIN over a larger IGDB player_count.max', async () => {
      await createBuildingLineup();
      // IGDB says 16 (generic lobby capacity) but Co-Optimus says online
      // co-op tops out at 2 — the Co-Optimus value must win, so a group of
      // 4 does NOT see this game. A COALESCE/GREATEST implementation that
      // takes the IGDB number would wrongly include it.
      const cooptimusWins = await insertOwnedGame('Cooptimus Wins', {
        cooptimusOnlineMax: 2,
        playerCount: { min: 1, max: 16 },
      });

      const { status, ids } = await fetchGameIds({
        minOwners: 1,
        minOnlineCoop: 4,
      });

      expect(status).toBe(200);
      expect(ids).not.toContain(cooptimusWins);
    });

    it('falls back to IGDB player_count.max when cooptimus_online_max is NULL', async () => {
      await createBuildingLineup();
      const igdbOnlyBigEnough = await insertOwnedGame('Igdb Only Eight', {
        cooptimusOnlineMax: null,
        playerCount: { min: 1, max: 8 },
      });
      const igdbOnlyTooSmall = await insertOwnedGame('Igdb Only Two', {
        cooptimusOnlineMax: null,
        playerCount: { min: 1, max: 2 },
      });

      const { status, ids } = await fetchGameIds({
        minOwners: 1,
        minOnlineCoop: 4,
      });

      expect(status).toBe(200);
      expect(ids).toContain(igdbOnlyBigEnough);
      expect(ids).not.toContain(igdbOnlyTooSmall);
    });
  }
  describe(
    'minOnlineCoop — precedence (positive cooptimus wins)',
    describePrecedence,
  );

  // ── Zero falls through (the ROK-1411 edge case) ──────────────

  function describeZeroFallthrough() {
    it('treats cooptimus_online_max = 0 as absent and USES the IGDB max (included)', async () => {
      await createBuildingLineup();
      // Synced with Co-Optimus, no online co-op entry recorded (0), but
      // IGDB knows it supports 8. Zero must NOT exclude the row.
      const zeroWithBigIgdb = await insertOwnedGame('Zero Coop Big Igdb', {
        cooptimusOnlineMax: 0,
        playerCount: { min: 1, max: 8 },
      });
      // Control: same zero, tiny IGDB max — must NOT come back.
      const zeroWithTinyIgdb = await insertOwnedGame('Zero Coop Tiny Igdb', {
        cooptimusOnlineMax: 0,
        playerCount: { min: 1, max: 1 },
      });

      const { status, ids } = await fetchGameIds({
        minOwners: 1,
        minOnlineCoop: 4,
      });

      expect(status).toBe(200);
      expect(ids).toContain(zeroWithBigIgdb);
      expect(ids).not.toContain(zeroWithTinyIgdb);
    });

    it('treats cooptimus_online_max = 0 as absent and EXCLUDES when the IGDB max is too small', async () => {
      await createBuildingLineup();
      const zeroWithSmallIgdb = await insertOwnedGame('Zero Coop Small Igdb', {
        cooptimusOnlineMax: 0,
        playerCount: { min: 1, max: 2 },
      });

      const { status, ids } = await fetchGameIds({
        minOwners: 1,
        minOnlineCoop: 4,
      });

      expect(status).toBe(200);
      expect(ids).not.toContain(zeroWithSmallIgdb);
    });

    it('excludes cooptimus_online_max = 0 with NULL player_count (nothing to fall through to)', async () => {
      await createBuildingLineup();
      const zeroAndNull = await insertOwnedGame('Zero And Null', {
        cooptimusOnlineMax: 0,
        playerCount: null,
      });

      const { status, ids } = await fetchGameIds({
        minOwners: 1,
        minOnlineCoop: 4,
      });

      expect(status).toBe(200);
      expect(ids).not.toContain(zeroAndNull);
    });
  }
  describe(
    'minOnlineCoop — zero falls through to IGDB',
    describeZeroFallthrough,
  );

  // ── NULL-data semantics (AC 2) ───────────────────────────────

  function describeNullData() {
    it('excludes games with NO co-op data at all while the filter is active', async () => {
      await createBuildingLineup();
      const noData = await insertOwnedGame('No Coop Data', {
        cooptimusOnlineMax: null,
        playerCount: null,
      });

      const { status, ids } = await fetchGameIds({
        minOwners: 1,
        minOnlineCoop: 2,
      });

      expect(status).toBe(200);
      expect(ids).not.toContain(noData);
    });

    it('still returns the no-data game when the filter is ABSENT (backward compatible)', async () => {
      await createBuildingLineup();
      const noData = await insertOwnedGame('No Coop Data Absent Param', {
        cooptimusOnlineMax: null,
        playerCount: null,
      });

      const { status, ids } = await fetchGameIds({ minOwners: 1 });

      expect(status).toBe(200);
      expect(ids).toContain(noData);
    });

    it('leaves the unfiltered result set unchanged when minOnlineCoop is absent', async () => {
      await createBuildingLineup();
      const small = await insertOwnedGame('Absent Param Small', {
        cooptimusOnlineMax: 2,
        playerCount: { min: 1, max: 2 },
      });
      const large = await insertOwnedGame('Absent Param Large', {
        cooptimusOnlineMax: 8,
        playerCount: { min: 1, max: 8 },
      });
      const unknown = await insertOwnedGame('Absent Param Unknown', {
        cooptimusOnlineMax: null,
        playerCount: null,
      });

      const { status, ids } = await fetchGameIds({ minOwners: 1 });

      expect(status).toBe(200);
      expect(ids).toEqual(expect.arrayContaining([small, large, unknown]));
    });
  }
  describe('minOnlineCoop — NULL-data semantics', describeNullData);

  // ── Composition with existing filters ────────────────────────

  function describeComposition() {
    it('composes with minOwners — both gates apply independently', async () => {
      await createBuildingLineup();
      // Owned by admin only (1 owner) but supports 8 — minOwners=2 rejects it.
      const underOwned = await insertOwnedGame('Under Owned Big Coop', {
        cooptimusOnlineMax: 8,
        playerCount: { min: 1, max: 8 },
      });
      // 2 owners AND supports 8 — passes both gates.
      const bothPass = await insertOwnedGame('Both Gates Pass', {
        cooptimusOnlineMax: 8,
        playerCount: { min: 1, max: 8 },
      });
      await addSecondOwner(bothPass, 'both-pass');
      // 2 owners but only 2-player co-op — minOnlineCoop rejects it.
      const ownedButTooSmall = await insertOwnedGame('Owned But Too Small', {
        cooptimusOnlineMax: 2,
        playerCount: { min: 1, max: 2 },
      });
      await addSecondOwner(ownedButTooSmall, 'too-small');

      const { status, ids } = await fetchGameIds({
        minOwners: 2,
        minOnlineCoop: 4,
      });

      expect(status).toBe(200);
      expect(ids).toContain(bothPass);
      expect(ids).not.toContain(underOwned);
      expect(ids).not.toContain(ownedButTooSmall);
    });

    it('composes with search — only the matching, big-enough game comes back', async () => {
      await createBuildingLineup();
      const matchBigEnough = await insertOwnedGame('Zephyr Raiders', {
        cooptimusOnlineMax: 8,
        playerCount: null,
      });
      const matchTooSmall = await insertOwnedGame('Zephyr Duel', {
        cooptimusOnlineMax: 2,
        playerCount: null,
      });

      const { status, ids } = await fetchGameIds({
        minOwners: 1,
        minOnlineCoop: 4,
        search: 'Zephyr',
      });

      expect(status).toBe(200);
      expect(ids).toContain(matchBigEnough);
      expect(ids).not.toContain(matchTooSmall);
    });
  }
  describe(
    'minOnlineCoop — composes with existing filters',
    describeComposition,
  );

  // ── Param validation (contract shape) ────────────────────────

  function describeValidation() {
    it('rejects minOnlineCoop=0 (schema min is 1)', async () => {
      await createBuildingLineup();

      const res = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ minOwners: 1, minOnlineCoop: 0 });

      expect(res.status).toBe(400);
    });

    it('rejects a non-numeric minOnlineCoop', async () => {
      await createBuildingLineup();

      const res = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ minOwners: 1, minOnlineCoop: 'four' });

      expect(res.status).toBe(400);
    });

    it('coerces a numeric string minOnlineCoop from the query string', async () => {
      await createBuildingLineup();
      const bigEnough = await insertOwnedGame('Coerce Big', {
        cooptimusOnlineMax: 6,
        playerCount: null,
      });
      const tooSmall = await insertOwnedGame('Coerce Small', {
        cooptimusOnlineMax: 2,
        playerCount: null,
      });

      const { status, ids } = await fetchGameIds({
        minOwners: 1,
        minOnlineCoop: '4',
      });

      expect(status).toBe(200);
      expect(ids).toContain(bigEnough);
      expect(ids).not.toContain(tooSmall);
    });
  }
  describe('minOnlineCoop — param validation', describeValidation);
}

describe(
  'Common Ground co-op group-size filter (integration)',
  describeCommonGroundCoop,
);
