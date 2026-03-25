/**
 * Lineup Phase Scheduling Integration Tests (ROK-946)
 *
 * Verifies automated phase scheduling with configurable durations:
 * - POST /lineups with duration params returns phaseDeadline
 * - GET /lineups/:id includes phaseDeadline
 * - GET /lineups/banner includes phaseDeadline
 * - PATCH /lineups/:id/status (force-advance) updates phaseDeadline
 * - GET /admin/settings/lineup returns default durations
 * - PUT /admin/settings/lineup updates default durations
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';

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
      .send(durations);
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

    it('should use admin defaults when no durations provided', async () => {
      const res = await testApp.request
        .post('/lineups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(201);
      // Without explicit durations, admin defaults (48h building) are applied
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
      const createRes = await createLineupWithDurations(adminToken, {
        buildingDurationHours: 24,
      });
      const lineupId = createRes.body.id as number;

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
      await createLineupWithDurations(adminToken, {
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
      const createRes = await createLineupWithDurations(adminToken, {
        buildingDurationHours: 24,
        votingDurationHours: 48,
        decidedDurationHours: 24,
      });
      const lineupId = createRes.body.id as number;
      const originalDeadline = createRes.body.phaseDeadline;

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
      const createRes = await createLineupWithDurations(adminToken, {
        buildingDurationHours: 24,
        votingDurationHours: 48,
        decidedDurationHours: 24,
      });
      const lineupId = createRes.body.id as number;

      // Walk through all transitions to archived
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'decided', decidedGameId: null });
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

  // ── GET /admin/settings/lineup — default durations ─────────

  function describeGETLineupSettings() {
    it('should return default phase durations', async () => {
      const res = await testApp.request
        .get('/admin/settings/lineup')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        buildingDurationHours: expect.any(Number),
        votingDurationHours: expect.any(Number),
        decidedDurationHours: expect.any(Number),
      });
    });

    it('should require authentication', async () => {
      const res = await testApp.request.get('/admin/settings/lineup');
      expect(res.status).toBe(401);
    });
  }
  describe('GET /admin/settings/lineup', describeGETLineupSettings);

  // ── PUT /admin/settings/lineup — update defaults ───────────

  function describePUTLineupSettings() {
    it('should update default phase durations', async () => {
      const putRes = await testApp.request
        .put('/admin/settings/lineup')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          buildingDurationHours: 48,
          votingDurationHours: 72,
          decidedDurationHours: 12,
        });

      expect(putRes.status).toBe(200);
      expect(putRes.body.success).toBe(true);

      // Verify the updated values are returned on GET
      const getRes = await testApp.request
        .get('/admin/settings/lineup')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body).toMatchObject({
        buildingDurationHours: 48,
        votingDurationHours: 72,
        decidedDurationHours: 12,
      });
    });

    it('should reject invalid duration values', async () => {
      const res = await testApp.request
        .put('/admin/settings/lineup')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          buildingDurationHours: -1,
          votingDurationHours: 48,
          decidedDurationHours: 24,
        });

      expect(res.status).toBe(400);
    });

    it('should require authentication', async () => {
      const res = await testApp.request.put('/admin/settings/lineup').send({
        buildingDurationHours: 24,
        votingDurationHours: 48,
        decidedDurationHours: 24,
      });

      expect(res.status).toBe(401);
    });
  }
  describe('PUT /admin/settings/lineup', describePUTLineupSettings);

  // ── POST /lineups with matchThreshold ─────────────────────

  function describePOSTWithMatchThreshold() {
    it('should accept matchThreshold and return it in detail', async () => {
      const res = await createLineupWithDurations(adminToken, {
        buildingDurationHours: 24,
        matchThreshold: 0.5,
      });

      expect(res.status).toBe(201);
      expect(res.body.matchThreshold).toBe(0.5);
    });

    it('should default matchThreshold to 0.35 when not provided', async () => {
      const res = await createLineupWithDurations(adminToken, {
        buildingDurationHours: 24,
      });

      expect(res.status).toBe(201);
      expect(res.body.matchThreshold).toBe(0.35);
    });

    it('should reject matchThreshold below 0.10', async () => {
      const res = await createLineupWithDurations(adminToken, {
        buildingDurationHours: 24,
        matchThreshold: 0.05,
      });

      expect(res.status).toBe(400);
    });

    it('should reject matchThreshold above 0.75', async () => {
      const res = await createLineupWithDurations(adminToken, {
        buildingDurationHours: 24,
        matchThreshold: 0.9,
      });

      expect(res.status).toBe(400);
    });
  }
  describe('POST /lineups with matchThreshold', describePOSTWithMatchThreshold);

  // ── PATCH /lineups/:id/status — reverse transitions ───────

  function describeReverseTransitions() {
    it('should allow reverting voting back to building', async () => {
      const createRes = await createLineupWithDurations(adminToken, {
        buildingDurationHours: 24,
      });
      const lineupId = createRes.body.id as number;

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

    it('should allow reverting decided back to voting', async () => {
      const createRes = await createLineupWithDurations(adminToken, {
        buildingDurationHours: 24,
        votingDurationHours: 48,
      });
      const lineupId = createRes.body.id as number;

      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'decided', decidedGameId: null });

      // Revert to voting
      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('voting');
    });

    it('should reject skipping phases (building to decided)', async () => {
      const createRes = await createLineupWithDurations(adminToken, {
        buildingDurationHours: 24,
      });
      const lineupId = createRes.body.id as number;

      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'decided' });

      expect(res.status).toBe(400);
    });
  }
  describe('PATCH reverse transitions', describeReverseTransitions);
}
describe('Lineup Phase Scheduling (integration)', describePhaseScheduling);
