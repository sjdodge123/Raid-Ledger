/**
 * Co-op fit signals — API payload integration tests (ROK-1401).
 *
 * Written TDD-style BEFORE the feature exists: every assertion on
 * `cooptimusOnlineMax` MUST fail on first run, because neither
 * `LineupEntryResponseSchema` nor `MatchDetailResponseSchema` carries the
 * field yet (the DTO mappers never select it, so the key is `undefined`).
 *
 * What the UI needs and this spec pins:
 *   1. `GET /lineups/:id` → every entry carries `cooptimusOnlineMax`, the RAW
 *      `games.cooptimus_online_max` value — positive, 0, or null. VotingRow's
 *      badge is a CO-OP CLAIM (spec rule 1): Co-Optimus-verified only, so the
 *      transport must NOT pre-blend IGDB `player_count` into this field.
 *      `playerCount` continues to ship alongside it, untouched.
 *   2. `GET /lineups/:id/matches` → every match DTO carries the same raw
 *      value, so MatchCard can recompute the badge against the LIVE
 *      `members.length` on every render (bandwagon joins move the
 *      denominator; the persisted `fitType` goes stale).
 *
 * `playerCap` (ROK-1411) is a DIFFERENT field answering a different question
 * (capacity, with IGDB fallback). Both must coexist on the match DTO — the
 * assertions below check them together so a dev cannot "simplify" by
 * collapsing the two.
 *
 * Co-op columns are seeded by direct drizzle INSERT on games this spec
 * creates — no Co-Optimus HTTP call, no user-agent anywhere near this file.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

function describeCoopFitPayloads() {
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

  // ── Fixtures ─────────────────────────────────────────────────

  /**
   * Insert a game with explicit co-op / player-count metadata.
   * `cooptimusOnlineMax` is written straight onto the row — the three states
   * (positive / synced-zero / never-synced) are what the UI branches on.
   */
  async function insertGame(
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
        ...overrides,
      })
      .returning();
    return game.id;
  }

  /** Create a lineup and nominate the given games into it. */
  async function createLineupWith(gameIds: number[]): Promise<number> {
    const res = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'ROK-1401 Co-op Fit Payloads' });
    if (res.status !== 201) {
      throw new Error(
        `createLineupWith failed: ${res.status} ${JSON.stringify(res.body)}`,
      );
    }
    const lineupId = res.body.id as number;
    for (const gameId of gameIds) {
      await testApp.db.insert(schema.communityLineupEntries).values({
        lineupId,
        gameId,
        nominatedBy: testApp.seed.adminUser.id,
      });
    }
    return lineupId;
  }

  /** GET /lineups/:id and return its entries keyed by gameId. */
  async function fetchEntries(
    lineupId: number,
  ): Promise<Map<number, Record<string, unknown>>> {
    const res = await testApp.request
      .get(`/lineups/${lineupId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const entries = res.body.entries as Array<Record<string, unknown>>;
    return new Map(entries.map((e) => [e.gameId as number, e]));
  }

  /** Drive a lineup to decided so matches exist, then return the flat list. */
  async function fetchMatches(
    lineupId: number,
    gameIds: number[],
  ): Promise<Map<number, Record<string, unknown>>> {
    await testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'voting' });
    for (const gameId of gameIds) {
      await testApp.db.insert(schema.communityLineupVotes).values({
        lineupId,
        userId: testApp.seed.adminUser.id,
        gameId,
      });
    }
    await testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'decided' });

    const res = await testApp.request
      .get(`/lineups/${lineupId}/matches`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const flat = [
      ...(res.body.scheduling ?? []),
      ...(res.body.almostThere ?? []),
      ...(res.body.rallyYourCrew ?? []),
    ] as Array<Record<string, unknown>>;
    return new Map(flat.map((m) => [m.gameId as number, m]));
  }

  // ── Entry mapping (VotingRow's data source) ──────────────────

  function describeEntryMapping() {
    it('carries a POSITIVE cooptimus_online_max onto the entry DTO', async () => {
      const gameId = await insertGame('ROK-1401 Enriched Entry', {
        cooptimusOnlineMax: 4,
        cooptimusSyncedAt: new Date(),
      });
      const lineupId = await createLineupWith([gameId]);

      const entry = (await fetchEntries(lineupId)).get(gameId);
      expect(entry).toBeDefined();
      expect(entry?.cooptimusOnlineMax).toBe(4);
    });

    it('carries a SYNCED ZERO through as 0, not null (0 ≠ "no data")', async () => {
      // 0 means "asked, no online co-op". The UI suppresses the badge for it
      // just like null, but the transport must not lose the distinction —
      // other surfaces (coopDataAvailable, filters) depend on it.
      const gameId = await insertGame('ROK-1401 Synced Empty Entry', {
        cooptimusOnlineMax: 0,
        cooptimusSyncedAt: new Date(),
      });
      const lineupId = await createLineupWith([gameId]);

      const entry = (await fetchEntries(lineupId)).get(gameId);
      expect(entry?.cooptimusOnlineMax).toBe(0);
    });

    it('carries NULL for a never-synced game', async () => {
      const gameId = await insertGame('ROK-1401 Unsynced Entry');
      const lineupId = await createLineupWith([gameId]);

      const entry = (await fetchEntries(lineupId)).get(gameId);
      expect(entry).toHaveProperty('cooptimusOnlineMax');
      expect(entry?.cooptimusOnlineMax).toBeNull();
    });

    it('does NOT blend IGDB player_count into cooptimusOnlineMax (rule 1)', async () => {
      // The co-op CLAIM is Co-Optimus-only. A PvP title with a 100-player
      // IGDB lobby and no Co-Optimus entry must ship `null` here — falling
      // back would make PUBG look like a 100-player co-op game.
      const gameId = await insertGame('ROK-1401 Big Lobby PvP', {
        playerCount: { min: 1, max: 100 },
      });
      const lineupId = await createLineupWith([gameId]);

      const entry = (await fetchEntries(lineupId)).get(gameId);
      expect(entry?.cooptimusOnlineMax).toBeNull();
      // playerCount still ships unchanged on its own key.
      expect(entry?.playerCount).toEqual({ min: 1, max: 100 });
    });

    it('ships the field for every entry in a mixed lineup', async () => {
      const enriched = await insertGame('ROK-1401 Mixed Enriched', {
        cooptimusOnlineMax: 6,
        cooptimusSyncedAt: new Date(),
      });
      const unsynced = await insertGame('ROK-1401 Mixed Unsynced');
      const lineupId = await createLineupWith([enriched, unsynced]);

      const entries = await fetchEntries(lineupId);
      expect(entries.get(enriched)?.cooptimusOnlineMax).toBe(6);
      expect(entries.get(unsynced)?.cooptimusOnlineMax).toBeNull();
    });
  }
  describe('GET /lineups/:id — entry mapping', describeEntryMapping);

  // ── Match detail DTO (MatchCard's data source) ───────────────

  function describeMatchDto() {
    it('carries a POSITIVE cooptimus_online_max onto the match DTO', async () => {
      const gameId = await insertGame('ROK-1401 Enriched Match', {
        cooptimusOnlineMax: 4,
        cooptimusSyncedAt: new Date(),
      });
      const lineupId = await createLineupWith([gameId]);

      const match = (await fetchMatches(lineupId, [gameId])).get(gameId);
      expect(match).toBeDefined();
      expect(match?.cooptimusOnlineMax).toBe(4);
    });

    it('carries NULL for a never-synced game', async () => {
      const gameId = await insertGame('ROK-1401 Unsynced Match');
      const lineupId = await createLineupWith([gameId]);

      const match = (await fetchMatches(lineupId, [gameId])).get(gameId);
      expect(match).toHaveProperty('cooptimusOnlineMax');
      expect(match?.cooptimusOnlineMax).toBeNull();
    });

    it('carries a SYNCED ZERO through as 0', async () => {
      const gameId = await insertGame('ROK-1401 Synced Empty Match', {
        cooptimusOnlineMax: 0,
        cooptimusSyncedAt: new Date(),
      });
      const lineupId = await createLineupWith([gameId]);

      const match = (await fetchMatches(lineupId, [gameId])).get(gameId);
      expect(match?.cooptimusOnlineMax).toBe(0);
    });

    it('keeps cooptimusOnlineMax and playerCap as SEPARATE fields', async () => {
      // Two rules, two fields. `playerCap` (ROK-1411) resolves cooptimus-then-
      // IGDB for the "X of Y players" copy; `cooptimusOnlineMax` is the raw
      // co-op claim the badge needs. A synced ZERO is the case that pulls
      // them apart: playerCap falls through to IGDB max 10, the raw claim
      // stays 0.
      const gameId = await insertGame('ROK-1401 Cap vs Claim', {
        cooptimusOnlineMax: 0,
        cooptimusSyncedAt: new Date(),
        playerCount: { min: 2, max: 10 },
      });
      const lineupId = await createLineupWith([gameId]);

      const match = (await fetchMatches(lineupId, [gameId])).get(gameId);
      expect(match?.cooptimusOnlineMax).toBe(0);
      expect(match?.playerCap).toBe(10);
    });

    it('keeps playerCap on the cooptimus value when it is positive', async () => {
      const gameId = await insertGame('ROK-1401 Cap Wins', {
        cooptimusOnlineMax: 4,
        cooptimusSyncedAt: new Date(),
        playerCount: { min: 1, max: 100 },
      });
      const lineupId = await createLineupWith([gameId]);

      const match = (await fetchMatches(lineupId, [gameId])).get(gameId);
      expect(match?.cooptimusOnlineMax).toBe(4);
      expect(match?.playerCap).toBe(4);
    });
  }
  describe('GET /lineups/:id/matches — match detail DTO', describeMatchDto);

  // ── fitType precedence, end to end ───────────────────────────

  function describeFitType() {
    it('persists an oversubscribed fitType against the COOPTIMUS cap, not the IGDB lobby', async () => {
      // Mirrors the classifyFit unit test through the real matching pass:
      // IGDB says 100 (lobby size), Co-Optimus says 4. Three voters is
      // inside the IGDB band but the game only co-ops 4 — the persisted
      // fitType must come from the cooptimus-resolved max.
      const gameId = await insertGame('ROK-1401 FitType Precedence', {
        cooptimusOnlineMax: 1,
        cooptimusSyncedAt: new Date(),
        playerCount: { min: 1, max: 100 },
      });
      const lineupId = await createLineupWith([gameId]);

      // Two extra voters so voterCount (3) exceeds the cooptimus cap (1)
      // while staying far inside the IGDB max (100).
      const [u1] = await testApp.db
        .insert(schema.users)
        .values({
          discordId: 'rok1401:voter-1',
          username: 'rok1401-voter-1',
          role: 'member',
        })
        .returning();
      const [u2] = await testApp.db
        .insert(schema.users)
        .values({
          discordId: 'rok1401:voter-2',
          username: 'rok1401-voter-2',
          role: 'member',
        })
        .returning();

      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });
      for (const userId of [testApp.seed.adminUser.id, u1.id, u2.id]) {
        await testApp.db
          .insert(schema.communityLineupVotes)
          .values({ lineupId, userId, gameId });
      }
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'decided' });

      const res = await testApp.request
        .get(`/lineups/${lineupId}/matches`)
        .set('Authorization', `Bearer ${adminToken}`);
      const flat = [
        ...(res.body.scheduling ?? []),
        ...(res.body.almostThere ?? []),
        ...(res.body.rallyYourCrew ?? []),
      ] as Array<Record<string, unknown>>;
      const match = flat.find((m) => m.gameId === gameId);
      expect(match?.voteCount).toBe(3);
      expect(match?.fitType).toBe('oversubscribed');
    });
  }
  describe('fitType precedence (end to end)', describeFitType);

  // ── Banner entries (LineupBanner thumbnail pill) ─────────────

  /**
   * ROK-1401: the Games-page banner thumbnails render the `👥 N co-op` pill,
   * so `GET /lineups/banner` entries carry the same RAW value. Gating is
   * per-entry — an enriched nomination and an unsynced one coexist in one
   * banner payload.
   */
  async function fetchBannerEntries(): Promise<
    Map<number, Record<string, unknown>>
  > {
    const res = await testApp.request
      .get('/lineups/banner')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const entries = (res.body.entries ?? []) as Array<Record<string, unknown>>;
    return new Map(entries.map((e) => [e.gameId as number, e]));
  }

  function describeBannerEntries() {
    it('carries a POSITIVE cooptimus_online_max onto a banner entry', async () => {
      const gameId = await insertGame('ROK-1401 Banner Enriched', {
        cooptimusOnlineMax: 4,
        cooptimusSyncedAt: new Date(),
      });
      await createLineupWith([gameId]);

      expect((await fetchBannerEntries()).get(gameId)?.cooptimusOnlineMax).toBe(
        4,
      );
    });

    it('gates per entry — enriched and unsynced coexist in one payload', async () => {
      const enriched = await insertGame('ROK-1401 Banner Mixed Enriched', {
        cooptimusOnlineMax: 6,
        cooptimusSyncedAt: new Date(),
      });
      const unsynced = await insertGame('ROK-1401 Banner Mixed Unsynced', {
        playerCount: { min: 1, max: 100 },
      });
      await createLineupWith([enriched, unsynced]);

      const entries = await fetchBannerEntries();
      expect(entries.get(enriched)?.cooptimusOnlineMax).toBe(6);
      expect(entries.get(unsynced)).toHaveProperty('cooptimusOnlineMax');
      // No IGDB fallback: a 100-player lobby is not a co-op claim.
      expect(entries.get(unsynced)?.cooptimusOnlineMax).toBeNull();
    });

    it('carries a SYNCED ZERO through as 0', async () => {
      const gameId = await insertGame('ROK-1401 Banner Synced Empty', {
        cooptimusOnlineMax: 0,
        cooptimusSyncedAt: new Date(),
      });
      await createLineupWith([gameId]);

      expect((await fetchBannerEntries()).get(gameId)?.cooptimusOnlineMax).toBe(
        0,
      );
    });
  }
  describe('GET /lineups/banner — entry payload', describeBannerEntries);
}

describe(
  'Co-op fit signals — API payloads (integration)',
  describeCoopFitPayloads,
);
