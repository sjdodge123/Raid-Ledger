/**
 * Quest Progress Integration Tests (ROK-569)
 *
 * Verifies quest progress upsert, event progress retrieval, and
 * sharable quest coverage queries against a real PostgreSQL database
 * via HTTP endpoints.
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';

/** Create a test event owned by the admin user. */
async function createTestEvent(
  testApp: TestApp,
  title: string,
): Promise<typeof schema.events.$inferSelect> {
  const now = new Date();
  const later = new Date(now.getTime() + 3600_000);
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title,
      creatorId: testApp.seed.adminUser.id,
      duration: [now, later],
    })
    .returning();
  return event;
}

describe('Quest Progress (integration)', () => {
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

  // ===================================================================
  // PUT /plugins/wow-classic/events/:eventId/quest-progress (updateProgress)
  // ===================================================================

  describe('PUT /plugins/wow-classic/events/:eventId/quest-progress', () => {
    it('should insert new quest progress entry', async () => {
      const event = await createTestEvent(testApp, 'Quest Run');

      const res = await testApp.request
        .put(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ questId: 1001, pickedUp: true, completed: false });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        eventId: event.id,
        questId: 1001,
        pickedUp: true,
        completed: false,
        username: expect.any(String),
      });
    });

    it('should update existing progress entry (upsert)', async () => {
      const event = await createTestEvent(testApp, 'Upsert Event');

      // First insert
      await testApp.request
        .put(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ questId: 2001, pickedUp: true, completed: false });

      // Update to completed
      const res = await testApp.request
        .put(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ questId: 2001, completed: true });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        questId: 2001,
        pickedUp: true,
        completed: true,
      });
    });

    it('should require authentication', async () => {
      const event = await createTestEvent(testApp, 'No Auth Event');

      const res = await testApp.request
        .put(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .send({ questId: 3001, pickedUp: true });

      expect(res.status).toBe(401);
    });

    it('should reject invalid body (missing questId)', async () => {
      const event = await createTestEvent(testApp, 'Bad Body Event');

      const res = await testApp.request
        .put(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ pickedUp: true });

      expect(res.status).toBe(400);
    });
  });

  // ===================================================================
  // GET /plugins/wow-classic/events/:eventId/quest-progress
  // ===================================================================

  describe('GET /plugins/wow-classic/events/:eventId/quest-progress', () => {
    it('should return all progress entries with usernames', async () => {
      const event = await createTestEvent(testApp, 'Progress Event');

      // Seed progress via API
      await testApp.request
        .put(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ questId: 4001, pickedUp: true, completed: false });

      await testApp.request
        .put(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ questId: 4002, pickedUp: true, completed: true });

      const res = await testApp.request
        .get(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
      expect(res.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            questId: 4001,
            pickedUp: true,
            completed: false,
            username: expect.any(String),
          }),
          expect.objectContaining({
            questId: 4002,
            pickedUp: true,
            completed: true,
            username: expect.any(String),
          }),
        ]),
      );
    });

    it('should return empty array for event with no progress', async () => {
      const event = await createTestEvent(testApp, 'Empty Progress Event');

      const res = await testApp.request
        .get(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should require authentication', async () => {
      const event = await createTestEvent(testApp, 'Auth Check Event');

      const res = await testApp.request.get(
        `/plugins/wow-classic/events/${event.id}/quest-progress`,
      );

      expect(res.status).toBe(401);
    });
  });

  // ===================================================================
  // GET /plugins/wow-classic/events/:eventId/quest-coverage
  // ===================================================================

  describe('GET /plugins/wow-classic/events/:eventId/quest-coverage', () => {
    it('should return coverage grouped by questId', async () => {
      const event = await createTestEvent(testApp, 'Coverage Event');

      // Mark two quests as picked up
      await testApp.request
        .put(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ questId: 5001, pickedUp: true });

      await testApp.request
        .put(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ questId: 5002, pickedUp: true });

      const res = await testApp.request
        .get(`/plugins/wow-classic/events/${event.id}/quest-coverage`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);

      for (const entry of res.body) {
        expect(entry).toMatchObject({
          questId: expect.any(Number),
          coveredBy: expect.arrayContaining([
            expect.objectContaining({
              userId: expect.any(Number),
              username: expect.any(String),
            }),
          ]),
        });
      }
    });

    it('should exclude quests that are not picked up', async () => {
      const event = await createTestEvent(testApp, 'Not Picked Up Event');

      // Insert progress with pickedUp=false
      await testApp.request
        .put(`/plugins/wow-classic/events/${event.id}/quest-progress`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ questId: 6001, pickedUp: false, completed: false });

      const res = await testApp.request
        .get(`/plugins/wow-classic/events/${event.id}/quest-coverage`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should require authentication', async () => {
      const event = await createTestEvent(testApp, 'Coverage Auth Event');

      const res = await testApp.request.get(
        `/plugins/wow-classic/events/${event.id}/quest-coverage`,
      );

      expect(res.status).toBe(401);
    });
  });
});
