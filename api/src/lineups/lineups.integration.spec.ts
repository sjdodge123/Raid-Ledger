/**
 * Community Lineup Integration Tests (ROK-933)
 *
 * Verifies lineup CRUD and status transitions against a real PostgreSQL
 * database via HTTP endpoints, including auth guard enforcement.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

function describeLineups() {
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

  async function loginAsOperator(): Promise<string> {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('OperatorPass1!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: 'local:operator@test.local',
        username: 'operator',
        role: 'operator',
      })
      .returning();
    await testApp.db.insert(schema.localCredentials).values({
      email: 'operator@test.local',
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email: 'operator@test.local', password: 'OperatorPass1!' });
    return res.body.access_token as string;
  }

  async function loginAsMember(): Promise<string> {
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
    return res.body.access_token as string;
  }

  async function createLineup(token: string) {
    return testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${token}`)
      .send({});
  }

  async function addEntry(lineupId: number, gameId: number, userId: number) {
    await testApp.db.insert(schema.communityLineupEntries).values({
      lineupId,
      gameId,
      nominatedBy: userId,
    });
  }

  // ── POST /lineups ────────────────────────────────────────────

  function describePOST() {
    it('should create a lineup and return detail', async () => {
      const res = await createLineup(adminToken);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: expect.any(Number),
        status: 'building',
        entries: [],
        totalVoters: 0,
      });
    });

    it('should accept targetDate', async () => {
      const res = await testApp.request
        .post('/lineups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ targetDate: '2026-04-15T00:00:00Z' });

      expect(res.status).toBe(201);
      expect(res.body.targetDate).toBeTruthy();
    });

    it('should persist lineup in DB', async () => {
      await createLineup(adminToken);

      const rows = await testApp.db.select().from(schema.communityLineups);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('building');
    });

    it('should return 409 when active lineup exists', async () => {
      await createLineup(adminToken);
      const res = await createLineup(adminToken);

      expect(res.status).toBe(409);
    });

    it('should require authentication', async () => {
      const res = await testApp.request.post('/lineups').send({});
      expect(res.status).toBe(401);
    });

    it('should reject member role', async () => {
      const memberToken = await loginAsMember();
      const res = await createLineup(memberToken);
      expect(res.status).toBe(403);
    });

    it('should allow operator role', async () => {
      const opToken = await loginAsOperator();
      const res = await createLineup(opToken);
      expect(res.status).toBe(201);
    });
  }
  describe('POST /lineups', describePOST);

  // ── GET /lineups/active ──────────────────────────────────────

  function describeGETActive() {
    it('should return the active lineup', async () => {
      await createLineup(adminToken);
      const res = await testApp.request
        .get('/lineups/active')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('building');
    });

    it('should return 404 when no active lineup', async () => {
      const res = await testApp.request
        .get('/lineups/active')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('should be accessible to members', async () => {
      await createLineup(adminToken);
      const memberToken = await loginAsMember();

      const res = await testApp.request
        .get('/lineups/active')
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(200);
    });

    it('should require authentication', async () => {
      const res = await testApp.request.get('/lineups/active');
      expect(res.status).toBe(401);
    });
  }
  describe('GET /lineups/active', describeGETActive);

  // ── GET /lineups/:id ─────────────────────────────────────────

  function describeGETById() {
    it('should return lineup detail with entries', async () => {
      const createRes = await createLineup(adminToken);
      const lineupId = createRes.body.id as number;

      // Add an entry directly in DB
      await addEntry(lineupId, testApp.seed.game.id, testApp.seed.adminUser.id);

      const res = await testApp.request
        .get(`/lineups/${lineupId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(1);
      expect(res.body.entries[0]).toMatchObject({
        gameId: testApp.seed.game.id,
        gameName: 'Test Game',
        voteCount: 0,
        carriedOver: false,
      });
    });

    it('should include vote counts', async () => {
      const createRes = await createLineup(adminToken);
      const lineupId = createRes.body.id as number;

      await addEntry(lineupId, testApp.seed.game.id, testApp.seed.adminUser.id);

      // Add a vote
      await testApp.db.insert(schema.communityLineupVotes).values({
        lineupId,
        userId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
      });

      const res = await testApp.request
        .get(`/lineups/${lineupId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.body.entries[0].voteCount).toBe(1);
      expect(res.body.totalVoters).toBe(1);
    });

    it('should return 404 for nonexistent lineup', async () => {
      const res = await testApp.request
        .get('/lineups/99999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  }
  describe('GET /lineups/:id', describeGETById);

  // ── PATCH /lineups/:id/status ────────────────────────────────

  function describePATCHStatus() {
    it('should transition building → voting', async () => {
      const createRes = await createLineup(adminToken);
      const lineupId = createRes.body.id as number;

      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('voting');
    });

    it('should set votingDeadline on building → voting', async () => {
      const createRes = await createLineup(adminToken);
      const lineupId = createRes.body.id as number;
      const deadline = '2026-04-01T00:00:00Z';

      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting', votingDeadline: deadline });

      expect(res.status).toBe(200);
      expect(res.body.votingDeadline).toBeTruthy();
    });

    it('should transition voting → decided with decidedGameId', async () => {
      const createRes = await createLineup(adminToken);
      const lineupId = createRes.body.id as number;

      // Add entry and move to voting
      await addEntry(lineupId, testApp.seed.game.id, testApp.seed.adminUser.id);
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });

      // Now decide
      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'decided', decidedGameId: testApp.seed.game.id });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('decided');
      expect(res.body.decidedGameId).toBe(testApp.seed.game.id);
      expect(res.body.decidedGameName).toBe('Test Game');
    });

    it('should transition decided → archived', async () => {
      const createRes = await createLineup(adminToken);
      const lineupId = createRes.body.id as number;

      await addEntry(lineupId, testApp.seed.game.id, testApp.seed.adminUser.id);
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'scheduling' });
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'decided', decidedGameId: testApp.seed.game.id });

      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'archived' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('archived');
    });

    it('should reject invalid transition building → decided', async () => {
      const createRes = await createLineup(adminToken);
      const lineupId = createRes.body.id as number;

      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'decided', decidedGameId: testApp.seed.game.id });

      expect(res.status).toBe(400);
    });

    it('should allow reversion voting → building', async () => {
      const createRes = await createLineup(adminToken);
      const lineupId = createRes.body.id as number;

      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });

      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'building' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('building');
    });

    it('should allow decided → scheduling (advance to scheduling phase)', async () => {
      const createRes = await createLineup(adminToken);
      const lineupId = createRes.body.id as number;

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
        .send({ status: 'scheduling' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('scheduling');
    });

    it('should reject decidedGameId not in entries', async () => {
      const createRes = await createLineup(adminToken);
      const lineupId = createRes.body.id as number;

      // Create a second game not in the lineup
      const [otherGame] = await testApp.db
        .insert(schema.games)
        .values({ name: 'Other Game', slug: 'other-game' })
        .returning();

      await addEntry(lineupId, testApp.seed.game.id, testApp.seed.adminUser.id);
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'scheduling' });

      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'decided', decidedGameId: otherGame.id });

      expect(res.status).toBe(400);
    });

    it('should reject member role', async () => {
      const createRes = await createLineup(adminToken);
      const lineupId = createRes.body.id as number;
      const memberToken = await loginAsMember();

      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ status: 'voting' });

      expect(res.status).toBe(403);
    });

    it('should return 404 for nonexistent lineup', async () => {
      const res = await testApp.request
        .patch('/lineups/99999/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });

      expect(res.status).toBe(404);
    });
  }
  describe('PATCH /lineups/:id/status', describePATCHStatus);

  // ── Active lineup constraint (cross-endpoint) ────────────────

  function describeActiveConstraint() {
    it('should allow creating after archiving previous lineup', async () => {
      // Create → vote → scheduling → decide → archive
      const res1 = await createLineup(adminToken);
      const id = res1.body.id as number;
      await addEntry(id, testApp.seed.game.id, testApp.seed.adminUser.id);

      await testApp.request
        .patch(`/lineups/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });
      await testApp.request
        .patch(`/lineups/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'scheduling' });
      await testApp.request
        .patch(`/lineups/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'decided', decidedGameId: testApp.seed.game.id });
      await testApp.request
        .patch(`/lineups/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'archived' });

      // Now create a new one — should succeed
      const res2 = await createLineup(adminToken);
      expect(res2.status).toBe(201);
    });

    it('should block creating while voting is active', async () => {
      const res1 = await createLineup(adminToken);
      const id = res1.body.id as number;
      await testApp.request
        .patch(`/lineups/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });

      const res2 = await createLineup(adminToken);
      expect(res2.status).toBe(409);
    });
  }
  describe('Active lineup constraint', describeActiveConstraint);
}
describe('Lineups (integration)', describeLineups);
