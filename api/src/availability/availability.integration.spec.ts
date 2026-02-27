/**
 * Availability Integration Tests (ROK-526)
 *
 * Verifies availability CRUD, tsrange overlap conflict detection,
 * batch user range queries, and ownership enforcement against a real
 * PostgreSQL database.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as bcrypt from 'bcrypt';
import * as schema from '../drizzle/schema';
import { AvailabilityService } from './availability.service';

/** Helper to create a member user with local credentials and return their token. */
async function createMemberAndLogin(
  testApp: TestApp,
  username: string,
  email: string,
): Promise<{ userId: number; token: string }> {
  const passwordHash = await bcrypt.hash('TestPassword123!', 4);

  const [user] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: `local:${email}`,
      username,
      role: 'member',
    })
    .returning();

  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash,
    userId: user.id,
  });

  const loginRes = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });

  return { userId: user.id, token: loginRes.body.access_token as string };
}

describe('Availability (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  // ===================================================================
  // Basic CRUD
  // ===================================================================

  describe('CRUD operations', () => {
    it('should create an availability window and return it', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'avail1',
        'avail1@test.local',
      );

      const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 3 * 60 * 60 * 1000);

      const createRes = await testApp.request
        .post('/users/me/availability')
        .set('Authorization', `Bearer ${token}`)
        .send({
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          status: 'available',
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body).toMatchObject({
        id: expect.any(String),
        timeRange: {
          start: expect.any(String),
          end: expect.any(String),
        },
        status: 'available',
      });
    });

    it('should list all availability windows for a user', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'avail_list',
        'avail_list@test.local',
      );

      const base = Date.now() + 24 * 60 * 60 * 1000;

      // Create two windows
      await testApp.request
        .post('/users/me/availability')
        .set('Authorization', `Bearer ${token}`)
        .send({
          startTime: new Date(base).toISOString(),
          endTime: new Date(base + 2 * 60 * 60 * 1000).toISOString(),
          status: 'available',
        });

      await testApp.request
        .post('/users/me/availability')
        .set('Authorization', `Bearer ${token}`)
        .send({
          startTime: new Date(base + 4 * 60 * 60 * 1000).toISOString(),
          endTime: new Date(base + 6 * 60 * 60 * 1000).toISOString(),
          status: 'blocked',
        });

      const listRes = await testApp.request
        .get('/users/me/availability')
        .set('Authorization', `Bearer ${token}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.data.length).toBe(2);
      expect(listRes.body.meta.total).toBe(2);
    });

    it('should get a single availability window by ID', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'avail_get',
        'avail_get@test.local',
      );

      const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 3 * 60 * 60 * 1000);

      const createRes = await testApp.request
        .post('/users/me/availability')
        .set('Authorization', `Bearer ${token}`)
        .send({
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        });

      const windowId = createRes.body.id;

      const getRes = await testApp.request
        .get(`/users/me/availability/${windowId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(windowId);
    });

    it('should update an availability window', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'avail_update',
        'avail_update@test.local',
      );

      const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 3 * 60 * 60 * 1000);

      const createRes = await testApp.request
        .post('/users/me/availability')
        .set('Authorization', `Bearer ${token}`)
        .send({
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          status: 'available',
        });

      const windowId = createRes.body.id;

      const updateRes = await testApp.request
        .patch(`/users/me/availability/${windowId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'blocked' });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.status).toBe('blocked');

      // Verify persistence
      const getRes = await testApp.request
        .get(`/users/me/availability/${windowId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.body.status).toBe('blocked');
    });

    it('should delete an availability window', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'avail_delete',
        'avail_delete@test.local',
      );

      const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 3 * 60 * 60 * 1000);

      const createRes = await testApp.request
        .post('/users/me/availability')
        .set('Authorization', `Bearer ${token}`)
        .send({
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        });

      const windowId = createRes.body.id;

      const deleteRes = await testApp.request
        .delete(`/users/me/availability/${windowId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);

      // Verify deleted
      const getRes = await testApp.request
        .get(`/users/me/availability/${windowId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.status).toBe(404);
    });
  });

  // ===================================================================
  // Conflict Detection (tsrange overlap)
  // ===================================================================

  describe('conflict detection', () => {
    it('should detect overlapping committed window on create', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'conflict_user',
        'conflict_user@test.local',
      );

      const base = Date.now() + 24 * 60 * 60 * 1000;

      // Create a committed window: 10:00 - 14:00
      await testApp.request
        .post('/users/me/availability')
        .set('Authorization', `Bearer ${token}`)
        .send({
          startTime: new Date(base).toISOString(),
          endTime: new Date(base + 4 * 60 * 60 * 1000).toISOString(),
          status: 'committed',
        });

      // Create an overlapping window: 12:00 - 16:00
      const overlapRes = await testApp.request
        .post('/users/me/availability')
        .set('Authorization', `Bearer ${token}`)
        .send({
          startTime: new Date(base + 2 * 60 * 60 * 1000).toISOString(),
          endTime: new Date(base + 6 * 60 * 60 * 1000).toISOString(),
          status: 'available',
        });

      expect(overlapRes.status).toBe(201);
      // Should report the conflict
      expect(overlapRes.body.conflicts).toBeDefined();
      expect(overlapRes.body.conflicts.length).toBe(1);
      expect(overlapRes.body.conflicts[0].status).toBe('committed');
    });

    it('should NOT detect conflicts for non-committed/non-blocked windows', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'no_conflict',
        'no_conflict@test.local',
      );

      const base = Date.now() + 24 * 60 * 60 * 1000;

      // Create an available (not committed/blocked) window
      await testApp.request
        .post('/users/me/availability')
        .set('Authorization', `Bearer ${token}`)
        .send({
          startTime: new Date(base).toISOString(),
          endTime: new Date(base + 4 * 60 * 60 * 1000).toISOString(),
          status: 'available',
        });

      // Create an overlapping window — should have no conflicts
      const overlapRes = await testApp.request
        .post('/users/me/availability')
        .set('Authorization', `Bearer ${token}`)
        .send({
          startTime: new Date(base + 2 * 60 * 60 * 1000).toISOString(),
          endTime: new Date(base + 6 * 60 * 60 * 1000).toISOString(),
          status: 'available',
        });

      expect(overlapRes.status).toBe(201);
      expect(overlapRes.body.conflicts).toBeUndefined();
    });

    it('should detect conflicts with blocked windows', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'blocked_conflict',
        'blocked_conflict@test.local',
      );

      const base = Date.now() + 24 * 60 * 60 * 1000;

      // Create a blocked window
      await testApp.request
        .post('/users/me/availability')
        .set('Authorization', `Bearer ${token}`)
        .send({
          startTime: new Date(base).toISOString(),
          endTime: new Date(base + 4 * 60 * 60 * 1000).toISOString(),
          status: 'blocked',
        });

      // Create overlapping window
      const overlapRes = await testApp.request
        .post('/users/me/availability')
        .set('Authorization', `Bearer ${token}`)
        .send({
          startTime: new Date(base + 1 * 60 * 60 * 1000).toISOString(),
          endTime: new Date(base + 3 * 60 * 60 * 1000).toISOString(),
          status: 'available',
        });

      expect(overlapRes.status).toBe(201);
      expect(overlapRes.body.conflicts).toBeDefined();
      expect(overlapRes.body.conflicts[0].status).toBe('blocked');
    });

    it('should exclude same-game conflicts when gameId matches', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'game_excl',
        'game_excl@test.local',
      );

      const base = Date.now() + 24 * 60 * 60 * 1000;
      const gameId = testApp.seed.game.id;

      // Create a committed game-specific window
      await testApp.request
        .post('/users/me/availability')
        .set('Authorization', `Bearer ${token}`)
        .send({
          startTime: new Date(base).toISOString(),
          endTime: new Date(base + 4 * 60 * 60 * 1000).toISOString(),
          status: 'committed',
          gameId,
        });

      // Create overlapping window for the SAME game — should exclude the conflict
      const overlapRes = await testApp.request
        .post('/users/me/availability')
        .set('Authorization', `Bearer ${token}`)
        .send({
          startTime: new Date(base + 2 * 60 * 60 * 1000).toISOString(),
          endTime: new Date(base + 6 * 60 * 60 * 1000).toISOString(),
          status: 'available',
          gameId,
        });

      expect(overlapRes.status).toBe(201);
      // Game-specific exclusion: conflict with same game is excluded
      expect(overlapRes.body.conflicts).toBeUndefined();
    });

    it('should NOT exclude non-adjacent time ranges as conflicts', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'non_overlap',
        'non_overlap@test.local',
      );

      const base = Date.now() + 24 * 60 * 60 * 1000;

      // Create a committed window: 10:00 - 12:00
      await testApp.request
        .post('/users/me/availability')
        .set('Authorization', `Bearer ${token}`)
        .send({
          startTime: new Date(base).toISOString(),
          endTime: new Date(base + 2 * 60 * 60 * 1000).toISOString(),
          status: 'committed',
        });

      // Create a non-overlapping window: 14:00 - 16:00
      const noOverlapRes = await testApp.request
        .post('/users/me/availability')
        .set('Authorization', `Bearer ${token}`)
        .send({
          startTime: new Date(base + 4 * 60 * 60 * 1000).toISOString(),
          endTime: new Date(base + 6 * 60 * 60 * 1000).toISOString(),
          status: 'available',
        });

      expect(noOverlapRes.status).toBe(201);
      expect(noOverlapRes.body.conflicts).toBeUndefined();
    });
  });

  // ===================================================================
  // Batch User Range Query
  // ===================================================================

  describe('batch user range query', () => {
    it('should return availability for multiple users in a time range', async () => {
      const { userId: u1 } = await createMemberAndLogin(
        testApp,
        'batch_u1',
        'batch_u1@test.local',
      );
      const { userId: u2 } = await createMemberAndLogin(
        testApp,
        'batch_u2',
        'batch_u2@test.local',
      );

      const base = Date.now() + 24 * 60 * 60 * 1000;
      const rangeStart = new Date(base);
      const rangeEnd = new Date(base + 24 * 60 * 60 * 1000);

      // Create availability for both users via direct DB insert
      // (findForUsersInRange is a service method without a dedicated controller endpoint)
      await testApp.db.insert(schema.availability).values([
        {
          userId: u1,
          timeRange: [
            new Date(base + 2 * 60 * 60 * 1000),
            new Date(base + 4 * 60 * 60 * 1000),
          ],
          status: 'available',
        },
        {
          userId: u2,
          timeRange: [
            new Date(base + 3 * 60 * 60 * 1000),
            new Date(base + 5 * 60 * 60 * 1000),
          ],
          status: 'committed',
        },
        {
          // Outside range — should NOT be returned
          userId: u1,
          timeRange: [
            new Date(base + 48 * 60 * 60 * 1000),
            new Date(base + 50 * 60 * 60 * 1000),
          ],
          status: 'available',
        },
      ]);

      // Call the service directly (no controller endpoint for multi-user queries)
      const availabilityService = testApp.app.get(AvailabilityService);

      const result = await availabilityService.findForUsersInRange(
        [u1, u2],
        rangeStart.toISOString(),
        rangeEnd.toISOString(),
      );

      expect(result.get(u1)?.length).toBe(1); // Only the in-range window
      expect(result.get(u2)?.length).toBe(1);
      expect(result.get(u1)?.[0].status).toBe('available');
      expect(result.get(u2)?.[0].status).toBe('committed');
    });
  });

  // ===================================================================
  // Ownership Enforcement
  // ===================================================================

  describe('ownership enforcement', () => {
    it("should forbid accessing another user's availability window", async () => {
      const { token: token1 } = await createMemberAndLogin(
        testApp,
        'owner_u1',
        'owner_u1@test.local',
      );
      const { token: token2 } = await createMemberAndLogin(
        testApp,
        'owner_u2',
        'owner_u2@test.local',
      );

      const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 3 * 60 * 60 * 1000);

      // User 1 creates a window
      const createRes = await testApp.request
        .post('/users/me/availability')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        });

      const windowId = createRes.body.id;

      // User 2 tries to access it
      const getRes = await testApp.request
        .get(`/users/me/availability/${windowId}`)
        .set('Authorization', `Bearer ${token2}`);

      expect(getRes.status).toBe(403);
    });

    it("should forbid deleting another user's availability window", async () => {
      const { token: token1 } = await createMemberAndLogin(
        testApp,
        'del_owner1',
        'del_owner1@test.local',
      );
      const { token: token2 } = await createMemberAndLogin(
        testApp,
        'del_owner2',
        'del_owner2@test.local',
      );

      const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 3 * 60 * 60 * 1000);

      const createRes = await testApp.request
        .post('/users/me/availability')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        });

      const windowId = createRes.body.id;

      const deleteRes = await testApp.request
        .delete(`/users/me/availability/${windowId}`)
        .set('Authorization', `Bearer ${token2}`);

      expect(deleteRes.status).toBe(403);
    });
  });

  // ===================================================================
  // Validation
  // ===================================================================

  describe('validation', () => {
    it('should reject window where end time is before start time', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'val_user',
        'val_user@test.local',
      );

      const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const endTime = new Date(startTime.getTime() - 1 * 60 * 60 * 1000);

      const res = await testApp.request
        .post('/users/me/availability')
        .set('Authorization', `Bearer ${token}`)
        .send({
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        });

      expect(res.status).toBe(400);
    });

    it('should reject window exceeding 24 hours', async () => {
      const { token } = await createMemberAndLogin(
        testApp,
        'val_long',
        'val_long@test.local',
      );

      const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 25 * 60 * 60 * 1000);

      const res = await testApp.request
        .post('/users/me/availability')
        .set('Authorization', `Bearer ${token}`)
        .send({
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        });

      expect(res.status).toBe(400);
    });
  });

  // ===================================================================
  // Auth Guards
  // ===================================================================

  describe('auth guards', () => {
    it('should require authentication for availability endpoints', async () => {
      const res = await testApp.request.get('/users/me/availability');
      expect(res.status).toBe(401);
    });

    it('should require authentication for creating availability', async () => {
      const res = await testApp.request.post('/users/me/availability').send({
        startTime: new Date().toISOString(),
        endTime: new Date(Date.now() + 3600000).toISOString(),
      });
      expect(res.status).toBe(401);
    });
  });
});
