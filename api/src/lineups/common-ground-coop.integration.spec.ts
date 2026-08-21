/**
 * Common Ground — co-op group-size filter integration tests (ROK-1400).
 *
 * Written TDD-style BEFORE the feature exists — every test in the
 * `minOnlineCoop` blocks must FAIL on first run (the contract param does
 * not exist yet, so `CommonGroundQuerySchema` strips it and the query is
 * unfiltered). The dev agent builds to make them pass.
 *
 * Rule under test — **Co-Optimus-verified only** (operator decision
 * 2026-08-20 round 2, after PUBG passed a "4+ co-op" filter via the old
 * IGDB fallback):
 *   cooptimus_online_max > 0  → the ONLY way to match
 *   cooptimus_online_max = 0  → fails (synced: no online co-op)
 *   cooptimus_online_max NULL → fails (never synced / unverified)
 *
 * IGDB `player_count.max` is a LOBBY-SIZE estimate, not a co-op capability,
 * and NEVER satisfies this filter. This deliberately diverges from
 * `resolvePlayerCap` (ROK-1411), which does fall back to player_count
 * because it answers a display question, not a filter-correctness one.
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
      // co-op tops out at 2 — the Co-Optimus value decides, so a group of
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

    // Round 2 flip: an unsynced game is UNVERIFIED, so it can never match —
    // its IGDB player count is a lobby-size estimate, not a co-op capability.
    // This is the PUBG case that motivated dropping the fallback.
    it('EXCLUDES an unsynced game no matter how large its IGDB player_count.max', async () => {
      await createBuildingLineup();
      const igdbOnlyBig = await insertOwnedGame('Igdb Only Hundred', {
        cooptimusOnlineMax: null,
        playerCount: { min: 1, max: 100 },
      });
      const igdbOnlyEight = await insertOwnedGame('Igdb Only Eight', {
        cooptimusOnlineMax: null,
        playerCount: { min: 1, max: 8 },
      });
      // Positive control: a Co-Optimus-verified game still comes back, so
      // the exclusions above are the filter working, not an empty page.
      const verified = await insertOwnedGame('Verified Coop', {
        cooptimusOnlineMax: 4,
        playerCount: null,
      });

      const { status, ids } = await fetchGameIds({
        minOwners: 1,
        minOnlineCoop: 4,
      });

      expect(status).toBe(200);
      expect(ids).toContain(verified);
      expect(ids).not.toContain(igdbOnlyBig);
      expect(ids).not.toContain(igdbOnlyEight);
    });
  }
  describe('minOnlineCoop — Co-Optimus-verified only', describePrecedence);

  // ── Zero is an explicit "no online co-op" claim ──────────────
  //
  // Operator-ratified 2026-08-20 (spike §5 filter correctness). A synced
  // `cooptimus_online_max = 0` means "we checked, this game has NO online
  // co-op", so it must FAIL the filter outright. It must NOT fall through
  // to the IGDB player count — PUBG-class PvP titles carry a large IGDB
  // lobby capacity that has nothing to do with co-op, and falling through
  // would let them pass a "4+ co-op" filter.

  function describeZeroExcluded() {
    it('EXCLUDES cooptimus_online_max = 0 even when the IGDB max is large', async () => {
      await createBuildingLineup();
      // Synced with Co-Optimus, no online co-op recorded (0), but IGDB
      // claims 8 (generic lobby capacity). Zero WINS — the row is out.
      const zeroWithBigIgdb = await insertOwnedGame('Zero Coop Big Igdb', {
        cooptimusOnlineMax: 0,
        playerCount: { min: 1, max: 8 },
      });
      const zeroWithTinyIgdb = await insertOwnedGame('Zero Coop Tiny Igdb', {
        cooptimusOnlineMax: 0,
        playerCount: { min: 1, max: 1 },
      });
      // Positive control: proves the query still returns rows, so the two
      // exclusions above are the filter working rather than an empty page.
      const genuineCoop = await insertOwnedGame('Genuine Coop', {
        cooptimusOnlineMax: 6,
        playerCount: null,
      });

      const { status, ids } = await fetchGameIds({
        minOwners: 1,
        minOnlineCoop: 4,
      });

      expect(status).toBe(200);
      expect(ids).toContain(genuineCoop);
      expect(ids).not.toContain(zeroWithBigIgdb);
      expect(ids).not.toContain(zeroWithTinyIgdb);
    });

    it('EXCLUDES cooptimus_online_max = 0 at the smallest possible N (1)', async () => {
      await createBuildingLineup();
      // N=1 is the loosest filter the schema allows; a zero must still fail
      // it, which is only true if zero is compared rather than skipped.
      const zeroWithSmallIgdb = await insertOwnedGame('Zero Coop Small Igdb', {
        cooptimusOnlineMax: 0,
        playerCount: { min: 1, max: 2 },
      });
      const oneCoop = await insertOwnedGame('Solo Coop', {
        cooptimusOnlineMax: 1,
        playerCount: null,
      });

      const { status, ids } = await fetchGameIds({
        minOwners: 1,
        minOnlineCoop: 1,
      });

      expect(status).toBe(200);
      expect(ids).toContain(oneCoop);
      expect(ids).not.toContain(zeroWithSmallIgdb);
    });

    it('excludes cooptimus_online_max = 0 with NULL player_count', async () => {
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
    'minOnlineCoop — zero is an explicit no-online-co-op claim',
    describeZeroExcluded,
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

  // ── meta.coopDataAvailable (ROK-1400 round 2) ────────────────
  //
  // Drives the client's dormant-until-data gate. Keyed on
  // `cooptimus_synced_at` rather than `cooptimus_online_max` so a sync that
  // found no co-op entry still counts as "we have data".

  function describeCoopDataAvailable() {
    async function fetchMeta(): Promise<Record<string, unknown>> {
      const res = await testApp.request
        .get('/lineups/common-ground')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ minOwners: 1 });
      expect(res.status).toBe(200);
      return res.body.meta as Record<string, unknown>;
    }

    it('is false when no game has ever been Co-Optimus-synced', async () => {
      await createBuildingLineup();
      await insertOwnedGame('Never Synced', {
        cooptimusOnlineMax: null,
        cooptimusSyncedAt: null,
      });

      expect(await fetchMeta()).toMatchObject({ coopDataAvailable: false });
    });

    it('is true once any game carries a sync timestamp', async () => {
      await createBuildingLineup();
      await insertOwnedGame('Synced With Coop', {
        cooptimusOnlineMax: 4,
        cooptimusSyncedAt: new Date(),
      });

      expect(await fetchMeta()).toMatchObject({ coopDataAvailable: true });
    });

    it('is true for a synced game even when it has NO co-op (zero)', async () => {
      await createBuildingLineup();
      // "We checked and this game has no online co-op" is still data — the
      // control should be live so the user can filter such titles out.
      await insertOwnedGame('Synced No Coop', {
        cooptimusOnlineMax: 0,
        cooptimusSyncedAt: new Date(),
      });

      expect(await fetchMeta()).toMatchObject({ coopDataAvailable: true });
    });
  }
  describe('meta.coopDataAvailable', describeCoopDataAvailable);

  // ── Row payload (ROK-1401 co-op pill) ────────────────────────

  /**
   * ROK-1401: the nominate tile renders a `👥 N co-op` pill, so the Common
   * Ground row DTO has to carry the RAW `cooptimus_online_max` alongside
   * `playerCount`. Raw means un-blended: the pill is a Co-Optimus CLAIM and
   * must never be manufactured from an IGDB lobby size.
   */
  async function fetchRow(gameId: number): Promise<Record<string, unknown>> {
    const res = await testApp.request
      .get('/lineups/common-ground')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ minOwners: 1, limit: 100 });
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.gameId === gameId);
    expect(row).toBeDefined();
    return row!;
  }

  function describeRowPayload() {
    it('carries a POSITIVE cooptimus_online_max onto the row', async () => {
      await createBuildingLineup();
      const gameId = await insertOwnedGame('ROK-1401 CG Enriched', {
        cooptimusOnlineMax: 4,
        cooptimusSyncedAt: new Date(),
      });

      expect((await fetchRow(gameId)).cooptimusOnlineMax).toBe(4);
    });

    it('carries a SYNCED ZERO through as 0, not null', async () => {
      await createBuildingLineup();
      const gameId = await insertOwnedGame('ROK-1401 CG Synced Empty', {
        cooptimusOnlineMax: 0,
        cooptimusSyncedAt: new Date(),
      });

      expect((await fetchRow(gameId)).cooptimusOnlineMax).toBe(0);
    });

    it('ships NULL for a never-synced game and does NOT blend playerCount', async () => {
      await createBuildingLineup();
      const gameId = await insertOwnedGame('ROK-1401 CG Big Lobby PvP', {
        playerCount: { min: 1, max: 100 },
      });

      const row = await fetchRow(gameId);
      expect(row).toHaveProperty('cooptimusOnlineMax');
      expect(row.cooptimusOnlineMax).toBeNull();
      // playerCount still ships unchanged on its own key.
      expect(row.playerCount).toEqual({ min: 1, max: 100 });
    });
  }
  describe('row payload — cooptimusOnlineMax (ROK-1401)', describeRowPayload);
}

describe(
  'Common Ground co-op group-size filter (integration)',
  describeCommonGroundCoop,
);
