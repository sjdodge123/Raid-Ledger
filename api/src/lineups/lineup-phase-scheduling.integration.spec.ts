/**
 * Lineup Phase Scheduling Integration Tests (ROK-946)
 *
 * Verifies automated phase scheduling with configurable durations:
 * - POST /lineups with duration params returns phaseDeadline
 * - GET /lineups/:id includes phaseDeadline
 * - GET /lineups/banner includes phaseDeadline
 * - PATCH /lineups/:id/status (force-advance) updates phaseDeadline
 *
 * ROK-1060: removed coverage for /admin/settings/lineup — the admin panel
 * and its endpoints have been deleted. The hardcoded `DEFAULT_DURATIONS`
 * constant is exercised by the "should use admin defaults" case below.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

function describePhaseScheduling() {
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

  function createLineupWithDurations(
    token: string,
    durations: {
      buildingDurationHours?: number;
      votingDurationHours?: number;
      decidedDurationHours?: number;
      matchThreshold?: number;
    } = {},
  ) {
    return testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Phase Scheduling Test', ...durations });
  }

  /**
   * Create a lineup and assert POST succeeded with a real row id. Use this
   * for any test whose subsequent assertions depend on the lineup existing.
   *
   * Background: a flake reported during the ROK-1250 stability loop showed
   * `GET /lineups/banner` returning 200 with body `{}` — supertest's empty-
   * body fallback (`superagent/lib/node/response.js:60`). The 4 banner-style
   * tests below previously fired POST without checking the result, so an
   * upstream POST failure (auth glitch / contention) surfaced as a
   * misleading "phaseDeadline missing" assertion. Asserting POST here
   * surfaces the real cause on the next reproduction.
   */
  async function createLineupOrFail(
    token: string,
    durations: Parameters<typeof createLineupWithDurations>[1] = {},
  ): Promise<{ id: number; phaseDeadline: string | null }> {
    const res = await createLineupWithDurations(token, durations);
    if (res.status !== 201 || typeof res.body?.id !== 'number') {
      throw new Error(
        `createLineupOrFail: expected 201 with body.id, got status=${res.status} body=${JSON.stringify(res.body)}`,
      );
    }
    return { id: res.body.id, phaseDeadline: res.body.phaseDeadline ?? null };
  }

  // ── POST /lineups with duration params ──────────────────────

  function describePOSTWithDurations() {
    it('should accept duration params and return phaseDeadline', async () => {
      const res = await createLineupWithDurations(adminToken, {
        buildingDurationHours: 24,
        votingDurationHours: 48,
        decidedDurationHours: 24,
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: expect.any(Number),
        status: 'building',
        phaseDeadline: expect.any(String),
      });

      // phaseDeadline should be a valid ISO date roughly 24h from now
      const deadline = new Date(res.body.phaseDeadline);
      expect(deadline.getTime()).toBeGreaterThan(Date.now());
      const hoursUntilDeadline =
        (deadline.getTime() - Date.now()) / (1000 * 60 * 60);
      expect(hoursUntilDeadline).toBeGreaterThan(22);
      expect(hoursUntilDeadline).toBeLessThan(25);
    });

    it('should use hardcoded DEFAULT_DURATIONS when no durations provided', async () => {
      const res = await testApp.request
        .post('/lineups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Phase Scheduling Default' });

      expect(res.status).toBe(201);
      // ROK-1060: without overrides, the hardcoded DEFAULT_DURATIONS.building
      // (48h, see api/src/lineups/queue/lineup-phase.constants.ts) is used.
      expect(res.body).toHaveProperty('phaseDeadline');
      expect(res.body.phaseDeadline).not.toBeNull();
      const deadline = new Date(res.body.phaseDeadline);
      const hoursUntilDeadline =
        (deadline.getTime() - Date.now()) / (1000 * 60 * 60);
      expect(hoursUntilDeadline).toBeGreaterThan(46);
      expect(hoursUntilDeadline).toBeLessThan(49);
    });
  }
  describe('POST /lineups with duration params', describePOSTWithDurations);

  // ── GET /lineups/:id includes phaseDeadline ─────────────────

  function describeGETByIdPhaseDeadline() {
    it('should include phaseDeadline in lineup detail', async () => {
      const { id: lineupId } = await createLineupOrFail(adminToken, {
        buildingDurationHours: 24,
      });

      const res = await testApp.request
        .get(`/lineups/${lineupId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('phaseDeadline');
      expect(res.body.phaseDeadline).toBeTruthy();

      // Should be a valid ISO date string
      const deadline = new Date(res.body.phaseDeadline);
      expect(deadline.getTime()).toBeGreaterThan(Date.now());
    });
  }
  describe(
    'GET /lineups/:id includes phaseDeadline',
    describeGETByIdPhaseDeadline,
  );

  // ── GET /lineups/banner includes phaseDeadline ──────────────

  function describeGETBannerPhaseDeadline() {
    it('should include phaseDeadline in banner response', async () => {
      await createLineupOrFail(adminToken, {
        buildingDurationHours: 24,
      });

      const res = await testApp.request
        .get('/lineups/banner')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('phaseDeadline');
      expect(res.body.phaseDeadline).toBeTruthy();
    });
  }
  describe(
    'GET /lineups/banner includes phaseDeadline',
    describeGETBannerPhaseDeadline,
  );

  // ── PATCH /lineups/:id/status (force-advance) ──────────────

  function describePATCHForceAdvance() {
    it('should update phaseDeadline when force-advancing building to voting', async () => {
      const { id: lineupId, phaseDeadline: originalDeadline } =
        await createLineupOrFail(adminToken, {
          buildingDurationHours: 24,
          votingDurationHours: 48,
          decidedDurationHours: 24,
        });

      // Force-advance to voting
      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('voting');
      expect(res.body.phaseDeadline).toBeTruthy();

      // phaseDeadline should be different (now ~48h for voting phase)
      expect(res.body.phaseDeadline).not.toBe(originalDeadline);
      const deadline = new Date(res.body.phaseDeadline);
      const hoursUntilDeadline =
        (deadline.getTime() - Date.now()) / (1000 * 60 * 60);
      expect(hoursUntilDeadline).toBeGreaterThan(46);
      expect(hoursUntilDeadline).toBeLessThan(49);
    });

    it('should clear phaseDeadline when transitioning to archived', async () => {
      const { id: lineupId } = await createLineupOrFail(adminToken, {
        buildingDurationHours: 24,
        votingDurationHours: 48,
        decidedDurationHours: 24,
      });

      // Walk through all transitions to archived
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'decided' });
      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'archived' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('archived');
      expect(res.body.phaseDeadline).toBeNull();
    });
  }
  describe(
    'PATCH /lineups/:id/status updates phaseDeadline',
    describePATCHForceAdvance,
  );

  // ── POST /lineups with matchThreshold ─────────────────────

  function describePOSTWithMatchThreshold() {
    it('should accept matchThreshold and return it in detail', async () => {
      const res = await createLineupWithDurations(adminToken, {
        buildingDurationHours: 24,
        matchThreshold: 50,
      });

      expect(res.status).toBe(201);
      expect(res.body.matchThreshold).toBe(50);
    });

    it('should default matchThreshold to 35 when not provided', async () => {
      const res = await createLineupWithDurations(adminToken, {
        buildingDurationHours: 24,
      });

      expect(res.status).toBe(201);
      expect(res.body.matchThreshold).toBe(35);
    });

    it('should reject matchThreshold below 0', async () => {
      const res = await createLineupWithDurations(adminToken, {
        buildingDurationHours: 24,
        matchThreshold: -1,
      });

      expect(res.status).toBe(400);
    });

    it('should reject matchThreshold above 100', async () => {
      const res = await createLineupWithDurations(adminToken, {
        buildingDurationHours: 24,
        matchThreshold: 101,
      });

      expect(res.status).toBe(400);
    });
  }
  describe('POST /lineups with matchThreshold', describePOSTWithMatchThreshold);

  // ── PATCH /lineups/:id/status — reverse transitions ───────

  function describeReverseTransitions() {
    it('should allow reverting voting back to building', async () => {
      const { id: lineupId } = await createLineupOrFail(adminToken, {
        buildingDurationHours: 24,
      });

      // Advance to voting
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });

      // Revert to building
      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'building' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('building');
      expect(res.body.phaseDeadline).toBeTruthy();
    });

    it('should allow reverting archived back to decided', async () => {
      const { id: lineupId } = await createLineupOrFail(adminToken, {
        buildingDurationHours: 24,
        votingDurationHours: 48,
        decidedDurationHours: 24,
      });

      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'decided' });
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'archived' });

      // Revert to decided (one step back)
      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'decided' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('decided');
    });

    it('should reject skipping phases (building to decided)', async () => {
      const { id: lineupId } = await createLineupOrFail(adminToken, {
        buildingDurationHours: 24,
      });

      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'decided' });

      expect(res.status).toBe(400);
    });
  }
  describe('PATCH reverse transitions', describeReverseTransitions);

  // ── ROK-1306: wrong-game-link regression ───────────────────
  //
  // Reproduces the prod 2026-05-15 failure: Lineup #115 decided, was reverted
  // to voting, decided again — but `buildMatchesForLineup`'s `onConflictDoNothing`
  // silently dropped the second insert and the lineup ended up wired to the
  // OLD match row including its stale scheduling poll (ORBITALIS #9). The fix
  // is delete-then-insert per decide. Tests below pin both:
  //   (a) each decide spawns fresh match ids — no carry-over of suggested/
  //       scheduling matches from the prior decide.
  //   (b) `GET /lineups/:lineupId/schedule/:matchId` returns 404 when the
  //       match belongs to a different lineup (route guard).

  async function seedGame(name: string, slug: string) {
    const [game] = await testApp.db
      .insert(schema.games)
      .values({ name, slug })
      .returning();
    return game;
  }

  async function nominateAndVote(
    lineupId: number,
    gameIds: number[],
  ): Promise<void> {
    for (const gameId of gameIds) {
      await testApp.db.insert(schema.communityLineupEntries).values({
        lineupId,
        gameId,
        nominatedBy: testApp.seed.adminUser.id,
      });
    }
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
  }

  async function advanceToDecided(
    lineupId: number,
    decidedGameId: number,
  ): Promise<void> {
    await testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'decided', decidedGameId });
  }

  async function fetchMatchIdsForLineup(lineupId: number): Promise<number[]> {
    const rows = await testApp.db
      .select({ id: schema.communityLineupMatches.id })
      .from(schema.communityLineupMatches)
      .where(eq(schema.communityLineupMatches.lineupId, lineupId));
    return rows.map((r) => r.id).sort((a, b) => a - b);
  }

  function describeWrongGameLinkRegression() {
    it('decide → revert → decide spawns FRESH match ids per game (no carry-over)', async () => {
      const game1 = await seedGame('Helldivers 2', 'helldivers-2-r1306');
      const game2 = await seedGame('Destiny 2', 'destiny-2-r1306');
      const game3 = await seedGame('Valheim', 'valheim-r1306');

      const { id: lineupId } = await createLineupOrFail(adminToken, {
        buildingDurationHours: 24,
        votingDurationHours: 48,
        decidedDurationHours: 24,
      });

      await nominateAndVote(lineupId, [game1.id, game2.id, game3.id]);
      await advanceToDecided(lineupId, game1.id);

      const firstIds = await fetchMatchIdsForLineup(lineupId);
      expect(firstIds.length).toBeGreaterThan(0);

      // Revert decided → voting (the path the operator clicked in prod).
      const revertRes = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });
      expect(revertRes.status).toBe(200);

      // Advance to decided again — buildMatchesForLineup must wipe the prior
      // suggested/scheduling matches before re-inserting. Otherwise the new
      // insert silently drops on uq_lineup_match_game and the lineup ends up
      // wired to the STALE match row from the first decide.
      await advanceToDecided(lineupId, game1.id);
      const secondIds = await fetchMatchIdsForLineup(lineupId);

      // Same number of matches per game.
      expect(secondIds).toHaveLength(firstIds.length);
      // BUT every id must differ from the first round — proves we
      // deleted-then-re-inserted instead of silently keeping the old rows.
      for (const id of secondIds) {
        expect(firstIds).not.toContain(id);
      }
    });

    it('preserves the decide → scheduling state when no revert happens (sanity)', async () => {
      // Negative control: a single decide with no revert must produce stable
      // match ids — the delete-then-insert pass must not run a second time
      // when nothing triggers a re-decide.
      const game1 = await seedGame('Halo', 'halo-r1306');

      const { id: lineupId } = await createLineupOrFail(adminToken);
      await nominateAndVote(lineupId, [game1.id]);
      await advanceToDecided(lineupId, game1.id);

      const before = await fetchMatchIdsForLineup(lineupId);
      expect(before.length).toBeGreaterThan(0);

      // A no-op GET on the lineup must not regenerate matches.
      const detail = await testApp.request
        .get(`/lineups/${lineupId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(detail.status).toBe(200);

      const after = await fetchMatchIdsForLineup(lineupId);
      expect(after).toEqual(before);
    });

    it('GET /lineups/:lineupId/schedule/:matchId returns 404 when matchId belongs to a different lineup', async () => {
      // Build TWO lineups so we have a matchId from lineup A and try to load
      // it under lineup B's URL — the prod failure shape generalised.
      const game = await seedGame('Cross Lineup Game', 'cross-lineup-r1306');

      const { id: lineupA } = await createLineupOrFail(adminToken);
      await nominateAndVote(lineupA, [game.id]);
      await advanceToDecided(lineupA, game.id);
      const [matchIdA] = await fetchMatchIdsForLineup(lineupA);
      expect(matchIdA).toBeDefined();

      // Use a deliberately unrelated 2nd lineup id — does NOT need to have
      // a real match of its own; the guard only needs match.lineupId ≠
      // requested lineupId.
      const { id: lineupB } = await createLineupOrFail(adminToken);

      const res = await testApp.request
        .get(`/lineups/${lineupB}/schedule/${matchIdA}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
      // Must be the domain guard message, not a route-not-found.
      expect(res.body.message).toMatch(/match not found in this lineup/i);
    });

    it('zero-vote re-decide STILL wipes prior suggested/scheduling matches (Codex P2 #4)', async () => {
      // The hostile path Codex flagged: first decide produces real matches,
      // then the operator (or test fixture) retracts every vote and triggers
      // a re-decide. Before the fix, buildMatchesForLineup short-circuited
      // on totalVoters === 0 BEFORE calling wipeStaleMatches, so the prior
      // suggested/scheduling rows survived and the wrong-game-link bug
      // could resurface for the zero-vote re-decide.
      const game = await seedGame('Zero Vote Wipe Game', 'zero-vote-r1306');

      const { id: lineupId } = await createLineupOrFail(adminToken);
      await nominateAndVote(lineupId, [game.id]);
      await advanceToDecided(lineupId, game.id);

      const before = await fetchMatchIdsForLineup(lineupId);
      expect(before.length).toBeGreaterThan(0);

      // Revert to voting so we can mutate vote state freely.
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });

      // Drop every vote — simulates the "operator retracted, then force-
      // decided via explicit decidedGameId" path.
      await testApp.db
        .delete(schema.communityLineupVotes)
        .where(eq(schema.communityLineupVotes.lineupId, lineupId));

      await advanceToDecided(lineupId, game.id);

      // Post-fix: every suggested/scheduling match from the first decide is
      // wiped, leaving only the matches the empty re-decide would create
      // (which is zero — no votes, so no new inserts). The bug pre-fix would
      // have left the original rows in place.
      const after = await fetchMatchIdsForLineup(lineupId);
      const overlap = after.filter((id) => before.includes(id));
      expect(overlap).toHaveLength(0);
    });

    it('GET /lineups/:lineupId/schedule/:matchId still succeeds for the correct lineup', async () => {
      // Positive control: the route guard must not break the happy path.
      const game = await seedGame('Happy Path Game', 'happy-path-r1306');

      const { id: lineupId } = await createLineupOrFail(adminToken);
      await nominateAndVote(lineupId, [game.id]);
      await advanceToDecided(lineupId, game.id);
      const [matchId] = await fetchMatchIdsForLineup(lineupId);
      expect(matchId).toBeDefined();

      const res = await testApp.request
        .get(`/lineups/${lineupId}/schedule/${matchId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.match.id).toBe(matchId);
    });
  }
  describe(
    'ROK-1306: wrong-game-link regression',
    describeWrongGameLinkRegression,
  );
}
describe('Lineup Phase Scheduling (integration)', describePhaseScheduling);
